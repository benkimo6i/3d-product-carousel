import gsap from 'gsap'
import { ScrollToPlugin } from 'gsap/ScrollToPlugin'
import type { ScrollTrigger } from 'gsap/ScrollTrigger'
import { motion, motionScale, useStore } from './store'
import { detailStep, slotOf } from './actions'
import { detailLayout } from './three/detailFraming'

gsap.registerPlugin(ScrollToPlugin)

/** Duration of one paddle step, product to product (matches the approved Blender timing). */
const STEP_DURATION = 1.0
/** Scrolling scrubs the row freely; once it stops this close to a product (share of the gap), it snaps. */
const SNAP_ZONE = 0.25
/**
 * The snap starts from rest (it waits for scrolling to stop), so it eases in as well as out: an
 * ease-out alone would jump straight to full speed and feel jerky.
 */
const SNAP_DURATION = 0.5
const SNAP_EASE = 'sine.inOut'
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
/** Touch: movement before a carousel swipe commits to an axis (scrub sideways, or scroll natively). */
const TOUCH_AXIS_PX = 8
/** A move redirected mid-slide is already travelling, so it eases out only, a little quicker. */
const CHAIN_DURATION = 0.8
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
/** Product the page rests on, captured before a layout refresh rewrites progress (see onRefresh). */
let restSlot: number | null = null
/** A refresh landed mid-move; realign once the move finishes. */
let alignAfterMove = false

const slotCount = () => useStore.getState().manifest.carousel.order.length

function slotY(slot: number) {
  if (!trigger) return 0
  return trigger.start + ((trigger.end - trigger.start) * slot) / (slotCount() - 1)
}

/** Where the row is, in products (fractional between them), or null when the carousel isn't on screen. */
function currentPosition(): number | null {
  if (!trigger) return null
  const y = window.scrollY
  if (y < trigger.start - 1 || y > trigger.end + 1) return null
  return ((y - trigger.start) / (trigger.end - trigger.start)) * (slotCount() - 1)
}

/** Slot the page is currently at, or null when the carousel isn't pinned on screen. */
function currentSlot(): number | null {
  if (!trigger) return null
  const y = window.scrollY
  if (y < trigger.start - 1 || y > trigger.end + 1) return null
  return Math.round(((y - trigger.start) / (trigger.end - trigger.start)) * (slotCount() - 1))
}

interface MoveOptions {
  /** Redirect a move already under way instead of ignoring the call. */
  chain?: boolean
  /** Snap: a short, gentle glide over the last stretch. */
  snap?: boolean
}

/**
 * Moves the carousel to `slot`. A paddle step slides the full second; with `chain`, a move already
 * under way is redirected there (clicking again mid-slide carries on to the following product);
 * otherwise the call is ignored while a move is running.
 */
export function goToSlot(slot: number, { chain = false, snap = false }: MoveOptions = {}) {
  if (!trigger || (animating && !chain)) return
  const target = Math.max(0, Math.min(slotCount() - 1, slot))
  if (animating && target === moveTarget) return
  const redirect = animating
  const id = ++moveId
  moveTarget = target
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
  const duration = (snap ? SNAP_DURATION : redirect ? CHAIN_DURATION : STEP_DURATION) * motionScale()
  // If the tween is ever interrupted, never leave the carousel locked.
  clearTimeout(failsafe)
  failsafe = setTimeout(done, duration * 1000 + 400)
  gsap.to(window, {
    scrollTo: { y: slotY(target), autoKill: false },
    duration,
    ease: snap ? SNAP_EASE : redirect ? 'power2.out' : 'power2.inOut',
    overwrite: true,
    onComplete: done,
    onInterrupt: done,
  })
}

/** The visitor scrolls (or swipes) while a paddle step or snap is moving: hand control back to them. */
function yieldToScroll() {
  if (animating) gsap.killTweensOf(window)
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

/**
 * Paddles: to the next product in that direction (from a rest between two products, the one ahead,
 * not the one after the nearest); clicking again mid-slide carries on to the following one.
 */
export function step(dir: 1 | -1) {
  if (animating) {
    goToSlot(moveTarget + dir, { chain: true })
    return
  }
  const pos = currentPosition()
  if (pos === null) return
  goToSlot(dir > 0 ? Math.floor(pos + 1e-3) + 1 : Math.ceil(pos - 1e-3) - 1)
}

/**
 * Carousel: scrolling scrubs the row (the page scroll drives it 1:1). Vertical input scrolls the
 * page natively; sideways input is converted to the same scroll distance, kept inside the carousel
 * so it never carries the page past it. Once scrolling stops, maybeSnap() finishes the move if the
 * row is close to a product.
 */
function scrubSideways(deltaPx: number) {
  if (!trigger) return
  yieldToScroll()
  window.scrollTo(0, Math.min(trigger.end, Math.max(trigger.start, window.scrollY + deltaPx)))
}

/** Within SNAP_ZONE of a product, glide the last stretch onto it; further out, stay put. */
function maybeSnap() {
  if (animating || touching || !trigger || useStore.getState().mode !== 'carousel') return
  const pos = currentPosition()
  if (pos === null) return
  const nearest = Math.round(pos)
  const off = Math.abs(pos - nearest)
  if (off <= SNAP_ZONE && Math.abs(window.scrollY - slotY(nearest)) > 1) goToSlot(nearest, { snap: true })
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
  if (mode === 'carousel') {
    onCarouselWheel(e)
    return
  }
  // Details from here on. Normalise line/page wheel modes (some mice, Firefox) to pixels. Sideways
  // trackpad swipes switch products (towards the next one when the fingers move left).
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
      // Too little movement to tell the axis yet (details): hold still, except native copy scrolling.
      lastWheel = now
      if (mode !== 'detail' || Math.abs(e.deltaX) > Math.abs(e.deltaY)) e.preventDefault()
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
}

/** Carousel wheel: vertical scrolls the page natively; sideways scrubs (towards the next product when
 *  the fingers move left). Either one takes over from a paddle step or snap in progress. */
function onCarouselWheel(e: WheelEvent) {
  if (currentPosition() === null) return
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    // Also stops the browser treating it as a back/forward swipe.
    e.preventDefault()
    scrubSideways(e.deltaX * unit)
  } else {
    yieldToScroll()
  }
}

let touchY: number | null = null
let touchX: number | null = null
/** Carousel touch: a finger is down (no snapping under it), and the axis its swipe committed to. */
let touching = false
let touchAxis: 'x' | 'y' | null = null
let lastScroll = 0
function onTouchStart(e: TouchEvent) {
  touchY = e.touches[0].clientY
  touchX = e.touches[0].clientX
  touching = true
  touchAxis = null
  // Every new touch is a new gesture.
  armed = true
}
function onTouchEnd() {
  touching = false
  // If the page is still gliding (momentum), scrollEnd will snap; otherwise check now.
  setTimeout(() => {
    if (performance.now() - lastScroll > 120) maybeSnap()
  }, 150)
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
  if (mode !== 'carousel' || touchX === null) return
  const x = e.touches[0].clientX
  const y = e.touches[0].clientY
  // Commit to an axis first: vertical swipes scroll the page natively, sideways ones scrub.
  if (touchAxis === null) {
    if (Math.max(Math.abs(x - touchX), Math.abs(y - touchY)) < TOUCH_AXIS_PX) return
    touchAxis = Math.abs(x - touchX) > Math.abs(y - touchY) ? 'x' : 'y'
    if (touchAxis === 'y') yieldToScroll()
  }
  if (touchAxis === 'x' && currentPosition() !== null) {
    e.preventDefault()
    scrubSideways(touchX - x)
  }
  touchX = x
  touchY = y
}

/** Scrolling has stopped (momentum included): snap if the row came to rest close to a product. */
function onScrollEnd() {
  maybeSnap()
}

function onScroll() {
  lastScroll = performance.now()
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
      position: currentPosition(),
    })
  }
  window.addEventListener('wheel', onWheel, { passive: false })
  window.addEventListener('touchstart', onTouchStart, { passive: true })
  window.addEventListener('touchmove', onTouchMove, { passive: false })
  window.addEventListener('touchend', onTouchEnd, { passive: true })
  window.addEventListener('touchcancel', onTouchEnd, { passive: true })
  window.addEventListener('scroll', onScroll, { passive: true })
  scrollTriggerClass.addEventListener('scrollEnd', onScrollEnd)
  return () => {
    trigger = null
    scrollTriggerClass.removeEventListener('refreshInit', onRefreshInit)
    scrollTriggerClass.removeEventListener('refresh', onRefresh)
    window.removeEventListener('wheel', onWheel)
    window.removeEventListener('touchstart', onTouchStart)
    window.removeEventListener('touchmove', onTouchMove)
    window.removeEventListener('touchend', onTouchEnd)
    window.removeEventListener('touchcancel', onTouchEnd)
    window.removeEventListener('scroll', onScroll)
    scrollTriggerClass.removeEventListener('scrollEnd', onScrollEnd)
  }
}
