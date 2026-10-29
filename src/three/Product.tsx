import { Suspense, useCallback, useEffect, useRef } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { Frustum, MathUtils, Matrix4, Sphere, Vector3, type Camera, type Group, type MeshBasicMaterial, type Object3D } from 'three'
import { FADE_PASS_ORDER, Model, type LoadedModel } from './Model'
import { BakedShadow, type ShadowTuning } from './BakedShadow'
import { motion, motionScale, productDisplays, productRoots, useStore } from '../store'
import { openDetail, scrollToSlot, toggleScreen } from '../actions'
import { slotReady } from './loadQueue'
import { mbp } from '../mbpSwap'
import { loadScreenImage, patchScreenMaterial, screenUniforms } from './screenWake'
import { createWatchFaceAnimation, type WatchFaceAnimation } from './watchFace'
import type { ProductDef } from '../types'

interface Props {
  pkey: string
  def: ProductDef
  slot: number
}

const isMbp = (key: string | null) => key === 'mbp14' || key === 'mbp16'
/** The product shown in details (either MacBook Pro counts for both: they swap in place). */
const isDetailProduct = (pkey: string, detailKey: string | null) =>
  pkey === detailKey || (isMbp(pkey) && isMbp(detailKey))
/** Pointer travel (px) below which a press on the product counts as a click rather than a drag. */
const CLICK_SLOP_PX = 4

/** Peak opacity of the baked floor shadows ("medium"). */
const SHADOW_STRENGTH = 0.7

/**
 * Per-product shadow tweaks. The iMac and Watch shadows reach forward behind the label copy, so the
 * part in front of them is trimmed away; the AirPods' up-scaled bake gets a lighter, shorter front.
 */
const SHADOW_TUNING: Record<string, ShadowTuning> = {
  imac: { trimFront: true },
  watch: { trimFront: true },
  airpods: { front: 0.3, frontFade: 0.42 },
}

/**
 * Generous bounding radius (m) around a product's floor spot for the in-view test: covers the
 * largest product, its shadow, and the camera moving on a little before the next frame.
 */
const VIEW_RADIUS = 0.6
const frustum = new Frustum()
const viewProj = new Matrix4()
const sphere = new Sphere()
let frustumFrame = -1

function inView(object: Object3D, camera: Camera, frame: number) {
  if (frustumFrame !== frame) {
    frustumFrame = frame
    camera.updateMatrixWorld()
    frustum.setFromProjectionMatrix(viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse))
  }
  object.getWorldPosition(sphere.center)
  sphere.radius = VIEW_RADIUS
  return frustum.intersectsSphere(sphere)
}

/** 1 when the product belongs on screen in the current mode (details hides everything else). */
function modeVisibility(pkey: string): number {
  const { mode, detailKey } = useStore.getState()
  if (mode !== 'detail') return 1
  if (pkey === detailKey) return 1
  // Both MacBook Pros stay in play during details so the size swap can animate between them.
  return isMbp(pkey) && isMbp(detailKey) ? 1 : 0
}

export function Product({ pkey, def, slot }: Props) {
  const group = useRef<Group>(null)
  const model = useRef<LoadedModel | null>(null)
  const hinge = useRef<Object3D | null>(null)
  const state = useRef({ visibility: 1, lid: def.lid?.defaultState === 'closed' ? 0 : 1, wake: 0 })
  const manifest = useStore((s) => s.manifest)
  // Screen products: both model versions' screen materials share these, so the state survives a swap.
  const screen = useRef(
    def.screen
      ? { uniforms: screenUniforms(def.screen), loading: false, ready: false, anim: null as WatchFaceAnimation | null, replay: 0 }
      : null,
  ).current

  // Both MacBook Pros share the 14"'s spot (the swap crossfades between them in place).
  const spot = useRef(
    pkey === 'mbp16'
      ? new Vector3(manifest.products.mbp14.pivotOffset[0], def.pivotOffset[1], manifest.products.mbp14.pivotOffset[2])
      : new Vector3(...def.pivotOffset),
  ).current
  // The display group sits on the floor under the pivot, so normalisation scales about the floor
  // (the product stays standing on it) and slides the product and its shadow together.
  const display = def.display ?? { scale: 1, offset: [0, 0] as [number, number] }
  const displayGroup = useRef<Group>(null)
  const pivotHeight = useRef(new Vector3(0, spot.y, 0)).current

  useEffect(() => {
    const d = displayGroup.current
    if (!d) return
    productDisplays.set(pkey, d)
    return () => {
      productDisplays.delete(pkey)
    }
  }, [pkey])

  // The detailed model loads for the product in details, and for the incoming MacBook mid-swap.
  const showDetail = useStore((s) => s.detailKey === pkey || (s.mode === 'detail' && s.copyKey === pkey))

  const onReady = useCallback(
    (m: LoadedModel) => {
      model.current = m
      hinge.current = def.lid ? m.root.getObjectByName(def.lid.node) ?? null : null
      if (screen && def.screen) {
        const mat = m.materials.find((x) => x.name === def.screen!.material)
        if (mat) patchScreenMaterial(mat, screen.uniforms)
      }
      slotReady(slot)
    },
    [def.lid, def.screen, screen, slot],
  )

  useEffect(() => {
    const g = group.current
    if (!g) return
    productRoots.set(pkey, g)
    return () => {
      productRoots.delete(pkey)
    }
  }, [pkey])

  useFrame(({ invalidate, camera, clock }, dt) => {
    const g = group.current
    const m = model.current
    const d = displayGroup.current
    if (!g || !m || !d) return
    const s = state.current

    // Out of view (slid past the screen edge): skip drawing and all per-frame work.
    d.visible = inView(d, camera, clock.elapsedTime)
    if (!d.visible) return

    const goal = modeVisibility(pkey)
    s.visibility = MathUtils.damp(s.visibility, goal, 5, dt)
    if (Math.abs(s.visibility - goal) > 0.002) invalidate()
    else s.visibility = goal
    let opacity = s.visibility
    if (pkey === 'mbp14') {
      opacity *= mbp.o14
      s.lid = mbp.lid14
    } else if (pkey === 'mbp16') {
      opacity *= mbp.o16
      s.lid = mbp.lid16
    }

    g.visible = opacity > 0.004
    const solid = opacity > 0.995
    for (const mat of m.materials) {
      mat.opacity = mat.userData.baseOpacity * opacity
      const transparent = !solid || mat.userData.baseTransparent
      if (mat.transparent !== transparent) {
        mat.transparent = transparent
        mat.needsUpdate = true
      }
    }
    if (m.depthMeshes[0] && m.depthMeshes[0].visible === solid) {
      for (const d of m.depthMeshes) d.visible = !solid
      for (const mesh of m.meshes) mesh.renderOrder = (solid ? 0 : FADE_PASS_ORDER) + mesh.userData.drawOrder
    }

    if (def.lid && hinge.current) hinge.current.rotation.x = def.lid.closedAngleRad * (1 - s.lid)

    // Screen: the mock desktop loads as soon as details opens on this product, then fades in and
    // out with the toggle.
    if (screen && def.screen) {
      const { mode, detailKey, screenOn } = useStore.getState()
      const here = mode === 'detail' && isDetailProduct(pkey, detailKey)
      if (here && !screen.loading) {
        screen.loading = true
        loadScreenImage(`${import.meta.env.BASE_URL}${def.screen.image}`).then((t) => {
          if (def.screen?.live === 'watch') {
            screen.anim = createWatchFaceAnimation(t.image as CanvasImageSource, motionScale())
            screen.uniforms.screenWakeMap.value = screen.anim.texture
          } else screen.uniforms.screenWakeMap.value = t
          screen.ready = true
          invalidate()
        })
      }
      if (screen.anim) {
        // The Watch: each click replays the face animation. Its canvas shows only while it plays (it
        // ends on the original face, so handing back to the texture is seamless).
        const { screenReplay } = useStore.getState()
        if (screenReplay !== screen.replay) {
          screen.replay = screenReplay
          if (here) screen.anim.play()
        }
        if (!here) screen.anim.stop()
        const playing = screen.anim.update(performance.now())
        if (playing) invalidate()
        s.wake = playing ? 1 : 0
        screen.uniforms.screenWake.value = s.wake
        return
      }
      const wakeGoal = here && screenOn && screen.ready ? 1 : 0
      s.wake = MathUtils.damp(s.wake, wakeGoal, 7, dt)
      if (Math.abs(s.wake - wakeGoal) > 0.002) invalidate()
      else s.wake = wakeGoal
      screen.uniforms.screenWake.value = s.wake
    }

    // Baked shadows: follow the product's visibility, blend open/closed with the lid, and fade out
    // as the details view opens (the product rotates freely there, which a baked shadow can't follow).
    const shadowAlpha = SHADOW_STRENGTH * opacity * (1 - motion.detail)
    const closedShare = shadowClosed.current ? 1 - s.lid : 0
    if (shadowOpen.current) shadowOpen.current.opacity = shadowAlpha * (1 - closedShare)
    if (shadowClosed.current) shadowClosed.current.opacity = shadowAlpha * closedShare
  })

  const shadowOpen = useRef<MeshBasicMaterial | null>(null)
  const shadowClosed = useRef<MeshBasicMaterial | null>(null)
  const setShadowOpen = useCallback((m: MeshBasicMaterial) => (shadowOpen.current = m), [])
  const setShadowClosed = useCallback((m: MeshBasicMaterial) => (shadowClosed.current = m), [])

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const { mode, nearest, settled, detailKey } = useStore.getState()
    if (mode === 'detail') {
      // A click (not the end of a drag) on the product in details toggles its screen.
      const click = e.delta <= CLICK_SLOP_PX
      if (click && isDetailProduct(pkey, detailKey) && motion.detail >= 0.98 && !mbp.swapping) toggleScreen()
      return
    }
    if (mode !== 'carousel') return
    if (nearest !== slot || !settled) {
      scrollToSlot(slot)
      return
    }
    openDetail(pkey)
  }

  const setCursor = (pointer: boolean) => {
    const { mode, detailKey } = useStore.getState()
    // In details, only a product with a screen to toggle is clickable.
    const clickable = mode === 'carousel' || (mode === 'detail' && !!def.screen && isDetailProduct(pkey, detailKey))
    if (clickable || !pointer) document.body.style.cursor = pointer ? 'pointer' : ''
  }

  const lod = <Model url={def.files.carousel} onReady={onReady} />

  return (
    <group
      ref={displayGroup}
      position={[spot.x + display.offset[0], 0, spot.z + display.offset[1]]}
      scale={display.scale}
    >
      <group
        ref={group}
        position={pivotHeight}
        onClick={onClick}
        onPointerOver={() => setCursor(true)}
        onPointerOut={() => setCursor(false)}
      >
        {showDetail ? (
          <Suspense fallback={lod}>
            <Model url={def.files.detail} onReady={onReady} />
          </Suspense>
        ) : (
          lod
        )}
      </group>
      {/* Separate from the product group so the shadow stays on the floor while the product rotates. */}
      <group position={pivotHeight}>
        <Suspense fallback={null}>
          {def.shadow && <BakedShadow def={def.shadow} tuning={SHADOW_TUNING[pkey]} onMaterial={setShadowOpen} />}
          {def.shadowClosed && (
            <BakedShadow def={def.shadowClosed} tuning={SHADOW_TUNING[pkey]} onMaterial={setShadowClosed} />
          )}
        </Suspense>
      </group>
    </group>
  )
}
