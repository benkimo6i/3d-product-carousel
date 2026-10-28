import { Suspense, useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import gsap from 'gsap'
import type { Camera, Material, Mesh, Object3D, Scene, Texture, WebGLRenderer } from 'three'
import { useStore } from '../store'
import { useModel } from './gltf'

let ctx: { gl: WebGLRenderer; scene: Scene; camera: Camera } | null = null
const warmed = new WeakSet<Object3D>()

/**
 * Uploads a model's textures and compiles its shaders now, so the first frame that shows it doesn't
 * hitch. Clones share textures and shader programs with their source, so warming a glTF's own scene
 * covers every copy of it.
 */
export function warmUp(root: Object3D) {
  if (!ctx || warmed.has(root)) return
  warmed.add(root)
  const { gl, scene, camera } = ctx
  root.traverse((o) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    for (const m of [mesh.material].flat() as Material[]) {
      for (const v of Object.values(m)) if ((v as Texture | null)?.isTexture) gl.initTexture(v as Texture)
    }
  })
  // Compiled against the real scene, so its lights and environment match what renders.
  gl.compileAsync(root, camera, scene).catch(() => {})
}

/** Fetches and warms one detail model without showing it. */
function Prefetch({ url }: { url: string }) {
  const { scene } = useModel(url)
  useEffect(() => warmUp(scene), [scene])
  return null
}

/** Background detail-model prefetches (the list is managed by loadQueue). */
export function DetailPrefetch() {
  const { prefetch, manifest } = useStore()
  return (
    <>
      {prefetch.map((key) => (
        <Suspense key={key} fallback={null}>
          <Prefetch url={manifest.products[key].files.detail} />
        </Suspense>
      ))}
    </>
  )
}

/**
 * The canvas renders on demand (frameloop "demand"): a frame is drawn only while something moves.
 * This keeps it going during GSAP tweens and after any store change; scrolling, dragging and
 * anything still easing in useFrame request their own frames.
 */
export function RenderDriver() {
  const gl = useThree((s) => s.gl)
  const scene = useThree((s) => s.scene)
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    ctx = { gl, scene, camera }
    const tick = () => {
      if (gsap.globalTimeline.getChildren(false, true, true).some((t) => t.isActive())) invalidate()
    }
    gsap.ticker.add(tick)
    const unsubscribe = useStore.subscribe(() => invalidate())
    // Web fonts change the copy's layout, which the framing is measured against.
    document.fonts?.ready.then(() => invalidate())
    return () => {
      ctx = null
      gsap.ticker.remove(tick)
      unsubscribe()
    }
  }, [gl, scene, camera, invalidate])

  return null
}
