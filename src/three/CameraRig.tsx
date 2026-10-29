import { useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { MathUtils, PerspectiveCamera, Vector3, type Object3D } from 'three'
import { MOBILE_MAX_WIDTH, publishStageHeight, solveDetailFraming, type Framing } from './detailFraming'
import { restingScreenRect } from './restingBox'
import { centringShift } from './carouselCentering'
import { activeKey, motion, productRoots, useStore } from '../store'
import { detailSwitch, slotOf } from '../actions'
import type { CameraDef, ProductDef } from '../types'

/** Aspect the Blender cameras were framed for. */
const DESIGN_ASPECT = 16 / 9
/** Lowers the carousel aim point so products sit higher in frame, clear of the label below. */
const CAROUSEL_LIFT = 0.07
/** Pulls the carousel camera back from the Blender framing so products never touch the viewport edges. */
const CAROUSEL_ZOOM_OUT = 1.14
/** Phones: share of the screen width the on-stage product spans in the carousel. */
const MOBILE_CAROUSEL_FILL = 0.8


interface Orbit {
  target: Vector3
  yaw: number
  elevation: number
  distance: number
}

const fromDef = (c: CameraDef, target = new Vector3(...c.target)): Orbit => ({
  target,
  yaw: MathUtils.degToRad(c.spherical.yawDeg),
  elevation: MathUtils.degToRad(c.spherical.elevationDeg),
  distance: c.spherical.distance,
})

function lerpOrbit(a: Orbit, b: Orbit, t: number, out: Orbit): Orbit {
  out.target.lerpVectors(a.target, b.target, t)
  out.yaw = MathUtils.lerp(a.yaw, b.yaw, t)
  out.elevation = MathUtils.lerp(a.elevation, b.elevation, t)
  out.distance = MathUtils.lerp(a.distance, b.distance, t)
  return out
}

const tmpPivot = new Vector3()
const centreCam = new PerspectiveCamera()

/** Poses `cam` at `orbit` with `like`'s lens, and no view offset. */
function poseCamera(cam: PerspectiveCamera, orbit: Orbit, like: PerspectiveCamera) {
  cam.fov = like.fov
  cam.aspect = like.aspect
  cam.near = like.near
  cam.far = like.far
  cam.updateProjectionMatrix()
  const ce = Math.cos(orbit.elevation)
  cam.position.set(
    orbit.target.x - Math.sin(orbit.yaw) * ce * orbit.distance,
    orbit.target.y + Math.sin(orbit.elevation) * orbit.distance,
    orbit.target.z + Math.cos(orbit.yaw) * ce * orbit.distance,
  )
  cam.lookAt(orbit.target)
}
const lidHinges = new Map<string, Object3D | null>()
const budPivots = new Map<string, Object3D[]>()

const isInside = (o: Object3D, root: Object3D) => {
  for (let p: Object3D | null = o; p; p = p.parent) if (p === root) return true
  return false
}

/**
 * Runs `fn` with the product in its rest pose: any lid fully open, and the AirPods' buds out of
 * the case (and the case at its resting height). The framing is measured at rest so the camera holds still while they move (and the two
 * MacBook Pros share the 16"'s framing, measured open even while the 16" sits closed behind the 14").
 */
function withRestPose<T>(key: string, root: Object3D, def: ProductDef, fn: () => T): T {
  // The model swaps between its carousel and detailed versions; nodes from the other one still
  // have a parent (inside its cached scene) but no longer move this product.
  let hinge = lidHinges.get(key)
  if (def.lid && (!hinge || !isInside(hinge, root))) {
    hinge = root.getObjectByName(def.lid.node) ?? null
    lidHinges.set(key, hinge)
  }
  let buds = budPivots.get(key)
  if (def.case && (!buds?.[0] || !isInside(buds[0], root))) {
    buds = def.case.buds.map((b) => root.getObjectByName(b.node)).filter((o): o is Object3D => !!o?.userData.rest)
    // ...and the product body they hang from, which rises as the case closes.
    if (buds[0]?.parent?.userData.rest) buds.push(buds[0].parent)
    budPivots.set(key, buds)
  }
  if (!hinge && !buds?.length) return fn()
  const angle = hinge?.rotation.x ?? 0
  const posed = (buds ?? []).map((b) => ({ b, p: b.position.clone(), q: b.quaternion.clone() }))
  if (hinge) hinge.rotation.x = 0
  for (const { b } of posed) {
    b.position.copy(b.userData.rest.position)
    b.quaternion.copy(b.userData.rest.quaternion)
  }
  try {
    return fn()
  } finally {
    if (hinge) hinge.rotation.x = angle
    for (const { b, p, q } of posed) {
      b.position.copy(p)
      b.quaternion.copy(q)
    }
    root.updateMatrixWorld(true)
  }
}

const framing: Framing = { target: new Vector3(), distance: 1, shiftX: 0, shiftY: 0, stageH: 0 }
const framingB: Framing = { target: new Vector3(), distance: 1, shiftX: 0, shiftY: 0, stageH: 0 }

/**
 * Drives the camera around a target in spherical coordinates, so moving between the carousel
 * view and a details view is an arc around the product rather than a straight dolly.
 */
export function CameraRig() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera
  const size = useThree((s) => s.size)
  const detailShift = useRef(0)
  const detailShiftX = useRef(0)
  const hasFraming = useRef(false)
  const carouselShift = useRef(0)
  const manifest = useStore((s) => s.manifest)

  const carousel = useRef(fromDef(manifest.carousel.camera)).current
  carousel.target.y = manifest.carousel.camera.target[1] - CAROUSEL_LIFT
  const neoKey = activeKey(manifest, 0, '14')
  const base = useRef(fromDef(manifest.carousel.camera, new Vector3())).current
  const detail = useRef(fromDef(manifest.carousel.camera, new Vector3())).current
  const out = useRef(fromDef(manifest.carousel.camera, new Vector3())).current
  const lastDetailKey = useRef<string | null>(null)
  // Carousel measurements only change with the viewport or the label block, so they're cached.
  const carouselCache = useRef({ stamp: '', distanceScale: 1, shift: 0 })

  useFrame(({ invalidate }, dt) => {
    const { mode, detailKey } = useStore.getState()

    // One fixed carousel framing for every product: the products themselves are normalised
    // (manifest `display`) so each sits centred under this camera, and switching is a pure slide.
    const fit = Math.max(1, DESIGN_ASPECT / camera.aspect)
    lerpOrbit(carousel, carousel, 0, base)
    base.distance *= CAROUSEL_ZOOM_OUT * fit

    // Measurements use the reference (first) product posed as if it were on stage; the same result
    // then holds for every normalised product.
    const ref = productRoots.get(neoKey)
    const poseOnStage = () => {
      poseCamera(centreCam, base, camera)
      ref!.getWorldPosition(tmpPivot)
      centreCam.position.x += tmpPivot.x - manifest.products[neoKey].pivotOffset[0]
    }
    if (ref) {
      const label = document.querySelector<HTMLElement>('.product-label')
      const paddles = document.querySelector<HTMLElement>('.nav-arrows.inline')
      const stamp = [size.width, size.height, label?.offsetHeight, paddles?.offsetTop, ref.children[0]?.uuid].join('|')
      const c = carouselCache.current
      if (c.stamp !== stamp) {
        c.stamp = stamp
        c.distanceScale = 1
        // Phones: a tighter shot, the product spanning ~80% of the screen width (neighbours needn't
        // peek in). Screen width scales ~1/distance, so two passes converge.
        if (size.width <= MOBILE_MAX_WIDTH) {
          for (let i = 0; i < 2; i++) {
            poseOnStage()
            const [l, r] = restingScreenRect(ref, centreCam, size.width, size.height)
            const share = (r - l) / size.width
            if (Number.isFinite(share) && share > 0) {
              c.distanceScale *= share / MOBILE_CAROUSEL_FILL
              base.distance *= share / MOBILE_CAROUSEL_FILL
            }
          }
        }
        // Centre "product + label" under the nav.
        poseOnStage()
        const s = centringShift(ref, centreCam, size.height, false)
        if (Number.isFinite(s)) c.shift = s
        else c.stamp = ''
      } else {
        base.distance *= c.distanceScale
      }
      carouselShift.current = c.shift
    }

    // Details framing for one product: sized and placed against the copy layout's lines (column tops
    // on desktop, the band between header and copy sheet on mobile), aimed where the product rests
    // once the row settles on its slot (not where it is mid-slide).
    const goalFor = (key: string, into: Framing) => {
      // Both MacBook Pros share the 16"'s framing (lid open), so the size toggle shows the real
      // difference in size and the camera never moves during a swap.
      const frameKey = key === 'mbp14' ? 'mbp16' : key
      const def = manifest.products[frameKey]
      const root = productRoots.get(frameKey)
      if (!root) return null
      root.getWorldPosition(tmpPivot)
      const goal = fromDef(def.detailCamera, tmpPivot.clone())
      const solved = withRestPose(frameKey, root, def, () =>
        solveDetailFraming(root, camera, size.width, size.height, goal.yaw, goal.elevation, into),
      )
      const settleOffsetX = (slotOf(key) - motion.progress) * manifest.carousel.spacing
      if (!solved) {
        goal.target.x -= settleOffsetX
        goal.target.y += def.detailCamera.target[1] - def.pivotOffset[1]
        goal.distance *= fit
        return { goal, shift: 0, shiftX: 0, stageH: 0, solved: false }
      }
      goal.target.copy(solved.target)
      goal.target.x -= settleOffsetX
      goal.distance = solved.distance
      return { goal, shift: solved.shiftY, shiftX: solved.shiftX, stageH: solved.stageH, solved: true }
    }

    const key = detailKey ?? lastDetailKey.current
    if (detailSwitch.active && mode === 'detail') {
      // Switching products inside details: blend the outgoing and incoming framings by how far the
      // row has slid, so any change of size moves in step with the slide (no push/pull up front).
      const a = goalFor(detailSwitch.from, framing)
      const b = goalFor(detailSwitch.to, framingB)
      if (a?.solved && b?.solved) {
        const span = detailSwitch.toSlot - detailSwitch.fromSlot
        const t = MathUtils.clamp((motion.progress - detailSwitch.fromSlot) / span, 0, 1)
        lerpOrbit(a.goal, b.goal, t, detail)
        detailShift.current = MathUtils.lerp(a.shift, b.shift, t)
        detailShiftX.current = MathUtils.lerp(a.shiftX, b.shiftX, t)
        publishStageHeight(MathUtils.lerp(a.stageH, b.stageH, t))
        lastDetailKey.current = detailSwitch.to
      }
    } else if (key) {
      lastDetailKey.current = key
      const r = goalFor(key, framing)
      // If a frame can't be measured (model mid-swap), hold the last good framing.
      if (r && (r.solved || !hasFraming.current)) {
        if (r.solved) hasFraming.current = true
        // Glides if the framing changes while details is open (e.g. the copy re-flows).
        const k = mode === 'detail' && motion.detail >= 1 ? 1 - Math.exp(-6 * dt) : 1
        lerpOrbit(detail, r.goal, k, detail)
        detailShift.current = MathUtils.lerp(detailShift.current, r.shift, k)
        detailShiftX.current = MathUtils.lerp(detailShiftX.current, r.shiftX, k)
        // Still gliding to a new framing: keep frames coming (the canvas renders on demand).
        const settling =
          Math.abs(detail.distance - r.goal.distance) > 1e-4 ||
          detail.target.distanceToSquared(r.goal.target) > 1e-10 ||
          Math.abs(detailShift.current - r.shift) > 0.1 ||
          Math.abs(detailShiftX.current - r.shiftX) > 0.1
        if (settling && motion.detail > 0) invalidate()
        if (!Number.isFinite(detailShift.current)) detailShift.current = 0
        if (!Number.isFinite(detailShiftX.current)) detailShiftX.current = 0
        publishStageHeight(r.stageH)
      }
    }

    lerpOrbit(base, detail, motion.detail, out)

    // Shift the picture vertically: centred block in the carousel, layout lines in details.
    const shiftY = MathUtils.lerp(carouselShift.current, detailShift.current, motion.detail)
    // Horizontal shift only in details (the in-between layout puts the product right of the copy).
    const shiftX = detailShiftX.current * motion.detail
    if (Math.abs(shiftY) > 0.5 || Math.abs(shiftX) > 0.5)
      camera.setViewOffset(size.width, size.height, shiftX, shiftY, size.width, size.height)
    else if (camera.view?.enabled) camera.clearViewOffset()

    const d = out.distance
    const ce = Math.cos(out.elevation)
    camera.position.set(
      out.target.x - Math.sin(out.yaw) * ce * d,
      out.target.y + Math.sin(out.elevation) * d,
      out.target.z + Math.cos(out.yaw) * ce * d,
    )
    camera.lookAt(out.target)
  })

  return null
}
