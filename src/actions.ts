import gsap from 'gsap'
import { Quaternion } from 'three'
import type { ScrollTrigger } from 'gsap/ScrollTrigger'
import { activeKey, motion, motionScale, productRoots, useStore } from './store'
import { mbp, playMbpSwap } from './mbpSwap'
import { alignToSlot, goToSlot } from './stepNav'
import { preloadModel } from './three/gltf'

let trigger: ScrollTrigger | null = null

export function registerTrigger(st: ScrollTrigger | null) {
  trigger = st
}

export function getTrigger() {
  return trigger
}

/** Moves the carousel so `slot` lands on stage. */
export function scrollToSlot(slot: number) {
  goToSlot(slot)
}

function lockScroll(locked: boolean) {
  document.documentElement.style.overflow = locked ? 'hidden' : ''
}

export function openDetail(key: string) {
  const s = useStore.getState()
  if (s.mode !== 'carousel') return
  s.setDetailKey(key)
  s.setCopyKey(key)
  s.setSwapPhase('idle')
  s.setHintDismissed(false)
  s.setScreenOn(false)
  s.setMode('detail')
  // If the page is only part-way into the section, glide it fully into place during the arc,
  // otherwise the scroll lock would leave part of the details layout off-screen.
  const slot = s.manifest.carousel.order.findIndex((name) => s.manifest.carousel.slots[name].includes(key))
  alignToSlot(slot, 1.5 * motionScale())
  lockScroll(true)
  // overwrite 'auto' only replaces tweens of `detail`; `true` would also kill the scroll tween on `progress`.
  gsap.to(motion, { detail: 1, duration: 1.5 * motionScale(), ease: 'power2.inOut', overwrite: 'auto' })
}

export function closeDetail() {
  const s = useStore.getState()
  if (s.mode !== 'detail' || !s.detailKey) return
  const root = productRoots.get(s.detailKey)
  if (root) tweenQuaternion(root.quaternion, new Quaternion(), 0.8 * motionScale(), 'power2.inOut')
  s.setMode('closing')
  s.setScreenOn(false)
  gsap.to(motion, {
    detail: 0,
    duration: 1.5 * motionScale(),
    delay: 0.2 * motionScale(),
    ease: 'power2.inOut',
    overwrite: 'auto',
    onComplete: () => {
      useStore.getState().setDetailKey(null)
      useStore.getState().setMode('carousel')
      lockScroll(false)
    },
  })
}

/**
 * Switches the MacBook Pro size: close → crossfade → open (the same swap in the carousel and in
 * details). Inside details the copy fades out, switches mid-crossfade and staggers back in as the
 * new machine opens; the camera only reframes once it's fully open.
 */
export function setMbpSize(size: '14' | '16') {
  const s = useStore.getState()
  if (s.mbpSize === size) return
  s.setMbpSize(size)
  const next = size === '16' ? 'mbp16' : 'mbp14'
  const inDetail = s.mode === 'detail' && (s.detailKey === 'mbp14' || s.detailKey === 'mbp16')
  if (!inDetail) {
    playMbpSwap(size)
    return
  }
  // Fetch the detailed model now so it's ready when the swap hands over.
  preloadModel(s.manifest.products[next].files.detail)
  const prev = productRoots.get(s.detailKey!)
  if (prev) tweenQuaternion(prev.quaternion, new Quaternion(), 0.45, 'power2.inOut')
  s.setSwapPhase('out')
  playMbpSwap(size, {
    onCrossfadeMid: () => useStore.getState().setCopyKey(next),
    onOpenStart: () => useStore.getState().setSwapPhase('in'),
    onOpened: () => {
      const st = useStore.getState()
      if (st.mode !== 'detail') return
      st.setDetailKey(next)
      st.setSwapPhase('idle')
    },
  })
}

/**
 * Details: what clicking the product does. Macs and iPhone toggle the mock desktop, the Watch
 * replays its face animation, and the AirPods go into (or come out of) their case.
 */
export function toggleProduct() {
  const s = useStore.getState()
  const def = s.mode === 'detail' && s.detailKey ? s.manifest.products[s.detailKey] : undefined
  if (!def?.screen && !def?.case) return
  if (def.screen?.live === 'watch') s.replayScreen()
  else s.setScreenOn(!s.screenOn)
}

export function slotOf(key: string): number {
  const { order, slots } = useStore.getState().manifest.carousel
  return order.findIndex((name) => slots[name].includes(key))
}

let detailSwitching = false

/**
 * The product switch in progress inside details. The camera blends from the outgoing product's
 * framing to the incoming one by how far the row has slid, so re-framing and sliding move together.
 */
export const detailSwitch = { active: false, from: '', to: '', fromSlot: 0, toSlot: 0 }

/**
 * Moves to the neighbouring product without leaving the details view: copy fades out, the row
 * slides the next product to centre (the camera holds its front-on framing), new copy staggers in.
 */
export function detailStep(dir: 1 | -1) {
  const s = useStore.getState()
  if (s.mode !== 'detail' || !s.detailKey || detailSwitching || mbp.swapping) return
  const next = slotOf(s.detailKey) + dir
  if (next < 0 || next >= s.manifest.carousel.order.length) return
  const key = activeKey(s.manifest, next, s.mbpSize)
  detailSwitching = true
  Object.assign(detailSwitch, { active: true, from: s.detailKey, to: key, fromSlot: next - dir, toSlot: next })
  preloadModel(s.manifest.products[key].files.detail)
  const prev = productRoots.get(s.detailKey)
  if (prev) tweenQuaternion(prev.quaternion, new Quaternion(), 0.5, 'power2.inOut')
  s.setSwapPhase('out')
  s.setHintDismissed(false)
  s.setScreenOn(false)
  s.setDetailKey(key)
  goToSlot(next)
  gsap
    .timeline()
    .timeScale(1 / motionScale())
    .call(() => useStore.getState().setCopyKey(key), [], 0.45)
    .call(() => useStore.getState().setSwapPhase('in'), [], 0.9)
    .call(
      () => {
        useStore.getState().setSwapPhase('idle')
        detailSwitching = false
        detailSwitch.active = false
      },
      [],
      1.6,
    )
}

const quatTweens = new WeakMap<Quaternion, gsap.core.Tween>()

/** Slerps `q` to `to`. Eases like back.out may overshoot past 1, which slerp extrapolates. */
export function tweenQuaternion(q: Quaternion, to: Quaternion, duration: number, ease: string) {
  stopQuaternion(q)
  const from = q.clone()
  const t = { v: 0 }
  const tween = gsap.to(t, {
    v: 1,
    duration,
    ease,
    onUpdate: () => {
      q.slerpQuaternions(from, to, t.v)
    },
  })
  quatTweens.set(q, tween)
  return tween
}

export function stopQuaternion(q: Quaternion) {
  quatTweens.get(q)?.kill()
  quatTweens.delete(q)
}
