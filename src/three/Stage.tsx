import { useMemo } from 'react'
import { Environment, Lightformer } from '@react-three/drei'
import { BackSide, BufferGeometry, Float32BufferAttribute } from 'three'

/**
 * Seamless studio sweep matching the Blender stage: a floor that curves up into a back wall.
 * Profile runs front to back along -z.
 */
function useSweepGeometry(width = 24, front = 4, flat = 1.2, radius = 0.8, height = 4, segments = 16) {
  return useMemo(() => {
    const profile: [number, number][] = [
      [front, 0],
      [-flat, 0],
    ]
    for (let i = 1; i <= segments; i++) {
      const a = (i / segments) * (Math.PI / 2)
      profile.push([-flat - radius * Math.sin(a), radius - radius * Math.cos(a)])
    }
    profile.push([-flat - radius, height])

    const pos: number[] = []
    const idx: number[] = []
    for (const [z, y] of profile) pos.push(-width / 2, y, z, width / 2, y, z)
    for (let i = 0; i < profile.length - 1; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute(pos, 3))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }, [width, front, flat, radius, height, segments])
}

export function Stage() {
  const sweep = useSweepGeometry()

  return (
    <>
      {/* Drawn first and without depth, so a product rotated in the details view never sinks into the floor. */}
      <mesh geometry={sweep} renderOrder={-1}>
        <meshStandardMaterial color="#ececee" roughness={0.9} metalness={0} dithering depthWrite={false} />
      </mesh>


      {/* Key spotlight over the stage centre (from the Blender Key_Spot), plus soft fill. */}
      <spotLight
        position={[-0.35, 1.9, 0.55]}
        angle={0.66}
        penumbra={0.9}
        intensity={8}
        decay={1.2}
        color="#fffaf5"
      />
      <hemisphereLight args={['#ffffff', '#d9d9dc', 0.45]} />

      {/* Procedural studio reflections: no HDRI download needed. */}
      <Environment resolution={256} frames={1}>
        {/* Neutral studio fill: metals reflect this instead of a black void at grazing angles. */}
        <mesh scale={30}>
          <sphereGeometry args={[1, 32, 16]} />
          <meshBasicMaterial color="#8a8a8f" side={BackSide} />
        </mesh>
        {/* Floor bounce, so undersides read when the product is tipped up. */}
        <Lightformer form="rect" intensity={0.9} position={[0, -3, 0]} rotation-x={-Math.PI / 2} scale={[8, 8, 1]} />
        <Lightformer form="rect" intensity={2.4} position={[0, 3, 1]} rotation-x={Math.PI / 2} scale={[6, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[-4, 1.5, 1]} rotation-y={Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={1.2} position={[4, 1.5, 1]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={0.8} position={[0, 1.5, -4]} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={0.6} position={[0, 1, 5]} rotation-y={Math.PI} scale={[8, 2, 1]} />
      </Environment>
    </>
  )
}
