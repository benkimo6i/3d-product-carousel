import { activeKey, isMbpSlot, useStore } from '../store'

/**
 * Streams the carousel in: the first product loads on its own, then the rest one at a time, always
 * the unloaded slot nearest the stage first (scrolling ahead jumps the queue). Once every carousel
 * model is in, the on-stage product's detail model is fetched and warmed in the background.
 */
const loaded = new Set<number>()

const slotCount = () => useStore.getState().manifest.carousel.order.length

function allow(slot: number) {
  const { loadable } = useStore.getState()
  if (!loadable.includes(slot)) useStore.setState({ loadable: [...loadable, slot] })
}

function advance() {
  const { loadable, nearest } = useStore.getState()
  // One slot in flight at a time, so the products nearest the stage get the bandwidth.
  if (loadable.some((s) => !loaded.has(s))) return
  let next = -1
  for (let s = 0; s < slotCount(); s++) {
    if (loaded.has(s)) continue
    if (next < 0 || Math.abs(s - nearest) < Math.abs(next - nearest)) next = s
  }
  if (next >= 0) allow(next)
  else prefetchDetail()
}

/** A product's carousel model is ready (called from Product). */
export function slotReady(slot: number) {
  if (loaded.has(slot)) return
  loaded.add(slot)
  advance()
}

/** Detail models for the product(s) on stage; both MacBook Pros, since the toggle swaps between them. */
function prefetchDetail() {
  const { manifest, nearest, settled, mbpSize, prefetch } = useStore.getState()
  if (loaded.size < slotCount() || !settled) return
  const keys = isMbpSlot(manifest, nearest) ? ['mbp14', 'mbp16'] : [activeKey(manifest, nearest, mbpSize)]
  const fresh = keys.filter((k) => !prefetch.includes(k))
  if (fresh.length) useStore.setState({ prefetch: [...prefetch, ...fresh] })
}

/** Follows the stage: whatever lands on it loads next (slot 0 is allowed from the start). */
export function startLoadQueue() {
  useStore.subscribe((s, prev) => {
    if (s.nearest === prev.nearest && s.settled === prev.settled) return
    // Scrolled ahead of the queue: the product on stage loads right away.
    allow(s.nearest)
    prefetchDetail()
  })
}
