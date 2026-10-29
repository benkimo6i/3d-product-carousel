import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import type { PerspectiveCamera } from 'three'
import { normalize } from '../dev/normalize'
import * as actions from '../actions'
import { useStore } from '../store'

/**
 * Dev only: exposes the renderer/scene/camera as `window.__three`, the store and actions as
 * `window.__app` (for driving the page from the console), and the normaliser as `window.__normalize`.
 */
export function DevHandle() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as unknown as Record<string, unknown>
    w.__three = { gl, scene, camera }
    w.__app = { store: useStore, actions }
    w.__normalize = () => normalize(camera, size)
  }, [gl, scene, camera, size])
  return null
}
