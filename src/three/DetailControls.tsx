import { useEffect } from 'react'
import { useThree } from '@react-three/fiber'
import { Quaternion, Raycaster, Vector2, Vector3 } from 'three'
import { motion, productRoots, useStore } from '../store'
import { stopQuaternion, tweenQuaternion } from '../actions'

const RAD_PER_PX = 0.009
/** How far the release velocity carries before picking the snap pose (seconds of travel). */
const MOMENTUM = 0.18

const raycaster = new Raycaster()
const ndc = new Vector2()
const up = new Vector3(0, 1, 0)
const right = new Vector3()
const qa = new Quaternion()
const qb = new Quaternion()

function rotateBy(q: Quaternion, dx: number, dy: number, cameraQuat: Quaternion) {
  right.set(1, 0, 0).applyQuaternion(cameraQuat)
  qa.setFromAxisAngle(up, dx * RAD_PER_PX)
  qb.setFromAxisAngle(right, dy * RAD_PER_PX)
  q.premultiply(qa).premultiply(qb)
}

/** Free orbit by dragging; on release the product eases into the nearest curated pose. */
export function DetailControls() {
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const invalidate = useThree((s) => s.invalidate)

  useEffect(() => {
    const el = gl.domElement
    let last: { x: number; y: number; t: number } | null = null
    let vel = { x: 0, y: 0 }

    const activeRoot = () => {
      const { mode, detailKey } = useStore.getState()
      if (mode !== 'detail' || !detailKey || motion.detail < 0.98) return null
      return productRoots.get(detailKey) ?? null
    }

    const down = (e: PointerEvent) => {
      const root = activeRoot()
      if (!root) return
      // On touch, only a drag that starts on the product rotates it; elsewhere the page/sheet scrolls.
      if (e.pointerType === 'touch') {
        const rect = el.getBoundingClientRect()
        ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
        raycaster.setFromCamera(ndc, camera)
        if (raycaster.intersectObject(root, true).length === 0) return
      }
      stopQuaternion(root.quaternion)
      el.setPointerCapture(e.pointerId)
      last = { x: e.clientX, y: e.clientY, t: performance.now() }
      vel = { x: 0, y: 0 }
      motion.dragging = true
      el.style.cursor = 'grabbing'
    }

    const move = (e: PointerEvent) => {
      const root = activeRoot()
      if (!last || !root) return
      const now = performance.now()
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      const dt = Math.max(1, now - last.t) / 1000
      vel = { x: dx / dt, y: dy / dt }
      rotateBy(root.quaternion, dx, dy, camera.quaternion)
      invalidate()
      last = { x: e.clientX, y: e.clientY, t: now }
      if (!useStore.getState().hintDismissed && Math.hypot(dx, dy) > 2) useStore.getState().setHintDismissed(true)
    }

    const up_ = (e: PointerEvent) => {
      if (!last) return
      last = null
      motion.dragging = false
      el.style.cursor = ''
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
      const root = activeRoot()
      if (!root) return

      // Project a little of the fling forward, then snap to whichever curated pose is closest.
      const projected = root.quaternion.clone()
      rotateBy(projected, vel.x * MOMENTUM, vel.y * MOMENTUM, camera.quaternion)
      const { manifest, detailKey } = useStore.getState()
      const poses = manifest.products[detailKey!].snapPoses
      let best = new Quaternion()
      let bestAngle = Infinity
      for (const p of Object.values(poses)) {
        const q = new Quaternion(...p)
        const a = projected.angleTo(q)
        if (a < bestAngle) {
          bestAngle = a
          best = q
        }
      }
      if (best.dot(root.quaternion) < 0) best.set(-best.x, -best.y, -best.z, -best.w)
      tweenQuaternion(root.quaternion, best, 0.6, 'back.out(1.2)')
    }

    // In details the canvas owns touch drags (rotation); in the carousel, vertical swipes stay with the page.
    const unsubscribe = useStore.subscribe((s) => {
      el.style.touchAction = s.mode === 'detail' ? 'none' : 'pan-y'
    })

    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up_)
    el.addEventListener('pointercancel', up_)
    return () => {
      unsubscribe()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up_)
      el.removeEventListener('pointercancel', up_)
    }
  }, [gl, camera, invalidate])

  return null
}
