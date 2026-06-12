import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { CatVariant, IdleAction } from './catTypes'
import { VARIANT_COLORS } from './catTypes'

interface CatHeadProps {
  catVariant: CatVariant
  bodyColor: THREE.Color
  action: IdleAction
  isMoving: boolean
  isWorking: boolean
  isCompleted: boolean
}

/** 猫咪头部 — 扁宽猫脸，含耳朵/眼睛/鼻子/嘴/胡须 */
export function CatHead({ catVariant, bodyColor, action, isMoving, isWorking, isCompleted }: CatHeadProps) {
  const headRef = useRef<THREE.Group>(null)
  const leftEarRef = useRef<THREE.Group>(null)
  const rightEarRef = useRef<THREE.Group>(null)
  const leftEyeRef = useRef<THREE.Mesh>(null)
  const rightEyeRef = useRef<THREE.Mesh>(null)
  const blinkRef = useRef({ nextBlink: 2 + Math.random() * 4, isBlinking: false, blinkTimer: 0 })

  const colors = VARIANT_COLORS[catVariant]

  useFrame((state) => {
    const t = state.clock.elapsedTime

    // 耳朵动画
    if (leftEarRef.current) {
      if (isWorking) {
        leftEarRef.current.rotation.z = 0.2 + Math.sin(t * 3) * 0.03
      } else if (isMoving) {
        leftEarRef.current.rotation.z = 0.2 + Math.sin(t * 6) * 0.08
      } else {
        leftEarRef.current.rotation.z = 0.2 + Math.sin(t * 1.5) * 0.04 + Math.sin(t * 0.7) * 0.02
      }
    }
    if (rightEarRef.current) {
      if (isWorking) {
        rightEarRef.current.rotation.z = -0.2 - Math.sin(t * 3 + 0.5) * 0.03
      } else if (isMoving) {
        rightEarRef.current.rotation.z = -0.2 - Math.sin(t * 6 + 1) * 0.08
      } else {
        rightEarRef.current.rotation.z = -0.2 - Math.sin(t * 1.5 + 0.5) * 0.04 - Math.sin(t * 0.7 + 1) * 0.02
      }
    }

    // 眨眼
    const blink = blinkRef.current
    if (!blink.isBlinking) {
      blink.nextBlink -= state.clock.getDelta()
      if (t >= blink.nextBlink) {
        blink.isBlinking = true
        blink.blinkTimer = 0.12
        blink.nextBlink = t + 2 + Math.random() * 5
      }
    } else {
      blink.blinkTimer -= state.clock.getDelta()
      if (blink.blinkTimer <= 0) blink.isBlinking = false
    }
    const eyeScaleY = blink.isBlinking ? 0.1 : 1
    if (leftEyeRef.current) leftEyeRef.current.scale.y = eyeScaleY
    if (rightEyeRef.current) rightEyeRef.current.scale.y = eyeScaleY

    // 头部动画
    if (headRef.current) {
      if (action === 'coffee' && !isMoving && !isWorking) {
        const isSipping = Math.sin(t * 1.2) > 0.5
        headRef.current.rotation.x = isSipping ? 0.25 : 0
      } else if (action === 'smoke' && !isMoving && !isWorking) {
        const isPuffing = Math.sin(t * 0.8) > 0.6
        headRef.current.rotation.x = isPuffing ? -0.15 : 0
        headRef.current.rotation.z = Math.sin(t * 0.5) * 0.03
      } else if (action === 'chat' && !isMoving && !isWorking) {
        headRef.current.rotation.z = Math.sin(t * 2.5) * 0.06
        headRef.current.rotation.x = Math.sin(t * 1.8) * 0.03
      } else if (isCompleted) {
        headRef.current.rotation.x = Math.sin(t * 2) * 0.05
        headRef.current.rotation.z = 0
      } else if (isWorking) {
        headRef.current.rotation.x = Math.sin(t * 0.6) * 0.04
        headRef.current.rotation.z = 0
      } else {
        headRef.current.rotation.x = 0
        headRef.current.rotation.z = 0
      }
    }
  })

  return (
    <group ref={headRef}>
      {/* 头 — 扁宽猫脸 */}
      <mesh position={[0, 0.18, 0.02]} scale={[1.1, 0.85, 0.95]}>
        <sphereGeometry args={[0.12, 12, 10]} />
        <meshStandardMaterial color={bodyColor} roughness={0.5} />
      </mesh>

      {/* 左耳 */}
      <group ref={leftEarRef} position={[-0.07, 0.28, 0]}>
        <mesh rotation={[0, 0, 0.2]}>
          <coneGeometry args={[0.04, 0.08, 4]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.01, 0.01]} rotation={[0, 0, 0.2]}>
          <coneGeometry args={[0.025, 0.05, 4]} />
          <meshStandardMaterial color={colors.ear} roughness={0.5} />
        </mesh>
      </group>

      {/* 右耳 */}
      <group ref={rightEarRef} position={[0.07, 0.28, 0]}>
        <mesh rotation={[0, 0, -0.2]}>
          <coneGeometry args={[0.04, 0.08, 4]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.01, 0.01]} rotation={[0, 0, -0.2]}>
          <coneGeometry args={[0.025, 0.05, 4]} />
          <meshStandardMaterial color={colors.ear} roughness={0.5} />
        </mesh>
      </group>

      {/* 眼睛 — 简化为3层：眼白+虹膜瞳孔+高光 */}
      {[[-0.04, 0.2, 0.11], [0.04, 0.2, 0.11]].map((pos, i) => (
        <group key={i} position={pos as [number, number, number]}>
          {/* 眼白 */}
          <mesh position={[0, 0, 0.005]}>
            <sphereGeometry args={[0.022, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#2A2A3E" roughness={0.3} />
          </mesh>
          {/* 虹膜+瞳孔 */}
          <mesh ref={i === 0 ? leftEyeRef : rightEyeRef} position={[0, 0, 0.012]}>
            <sphereGeometry args={[0.014, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#5BA3C9" roughness={0.2} />
          </mesh>
          {/* 高光 */}
          <mesh position={[0.003, 0.003, 0.018]}>
            <sphereGeometry args={[0.003, 4, 4]} />
            <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.3} roughness={0.2} />
          </mesh>
        </group>
      ))}

      {/* 鼻子 */}
      <mesh position={[0, 0.15, 0.13]}>
        <sphereGeometry args={[0.012, 6, 6]} />
        <meshStandardMaterial color={colors.nose} roughness={0.4} />
      </mesh>

      {/* 嘴巴 */}
      <mesh position={[0, 0.13, 0.12]} rotation={[0.2, 0, 0]}>
        <torusGeometry args={[0.015, 0.003, 6, 8, Math.PI]} />
        <meshStandardMaterial color="#5A3A3A" roughness={0.5} />
      </mesh>

      {/* 胡须 */}
      {[[-0.02, 0.14, 0.12], [0.02, 0.14, 0.12]].map((base, i) => (
        <group key={i} position={base as [number, number, number]}>
          {[-0.15, 0, 0.15].map((angle, j) => (
            <mesh key={j} rotation={[angle * 0.5, 0, i === 0 ? -0.3 : 0.3]}>
              <cylinderGeometry args={[0.001, 0.001, 0.08, 4]} />
              <meshStandardMaterial color="#CCC" roughness={0.5} transparent opacity={0.6} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}
