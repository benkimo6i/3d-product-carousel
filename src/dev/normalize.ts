/**
 * Dev-only tool that computes each product's carousel normalisation (`display` in scene.json).
 *
 * For every slot it records where the current per-product camera framing puts the product on
 * screen, then finds a scale + floor offset that lands it in exactly the same place under ONE fixed
 * camera (the Neo's framing). With those applied, the carousel camera never has to move vertically.
 * Run from the console: `await __normalize()`; paste the result into scene.json.
 */
import { PerspectiveCamera, type Camera, type Object3D } from 'three'
import { productDisplays, productRoots, useStore } from '../store'
import { goToSlot } from '../stepNav'
import { setMbpSize } from '../actions'
import { restingScreenRect } from '../three/restingBox'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function freeze(camera: PerspectiveCamera): Camera {
  const c = new PerspectiveCamera()
  c.copy(camera)
  c.projectionMatrix.copy(camera.projectionMatrix)
  c.projectionMatrixInverse.copy(camera.projectionMatrixInverse)
  c.matrixWorld.copy(camera.matrixWorld)
  c.matrixWorldInverse.copy(camera.matrixWorldInverse)
  c.matrixAutoUpdate = false
  c.matrixWorldAutoUpdate = false
  return c
}

type Rect = [number, number, number, number]

function solve(root: Object3D, display: Object3D, cam: Camera, w: number, h: number, target: Rect) {
  const base = { s: display.scale.x, x: display.position.x, z: display.position.z }
  const apply = (s: number, x: number, z: number) => {
    display.scale.setScalar(s)
    display.position.x = x
    display.position.z = z
    display.updateMatrixWorld(true)
  }
  // Residuals: top, bottom and horizontal centre of the product on screen.
  const residual = (s: number, x: number, z: number) => {
    apply(s, x, z)
    const [l, r, t, b] = restingScreenRect(root, cam, w, h)
    return [t - target[2], b - target[3], (l + r) / 2 - (target[0] + target[1]) / 2]
  }
  let v = [base.s, base.x, base.z]
  for (let iter = 0; iter < 12; iter++) {
    const f = residual(v[0], v[1], v[2])
    if (Math.hypot(...f) < 0.25) break
    const eps = [0.002, 0.002, 0.002]
    const J = [0, 1, 2].map((j) => {
      const vv = [...v]
      vv[j] += eps[j]
      const fj = residual(vv[0], vv[1], vv[2])
      return fj.map((x, i) => (x - f[i]) / eps[j])
    })
    // Solve J^T-columns system: sum_j J[j][i] * d[j] = -f[i]
    const A = [0, 1, 2].map((i) => [J[0][i], J[1][i], J[2][i]])
    const d = solve3(A, f.map((x) => -x))
    v = v.map((x, i) => x + d[i])
  }
  apply(v[0], v[1], v[2])
  return { scale: v[0], x: v[1] - base.x, z: v[2] - base.z, err: residual(v[0], v[1], v[2]) }
}

function solve3(A: number[][], b: number[]): number[] {
  const det = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  const D = det(A)
  return [0, 1, 2].map((k) => det(A.map((row, i) => row.map((x, j) => (j === k ? b[i] : x)))) / D)
}

export async function normalize(camera: PerspectiveCamera, size: { width: number; height: number }) {
  const { manifest } = useStore.getState()
  const order = manifest.carousel.order
  const settle = async (slot: number) => {
    goToSlot(slot)
    await wait(2200)
  }

  // The one fixed camera: the Neo's current framing.
  await settle(0)
  const fixed = freeze(camera)

  const out: Record<string, { scale: number; offset: [number, number] }> = {}
  const report: Record<string, number[]> = {}
  for (let slot = 0; slot < order.length; slot++) {
    const keys = manifest.carousel.slots[order[slot]]
    // The MacBook Pro slot shares one framing, based on the 16".
    if (keys.length > 1 && useStore.getState().mbpSize !== '16') {
      await settle(slot)
      setMbpSize('16')
      await wait(3200)
    }
    await settle(slot)
    const key = keys.length > 1 ? 'mbp16' : keys[0]
    const root = productRoots.get(key)!
    const display = productDisplays.get(key)!
    const target = restingScreenRect(root, camera, size.width, size.height)
    const r = solve(root, display, fixed, size.width, size.height, target)
    const entry = { scale: +r.scale.toFixed(4), offset: [+r.x.toFixed(4), +r.z.toFixed(4)] as [number, number] }
    out[key] = entry
    if (key === 'mbp16') out.mbp14 = entry
    report[key] = r.err.map((e) => +e.toFixed(2))
  }
  setMbpSize('14')
  console.log('[normalize] residual px (top, bottom, centreX):', report)
  return out
}
