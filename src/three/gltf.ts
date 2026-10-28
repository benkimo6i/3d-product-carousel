import { useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import type { WebGLRenderer } from 'three'
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js'

/**
 * One loader setup for every model: Meshopt geometry and KTX2 (Basis) textures, from
 * scripts/optimize-models.mjs. drei caches models by URL alone, so loads and preloads must all go
 * through here, and only once the renderer exists (KTX2 picks a GPU format from it).
 */
const ktx2 = new KTX2Loader().setTranscoderPath(`${import.meta.env.BASE_URL}basis/`)
let ready = false

function initLoaders(gl: WebGLRenderer) {
  if (ready) return
  ktx2.detectSupport(gl)
  ready = true
}

// drei types its loader with three-stdlib's GLTFLoader; three's KTX2Loader (matching the transcoder
// in public/basis) works with it all the same.
const extend: NonNullable<Parameters<typeof useGLTF>[3]> = (loader) => {
  loader.setKTX2Loader(ktx2 as unknown as Parameters<typeof loader.setKTX2Loader>[0])
}

/** Loads a model (suspends until it's ready). Must be used inside the canvas. */
export function useModel(url: string) {
  initLoaders(useThree((s) => s.gl))
  return useGLTF(url, false, true, extend)
}

/** Starts loading a model ahead of time; a no-op until the canvas has set the loaders up. */
export function preloadModel(url: string) {
  if (ready) useGLTF.preload(url, false, true, extend)
}
