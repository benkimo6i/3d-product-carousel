import { Box3, Quaternion, Vector3, type BufferGeometry, type Camera, type Mesh, type Object3D } from 'three'

const saved = new Quaternion()

/** Runs `fn` with `root` temporarily un-rotated, so measurements stay stable while the user spins it. */
function atRest<T>(root: Object3D, fn: () => T): T {
  saved.copy(root.quaternion)
  root.quaternion.identity()
  root.updateMatrixWorld(true)
  try {
    return fn()
  } finally {
    root.quaternion.copy(saved)
    root.updateMatrixWorld(true)
  }
}

/** World-space bounds of `root` as if it weren't rotated. */
export function restingBox(root: Object3D, out: Box3): Box3 {
  return atRest(root, () => out.setFromObject(root))
}

/** Max vertices sampled per mesh when measuring the visible silhouette. */
const SAMPLES_PER_MESH = 240
const samples = new WeakMap<BufferGeometry, Float32Array>()

function sampleGeometry(geometry: BufferGeometry): Float32Array {
  let s = samples.get(geometry)
  if (s) return s
  const pos = geometry.getAttribute('position')
  const step = Math.max(1, Math.floor(pos.count / SAMPLES_PER_MESH))
  const out: number[] = []
  for (let i = 0; i < pos.count; i += step) out.push(pos.getX(i), pos.getY(i), pos.getZ(i))
  s = new Float32Array(out)
  samples.set(geometry, s)
  return s
}

const p = new Vector3()

/**
 * Top and bottom (CSS px from the top of the view) of the product's actual geometry on screen, at
 * rest. Unlike projecting a bounding box, this isn't thrown off by parts that stick out towards the
 * camera (like the Watch's band loop).
 */
export function restingScreenSpan(root: Object3D, camera: Camera, viewH: number): [number, number] {
  const [, , top, bottom] = restingScreenRect(root, camera, 1, viewH)
  return [top, bottom]
}

/** [left, right, top, bottom] of the product's actual geometry on screen (CSS px), at rest. */
export function restingScreenRect(
  root: Object3D,
  camera: Camera,
  viewW: number,
  viewH: number,
): [number, number, number, number] {
  return atRest(root, () => {
    camera.updateMatrixWorld()
    let left = Infinity
    let right = -Infinity
    let top = Infinity
    let bottom = -Infinity
    root.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh || mesh.userData.depthPass) return
      const s = sampleGeometry(mesh.geometry)
      for (let i = 0; i < s.length; i += 3) {
        p.set(s[i], s[i + 1], s[i + 2]).applyMatrix4(mesh.matrixWorld).project(camera)
        const x = ((p.x + 1) / 2) * viewW
        const y = ((1 - p.y) / 2) * viewH
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    })
    return [left, right, top, bottom]
  })
}
