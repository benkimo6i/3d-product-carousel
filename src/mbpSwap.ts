import gsap from 'gsap'
import { motionScale } from './store'

/**
 * State of the MacBook Pro 14"/16" swap. Both machines share one spot: the swap closes the
 * current lid, crossfades to the other (closed) machine, then opens it.
 */
export const mbp = {
  /** Opacity of each machine. */
  o14: 1,
  o16: 0,
  /** Lid openness, 0 = closed, 1 = open. */
  lid14: 1,
  lid16: 0,
  /** True from the start of a swap until the new lid is open; framing and labels hold still meanwhile. */
  swapping: false,
}

const CLOSE_S = 0.6
const CROSSFADE_S = 0.4
const OPEN_S = 0.75
const LID_EASE = 'power3.inOut'

export interface SwapHooks {
  /** Halfway through the crossfade: the moment to switch copy over to the new machine. */
  onCrossfadeMid?: () => void
  /** The new machine starts opening. */
  onOpenStart?: () => void
  /** The new machine is fully open. */
  onOpened?: () => void
}

let timeline: gsap.core.Timeline | null = null

export function playMbpSwap(size: '14' | '16', hooks: SwapHooks = {}) {
  const to16 = size === '16'
  const fadeAt = CLOSE_S
  const openAt = CLOSE_S + CROSSFADE_S
  const openedAt = openAt + OPEN_S
  timeline?.kill()
  mbp.swapping = true
  timeline = gsap
    .timeline()
    .timeScale(1 / motionScale())
    // Close whichever lid is open (also tidies up if a previous swap was interrupted).
    .to(mbp, { lid14: 0, lid16: 0, duration: CLOSE_S, ease: LID_EASE }, 0)
    .call(() => hooks.onCrossfadeMid?.(), [], fadeAt + CROSSFADE_S / 2)
    .call(() => hooks.onOpenStart?.(), [], openAt)
    .to(mbp, { [to16 ? 'lid16' : 'lid14']: 1, duration: OPEN_S, ease: LID_EASE }, openAt)
    .call(
      () => {
        mbp.swapping = false
        hooks.onOpened?.()
      },
      [],
      openedAt,
    )

  // Enclosed crossfade: closed, the 16" fully contains the 14", so only the 16" ever fades and it
  // always does so over a solid 14" — the backdrop never shows through mid-fade.
  if (to16) {
    timeline
      .to(mbp, { o16: 1, duration: CROSSFADE_S, ease: 'sine.inOut' }, fadeAt)
      .set(mbp, { o14: 0 }, openAt)
  } else {
    timeline
      .set(mbp, { o14: 1 }, fadeAt)
      .to(mbp, { o16: 0, duration: CROSSFADE_S, ease: 'sine.inOut' }, fadeAt)
  }
}
