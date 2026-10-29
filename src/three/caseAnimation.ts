import { MathUtils, Quaternion, Vector3, type MeshStandardMaterial, type Object3D } from 'three'
import type { CaseDef } from '../types'

/**
 * The AirPods going into their case, as one timeline from 0 (open, buds floating) to 1 (buds
 * seated, lid shut). Played forwards to close and backwards to open. Each bud first lines its stem
 * up over its hole, then slides straight down it, turning inwards into its cup as it goes (so the
 * stem never cuts through the case), the right just after the left; then the lid swings shut,
 * speeding up at the end like a magnet catching it, with a small rebound.
 */

/** Seconds for the whole timeline. */
export const CASE_DURATION = 2.4

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
const easeIn = (t: number) => t ** 3
/** Progress of a part that runs over [start, start + length] of the timeline. */
const part = (t: number, start: number, length: number) => clamp01((t - start) / length)

/** Seconds → share of the timeline. */
const s = (seconds: number) => seconds / CASE_DURATION
/** Bud windows on the timeline: 1.2s each, the right starting 0.15s after the left. */
const BUDS: [number, number][] = [
  [0, s(1.2)],
  [s(0.15), s(1.2)],
]
/** Lid window (0.9s, once both buds are in); it catches in the last 15% and rebounds by this share of its swing. */
const LID: [number, number] = [s(1.45), s(0.9)]
const LID_CATCH = 0.85
const LID_REBOUND = 0.035
/** Share of a bud's time spent lining up over its hole (the rest is the slide in). */
const LINE_UP = 0.4
/** How far past its seat (share of the slide) a bud dips before settling. */
const SETTLE = 0.02

/** How far closed the lid is at timeline position `t` (0 open, 1 shut; dips under 1 on the rebound). */
export function lidClosed(t: number): number {
  const q = part(t, ...LID)
  if (q < LID_CATCH) return easeIn(q / LID_CATCH)
  return 1 - LID_REBOUND * Math.sin((Math.PI * (q - LID_CATCH)) / (1 - LID_CATCH))
}

interface Pose {
  position: Vector3
  quaternion: Quaternion
}

interface Bud {
  node: Object3D
  rest: Pose
  hover: Pose
  seat: Pose
}

export interface CaseRig {
  /** Poses the buds for timeline position `t`. */
  pose: (t: number) => void
  /** Status light: 0 normal, 1 full glow. */
  setLight: (glow: number) => void
}

/**
 * Finds the bud pivots and the status light in a loaded model (null for a model without them). The
 * light is the material that glows most without a texture (the model pipeline merges plain-colour
 * materials, so it can't be found by name).
 */
export function createCaseRig(root: Object3D, def: CaseDef, materials: MeshStandardMaterial[]): CaseRig | null {
  const buds: Bud[] = []
  for (const b of def.buds) {
    const node = root.getObjectByName(b.node)
    if (!node) return null
    const pose = (p: { position: [number, number, number]; quaternion: [number, number, number, number] }) => ({
      position: new Vector3(...p.position),
      quaternion: new Quaternion(...p.quaternion),
    })
    const bud = { node, rest: { position: node.position.clone(), quaternion: node.quaternion.clone() }, hover: pose(b.hover), seat: pose(b.seat) }
    // Lets the camera measure the AirPods at rest (see CameraRig).
    node.userData.rest = bud.rest
    buds.push(bud)
  }
  const glow = (m: MeshStandardMaterial) => (m.emissive && !m.emissiveMap ? Math.max(m.emissive.r, m.emissive.g, m.emissive.b) : 0)
  const light = materials.reduce<MeshStandardMaterial | undefined>((best, m) => (glow(m) > (best ? glow(best) : 0.005) ? m : best), undefined)
  const lightBase = light?.emissiveIntensity ?? 1

  return {
    pose(t) {
      buds.forEach((b, i) => {
        const p = part(t, ...BUDS[i])
        if (p < LINE_UP) {
          // Line the stem up over its hole.
          const q = easeInOut(p / LINE_UP)
          b.node.position.lerpVectors(b.rest.position, b.hover.position, q)
          b.node.quaternion.slerpQuaternions(b.rest.quaternion, b.hover.quaternion, q)
        } else {
          // Slide down the hole, turning inwards as it goes; dip a touch past the seat and settle.
          const r = (p - LINE_UP) / (1 - LINE_UP)
          const q = easeInOut(r)
          b.node.position.lerpVectors(b.hover.position, b.seat.position, q + SETTLE * Math.sin(Math.PI * clamp01((r - 0.8) / 0.2)))
          b.node.quaternion.slerpQuaternions(b.hover.quaternion, b.seat.quaternion, q)
        }
      })
    },
    setLight(glow) {
      if (light) light.emissiveIntensity = MathUtils.lerp(lightBase, lightBase * 25, glow)
    },
  }
}
