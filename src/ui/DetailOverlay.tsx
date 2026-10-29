import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { motionScale, useStore } from '../store'
import { closeDetail, detailStep, toggleScreen } from '../actions'
import { SizeToggle } from './SizeToggle'
import { TABLET_MAX_WIDTH } from '../three/detailFraming'
import type { CopyBlock, ProductCopy } from '../types'

/** Scrolling copy (in-between + mobile): blocks fade over this distance (px) at the top/bottom edges. */
const FADE_PX = 72

/** Stagger order: head, first column, second column, then the footnote (offsets from --base). */
const STAGGER_S = { head: 0, left: 0.18, right: 0.36, foot: 0.54 }
/** Entrance waits for the camera arc; re-entry after a MacBook swap starts right away. */
const ENTRANCE_BASE_S = 1.0
const delay = (s: number) => ({ '--d': `${s}s` }) as React.CSSProperties

function Block({ b }: { b: CopyBlock }) {
  return (
    <div className="copy-block">
      <h3>{b.title}</h3>
      <p>{b.body}</p>
    </div>
  )
}

function CtaActions({ actions, product }: { actions: string[]; product: string }) {
  return (
    <div className="cta-actions">
      {actions.map((a) => (
        <a key={a} href="#" className="link" onClick={(e) => e.preventDefault()}>
          {a}
          {/* Screen readers hear "Buy MacBook Neo", not "Buy single right-pointing angle quote". */}
          <span className="visually-hidden"> {product}</span>
          <span aria-hidden> &rsaquo;</span>
        </a>
      ))}
    </div>
  )
}

/** Fades each copy block individually as it nears the top edge of the (mobile) copy sheet. */
function useBlockFade(sheet: React.RefObject<HTMLDivElement | null>, active: boolean, contentKey: string | null) {
  useLayoutEffect(() => {
    const el = sheet.current
    if (!el || !active) return
    const update = () => {
      const sheetRect = el.getBoundingClientRect()
      // Only the scrolling copy (in-between and mobile layouts) fades at its edges.
      const stacked = window.matchMedia(`(max-width: ${TABLET_MAX_WIDTH}px)`).matches
      const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
      for (const block of el.querySelectorAll<HTMLElement>('.copy-block')) {
        const r = block.getBoundingClientRect()
        const t = stacked
          ? Math.min(clamp01((r.top - sheetRect.top) / FADE_PX), clamp01((sheetRect.bottom - r.bottom) / FADE_PX))
          : 1
        block.style.opacity = t.toFixed(3)
      }
    }
    // New product's copy starts from the top.
    el.scrollTop = 0
    update()
    el.addEventListener('scroll', update, { passive: true })
    window.addEventListener('resize', update)
    return () => {
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [sheet, active, contentKey])
}

/** Print-ad layout around the product: headline on top, copy columns either side, footnote below. */
export function DetailOverlay() {
  const { mode, copyKey, copy, hintDismissed, swapPhase, manifest, screenOn } = useStore()
  const closeButton = useRef<HTMLButtonElement>(null)
  const lastKey = useRef<string | null>(null)
  const sheet = useRef<HTMLDivElement>(null)
  if (copyKey) lastKey.current = copyKey
  const key = copyKey ?? lastKey.current
  const visible = mode === 'detail'

  // Apply the visible class a frame after mounting, so the very first entrance has a starting
  // state to transition from (otherwise the stagger is skipped the first time).
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!visible) {
      setShown(false)
      return
    }
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => setShown(true))
    })
    return () => cancelAnimationFrame(id)
  }, [visible])

  // After a swap inside details, the copy staggers back in without waiting for an arc.
  const [reentry, setReentry] = useState(false)
  useEffect(() => {
    if (!visible) setReentry(false)
    else if (swapPhase !== 'idle') setReentry(true)
  }, [visible, swapPhase])

  useBlockFade(sheet, visible && key !== null, key)

  // In-between and mobile layouts the copy scrolls on its own; keyboard users reach it with Tab
  // (its links move into the header there, so nothing else inside it takes focus).
  const [copyScrolls, setCopyScrolls] = useState(() => window.matchMedia(`(max-width: ${TABLET_MAX_WIDTH}px)`).matches)
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${TABLET_MAX_WIDTH}px)`)
    const onChange = () => setCopyScrolls(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  // A modal dialog for keyboard and screen-reader users: focus moves to it on open and returns to
  // whatever opened it (e.g. the Explore button) once the carousel is back.
  const opener = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (visible) {
      const active = document.activeElement
      opener.current = active instanceof HTMLElement && active !== document.body ? active : null
      closeButton.current?.focus({ preventScroll: true })
    }
  }, [visible])
  useEffect(() => {
    if (mode !== 'carousel' || !opener.current) return
    if (opener.current.isConnected) opener.current.focus({ preventScroll: true })
    opener.current = null
  }, [mode])

  useEffect(() => {
    if (!visible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDetail()
      else if (e.key === 'ArrowRight') detailStep(1)
      else if (e.key === 'ArrowLeft') detailStep(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [visible])

  if (!key) return null
  const c: ProductCopy = copy.products[key]
  const isMbp = key === 'mbp14' || key === 'mbp16'
  const screenDef = manifest.products[key]?.screen

  return (
    <div
      className={`detail-overlay ${shown ? 'visible' : ''} ${swapPhase === 'out' ? 'swap-out' : ''}`}
      style={{ '--base': `${reentry ? 0 : ENTRANCE_BASE_S * motionScale()}s` } as React.CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-title"
      // Hidden: out of the tab order and the accessibility tree entirely.
      inert={!visible}
    >
      {/* Desktop: a max-width block, centred vertically. Mobile: pass-through. */}
      <div className="detail-frame">
        <header className="detail-head stagger" style={delay(STAGGER_S.head)}>
          <h2 id="detail-title">{c.headline}</h2>
          <p>{c.subline}</p>
          {/* Mobile only: the CTA lives in the header instead of the copy sheet. */}
          <div className="detail-head-cta">
            {isMbp && <SizeToggle />}
            <CtaActions actions={c.cta.actions} product={c.name} />
          </div>
        </header>
        {/* Desktop: left column | stage | right column. Mobile: the copy sheet that scrolls under the product. */}
        <div
          className="detail-sheet"
          ref={sheet}
          {...(copyScrolls ? { tabIndex: 0, role: 'region', 'aria-label': `${c.name} details` } : {})}
        >
          <div className="detail-col left stagger" style={delay(STAGGER_S.left)}>
            {c.left.map((b) => (
              <Block key={b.title} b={b} />
            ))}
          </div>
          {/* Empty slot the 3D product is framed into (its height is set from the product). */}
          <div className="detail-stage" aria-hidden />
          <div className="detail-col right stagger" style={delay(STAGGER_S.right)}>
            {c.right.map((b) => (
              <Block key={b.title} b={b} />
            ))}
            <div className="copy-block cta">
              <h3>{c.cta.title}</h3>
              <p>{c.cta.body}</p>
              {isMbp && <SizeToggle className="detail-toggle" />}
              <CtaActions actions={c.cta.actions} product={c.name} />
            </div>
          </div>
          <footer className="detail-foot stagger" style={delay(STAGGER_S.foot)}>
            {c.footnote}
          </footer>
        </div>
      </div>
      <button
        ref={closeButton}
        className="detail-close stagger"
        style={delay(STAGGER_S.head)}
        onClick={closeDetail}
        aria-label="Close details"
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path d="M7 7l10 10M17 7 7 17" />
        </svg>
      </button>
      <p
        aria-hidden
        className={`detail-hint stagger ${hintDismissed || swapPhase !== 'idle' ? 'dismissed' : ''}`}
        style={delay(STAGGER_S.foot)}
      >
        Drag to interact
      </p>
      {/* Clicking the product toggles its screen; this is the keyboard / screen-reader way to, shown
          only while focused. */}
      {screenDef &&
        (screenDef.live === 'watch' ? (
          <button className="screen-toggle" onClick={toggleScreen}>
            Play watch face animation
          </button>
        ) : (
          <button className="screen-toggle" aria-pressed={screenOn} onClick={toggleScreen}>
            Show desktop on screen
          </button>
        ))}
    </div>
  )
}
