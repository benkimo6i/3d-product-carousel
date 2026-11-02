import { activeKey, isMbpSlot, useStore } from '../store'
import { openDetail } from '../actions'
import { SizeToggle } from './SizeToggle'

/** Product name label and the 14"/16" toggle for whichever product is on stage. */
export function CarouselUI() {
  const { manifest, copy, nearest, settled, mode, mbpSize } = useStore()
  const key = activeKey(manifest, nearest, mbpSize)
  const c = copy.products[key]
  const visible = mode === 'carousel' && settled
  const position = `${nearest + 1} of ${manifest.carousel.order.length}`
  const mbp = isMbpSlot(manifest, nearest)
  // The MacBook Pro title leaves the size out; screen readers still hear the full name.
  const title = mbp ? c.name.replace(/\s\d+"$/, '') : c.name

  return (
    // While details is open the label sits behind the dialog: out of reach entirely.
    <div className={`carousel-ui ${visible ? 'visible' : ''}`} inert={mode !== 'carousel'}>
      {/* Screen readers hear each product as the carousel comes to rest on it. */}
      <p className="visually-hidden" aria-live="polite" aria-atomic="true">
        {visible ? `${c.name}, ${position}` : ''}
      </p>
      <div className="product-label" key={key}>
        <h2>{title}</h2>
        <p>{c.tagline}</p>
        <button className="link" onClick={() => openDetail(key)}>
          Explore<span className="visually-hidden"> {c.name}</span>
          <span aria-hidden> &rsaquo;</span>
        </button>
      </div>
      {mbp && <SizeToggle className="stage-toggle" />}
    </div>
  )
}
