import gsap from 'gsap'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import type { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motion, motionScale, useStore } from './store'
import { detailStep, slotOf } from './actions'
import { detailLayout } from './three/detailFraming'

gsap.registerPlugin(ScrollToPlugin)

/** Duration of one product-to-product move (matches the approved Blender timing). */
const STEP_DURATION = 1.0
/** Wheel deltas below this are treated as noise. */
const MIN_DELTA = 4
/** A pause this long between wheel events always starts a new gesture. */
const QUIET_MS = 180
/** After a move, input this strong counts as a new gesture once the cooldown has passed. */
const COOLDOWN_MS = 300
const FIRM_DELTA = 24
/** A delta this much stronger than the previous one is a fresh flick, not a decaying momentum tail. */
const RISE_FACTOR = 1.4
const SWIPE_MIN_PX = 40
/** A move redirected mid-slide is already travelling, so it eases out only, a little quicker. */
const CHAIN_DURATION = 0.8
/** No new gesture is that quick: input this soon after a move starts is the same gesture. */
const CHAIN_MIN_MS = 250
/** A wheel gesture counts as decaying once its deltas drop below this share of its peak. */
const DECAY_SHARE = 0.5
/** Wheel travel (px) a gesture needs before its axis is decided, so faint drift can't decide it. */
const AXIS_LOCK_PX = 12
/** A direction change only counts as a new gesture once it's this firm (end-of-swipe jitter isn't). */
const REVERSE_DELTA = 10

let trigger: ScrollTrigger | null = null
let animating = false
let lastWheel = 0
let lastAbs = 0
let lastDir = 0
let animEnd = 0
let armed = true
/**
 * The current wheel gesture: its axis (locked at the start, so a sideways swipe's vertical drift
 * never reads as a separate gesture), its peak delta, and whether it has passed that peak (a
 * trackpad ramps up, wobbling, then its momentum decays).
 */
let gestureAxis: 'x' | 'y' | null = null
const gestureTravel = { x: 0, y: 0 }
let gesturePeak = 0
let decaying = false
let failsafe: ReturnType<typeof setTimeout> | undefined
/** Slot the current move is heading to; `moveId` tells a superseded move's callbacks apart. */
let moveTarget = 0
let moveId = 0
let moveStart = 0
/** Product the page rests on, captured before a layout refresh rewrites progress (see onRefresh). */
let restSlot: number | null = null
/** A refresh landed mid-move; realign once the move finishes. */
let alignAfterMove = false

const slotCount = () => useStore.getState().manifest.carousel.order.length

function slotY(slot: number) {
  if (!trigger) return 0
  return trigger.start + ((trigger.end - trigger.start) * slot) / (slotCount() - 1)
}

/** Slot the page is currently at, or null when the carousel isn't pinned on screen. */
function currentSlot(): number | null {
  if (!trigger) return null
  const y = window.scrollY
  if (y < trigger.start - 1 || y > trigger.end + 1) return null
  return Math.round(((y - trigger.start) / (trigger.end - trigger.start)) * (slotCount() - 1))
}

/**
 * Slides the carousel to `slot`. With `chain`, a move already under way is redirected there (a new
 * gesture mid-slide carries on to the following product instead of being dropped); otherwise the
 * call is ignored while a move is running.
 */
export function goToSlot(slot: number, { chain = false } = {}) {
  if (!trigger || (animating && !chain)) return
  const target = Math.max(0, Math.min(slotCount() - 1, slot))
  if (animating && target === moveTarget) return
  const redirect = animating
  const id = ++moveId
  moveTarget = target
  moveStart = performance.now()
  animating = true
  armed = false
  const done = () => {
    // A redirected move's tween is replaced; only the latest one ends the move.
    if (id !== moveId) return
    clearTimeout(failsafe)
    animating = false
    animEnd = performance.now()
    // The move's target was computed before a resize changed the slot positions.
    if (alignAfterMove) {
      alignAfterMove = false
      alignToSlot(target, 0)
    }
  }
  const duration = (redirect ? CHAIN_DURATION : STEP_DURATION) * motionScale()
  // If the tween is ever interrupted, never leave the carousel locked.
  clearTimeout(failsafe)
  failsafe = setTimeout(done, duration * 1000 + 400)
  gsap.to(window, {
    scrollTo: { y: slotY(target), autoKill: false },
    duration,
    ease: redirect ? 'power2.out' : 'power2.inOut',
    overwrite: true,
    onComplete: done,
    onInterrupt: done,
  })
}

/**
 * Puts the page exactly on `slot`, so the pinned stage fills the viewport. Used when the details
 * view opens from a part-scrolled position, and after resizes. `duration` 0 jumps.
 */
export function alignToSlot(slot: number, duration: number) {
  if (!trigger) return
  const y = slotY(slot)
  if (Math.abs(window.scrollY - y) < 1) return
  gsap.killTweensOf(window)
  if (duration <= 0) window.scrollTo(0, y)
  else gsap.to(window, { scrollTo: { y, autoKill: false }, duration, ease: 'power2.inOut' })
}

/** Paddles: one product either way; clicking again mid-slide carries on to the next one. */
export function step(dir: 1 | -1) {
  if (animating) {
    goToSlot(moveTarget + dir, { chain: true })
    return
  }
  const s = currentSlot()
  if (s === null) return
  goToSlot(s + dir)
}

/**
 * Decides what a scroll or swipe gesture should do (vertical and horizontal alike: one gesture, one
 * product). Returns true if it was consumed by the carousel.
 */
function handleGesture(dir: 1 | -1, deltaPx: number, horizontal = false): boolean {
  if (!trigger || useStore.getState().mode !== 'carousel') return false
  const y = window.scrollY
  // Entering from the hero above / footer below: lock into the first / last product.
  if (!horizontal && dir > 0 && y < trigger.start - 1 && y + deltaPx > trigger.start) {
    goToSlot(0)
    return true
  }
  if (!horizontal && dir < 0 && y > trigger.end + 1 && y + deltaPx < trigger.end) {
    goToSlot(slotCount() - 1)
    return true
  }
  const s = currentSlot()
  if (s === null) return false
  // A new gesture mid-slide carries the move on (momentum from the same gesture isn't armed).
  if (animating) {
    if (armed && performance.now() - moveStart > CHAIN_MIN_MS) goToSlot(moveTarget + dir, { chain: true })
    armed = false
    return true
  }
  // At either end, vertical scrolling carries on past the carousel; sideways swipes just stop.
  if ((s === 0 && dir < 0) || (s === slotCount() - 1 && dir > 0)) return horizontal
  if (!armed) return true
  goToSlot(s + dir)
  return true
}

/**
 * Details: the vertical wheel only ever scrolls the copy, never switches products (horizontal
 * swipes, paddles, keys and touch swipes do that). In-between and mobile layouts scroll the copy
 * sheet; desktop scrolls the whole block only if it has outgrown the screen, and otherwise does
 * nothing. Over the copy the browser scrolls natively; anywhere else the wheel is forwarded.
 */
function scrollDetailCopy(e: WheelEvent, delta: number) {
  const desktop = detailLayout(window.innerWidth) === 'desktop'
  const scroller = document.querySelector<HTMLElement>(desktop ? '.detail-frame' : '.detail-sheet')
  const scrollable = !!scroller && scroller.scrollHeight > scroller.clientHeight + 1
  if (scrollable && scroller.contains(e.target as Node)) return
  e.preventDefault()
  if (scrollable) scroller.scrollBy({ top: delta })
}

function onWheel(e: WheelEvent) {
  const now = performance.now()
  const mode = useStore.getState().mode
  // Normalise line/page wheel modes (some mice, Firefox) to pixels. Sideways trackpad swipes count
  // as gestures too (towards the next product when the fingers move left).
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
  const quiet = now - lastWheel > QUIET_MS
  if (quiet) {
    gestureAxis = null
    gestureTravel.x = gestureTravel.y = 0
  }
  if (gestureAxis === null) {
    gestureTravel.x += Math.abs(e.deltaX * unit)
    gestureTravel.y += Math.abs(e.deltaY * unit)
    if (Math.max(gestureTravel.x, gestureTravel.y) >= AXIS_LOCK_PX) {
      gestureAxis = gestureTravel.x > gestureTravel.y ? 'x' : 'y'
    } else {
      // Too little movement to tell the axis yet: hold the page still inside the carousel.
      lastWheel = now
      if (mode !== 'carousel' || currentSlot() !== null) {
        if (mode !== 'detail' || Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault()
      }
      return
    }
  }
  const horizontal = gestureAxis === 'x'
  const raw = horizontal ? e.deltaX : e.deltaY
  const delta = raw * unit
  const abs = Math.abs(delta)
  const dir = delta > 0 ? 1 : -1

  // A new gesture (not the momentum tail of the last one) arms the next step, even mid-slide. A
  // rise only counts once the deltas have clearly decayed; before that it's the same gesture
  // still ramping up.
  if (quiet) {
    decaying = false
    gesturePeak = 0
  }
  const reversed = abs >= REVERSE_DELTA && dir !== lastDir && lastDir !== 0
  const rising = decaying && abs > lastAbs * RISE_FACTOR + 2
  if (rising || reversed) {
    decaying = false
    gesturePeak = abs
  } else {
    gesturePeak = Math.max(gesturePeak, abs)
    if (abs < gesturePeak * DECAY_SHARE) decaying = true
  }
  const firmAfterCooldown = !animating && now - animEnd > COOLDOWN_MS && abs >= FIRM_DELTA
  if (quiet || reversed || rising || firmAfterCooldown) armed = true
  lastWheel = now
  lastAbs = abs
  if (abs >= MIN_DELTA) lastDir = dir

  if (mode === 'detail') {
    if (!horizontal) return scrollDetailCopy(e, e.deltaY * unit)
    e.preventDefault()
    if (abs >= MIN_DELTA && armed && !animating) {
      armed = false
      detailStep(dir)
    }
    return
  }
  if (mode !== 'carousel') return
  if (abs < MIN_DELTA) {
    // Inside the carousel, small deltas (and sideways ones, which would trigger browser history
    // swipes) never move the page.
    const inside = currentSlot() !== null && trigger && window.scrollY > trigger.start && window.scrollY < trigger.end
    if (inside || (horizontal && currentSlot() !== null)) e.preventDefault()
    return
  }
  if (handleGesture(dir, delta, horizontal)) e.preventDefault()
}

let touchY: number | null = null
let touchX: number | null = null
function onTouchStart(e: TouchEvent) {
  touchY = e.touches[0].clientY
  touchX = e.touches[0].clientX
  // Every new touch is a new gesture, so it can also carry on a slide that's still moving.
  armed = true
}
function onTouchMove(e: TouchEvent) {
  if (touchY === null) return
  const mode = useStore.getState().mode
  // Details: a clearly horizontal swipe switches products. Vertical swipes are left to the copy
  // sheet, and drags that start on the product rotate it instead.
  if (mode === 'detail') {
    if (touchX === null || motion.dragging) return
    const dx = touchX - e.touches[0].clientX
    const dy = touchY - e.touches[0].clientY
    if (Math.abs(dx) > SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5 && armed && !animating) {
      armed = false
      touchX = null
      detailStep(dx > 0 ? 1 : -1)
    }
    return
  }
  if (mode !== 'carousel') return
  // A clearly sideways swipe steps like a vertical one (finger moving left → next product).
  const dx = touchX === null ? 0 : touchX - e.touches[0].clientX
  if (Math.abs(dx) > Math.abs(touchY - e.touches[0].clientY) * 1.5) {
    if (currentSlot() !== null) e.preventDefault()
    if (Math.abs(dx) > SWIPE_MIN_PX && armed && handleGesture(dx > 0 ? 1 : -1, dx, true)) {
      touchX = null
      touchY = null
    }
    return
  }
  const dy = touchY - e.touches[0].clientY
  const s = currentSlot()
  const atEdge = s !== null && ((s === 0 && dy < 0) || (s === slotCount() - 1 && dy > 0))
  // Inside the carousel, the finger doesn't scroll the page; the release decides the step.
  if (s !== null && !atEdge) e.preventDefault()
  if (Math.abs(dy) > SWIPE_MIN_PX && armed && handleGesture(dy > 0 ? 1 : -1, dy)) touchY = null
}

/** Anything that leaves the page between products (scrollbar drag, keyboard) eases to the nearest one. */
function onScrollEnd() {
  if (animating || !trigger || useStore.getState().mode !== 'carousel') return
  const y = window.scrollY
  if (y <= trigger.start + 1 || y >= trigger.end - 1) return
  const s = currentSlot()
  if (s !== null && Math.abs(y - slotY(s)) > 2) goToSlot(s)
}

/** The product the page should rest on: the open product in details, otherwise the nearest. */
function restingSlot() {
  const { mode, detailKey, nearest } = useStore.getState()
  const slot = mode !== 'carousel' && detailKey ? slotOf(detailKey) : -1
  return slot >= 0 ? slot : nearest
}

/**
 * Before a refresh: remember the product. The refresh re-maps the (unchanged) scroll position onto
 * the resized section, which can move `nearest` to another product before onRefresh runs.
 */
function onRefreshInit() {
  restSlot = restingSlot()
}

/**
 * After any layout refresh (resize, breakpoint change), put the page back exactly on the product it
 * was on, so neither the carousel nor an open details view is left part-scrolled or moved along.
 */
function onRefresh() {
  const slot = restSlot ?? restingSlot()
  restSlot = null
  if (!trigger) return
  if (animating) {
    alignAfterMove = true
    return
  }
  const { mode } = useStore.getState()
  const y = window.scrollY
  const inside = y >= trigger.start - 2 && y <= trigger.end + 2
  if (mode !== 'carousel' || inside) alignToSlot(slot, 0)
}

export function attachStepNav(st: ScrollTrigger, scrollTriggerClass: typeof ScrollTrigger) {
  trigger = st
  scrollTriggerClass.addEventListener('refreshInit', onRefreshInit)
  scrollTriggerClass.addEventListener('refresh', onRefresh)
  if (import.meta.env.DEV) {
    ;(window as unknown as Record<string, unknown>).__nav = () => ({
      animating,
      armed,
      target: moveTarget,
      axis: gestureAxis,
      peak: gesturePeak,
      decaying,
      sinceWheel: Math.round(performance.now() - lastWheel),
      y: window.scrollY,
      start: trigger?.start,
      end: trigger?.end,
      slot: currentSlot(),
    })
  }
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  scrollTriggerClass.addEventListener('scrollEnd', onScrollEnd)
  return () => {
    trigger = null
    scrollTriggerClass.removeEventListener('refreshInit', onRefreshInit)
    scrollTriggerClass.removeEventListener('refresh', onRefresh)
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('touchstart', onTouchStart)
    window.removeEventListener('touchmove', onTouchMove)
    scrollTriggerClass.removeEventListener('scrollEnd', onScrollEnd)
  }
}
