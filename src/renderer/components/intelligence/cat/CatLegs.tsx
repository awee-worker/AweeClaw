import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface CatLegsProps {
  bodyColor: THREE.Color
  isMoving: boolean
}

/** 猫咪腿部 — 含行走摆动动画 */
export function CatLegs({ bodyColor, isMoving }: CatLegsProps) {
  const leftLegRef = useRef<THREE.Group>(null)
  const rightLegRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (isMoving) {
      if (leftLegRef.current) {
        leftLegRef.current.rotation.x = Math.sin(t * 6) * 0.25
      }
      if (rightLegRef.current) {
        rightLegRef.current.rotation.x = Math.sin(t * 6 + Math.PI) * 0.25
      }
    } else {
      if (leftLegRef.current) leftLegRef.current.rotation.x = 0
      if (rightLegRef.current) rightLegRef.current.rotation.x = 0
    }
  })

  return (
    <group position={[0, -0.12, 0]}>
      {/* 左腿 */}
      <group ref={leftLegRef} position={[-0.04, -0.06, 0]}>
        <mesh position={[0, -0.06, 0]}>
          <cylinderGeometry args={[0.018, 0.015, 0.14, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        {/* 脚掌 */}
        <mesh position={[0, -0.14, 0.01]}>
          <sphereGeometry args={[0.02, 6, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
      </group>

      {/* 右腿 */}
      <group ref={rightLegRef} position={[0.04, -0.06, 0]}>
        <mesh position={[0, -0.06, 0]}>
          <cylinderGeometry args={[0.018, 0.015, 0.14, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        {/* 脚掌 */}
        <mesh position={[0, -0.14, 0.01]}>
          <sphereGeometry args={[0.02, 6, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}
