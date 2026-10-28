import type { Camera, Object3D } from 'three'
import { restingScreenSpan } from './restingBox'

/** Gap between the bottom of the product and its label, in CSS pixels (LabelAnchor uses the same). */
export const LABEL_GAP_PX = 40
/** Space taken by the 14"/16" toggle under the label on the MacBook Pro slot. */
const TOGGLE_BLOCK_PX = 54
/** Mobile: minimum clearance between the label block and the paddle row at the bottom. */
const PADDLE_CLEARANCE_PX = 16

function cssPx(name: string, fallback: number) {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name))
  return Number.isFinite(v) ? v : fallback
}

/**
 * Vertical view shift (CSS px, positive moves the picture up) that centres "product + label" as one
 * block in the area under the top nav (and, on mobile, above the bottom paddle row). `camera` must be
 * posed without any view offset.
 */
export function centringShift(root: Object3D, camera: Camera, viewH: number, withToggle: boolean): number {
  const [top, bottom] = restingScreenSpan(root, camera, viewH)
  if (!Number.isFinite(top) || !Number.isFinite(bottom)) return NaN
  const label = document.querySelector<HTMLElement>('.product-label')
  const labelH = (label?.offsetHeight ?? 110) + (withToggle ? TOGGLE_BLOCK_PX : 0)
  const blockCentre = (top + bottom + LABEL_GAP_PX + labelH) / 2
  const navH = cssPx('--nav-h', 44)
  // Mobile anchors the paddles to the bottom of the screen; centre in the space above them.
  const paddles = document.querySelector<HTMLElement>('.nav-arrows.inline')
  const areaBottom =
    paddles && paddles.getClientRects().length > 0 ? paddles.offsetTop - PADDLE_CLEARANCE_PX : viewH
  return blockCentre - (navH + (areaBottom - navH) / 2)
}
