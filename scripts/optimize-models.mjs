// Turns the Blender source exports (blender/export_src/*.glb: lossless textures, no compression)
// into the web-ready models in public/models/:
//
//   1. dedup + prune, merge plain-colour materials into a palette, join meshes that share a material
//   2. cap texture sizes: detail models 2048 for screens, 1024 for other colour maps, 512 for
//      normal maps; carousel models 1024, normal maps 256
//   3. KTX2 GPU textures: UASTC for data maps (normals etc.), ETC1S for colour maps. The palette
//      textures stay PNG: they're tiny, and block compression or mipmaps would bleed their colours
//   4. Meshopt geometry compression
//
// Usage: npm run optimize [-- --no-ktx] [-- --out <dir>]   (KTX2 needs KTX-Software's `toktx` on the PATH)
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS, KHRTextureBasisu } from '@gltf-transform/extensions'
import { checkKTXSoftware, Mode, toktx } from '@gltf-transform/cli'
import {
  dedup,
  join as joinMeshes,
  listTextureSlots,
  meshopt,
  palette,
  prune,
  textureCompress,
} from '@gltf-transform/functions'
import { MeshoptEncoder } from 'meshoptimizer'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, '../blender/export_src')
const outArg = process.argv.indexOf('--out')
const outDir = outArg > 0 ? process.argv[outArg + 1] : join(root, 'public/models')

/**
 * Largest texture side. Detail models are seen close up, but only their screens (emissive textures)
 * fill enough of the view to need 2048; carousel models are seen at a distance. Normal maps only
 * carry fine surface detail and cost the most, so they get the smallest caps.
 */
const MAX_DETAIL_SCREEN = 2048
const MAX_DETAIL = 1024
const MAX_NORMAL_DETAIL = 512
const MAX_CAROUSEL = 1024
const MAX_NORMAL_CAROUSEL = 256
/** UASTC rate-distortion optimisation: trades a barely visible loss for much better zstd packing. */
const UASTC_RDO_LAMBDA = 6
/** Texture slots holding data rather than colour: encoded as UASTC, which keeps them accurate. */
const DATA_SLOTS = /normal|occlusion|metallicRoughness/i
/** Every texture except the palette ones (see above). */
const NOT_PALETTE = /^(?!Palette)/

const withKtx = !process.argv.includes('--no-ktx')
if (withKtx) {
  try {
    await checkKTXSoftware(console)
  } catch (e) {
    console.error(`${e.message}\nInstall KTX-Software (github.com/KhronosGroup/KTX-Software/releases), or pass --no-ktx`)
    process.exit(1)
  }
}

await MeshoptEncoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
mkdirSync(outDir, { recursive: true })

const run = promisify(execFile)
const work = mkdtempSync(join(tmpdir(), 'optimize-models-'))

/**
 * UASTC for the data maps, run through `ktx create` directly: gltf-transform 4.5.1 drops the RDO
 * flags when it drives `ktx create`, and without RDO these maps barely compress.
 */
function uastcDataMaps(prefix) {
  return async (doc) => {
    const basisu = doc.createExtension(KHRTextureBasisu).setRequired(true)
    const textures = doc.getRoot().listTextures()
    await Promise.all(
      textures.map(async (texture, i) => {
        const mime = texture.getMimeType()
        if (mime === 'image/ktx2' || !NOT_PALETTE.test(texture.getName())) return
        if (!listTextureSlots(texture).some((slot) => DATA_SLOTS.test(slot))) return
        // Block compression needs sides in multiples of 4; data maps don't use alpha.
        const [w, h] = texture.getSize()
        const png = await sharp(texture.getImage())
          .resize(Math.ceil(w / 4) * 4, Math.ceil(h / 4) * 4, { fit: 'fill' })
          .removeAlpha()
          .png()
          .toBuffer()
        const src = join(work, `${prefix}-${i}.png`)
        const dst = join(work, `${prefix}-${i}.ktx2`)
        writeFileSync(src, png)
        await run('ktx', [
          'create', '--generate-mipmap', '--encode', 'uastc', '--uastc-quality', '2',
          '--uastc-rdo', '--uastc-rdo-l', String(UASTC_RDO_LAMBDA), '--zstd', '18',
          '--assign-tf', 'linear', '--assign-primaries', 'none', '--format', 'R8G8B8_UNORM', src, dst,
        ])
        texture.setImage(readFileSync(dst)).setMimeType('image/ktx2')
        if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.\w+$/, '.ktx2'))
      }),
    )
    if (!textures.some((t) => t.getMimeType() === 'image/ktx2')) basisu.dispose()
  }
}

const kb = (file) => `${Math.round(statSync(file).size / 1024)} KB`

for (const name of readdirSync(srcDir).filter((f) => f.endsWith('.glb')).sort()) {
  const src = join(srcDir, name)
  const out = join(outDir, name)
  const detail = name.endsWith('_detail.glb')
  const maxScreen = detail ? MAX_DETAIL_SCREEN : MAX_CAROUSEL
  const maxSurface = detail ? MAX_DETAIL : MAX_CAROUSEL
  const maxNormal = detail ? MAX_NORMAL_DETAIL : MAX_NORMAL_CAROUSEL
  const doc = await io.read(src)
  // Screens: every texture used for emission (some double as base colour).
  const screens = doc
    .getRoot()
    .listTextures()
    .filter((t) => listTextureSlots(t).includes('emissiveTexture'))
    .map((t) => t.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const notScreen = screens.length ? new RegExp(`^(?!(${screens.join('|')})$)`) : null
  await doc.transform(
    // 1–2. Structure and texture sizes. join() only merges primitives within a mesh or across
    // sibling nodes, so the MacBook lids (under their hinge nodes) stay separate parts.
    dedup(),
    prune(),
    palette({ min: 3 }),
    joinMeshes(),
    prune(),
    textureCompress({ encoder: sharp, resize: [maxNormal, maxNormal], slots: /normal/i }),
    textureCompress({ encoder: sharp, resize: [maxSurface, maxSurface], pattern: notScreen }),
    textureCompress({ encoder: sharp, resize: [maxScreen, maxScreen] }),
    // 3. GPU textures: data maps first, then colour maps (already-KTX textures are skipped).
    ...(withKtx
      ? [
          uastcDataMaps(name),
          toktx({ mode: Mode.ETC1S, pattern: NOT_PALETTE, encoder: sharp, quality: 192 }),
        ]
      : []),
    // 4. Geometry.
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  )
  await io.write(out, doc)
  console.log(`${name.padEnd(20)} ${kb(src).padStart(9)} → ${kb(out).padStart(8)}`)
}
