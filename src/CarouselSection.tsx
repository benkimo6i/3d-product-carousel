import { Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Canvas, invalidate } from '@react-three/fiber'
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
import { Stage } from './three/Stage'
import { Carousel } from './three/Carousel'
import { CameraRig } from './three/CameraRig'
import { DetailControls } from './three/DetailControls'
import { CarouselUI } from './ui/CarouselUI'
import { DetailOverlay } from './ui/DetailOverlay'
import { activeKey, motion, useStore } from './store'
import { registerTrigger } from './actions'
import { attachStepNav } from './stepNav'
import { LabelAnchor } from './three/LabelAnchor'
import { DevHandle } from './three/DevHandle'
import { NavArrows } from './ui/NavArrows'
import { DetailPrefetch, RenderDriver } from './three/warmUp'
import { MOBILE_MAX_WIDTH } from './three/detailFraming'

gsap.registerPlugin(ScrollTrigger)

/** Scroll distance per product, in viewport heights. */
const VH_PER_SLOT = 0.85
/** Highest pixel ratio rendered: phones stop at 1.5 (barely visible there, ~44% fewer pixels than 2). */
const MAX_DPR = 2
const PHONE_MAX_DPR = 1.5

function useMaxDpr() {
  const query = `(max-width: ${MOBILE_MAX_WIDTH}px)`
  const [phone, setPhone] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setPhone(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return phone ? PHONE_MAX_DPR : MAX_DPR
}

export function CarouselSection() {
  const manifest = useStore((s) => s.manifest)
  const section = useRef<HTMLElement>(null)
  const slots = manifest.carousel.order.length
  const maxDpr = useMaxDpr()
  const canvasLabel = useStore((s) => {
    const key = s.detailKey ?? activeKey(s.manifest, s.nearest, s.mbpSize)
    const name = s.copy.products[key]?.name ?? 'product'
    return s.mode === 'detail' ? `3D model of ${name}. Drag to rotate.` : `3D model of ${name}`
  })

  useLayoutEffect(() => {
    const el = section.current
    if (!el) return
    const last = slots - 1
    const tween = gsap.to(motion, {
      progress: last,
      ease: 'none',
      scrollTrigger: {
        trigger: el,
        start: 'top top',
        end: 'bottom bottom',
        // The carousel follows the page exactly; stepNav animates the page one product per gesture.
        scrub: true,
      },
      onUpdate: () => {
        // The canvas renders on demand; scrolling moves the row.
        invalidate()
        const nearest = Math.round(motion.progress)
        const settled = Math.abs(motion.progress - nearest) < 0.02
        const s = useStore.getState()
        if (s.nearest !== nearest || s.settled !== settled) s.setNearest(nearest, settled)
      },
    })
    registerTrigger(tween.scrollTrigger ?? null)
    const detach = tween.scrollTrigger ? attachStepNav(tween.scrollTrigger, ScrollTrigger) : () => {}
    return () => {
      detach()
      registerTrigger(null)
      tween.scrollTrigger?.kill()
      tween.kill()
    }
  }, [slots])

  return (
    <section
      ref={section}
      className="carousel-section"
      style={{ height: `${100 + (slots - 1) * VH_PER_SLOT * 100}vh` }}
      aria-roledescription="carousel"
      aria-label="Products"
    >
      <div className="carousel-sticky">
        <Canvas
          className="carousel-canvas"
          role="img"
          aria-label={canvasLabel}
          dpr={[1, maxDpr]}
          frameloop="demand"
          camera={{ fov: manifest.carousel.camera.fovVertical, near: 0.02, far: 50, position: manifest.carousel.camera.position }}
          gl={{ antialias: true }}
        >
          <color attach="background" args={[manifest.stage.background]} />
          <Suspense fallback={null}>
            <Stage />
            <Carousel />
          </Suspense>
          <CameraRig />
          <DetailControls />
          <LabelAnchor />
          <RenderDriver />
          <Suspense fallback={null}>
            <DetailPrefetch />
          </Suspense>
          <DevHandle />
        </Canvas>
        <CarouselUI />
        {/* Mobile only: the paddles sit in a row at the bottom of the screen. */}
        <NavArrows inline />
        <DetailOverlay />
        {/* After the overlay, so the paddles stay clickable over it in the details view. */}
        <NavArrows />
      </div>
    </section>
  )
}
