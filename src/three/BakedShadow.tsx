import { useLayoutEffect, useMemo, useRef } from 'react'
import { useTexture } from '@react-three/drei'
import { MeshBasicMaterial } from 'three'
import type { ShadowDef } from '../types'

/** Share of the plane, from each edge, over which the shadow fades to nothing. */
const EDGE_FADE = 0.18
/** Alpha below this (the softbox's faint far penumbra) is dropped, so no plane edge ever shows. */
const ALPHA_FLOOR = 0.035
/** Floor captured in front of each product in the bakes: 9 cm margin + 5 cm forward spill. */
const BAKE_FRONT_MARGIN_M = 0.14
/** Trim: fade across the product's front edge over this many metres (behind / in front of it). */
const TRIM_FEATHER_BACK_M = 0.03
const TRIM_FEATHER_FRONT_M = 0.02

export interface ShadowTuning {
  /** Opacity of the part in front of the product (towards the camera), relative to the back. */
  front?: number
  /** Share of the plane, from the front edge, over which the shadow fades out. */
  frontFade?: number
  /** Remove the shadow in front of the product entirely (it would sit behind the label copy). */
  trimFront?: boolean
}

function createShadowMaterial({ front = 0.5, frontFade = EDGE_FADE, trimFront = false }: ShadowTuning, depth: number) {
  // Where the product's front edge falls along the plane, and the feather either side of it.
  const edgeV = BAKE_FRONT_MARGIN_M / depth
  const trimFrom = trimFront ? edgeV - TRIM_FEATHER_FRONT_M / depth : -1
  const trimTo = trimFront ? edgeV + TRIM_FEATHER_BACK_M / depth : 0
  const m = new MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, opacity: 0 })
  m.onBeforeCompile = (shader) => {
    // In the plane's UVs, v = 0 is the front edge (towards the camera) and v = 1 the back.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
      vec2 e = smoothstep(vec2(0.0), vec2(${EDGE_FADE}), vMapUv) * smoothstep(vec2(0.0), vec2(${EDGE_FADE}), 1.0 - vMapUv);
      float frontEdge = smoothstep(0.0, ${frontFade.toFixed(3)}, vMapUv.y);
      float frontShare = mix(${front.toFixed(3)}, 1.0, smoothstep(0.25, 0.7, vMapUv.y));
      float trim = smoothstep(${trimFrom.toFixed(4)}, ${trimTo.toFixed(4)}, vMapUv.y);
      diffuseColor.a = max(diffuseColor.a - ${ALPHA_FLOOR}, 0.0) / ${(1 - ALPHA_FLOOR).toFixed(3)}
        * e.x * e.y * frontEdge * frontShare * trim;`,
    )
  }
  return m
}

/**
 * A soft shadow baked in Blender (Cycles, shadow catcher), laid flat on the floor. Its opacity is
 * driven from outside every frame through `onMaterial`, so it can follow fades and lid angles.
 */
export function BakedShadow({
  def,
  tuning = {},
  onMaterial,
}: {
  def: ShadowDef
  tuning?: ShadowTuning
  onMaterial: (m: MeshBasicMaterial) => void
}) {
  const map = useTexture(def.file)
  // Tuning is fixed per product, so the material is built once.
  const material = useMemo(() => createShadowMaterial(tuning, def.size[1]), [])
  const ready = useRef(false)

  useLayoutEffect(() => {
    material.map = map
    material.needsUpdate = true
    if (!ready.current) {
      ready.current = true
      onMaterial(material)
    }
  }, [map, material, onMaterial])

  return (
    <mesh
      position={[def.center[0], def.y, def.center[1]]}
      rotation-x={-Math.PI / 2}
      renderOrder={1}
      material={material}
      raycast={() => null}
    >
      <planeGeometry args={def.size} />
    </mesh>
  )
}
