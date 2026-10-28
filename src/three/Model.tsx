import { useLayoutEffect, useMemo } from 'react'
import { useThree } from '@react-three/fiber'
import { Mesh, MeshBasicMaterial, type Material, type Object3D } from 'three'
import { warmUp } from './warmUp'
import { useModel } from './gltf'

export interface LoadedModel {
  root: Object3D
  materials: Material[]
  meshes: Mesh[]
  /** Depth-only copies drawn before a faded model, so only its front-most surfaces show. */
  depthMeshes: Mesh[]
}

// Render order while fading: the depth pre-pass draws after the opaque scene, then the colour pass.
export const DEPTH_PASS_ORDER = 1
export const FADE_PASS_ORDER = 2

const depthOnly = new MeshBasicMaterial({ colorWrite: false, depthWrite: true, transparent: true })

/** Renders a cloned glTF scene with its own materials, so each instance can fade independently. */
export function Model({ url, onReady }: { url: string; onReady: (m: LoadedModel) => void }) {
  const { scene } = useModel(url)
  const invalidate = useThree((s) => s.invalidate)

  const model = useMemo<LoadedModel>(() => {
    const root = scene.clone(true)
    const materials: Material[] = []
    const meshes: Mesh[] = []
    root.traverse((o) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const clone = (m: Material) => {
        const c = m.clone()
        c.userData.baseOpacity = c.opacity
        c.userData.baseTransparent = c.transparent
        materials.push(c)
        return c
      }
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(clone) : clone(mesh.material)
      // A fixed draw order per part, so coplanar layers (screen glass, speaker grilles) don't
      // flicker as three.js re-sorts parts by distance while things move.
      mesh.userData.drawOrder = meshes.length / 1000
      mesh.renderOrder = mesh.userData.drawOrder
      meshes.push(mesh)
    })
    // Parts cut out by texture alpha (speaker grilles etc.) stay out of the depth pre-pass: it can't
    // see their holes, and would fill them in, showing the backdrop through the grille while fading.
    const alphaCut = (m: Material) => m.userData.baseTransparent || m.alphaTest > 0
    const solidMeshes = meshes.filter((mesh) => ![mesh.material].flat().some(alphaCut))
    const depthMeshes = solidMeshes.map((mesh) => {
      const d = new Mesh(mesh.geometry, depthOnly)
      d.renderOrder = DEPTH_PASS_ORDER
      d.visible = false
      d.userData.depthPass = true
      d.raycast = () => {}
      mesh.add(d)
      return d
    })
    return { root, materials, meshes, depthMeshes }
  }, [scene])

  useLayoutEffect(() => {
    onReady(model)
    // Off-stage products are hidden until they slide in; prepare them now rather than mid-slide.
    warmUp(scene)
    invalidate()
  }, [model, onReady, scene, invalidate])

  return <primitive object={model.root} />
}
