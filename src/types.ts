export type Vec3 = [number, number, number]
/** three.js order: [x, y, z, w] */
export type Quat = [number, number, number, number]

export interface CameraDef {
  position: Vec3
  target: Vec3
  fovVertical: number
  spherical: { yawDeg: number; elevationDeg: number; distance: number }
}

export interface LidDef {
  node: string
  axis: 'x'
  restState: 'open'
  closedAngleRad: number
  defaultState: 'open' | 'closed'
}

/** A soft shadow baked in Blender, laid on the floor under the product. */
export interface ShadowDef {
  file: string
  /** Centre on the floor, [x, z], relative to the product's pivot. */
  center: [number, number]
  /** Width (x) and depth (z) in metres. */
  size: [number, number]
  /** Height of the floor relative to the pivot. */
  y: number
}

/** A display that reacts when you click the product in details: a mock desktop, or the Watch's animated face. */
export interface ScreenDef {
  /** Material of the screen surface (its emissive map is the wallpaper). */
  material: string
  /**
   * Part of the screen texture's UV space the display covers: [u0, v0, u1, v1] for the image's
   * top-left and bottom-right corners (glTF UVs, v down). A model whose screen UVs run backwards
   * lists that range reversed (the iMac's and 16" MacBook Pro's v, the iPhone's u).
   */
  uv: [number, number, number, number]
  /**
   * The mock desktop image, at the display's aspect ratio (rendered by `npm run screens`); for the
   * Watch, its original face, upright, which the animation reveals piece by piece.
   */
  image: string
  /** 'watch': a click replays the face's animation instead of toggling a desktop. */
  live?: 'watch'
}

export interface ProductDef {
  index: number
  files: { carousel: string; detail: string }
  /** Spin pivot relative to the slot origin (three.js coords). */
  pivotOffset: Vec3
  snapPoses: Record<string, Quat>
  defaultPose: string
  detailCamera: CameraDef
  copyKey: string
  lid?: LidDef
  shadow?: ShadowDef
  /** MacBooks: the shadow with the lid closed, blended in as the lid closes. */
  shadowClosed?: ShadowDef
  /**
   * Carousel normalisation: scale (about the floor point under the pivot) and floor offset [x, z],
   * chosen so every product sits centred and similarly sized under one fixed camera.
   */
  display?: { scale: number; offset: [number, number] }
  screen?: ScreenDef
}

export interface Credit {
  model: string
  author: string
  license: string
}

export interface Manifest {
  carousel: {
    spacing: number
    order: string[]
    slots: Record<string, string[]>
    camera: CameraDef
    mbp16Camera: CameraDef
  }
  stage: { background: string }
  products: Record<string, ProductDef>
  credits: Credit[]
}

export interface CopyBlock {
  title: string
  body: string
}

export interface ProductCopy {
  name: string
  headline: string
  subline: string
  left: CopyBlock[]
  right: CopyBlock[]
  cta: CopyBlock & { actions: string[] }
  footnote: string
}

export interface CopyDoc {
  products: Record<string, ProductCopy>
}
