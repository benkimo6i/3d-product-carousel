// Copies three.js's Basis (KTX2) transcoder into public/ so compressed textures load without a CDN.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules/three/examples/jsm/libs/basis')
const dest = join(root, 'public/basis')

if (existsSync(src)) {
  mkdirSync(dest, { recursive: true })
  for (const f of ['basis_transcoder.js', 'basis_transcoder.wasm']) cpSync(join(src, f), join(dest, f))
  console.log('basis transcoder copied to public/basis')
}
