import { CarouselSection } from './CarouselSection'
import { useStore } from './store'

function Nav() {
  const mode = useStore((s) => s.mode)
  return (
    // Behind the details dialog: dimmed, and out of reach for keyboard and screen readers.
    <nav className={`top-nav ${mode !== 'carousel' ? 'dim' : ''}`} inert={mode !== 'carousel'}>
      <div className="nav-inner">
        <a href="#" className="nav-logo" aria-label="Home" onClick={(e) => e.preventDefault()}>
          <span aria-hidden>●</span>
        </a>
        {['Store', 'Mac', 'iPhone', 'Watch', 'AirPods', 'Support'].map((l) => (
          <a key={l} href="#" onClick={(e) => e.preventDefault()}>
            {l}
          </a>
        ))}
      </div>
    </nav>
  )
}

function Hero() {
  const mode = useStore((s) => s.mode)
  return (
    <section className="hero" inert={mode !== 'carousel'}>
      <h1>The lineup.</h1>
      <p>Every device, front and centre. Scroll to explore.</p>
      <span className="hero-cue" aria-hidden>
        ↓
      </span>
    </section>
  )
}

function Footer() {
  const credits = useStore((s) => s.manifest.credits)
  const mode = useStore((s) => s.mode)
  return (
    <footer className="site-footer" inert={mode !== 'carousel'}>
      <p className="footer-note">Portfolio demo. Product names and copy are placeholders; not affiliated with Apple.</p>
      <h2 className="footer-heading">3D model credits</h2>
      <ul>
        {credits.map((c) => (
          <li key={c.model}>
            “{c.model}” by {c.author} — {c.license}
          </li>
        ))}
      </ul>
    </footer>
  )
}

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <CarouselSection />
      </main>
      <Footer />
    </>
  )
}
