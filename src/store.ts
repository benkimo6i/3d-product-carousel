import { create } from 'zustand'
import type { Object3D } from 'three'
import type { CopyDoc, Manifest } from './types'

export type Mode = 'carousel' | 'detail' | 'closing'
export type MbpSize = '14' | '16'

interface State {
  manifest: Manifest
  copy: CopyDoc
  /** Slot closest to the stage centre. */
  nearest: number
  /** True once scrolling has come to rest on `nearest`. */
  settled: boolean
  mode: Mode
  detailKey: string | null
  mbpSize: MbpSize
  /** The "Drag to interact" hint hides after the first drag, until details opens again. */
  hintDismissed: boolean
  /** Product whose copy the details overlay shows (switches mid-swap, before the camera does). */
  copyKey: string | null
  /** MacBook swap inside details: 'out' copy fading out, 'in' copy staggering back, 'idle' otherwise. */
  swapPhase: 'idle' | 'out' | 'in'
  /** Carousel slots whose models may load (streamed in, nearest first; see loadQueue). */
  loadable: number[]
  /** Detail models fetched and warmed up in the background, ahead of opening them. */
  prefetch: string[]
  /** Details: the product's screen shows its mock desktop instead of the wallpaper. */
  screenOn: boolean
  /** Details: bumped to replay the Watch face's animation. */
  screenReplay: number
  setNearest: (nearest: number, settled: boolean) => void
  setHintDismissed: (dismissed: boolean) => void
  setCopyKey: (key: string | null) => void
  setSwapPhase: (phase: 'idle' | 'out' | 'in') => void
  setMode: (mode: Mode) => void
  setDetailKey: (key: string | null) => void
  setMbpSize: (size: MbpSize) => void
  setScreenOn: (on: boolean) => void
  replayScreen: () => void
}

export const useStore = create<State>()((set) => ({
  manifest: undefined as unknown as Manifest,
  copy: undefined as unknown as CopyDoc,
  nearest: 0,
  settled: true,
  mode: 'carousel',
  detailKey: null,
  mbpSize: '14',
  hintDismissed: false,
  copyKey: null,
  swapPhase: 'idle',
  loadable: [0],
  prefetch: [],
  screenOn: false,
  screenReplay: 0,
  setNearest: (nearest, settled) => set({ nearest, settled }),
  setHintDismissed: (hintDismissed) => set({ hintDismissed }),
  setCopyKey: (copyKey) => set({ copyKey }),
  setSwapPhase: (swapPhase) => set({ swapPhase }),
  setMode: (mode) => set({ mode }),
  setDetailKey: (detailKey) => set({ detailKey }),
  setMbpSize: (mbpSize) => set({ mbpSize }),
  setScreenOn: (screenOn) => set({ screenOn }),
  replayScreen: () => set((s) => ({ screenReplay: s.screenReplay + 1 })),
}))

/** Values read every frame; mutated by GSAP and ScrollTrigger, never trigger React renders. */
export const motion = {
  /** Carousel position in slots: 0 = first product on stage. */
  progress: 0,
  /** 0 = carousel camera, 1 = details camera (eased by GSAP). */
  detail: 0,
  /** True while the user is dragging the product in the details view. */
  dragging: false,
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

/**
 * Multiplier for animation durations: with "reduce motion" on, slides, camera arcs and the lid swap
 * still play (a cut would be more disorienting in 3D), just at 30% of their length.
 */
export function motionScale() {
  return reducedMotion.matches ? 0.3 : 1
}

/** Product root groups by key, so the camera and orbit controls can find them. */
export const productRoots = new Map<string, Object3D>()
/** Each product's display (normalisation) group, by key. */
export const productDisplays = new Map<string, Object3D>()

export function slotKeys(manifest: Manifest, slot: number): string[] {
  return manifest.carousel.slots[manifest.carousel.order[slot]]
}

/** The product that a slot currently presents (the MacBook Pro slot depends on the size toggle). */
export function activeKey(manifest: Manifest, slot: number, mbpSize: MbpSize): string {
  const keys = slotKeys(manifest, slot)
  if (keys.length > 1) return mbpSize === '16' ? 'mbp16' : 'mbp14'
  return keys[0]
}

export function isMbpSlot(manifest: Manifest, slot: number): boolean {
  return slotKeys(manifest, slot).length > 1
}
