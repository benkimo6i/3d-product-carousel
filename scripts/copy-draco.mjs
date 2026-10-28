// Copies three.js's Draco decoder into public/ so compressed models load without a CDN.
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules/three/examples/jsm/libs/draco/gltf')
const dest = join(root, 'public/draco')

if (existsSync(src)) {
  mkdirSync(dest, { recursive: true })
  cpSync(src, dest, { recursive: true })
  console.log('draco decoder copied to public/draco')
}
