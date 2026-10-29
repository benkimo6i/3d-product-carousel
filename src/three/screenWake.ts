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
 * Lets a screen material crossfade from its wallpaper to the mock desktop: its glow (emissive) blends
 * to the new image, and mid-blend the screen dims slightly, like a display waking. Two things would
 * wash the desktop out, so both fade away as the screen wakes:
 * - the Neo's and iPhone's screens also have a lit base colour (the wallpaper again), which fades to
 *   black, like the other screens';
 * - the scene's filmic tone mapping compresses and desaturates bright colours, which flatters the
 *   products but mutes a screen image that already holds its final colours, so it's skipped.
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
  diffuseColor.rgb *= 1.0 - screenWake;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
#ifdef USE_EMISSIVEMAP
  totalEmissiveRadiance = mix(totalEmissiveRadiance, emissive * screenWakeColor(vEmissiveMapUv), screenWake);
  totalEmissiveRadiance *= 1.0 - 0.35 * sin(3.14159265 * screenWake);
#endif`,
      )
      .replace(
        '#include <tonemapping_fragment>',
        /* glsl */ `vec3 screenUntoned = gl_FragColor.rgb;
#include <tonemapping_fragment>
  gl_FragColor.rgb = mix(gl_FragColor.rgb, screenUntoned, screenWake);`,
      )
  }
  material.customProgramCacheKey = () => 'screen-wake'
  material.needsUpdate = true
}
