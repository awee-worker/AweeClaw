import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

interface CatTailProps {
  bodyColor: THREE.Color
  isMoving: boolean
  isWorking: boolean
}

/** 猫咪尾巴 — 从身体后部向上翘起，两段连续不断开 */
export function CatTail({ bodyColor, isMoving, isWorking }: CatTailProps) {
  const tailRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (tailRef.current) {
      if (isMoving) {
        tailRef.current.rotation.z = Math.sin(t * 4) * 0.3
      } else if (isWorking) {
        tailRef.current.rotation.z = Math.sin(t * 1.5) * 0.1
      } else {
        tailRef.current.rotation.z = Math.sin(t * 0.8) * 0.15
      }
    }
  })

  return (
    // 尾巴起点：身体后部
    <group ref={tailRef} position={[0, 0.02, -0.18]}>
      {/* 第一段：从身体向后上方翘起 */}
      <group rotation={[-0.8, 0, 0]}>
        <mesh position={[0, 0.07, 0]}>
          <cylinderGeometry args={[0.012, 0.009, 0.14, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        {/* 第二段：从第一段末端继续翘起，嵌套保证连续 */}
        <group position={[0, 0.14, 0]} rotation={[-0.5, 0, 0]}>
          <mesh position={[0, 0.05, 0]}>
            <cylinderGeometry args={[0.009, 0.004, 0.1, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
          {/* 尾巴尖端 */}
          <mesh position={[0, 0.1, 0]}>
            <sphereGeometry args={[0.005, 6, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
      </group>
    </group>
  )
}
