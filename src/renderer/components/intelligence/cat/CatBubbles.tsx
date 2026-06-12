import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text } from '@react-three/drei'
import * as THREE from 'three'

interface CatBubblesProps {
  statusBubble?: string
  speechBubble?: string
}

/** 猫咪头顶气泡 — 状态气泡和对话气泡 */
export function CatBubbles({ statusBubble, speechBubble }: CatBubblesProps) {
  const statusRef = useRef<THREE.Group>(null)
  const speechRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (statusRef.current) {
      statusRef.current.position.y = 0.55 + Math.sin(t * 2) * 0.02
    }
    if (speechRef.current) {
      speechRef.current.position.y = 0.7 + Math.sin(t * 2.5) * 0.02
    }
  })

  if (!statusBubble && !speechBubble) return null

  return (
    <group>
      {/* 状态气泡 */}
      {statusBubble && (
        <Billboard ref={statusRef} position={[0, 0.55, 0]} follow lockX={false} lockY={false} lockZ={false}>
          <mesh position={[0, 0, -0.005]}>
            <planeGeometry args={[statusBubble.length * 0.06 + 0.1, 0.12]} />
            <meshStandardMaterial color="#1E293B" transparent opacity={0.85} roughness={0.5} />
          </mesh>
          <Text
            fontSize={0.04}
            color="#94A3B8"
            anchorX="center"
            anchorY="middle"
            font={undefined}
          >
            {statusBubble}
          </Text>
        </Billboard>
      )}

      {/* 对话气泡 */}
      {speechBubble && (
        <Billboard ref={speechRef} position={[0, 0.7, 0]} follow lockX={false} lockY={false} lockZ={false}>
          <mesh position={[0, 0, -0.005]}>
            <planeGeometry args={[speechBubble.length * 0.05 + 0.12, 0.14]} />
            <meshStandardMaterial color="#3B82F6" transparent opacity={0.9} roughness={0.5} />
          </mesh>
          {/* 气泡小尾巴 */}
          <mesh position={[0, -0.08, -0.005]}>
            <circleGeometry args={[0.02, 6]} />
            <meshStandardMaterial color="#3B82F6" transparent opacity={0.9} roughness={0.5} />
          </mesh>
          <Text
            fontSize={0.04}
            color="white"
            anchorX="center"
            anchorY="middle"
            font={undefined}
          >
            {speechBubble}
          </Text>
        </Billboard>
      )}
    </group>
  )
}
