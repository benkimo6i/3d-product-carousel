import { Box3, MathUtils, PerspectiveCamera, Vector3, type Object3D } from 'three'
import { invalidate } from '@react-three/fiber'
import { restingBox, restingScreenRect } from './restingBox'

/** At or below this width the details view stacks: headline, product band, then a copy sheet. */
export const MOBILE_MAX_WIDTH = 768
/** Up to this width (above mobile) the details view uses the in-between layout: head on top, one
 *  scrolling copy column on the left, the product on the right. */
export const TABLET_MAX_WIDTH = 1100

export type DetailLayout = 'desktop' | 'tablet' | 'mobile'
export const detailLayout = (viewW: number): DetailLayout =>
  viewW <= MOBILE_MAX_WIDTH ? 'mobile' : viewW <= TABLET_MAX_WIDTH ? 'tablet' : 'desktop'

/** Desktop: the product's largest side fills this share of the middle (stage) column. */
const DESKTOP_STAGE_FILL = 0.9
/** Desktop: space reserved under the product for the "Drag to interact" hint. */
export const HINT_RESERVE_PX = 44
/** Desktop: breathing room kept above and below the whole centred block. */
const DESKTOP_V_MARGIN = 40
/** Mobile: the product fits this share of the band between the header and the copy sheet. */
const MOBILE_FILL_W = 0.84
const MOBILE_FILL_H = 0.86
/** In-between: the product fits this share of the area right of the copy column. */
const TABLET_FILL_W = 0.82
const TABLET_FILL_H = 0.74

export interface Framing {
  target: Vector3
  distance: number
  /** View offset in CSS px (positive moves the picture left / up). */
  shiftX: number
  shiftY: number
  /** Desktop: height the layout's stage slot should reserve for this product (px); 0 otherwise. */
  stageH: number
}

/** Tells the desktop layout how tall the product is, so the centred block makes room for it. */
export function publishStageHeight(px: number) {
  const overlay = q('.detail-overlay')
  if (!overlay || px <= 0) return
  if (Math.abs(parseFloat(overlay.style.getPropertyValue('--stage-h') || '0') - px) > 1) {
    overlay.style.setProperty('--stage-h', `${Math.round(px)}px`)
    // The layout moves the stage line the framing is measured against; measure again next frame.
    invalidate()
  }
}

/** The screen area (CSS px, relative to the overlay) the product has to sit in. */
interface Area {
  left: number
  right: number
  top: number
  bottom: number
  /** Desktop: tallest the product may be so the whole block still fits on screen. */
  maxHeight: number
}

const q = (s: string) => document.querySelector<HTMLElement>(s)

/** Reads the area the product has to sit in from the overlay's DOM. */
function readArea(layout: DetailLayout, viewW: number, viewH: number): Area | null {
  const overlay = q('.detail-overlay')
  const head = q('.detail-head')
  if (!overlay || !head) return null
  const o = overlay.getBoundingClientRect()

  if (layout === 'desktop') {
    const stage = q('.detail-stage')
    const foot = q('.detail-foot')
    if (!stage) return null
    // The stage has no transforms, so its rect is its laid-out position.
    const s = stage.getBoundingClientRect()
    const footReserve = (foot?.offsetHeight ?? 16) + 28
    return {
      left: s.left - o.left,
      right: s.right - o.left,
      top: s.top - o.top,
      bottom: viewH,
      maxHeight: viewH - head.offsetHeight - 2 * DESKTOP_V_MARGIN - HINT_RESERVE_PX - footReserve,
    }
  }

  const sheet = q('.detail-sheet')
  if (!sheet) return null
  if (layout === 'tablet') {
    // Right of the copy column, below the head (layout offsets ignore entrance transforms).
    const headBottom = head.offsetTop + head.offsetHeight
    return {
      left: sheet.offsetLeft + sheet.offsetWidth,
      right: viewW - 24,
      top: headBottom + 16,
      bottom: viewH - 56,
      maxHeight: Infinity,
    }
  }
  // Mobile: the band between the head and the copy sheet. The hint sits in the sheet's top runway,
  // so the band can reach just past the sheet edge.
  return {
    left: 0,
    right: viewW,
    top: head.offsetTop + head.offsetHeight + 16,
    bottom: sheet.offsetTop + 8,
    maxHeight: Infinity,
  }
}

const box = new Box3()
const size = new Vector3()
const scratch = new PerspectiveCamera()
const rootPos = new Vector3()

/**
 * Solved framings per product, reused until anything they depend on changes (viewport, layout
 * lines, view angle, the model itself, or `extra` such as a lid angle). The target is kept relative
 * to the product, so the cache stays valid while the row slides.
 */
interface Cached extends Omit<Framing, 'target'> {
  stamp: string
  offset: Vector3
}
const cache = new WeakMap<Object3D, Cached>()

/**
 * Works out where the details camera should sit for `root`, viewed from (yaw, elevation):
 * distance from the product's size, then a view shift that lands it in the layout's product area.
 * On desktop it also reports how tall the product is (`stageH`), for the layout to make room.
 */
export function solveDetailFraming(
  root: Object3D,
  camera: PerspectiveCamera,
  viewW: number,
  viewH: number,
  yaw: number,
  elevation: number,
  out: Framing,
  extra = '',
): Framing | null {
  const layout = detailLayout(viewW)
  const area = readArea(layout, viewW, viewH)
  if (!area) return null

  root.getWorldPosition(rootPos)
  const stamp = [
    layout,
    viewW,
    viewH,
    area.left.toFixed(1),
    area.right.toFixed(1),
    area.top.toFixed(1),
    area.bottom.toFixed(1),
    area.maxHeight,
    yaw.toFixed(4),
    elevation.toFixed(4),
    camera.fov,
    root.children[0]?.uuid,
    extra,
  ].join('|')
  const hit = cache.get(root)
  if (hit?.stamp === stamp) {
    out.target.copy(rootPos).add(hit.offset)
    out.distance = hit.distance
    out.shiftX = hit.shiftX
    out.shiftY = hit.shiftY
    out.stageH = hit.stageH
    return out
  }
  const areaW = Math.max(40, area.right - area.left)
  const areaH = Math.max(40, area.bottom - area.top)

  restingBox(root, box).getSize(size)
  box.getCenter(out.target)
  const tanHalf = Math.tan(MathUtils.degToRad(camera.fov / 2))
  const toDistance = (worldSpan: number, screenSpan: number, screenTotal: number, aspect = 1) =>
    worldSpan / (2 * tanHalf * aspect * (screenSpan / screenTotal))

  if (layout === 'desktop') {
    // Size by the largest side, so narrow products (iPhone, Watch) don't balloon to the stage width.
    const span = Math.max(size.x, size.y)
    out.distance = toDistance(span, areaW * DESKTOP_STAGE_FILL, viewW, camera.aspect) + size.z / 2
  } else {
    const [fillW, fillH] = layout === 'tablet' ? [TABLET_FILL_W, TABLET_FILL_H] : [MOBILE_FILL_W, MOBILE_FILL_H]
    out.distance =
      Math.max(
        toDistance(Math.max(size.x, size.z), areaW * fillW, viewW, camera.aspect),
        toDistance(size.y, areaH * fillH, viewH),
      ) +
      size.z / 2
  }

  // Project the real silhouette from the solved position (no view offset).
  scratch.fov = camera.fov
  scratch.aspect = camera.aspect
  scratch.near = camera.near
  scratch.far = camera.far
  scratch.updateProjectionMatrix()
  const ce = Math.cos(elevation)
  const project = () => {
    scratch.position.set(
      out.target.x - Math.sin(yaw) * ce * out.distance,
      out.target.y + Math.sin(elevation) * out.distance,
      out.target.z + Math.cos(yaw) * ce * out.distance,
    )
    scratch.lookAt(out.target)
    return restingScreenRect(root, scratch, viewW, viewH)
  }
  let [left, right, top, bottom] = project()
  // Nothing to measure (e.g. for a frame while the detailed model swaps in): keep the last framing.
  if (![left, right, top, bottom].every(Number.isFinite)) return null

  if (layout === 'desktop') {
    // Tall products: pull back until the whole centred block fits on screen. Screen height scales
    // roughly with 1/distance, so a few passes converge.
    for (let i = 0; i < 4 && bottom - top > area.maxHeight; i++) {
      out.distance *= ((bottom - top) / area.maxHeight) * 1.01
      ;[left, right, top, bottom] = project()
    }
  }
  // The caller publishes this (possibly blended during a product switch) via publishStageHeight.
  out.stageH = layout === 'desktop' ? bottom - top + HINT_RESERVE_PX : 0

  if (layout === 'desktop') {
    // Top pinned to the column-top line; horizontally the camera already centres the product.
    out.shiftX = 0
    out.shiftY = top - area.top
  } else if (layout === 'tablet') {
    out.shiftX = (left + right) / 2 - (area.left + area.right) / 2
    out.shiftY = (top + bottom) / 2 - (area.top + area.bottom) / 2
  } else {
    out.shiftX = 0
    out.shiftY = (top + bottom) / 2 - (area.top + area.bottom) / 2
  }
  cache.set(root, {
    stamp,
    offset: out.target.clone().sub(rootPos),
    distance: out.distance,
    shiftX: out.shiftX,
    shiftY: out.shiftY,
    stageH: out.stageH,
  })
  return out
}
