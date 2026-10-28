import { useStore } from '../store'
import { step } from '../stepNav'
import { detailStep } from '../actions'

/**
 * Prev / next paddles: step the carousel, or switch products while in the details view.
 * Desktop uses the side paddles; mobile uses an `inline` row anchored to the bottom of the screen instead
 * (and none in the details view, where swiping switches products).
 */
export function NavArrows({ inline = false }: { inline?: boolean }) {
  const { mode, nearest, manifest } = useStore()
  const last = manifest.carousel.order.length - 1
  // The inline (mobile) row only works in the carousel; the side paddles in both views.
  const visible = inline ? mode === 'carousel' : mode === 'carousel' || mode === 'detail'
  const go = (dir: 1 | -1) => (mode === 'detail' ? detailStep(dir) : step(dir))
  const cls = ['nav-arrows', inline ? 'inline' : 'sides', visible ? 'visible' : '', mode === 'detail' ? 'in-detail' : '']

  return (
    <div className={cls.join(' ')} inert={!visible}>
      <button className="nav-arrow prev" onClick={() => go(-1)} disabled={nearest === 0} aria-label="Previous product">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M14.5 5.5 8 12l6.5 6.5" />
        </svg>
      </button>
      <button className="nav-arrow next" onClick={() => go(1)} disabled={nearest === last} aria-label="Next product">
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M9.5 5.5 16 12l-6.5 6.5" />
        </svg>
      </button>
    </div>
  )
}
