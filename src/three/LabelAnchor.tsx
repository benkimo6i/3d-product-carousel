import { useFrame, useThree } from '@react-three/fiber'
import { MathUtils } from 'three'
import { activeKey, productRoots, useStore } from '../store'
import { restingScreenSpan } from './restingBox'
import { LABEL_GAP_PX } from './carouselCentering'

/** Gap between the bottom of the product and the hint under it in details, in CSS pixels. */
const HINT_GAP_PX = 18
/** Extra drop for a carousel label (CSS px): the Watch's soft shadow reaches further down than its band. */
const LABEL_NUDGE_PX: Record<string, number> = { watch: 10 }

const anchors = { label: -1, hint: -1 }
const written = { label: '', hint: '' }

/** Eases the anchor towards `target`; returns true while it's still moving. */
function place(el: HTMLElement, prop: string, key: 'label' | 'hint', target: number, dt: number) {
  if (!Number.isFinite(target)) return false
  anchors[key] = anchors[key] < 0 ? target : MathUtils.damp(anchors[key], target, 10, dt)
  const settled = Math.abs(anchors[key] - target) < 0.1
  if (settled) anchors[key] = target
  // Only touch the DOM on a real change (each write invalidates layout).
  const value = `${anchors[key].toFixed(1)}px`
  if (written[key] !== value) {
    written[key] = value
    el.style.setProperty(prop, value)
  }
  return !settled
}

/**
 * Keeps the carousel's product label, and the details view's "Drag to interact" hint, a fixed gap
 * under the product's visible bottom edge. Writes CSS variables instead of re-rendering React.
 */
export function LabelAnchor() {
  const camera = useThree((s) => s.camera)
  const size = useThree((s) => s.size)

  useFrame(({ invalidate }, dt) => {
    let moving = false
    const { manifest, nearest, mode, detailKey } = useStore.getState()

    const ui = document.querySelector<HTMLElement>('.carousel-ui')
    // The MacBook slot shares one framing (the 16"'s), so its label anchors to the 16" and stays put
    // whichever size is showing.
    const key = activeKey(manifest, nearest, '16')
    const root = productRoots.get(key)
    if (ui && root && mode === 'carousel') {
      const maxTop = size.height - ui.offsetHeight - 24
      const [, bottom] = restingScreenSpan(root, camera, size.height)
      const gap = LABEL_GAP_PX + (LABEL_NUDGE_PX[key] ?? 0)
      moving = place(ui, '--label-top', 'label', Math.min(bottom + gap, maxTop), dt)
    }

    const overlay = document.querySelector<HTMLElement>('.detail-overlay')
    const detailRoot = detailKey ? productRoots.get(detailKey) : undefined
    if (overlay && detailRoot && mode === 'detail') {
      const [, bottom] = restingScreenSpan(detailRoot, camera, size.height)
      moving = place(overlay, '--hint-top', 'hint', bottom + HINT_GAP_PX, dt) || moving
    }
    if (moving) invalidate()
  })

  return null
}
