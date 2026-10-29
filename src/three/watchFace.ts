import { CanvasTexture, SRGBColorSpace } from 'three'

/**
 * Plays the Watch face's wake animation. Nothing is redrawn: the original face's own pixels are
 * hidden and revealed again, so the type and icons stay exactly as they are and the last frame is
 * the original face.
 *
 * - Rings and arcs are picked out by colour (so their masks match the artwork exactly, round caps
 *   included) and sweep in pixel by pixel, the leading edge rounded like the ring's own cap. Hidden
 *   ring pixels show the ring's dark track, so rings fill over their tracks.
 * - UV bars rise and the altitude lines fan out through moving rectangles.
 * - The compass dial swings into place and settles, and the workout runner runs in from the left.
 *
 * Coordinates are on the 1024 upright face image. The image is stretched to fit the Watch's taller
 * display, so round things are wider than tall here: each ring is measured in its own squashed space
 * (`k` = height / width).
 */

const SIZE = 1024
const DEG = Math.PI / 180

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const easeOut = (t: number) => 1 - (1 - t) ** 3
const easeInOut = (t: number) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2)
const easeOutBack = (t: number) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2
/** Progress of a part that runs from `start` for `length` seconds. */
const part = (t: number, start: number, length: number) => clamp01((t - start) / length)

function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b)
  const d = mx - Math.min(r, g, b)
  let h = 0
  if (d) {
    if (mx === r) h = ((g - b) / d) % 6
    else if (mx === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, mx ? d / mx : 0, mx / 255]
}

/** A set of face pixels revealed in order: each shows once the part's progress value reaches `at`. */
interface PixelPart {
  pixels: number[]
  at: number[]
  /** Progress value at which every pixel shows. */
  end: number
  /** Colour the hidden pixels take (the ring's track, the complication's backdrop). */
  hidden: [number, number, number]
  /** Maps time (s since the click) to a progress value in the same units as `at`. */
  progress: (t: number) => number
}

interface Ring {
  /** Search box [x0, y0, x1, y1]. */
  box: [number, number, number, number]
  /** Which pixels belong to the ring (hue in degrees, saturation and value 0-1). */
  test: (h: number, s: number, v: number, x: number, y: number) => boolean
  /** Centre and height/width ratio of the ring as drawn on the face. */
  cx: number
  cy: number
  k: number
  hidden: [number, number, number]
  start: number
  length: number
}

const RINGS: Ring[] = [
  // Temperature gauge: everything lit in its band (the arc, its soft edges and the marker); the 63 and
  // the 52 / 68 labels inside it are left out by radius.
  {
    box: [130, 50, 375, 210],
    test: (_h, _s, v, x, y) => {
      const r = Math.hypot(x - 250, (y - 165) / 0.88)
      return v > 0.03 && r > 78 && r < 120
    },
    cx: 250,
    cy: 165,
    k: 0.88,
    hidden: [0, 0, 0],
    start: 0,
    length: 0.9,
  },
  // Activity rings: move (red), exercise (green), stand (cyan), outer to inner.
  ...(
    [
      [(h: number) => h >= 330 || h <= 15, 0.9, [42, 4, 12], 0.1],
      [(h: number) => h >= 65 && h <= 115, 0.957, [22, 48, 4], 0.22],
      [(h: number) => h >= 160 && h <= 200, 1, [2, 38, 36], 0.34],
    ] as const
  ).map(
    ([hue, k, hidden, start]): Ring => ({
      box: [650, 50, 895, 285],
      test: (h, s, v) => s > 0.35 && v > 0.3 && hue(h),
      cx: 772,
      cy: 167,
      k,
      hidden: [...hidden],
      start,
      length: 0.9,
    }),
  ),
  // Music: the track's progress ring (red; the note inside is white, so it's left out).
  {
    box: [650, 750, 895, 990],
    test: (h, s, v) => s > 0.35 && v > 0.3 && (h >= 330 || h <= 15),
    cx: 772,
    cy: 865,
    k: 0.856,
    hidden: [34, 7, 11],
    start: 0.45,
    length: 1,
  },
]

/**
 * Finds a ring's pixels and when each one shows. The sweep runs clockwise from where the artwork
 * starts: the centre of its start cap, just after its largest gap (the top for a closed ring, like
 * the activity rings). The start cap shows straight away; pixels just behind it belong to the ring's
 * other end and show last. Pixels near the centre line show a little early, so the leading edge is
 * round like the ring's cap.
 */
function ringPart(img: Uint8ClampedArray, ring: Ring): PixelPart {
  const found: { i: number; ang: number; r: number }[] = []
  const [x0, y0, x1, y1] = ring.box
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * SIZE + x) * 4
      const [h, s, v] = hsv(img[i], img[i + 1], img[i + 2])
      if (!ring.test(h, s, v, x, y)) continue
      const ex = x - ring.cx
      const ey = (y - ring.cy) / ring.k
      found.push({ i, ang: (Math.atan2(ey, ex) / DEG + 360) % 360, r: Math.hypot(ex, ey) })
    }
  // Where the artwork starts: just after the widest empty arc (or the top, if it's closed).
  const angles = found.map((p) => p.ang).sort((a, b) => a - b)
  let gap = 0
  let start = 270
  angles.forEach((a, n) => {
    const next = n + 1 < angles.length ? angles[n + 1] : angles[0] + 360
    if (next - a > gap) {
      gap = next - a
      start = next % 360
    }
  })
  if (gap < 10) start = 270
  const radii = found.map((p) => p.r).sort((a, b) => a - b)
  const mid = radii[Math.floor(radii.length / 2)]
  const half = (radii[Math.floor(radii.length * 0.97)] - radii[Math.floor(radii.length * 0.03)]) / 2
  const capDeg = half / mid / DEG
  // An open ring's first pixels are the tip of its cap; the sweep starts at the cap's centre.
  if (gap >= 10) start = (start + capDeg) % 360
  const at = found.map((p) => {
    let rel = (p.ang - start + 360) % 360
    if (rel > 360 - 2 * capDeg) rel -= 360
    const d = p.r - mid
    // How far (degrees) the round cap reaches past the sweep at this distance from the centre line.
    const bulge = Math.sqrt(Math.max(0, half * half - d * d)) / mid / DEG
    if (rel < 0) return rel + bulge >= 0 ? 0 : rel + 360 - bulge
    return Math.max(0, rel - bulge)
  })
  const end = Math.max(...at)
  return {
    pixels: found.map((p) => p.i),
    at,
    end,
    hidden: ring.hidden,
    progress: (t) => end * easeInOut(part(t, ring.start, ring.length)),
  }
}

/** Pixels in a rectangle, shown as a moving edge reaches them (`at` = distance from that edge). */
function rectPart(
  rect: [number, number, number, number],
  from: 'bottom' | 'top',
  hidden: [number, number, number],
  start: number,
  length: number,
): PixelPart {
  const [x, y, w, h] = rect
  const pixels: number[] = []
  const at: number[] = []
  for (let py = y; py < y + h; py++)
    for (let px = x; px < x + w; px++) {
      pixels.push((py * SIZE + px) * 4)
      at.push(from === 'bottom' ? y + h - py : py - y + 1)
    }
  return { pixels, at, end: h, hidden, progress: (t) => h * easeOut(part(t, start, length)) }
}

/** The compass dial (ticks, heading and arrow), as an ellipse ring; the bike inside stays put. */
const COMPASS = { cx: 512, cy: 864, k: 0.86, r0: 66, r1: 120, start: 0.2, length: 1.1 }
const inCompass = (x: number, y: number) => {
  const r = Math.hypot(x - COMPASS.cx, (y - COMPASS.cy) / COMPASS.k)
  return r >= COMPASS.r0 && r <= COMPASS.r1
}

/**
 * The workout runner, on its grey disc: everything in its box that isn't the disc's grey (so its soft
 * edges come too). It runs in from the disc's left edge, leaning forward, and settles with a bounce.
 */
const RUNNER = {
  box: [190, 795, 315, 925] as const,
  disc: { cx: 251, cy: 859, rx: 111, ry: 92 },
  grey: 17,
  /** Turns about its feet. */
  feet: [252, 913] as const,
  start: 0.5,
  length: 0.8,
}

/** Seconds from the click until every part has settled. */
const DURATION = 1.6

export interface WatchFaceAnimation {
  texture: CanvasTexture
  /** (Re)starts the animation. */
  play: () => void
  /** Stops it early (e.g. leaving details). */
  stop: () => void
  /** Draws the frame for `nowMs`; returns false once the animation has finished. */
  update: (nowMs: number) => boolean
}

/** `face` is the original face image (upright); `timeScale` stretches the timing (reduced motion). */
export function createWatchFaceAnimation(face: CanvasImageSource, timeScale = 1): WatchFaceAnimation {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = SIZE
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.anisotropy = 4

  ctx.drawImage(face, 0, 0, SIZE, SIZE)
  const original = ctx.getImageData(0, 0, SIZE, SIZE).data
  const parts: PixelPart[] = [
    ...RINGS.map((r) => ringPart(original, r)),
    // UV forecast: each day's bar rises in turn (its labels stay put).
    ...[0, 1, 2, 3, 4, 5, 6].map((i) =>
      rectPart([Math.round(218 + i * 108.7) - 19, 512, 38, 186], 'bottom', [0, 0, 0], 0.35 + i * 0.08, 0.55),
    ),
    // Altitude: the terrain lines fan out above and below 158FT, on the complication's grey disc.
    rectPart([466, 78, 92, 60], 'bottom', [17, 17, 17], 0.15, 0.7),
    rectPart([466, 180, 92, 58], 'top', [17, 17, 17], 0.15, 0.7),
  ]

  // The face with every animated part hidden; each frame starts from this.
  const base = new ImageData(new Uint8ClampedArray(original), SIZE, SIZE)
  const b = base.data
  for (const p of parts)
    for (const i of p.pixels) {
      b[i] = p.hidden[0]
      b[i + 1] = p.hidden[1]
      b[i + 2] = p.hidden[2]
    }
  // The compass dial moves as a whole: lift it onto its own layer.
  const dial = document.createElement('canvas')
  dial.width = dial.height = SIZE
  const dialCtx = dial.getContext('2d')!
  const dialImg = dialCtx.createImageData(SIZE, SIZE)
  for (let y = COMPASS.cy - 110; y < COMPASS.cy + 110; y++)
    for (let x = COMPASS.cx - 125; x < COMPASS.cx + 125; x++) {
      if (!inCompass(x, y)) continue
      const i = (y * SIZE + x) * 4
      dialImg.data.set(original.subarray(i, i + 4), i)
      b[i] = b[i + 1] = b[i + 2] = 0
    }
  dialCtx.putImageData(dialImg, 0, 0)
  // The runner moves as a whole too: lift it off its disc onto its own layer.
  const runner = document.createElement('canvas')
  runner.width = runner.height = SIZE
  const runnerCtx = runner.getContext('2d')!
  const runnerImg = runnerCtx.createImageData(SIZE, SIZE)
  const [rx0, ry0, rx1, ry1] = RUNNER.box
  for (let y = ry0; y < ry1; y++)
    for (let x = rx0; x < rx1; x++) {
      const i = (y * SIZE + x) * 4
      const g = RUNNER.grey
      if (Math.max(Math.abs(original[i] - g), Math.abs(original[i + 1] - g), Math.abs(original[i + 2] - g)) <= 2) continue
      runnerImg.data.set(original.subarray(i, i + 4), i)
      b[i] = b[i + 1] = b[i + 2] = g
    }
  runnerCtx.putImageData(runnerImg, 0, 0)
  const frame = new ImageData(SIZE, SIZE)

  let started = -1
  let playing = false

  return {
    texture,
    play() {
      started = -1
      playing = true
    },
    stop() {
      playing = false
    },
    update(nowMs) {
      if (!playing) return false
      if (started < 0) started = nowMs
      const t = (nowMs - started) / 1000 / timeScale
      if (t >= DURATION) {
        playing = false
        return false
      }
      const f = frame.data
      f.set(b)
      for (const p of parts) {
        const s = p.progress(t)
        if (s <= 0) continue
        for (let n = 0; n < p.pixels.length; n++) {
          if (p.at[n] > s) continue
          const i = p.pixels[n]
          f[i] = original[i]
          f[i + 1] = original[i + 1]
          f[i + 2] = original[i + 2]
        }
      }
      ctx.putImageData(frame, 0, 0)
      // Compass: the dial swings into place with a little overshoot, like a needle settling. It turns
      // in the dial's own (round) space, so it stays on its ellipse.
      const q = part(t, COMPASS.start, COMPASS.length)
      if (q > 0) {
        ctx.save()
        ctx.globalAlpha = clamp01(q * 4)
        ctx.translate(COMPASS.cx, COMPASS.cy)
        ctx.scale(1, COMPASS.k)
        ctx.rotate(-75 * DEG * (1 - easeOutBack(q)))
        ctx.scale(1, 1 / COMPASS.k)
        ctx.translate(-COMPASS.cx, -COMPASS.cy)
        ctx.drawImage(dial, 0, 0)
        ctx.restore()
      }
      // Runner: runs in from the disc's left edge (clipped to the disc), leaning forward, and settles.
      const r = part(t, RUNNER.start, RUNNER.length)
      if (r > 0) {
        const { cx, cy, rx, ry } = RUNNER.disc
        const [fx, fy] = RUNNER.feet
        ctx.save()
        ctx.beginPath()
        ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
        ctx.clip()
        ctx.globalAlpha = clamp01(r * 3)
        ctx.translate(-110 * (1 - easeOutBack(r)), 0)
        ctx.translate(fx, fy)
        ctx.rotate(12 * DEG * (1 - easeOut(r)))
        ctx.translate(-fx, -fy)
        ctx.drawImage(runner, 0, 0)
        ctx.restore()
      }
      texture.needsUpdate = true
      return true
    },
  }
}
