import { Suspense, useRef } from 'react'
import { ModelErrorBoundary } from './ModelErrorBoundary'
import { useFrame } from '@react-three/fiber'
import type { Group } from 'three'
import { Product } from './Product'
import { motion, useStore } from '../store'

/** All products in a row along x; the whole row slides so the current slot sits at the stage centre. */
export function Carousel() {
  const manifest = useStore((s) => s.manifest)
  const row = useRef<Group>(null)
  const loadable = useStore((s) => s.loadable)
  const { spacing, order, slots } = manifest.carousel

  useFrame(() => {
    if (row.current) row.current.position.x = -motion.progress * spacing
  })

  return (
    <group ref={row}>
      {order.map((slotName, i) => (
        <group key={slotName} position={[i * spacing, 0, 0]}>
          {/* Models stream in (loadQueue): a slot mounts once it's allowed to load. */}
          {loadable.includes(i) &&
            slots[slotName].map((pkey) => (
              <ModelErrorBoundary key={pkey} name={pkey}>
                <Suspense fallback={null}>
                  <Product pkey={pkey} def={manifest.products[pkey]} slot={i} />
                </Suspense>
              </ModelErrorBoundary>
            ))}
        </group>
      ))}
    </group>
  )
}
