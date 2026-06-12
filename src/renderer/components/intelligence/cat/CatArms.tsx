import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { ArmPose } from './catTypes'

interface CatArmsProps {
  bodyColor: THREE.Color
  pose: ArmPose
  themeAccentColor?: string
}

/** 咖啡杯道具 */
function CoffeeCup() {
  return (
    <>
      <mesh position={[0, -0.18, 0]}>
        <cylinderGeometry args={[0.02, 0.018, 0.05, 8]} />
        <meshStandardMaterial color="#FAFAFA" roughness={0.4} />
      </mesh>
      <mesh position={[0, -0.15, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.005, 8]} />
        <meshStandardMaterial color="#8B6F47" roughness={0.6} />
      </mesh>
    </>
  )
}

/** 香烟道具 */
function Cigarette() {
  return (
    <>
      <mesh position={[0, 0.06, 0]}>
        <cylinderGeometry args={[0.004, 0.003, 0.06, 6]} />
        <meshStandardMaterial color="#DDD" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.09, 0]}>
        <sphereGeometry args={[0.008, 6, 6]} />
        <meshStandardMaterial color="#AAA" transparent opacity={0.4} />
      </mesh>
    </>
  )
}

/** 手机道具 */
function Phone({ themeAccentColor = '#39bef8' }: { themeAccentColor?: string }) {
  return (
    <>
      <mesh>
        <boxGeometry args={[0.04, 0.06, 0.005]} />
        <meshStandardMaterial color="#1A1A2E" roughness={0.3} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0, 0.003]}>
        <planeGeometry args={[0.035, 0.05]} />
        <meshStandardMaterial color={themeAccentColor} emissive={themeAccentColor} emissiveIntensity={0.3} roughness={0.2} />
      </mesh>
    </>
  )
}

/** 爪子 */
function Paw({ bodyColor, position, rotation }: {
  bodyColor: THREE.Color
  position: [number, number, number]
  rotation?: [number, number, number]
}) {
  return (
    <mesh position={position} rotation={rotation || [0, 0, 0]}>
      <sphereGeometry args={[0.022, 8, 8]} />
      <meshStandardMaterial color={bodyColor} roughness={0.5} />
    </mesh>
  )
}

/** 统一猫咪手臂组件 — 替代 TypingArms/WalkingArms/IdleArms 三套重复代码 */
export function CatArms({ bodyColor, pose, themeAccentColor = '#39bef8' }: CatArmsProps) {
  const leftArmRef = useRef<THREE.Group>(null)
  const rightArmRef = useRef<THREE.Group>(null)

  // 各姿态的左右手臂配置
  // 手臂从肩膀出发，rotation.x 控制前后倾斜，rotation.z 控制左右张开
  const poseConfig = useMemo((): {
    leftPos: [number, number, number]
    leftRot: [number, number, number]
    rightPos: [number, number, number]
    rightRot: [number, number, number]
    leftContent: React.ReactNode
    rightContent: React.ReactNode
  } => {
    switch (pose) {
      case 'typing':
        return {
          leftPos: [-0.08, 0.02, 0.06],
          leftRot: [1.2, 0, 0.15],
          rightPos: [0.08, 0.02, 0.06],
          rightRot: [1.2, 0, -0.15],
          leftContent: <Paw bodyColor={bodyColor} position={[0, -0.16, 0.02]} rotation={[0.5, 0, 0]} />,
          rightContent: <Paw bodyColor={bodyColor} position={[0, -0.16, 0.02]} rotation={[0.5, 0, 0]} />,
        }
      case 'coffee':
        return {
          leftPos: [-0.08, 0.02, 0.06],
          leftRot: [0.8, 0, 0.2],
          rightPos: [0.08, 0.04, 0.1],
          rightRot: [1.4, 0, -0.3],
          leftContent: <Paw bodyColor={bodyColor} position={[0, -0.16, 0.02]} rotation={[0.3, 0, 0]} />,
          rightContent: <CoffeeCup />,
        }
      case 'smoke':
        return {
          leftPos: [-0.08, 0.02, 0.06],
          leftRot: [0.8, 0, 0.2],
          rightPos: [0.08, 0.06, 0.08],
          rightRot: [1.0, 0, -0.5],
          leftContent: <Paw bodyColor={bodyColor} position={[0, -0.16, 0.02]} rotation={[0.3, 0, 0]} />,
          rightContent: <Cigarette />,
        }
      case 'chat':
        return {
          leftPos: [-0.08, 0.02, 0.06],
          leftRot: [0.8, 0, 0.2],
          rightPos: [0.08, 0.06, 0.1],
          rightRot: [1.2, 0, -0.2],
          leftContent: <Paw bodyColor={bodyColor} position={[0, -0.16, 0.02]} rotation={[0.3, 0, 0]} />,
          rightContent: <Paw bodyColor={bodyColor} position={[0, -0.16, 0.02]} rotation={[0.3, 0, 0]} />,
        }
      case 'phone':
        return {
          leftPos: [-0.08, 0.02, 0.06],
          leftRot: [0.8, 0, 0.2],
          rightPos: [0.06, 0.08, 0.12],
          rightRot: [1.4, 0.2, -0.3],
          leftContent: <Paw bodyColor={bodyColor} position={[0, -0.16, 0.02]} rotation={[0.3, 0, 0]} />,
          rightContent: <Phone themeAccentColor={themeAccentColor} />,
        }
      default: // idle / walking
        return {
          leftPos: [-0.08, 0.02, 0.06],
          leftRot: [0.9, 0, 0.2],
          rightPos: [0.08, 0.02, 0.06],
          rightRot: [0.9, 0, -0.2],
          leftContent: <Paw bodyColor={bodyColor} position={[0, -0.16, 0.02]} rotation={[0.4, 0, 0]} />,
          rightContent: <Paw bodyColor={bodyColor} position={[0, -0.16, 0.02]} rotation={[0.4, 0, 0]} />,
        }
    }
  }, [pose, bodyColor, themeAccentColor])

  useFrame((state) => {
    const t = state.clock.elapsedTime

    if (leftArmRef.current) {
      if (pose === 'typing') {
        leftArmRef.current.rotation.z = Math.sin(t * 8) * 0.15
      } else if (pose === 'walking') {
        leftArmRef.current.rotation.x = poseConfig.leftRot[0] + Math.sin(t * 1.5) * 0.08
      }
    }

    if (rightArmRef.current) {
      if (pose === 'typing') {
        rightArmRef.current.rotation.z = Math.sin(t * 8 + 1) * 0.15
      } else if (pose === 'coffee') {
        rightArmRef.current.position.y = poseConfig.rightPos[1] + Math.sin(t * 1.5) * 0.03
      } else if (pose === 'chat') {
        rightArmRef.current.rotation.z = poseConfig.rightRot[2] + Math.sin(t * 3) * 0.15
      } else if (pose === 'walking') {
        rightArmRef.current.rotation.x = poseConfig.rightRot[0] + Math.sin(t * 1.5 + 1) * 0.08
      }
    }
  })

  return (
    <group position={[0, -0.02, 0.08]}>
      <group ref={leftArmRef} position={poseConfig.leftPos} rotation={poseConfig.leftRot}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.015, 0.012, 0.16, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        {poseConfig.leftContent}
      </group>
      <group ref={rightArmRef} position={poseConfig.rightPos} rotation={poseConfig.rightRot}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.015, 0.012, 0.16, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        {poseConfig.rightContent}
      </group>
    </group>
  )
}
