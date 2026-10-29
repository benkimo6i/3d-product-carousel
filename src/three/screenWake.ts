import { DataTexture, SRGBColorSpace, TextureLoader, type Material, type Texture } from 'three'
import type { ScreenDef } from '../types'

/** Shared per product: both its carousel and detailed screen materials read the same values. */
export interface ScreenUniforms {
  /** 0 = wallpaper, 1 = mock desktop. */
  screenWake: { value: number }
  screenWakeMap: { value: Texture }
  /** The display's part of the screen texture's UV space: [u0, v0, u1, v1]. */
  screenRect: { value: [number, number, number, number] }
}

/** Bound until the mock desktop has loaded (wake stays at 0 meanwhile, so it's never seen). */
const blank = new DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1)
blank.needsUpdate = true

export function screenUniforms(def: ScreenDef): ScreenUniforms {
  return { screenWake: { value: 0 }, screenWakeMap: { value: blank }, screenRect: { value: def.uv } }
}

const loader = new TextureLoader()
const images = new Map<string, Promise<Texture>>()

/** Loads (once) a mock desktop image as a glTF-style texture: sRGB, not flipped. */
export function loadScreenImage(url: string): Promise<Texture> {
  let p = images.get(url)
  if (!p) {
    p = loader.loadAsync(url).then((t) => {
      t.flipY = false
      t.colorSpace = SRGBColorSpace
      t.anisotropy = 4
      return t
    })
    images.set(url, p)
  }
  return p
}

/**
 * Lets a screen material crossfade from its wallpaper to the mock desktop. Its glow (emissive) and
 * base colour both blend to the new image; mid-blend the screen dims slightly, like a display waking.
 */
export function patchScreenMaterial(material: Material, uniforms: ScreenUniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        'void main() {',
        /* glsl */ `uniform float screenWake;
uniform sampler2D screenWakeMap;
uniform vec4 screenRect;
vec3 screenWakeColor(vec2 uv) {
  return texture2D(screenWakeMap, clamp((uv - screenRect.xy) / (screenRect.zw - screenRect.xy), 0.0, 1.0)).rgb;
}
void main() {`,
      )
      .replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
#ifdef USE_MAP
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuse * screenWakeColor(vMapUv), screenWake);
#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
#ifdef USE_EMISSIVEMAP
  totalEmissiveRadiance = mix(totalEmissiveRadiance, emissive * screenWakeColor(vEmissiveMapUv), screenWake);
  totalEmissiveRadiance *= 1.0 - 0.35 * sin(3.14159265 * screenWake);
#endif`,
      )
  }
  material.customProgramCacheKey = () => 'screen-wake'
  material.needsUpdate = true
}
