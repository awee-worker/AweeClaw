import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { CatVariant, IdleAction, ArmPose, CatModel3DProps } from './catTypes'
import { VARIANT_COLORS, ROLE_VARIANT, ROLE_ACCESSORY } from './catTypes'
import { CatAccessories } from './CatAccessories'
import { CatBubbles } from './CatBubbles'

// ===== 常量 =====

/** 身体各部位材质粗糙度 */
const MATTE = 0.5
/** 关节球材质粗糙度 */
const JOINT_ROUGH = 0.45

// ===== 头部组件 =====

/** 人形猫头部 — 保留猫耳、猫眼、猫鼻、胡须 */
function HumanoidCatHead({
  catVariant,
  bodyColor,
  isMoving,
  isWorking,
  isCompleted,
}: {
  catVariant: CatVariant
  bodyColor: THREE.Color
  isMoving: boolean
  isWorking: boolean
  isCompleted: boolean
}) {
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
        leftEarRef.current.rotation.z = 0.15 + Math.sin(t * 3) * 0.03
      } else if (isMoving) {
        leftEarRef.current.rotation.z = 0.15 + Math.sin(t * 6) * 0.08
      } else {
        leftEarRef.current.rotation.z = 0.15 + Math.sin(t * 1.5) * 0.04
      }
    }
    if (rightEarRef.current) {
      if (isWorking) {
        rightEarRef.current.rotation.z = -0.15 - Math.sin(t * 3 + 0.5) * 0.03
      } else if (isMoving) {
        rightEarRef.current.rotation.z = -0.15 - Math.sin(t * 6 + 1) * 0.08
      } else {
        rightEarRef.current.rotation.z = -0.15 - Math.sin(t * 1.5 + 0.5) * 0.04
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
      if (isCompleted) {
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
    <group ref={headRef} position={[0, 0.72, 0]}>
      {/* 头 — 稍圆的猫脸，人形比例 */}
      <mesh position={[0, 0, 0.02]} scale={[1.05, 1.0, 0.95]}>
        <sphereGeometry args={[0.12, 12, 10]} />
        <meshStandardMaterial color={bodyColor} roughness={MATTE} />
      </mesh>

      {/* 左耳 */}
      <group ref={leftEarRef} position={[-0.07, 0.11, 0]}>
        <mesh rotation={[0, 0, 0.15]}>
          <coneGeometry args={[0.035, 0.08, 4]} />
          <meshStandardMaterial color={bodyColor} roughness={MATTE} />
        </mesh>
        <mesh position={[0, -0.01, 0.01]} rotation={[0, 0, 0.15]}>
          <coneGeometry args={[0.02, 0.05, 4]} />
          <meshStandardMaterial color={colors.ear} roughness={MATTE} />
        </mesh>
      </group>

      {/* 右耳 */}
      <group ref={rightEarRef} position={[0.07, 0.11, 0]}>
        <mesh rotation={[0, 0, -0.15]}>
          <coneGeometry args={[0.035, 0.08, 4]} />
          <meshStandardMaterial color={bodyColor} roughness={MATTE} />
        </mesh>
        <mesh position={[0, -0.01, 0.01]} rotation={[0, 0, -0.15]}>
          <coneGeometry args={[0.02, 0.05, 4]} />
          <meshStandardMaterial color={colors.ear} roughness={MATTE} />
        </mesh>
      </group>

      {/* 眼睛 */}
      {[[-0.04, 0.02, 0.11], [0.04, 0.02, 0.11]].map((pos, i) => (
        <group key={i} position={pos as [number, number, number]}>
          <mesh position={[0, 0, 0.005]}>
            <sphereGeometry args={[0.02, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#2A2A3E" roughness={0.3} />
          </mesh>
          <mesh ref={i === 0 ? leftEyeRef : rightEyeRef} position={[0, 0, 0.012]}>
            <sphereGeometry args={[0.013, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#5BA3C9" roughness={0.2} />
          </mesh>
          <mesh position={[0.003, 0.003, 0.018]}>
            <sphereGeometry args={[0.003, 4, 4]} />
            <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.3} roughness={0.2} />
          </mesh>
        </group>
      ))}

      {/* 鼻子 */}
      <mesh position={[0, -0.03, 0.12]}>
        <sphereGeometry args={[0.01, 6, 6]} />
        <meshStandardMaterial color={colors.nose} roughness={0.4} />
      </mesh>

      {/* 嘴巴 */}
      <mesh position={[0, -0.05, 0.11]} rotation={[0.2, 0, 0]}>
        <torusGeometry args={[0.012, 0.002, 6, 8, Math.PI]} />
        <meshStandardMaterial color="#5A3A3A" roughness={MATTE} />
      </mesh>

      {/* 胡须 */}
      {[[-0.02, -0.04, 0.11], [0.02, -0.04, 0.11]].map((base, i) => (
        <group key={i} position={base as [number, number, number]}>
          {[-0.15, 0, 0.15].map((angle, j) => (
            <mesh key={j} rotation={[angle * 0.5, 0, i === 0 ? -0.3 : 0.3]}>
              <cylinderGeometry args={[0.0008, 0.0008, 0.07, 4]} />
              <meshStandardMaterial color="#CCC" roughness={MATTE} transparent opacity={0.6} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  )
}

// ===== 身体组件 =====

/** 人形猫身体 — 直立躯干，像人一样的比例 */
function HumanoidCatBody({ bodyColor, accentColor }: { bodyColor: THREE.Color; accentColor: THREE.Color }) {
  return (
    <group>
      {/* 躯干 — 人形直立 */}
      <mesh position={[0, 0.3, 0]}>
        <capsuleGeometry args={[0.1, 0.35, 8, 12]} />
        <meshStandardMaterial color={bodyColor} roughness={0.6} />
      </mesh>

      {/* 肚子 — 浅色区域 */}
      <mesh position={[0, 0.28, 0.06]} scale={[0.7, 0.85, 0.5]}>
        <sphereGeometry args={[0.1, 10, 8]} />
        <meshStandardMaterial color={accentColor} roughness={0.6} />
      </mesh>
    </group>
  )
}

/** 脖子 — 连接头部和身体的过渡 */
function HumanoidCatNeck({ bodyColor }: { bodyColor: THREE.Color }) {
  return (
    <mesh position={[0, 0.6, 0]}>
      <capsuleGeometry args={[0.04, 0.06, 6, 8]} />
      <meshStandardMaterial color={bodyColor} roughness={JOINT_ROUGH} />
    </mesh>
  )
}

// ===== 手臂组件（含肩关节 + 肘关节） =====

/** 单只手臂 — 上臂 + 前臂 + 手，带关节球 */
function CatArm({
  bodyColor,
  side,
  pose,
  themeAccentColor,
}: {
  bodyColor: THREE.Color
  side: 'left' | 'right'
  pose: ArmPose
  themeAccentColor: string
}) {
  const upperArmRef = useRef<THREE.Group>(null)
  const forearmRef = useRef<THREE.Group>(null)

  const isLeft = side === 'left'
  const shoulderX = isLeft ? -0.14 : 0.14

  // 根据姿态计算关节位置
  // rotation.x 为负值 → 手臂向前（+Z），正值 → 手臂向后（-Z）
  const poseConfig = useMemo(() => {
    switch (pose) {
      case 'typing': {
        // 双手前伸到键盘位置：上臂大幅前倾，前臂再弯曲
        return {
          upperRot: [-1.2, 0, isLeft ? 0.15 : -0.15] as [number, number, number],
          forearmRot: [-0.5, 0, 0] as [number, number, number],
          handContent: <HandPaw bodyColor={bodyColor} position={[0, -0.1, 0]} />,
        }
      }
      case 'coffee':
        return {
          upperRot: [-0.8, 0, isLeft ? 0.2 : -0.2] as [number, number, number],
          forearmRot: [-0.5, 0, isLeft ? 0.1 : -0.1] as [number, number, number],
          handContent: isLeft
            ? <HandPaw bodyColor={bodyColor} position={[0, -0.1, 0]} />
            : <CoffeeCup />,
        }
      case 'smoke':
        return {
          upperRot: [-0.8, 0, isLeft ? 0.2 : -0.2] as [number, number, number],
          forearmRot: [-0.5, 0, isLeft ? 0.1 : -0.5] as [number, number, number],
          handContent: isLeft
            ? <HandPaw bodyColor={bodyColor} position={[0, -0.1, 0]} />
            : <Cigarette />,
        }
      case 'chat':
        return {
          upperRot: [-0.8, 0, isLeft ? 0.2 : -0.2] as [number, number, number],
          forearmRot: [-0.5, 0, isLeft ? 0.1 : -0.2] as [number, number, number],
          handContent: <HandPaw bodyColor={bodyColor} position={[0, -0.1, 0]} />,
        }
      case 'phone':
        return {
          upperRot: [-0.8, 0, isLeft ? 0.2 : -0.2] as [number, number, number],
          forearmRot: [-0.5, isLeft ? 0.1 : 0.2, isLeft ? 0.1 : -0.3] as [number, number, number],
          handContent: isLeft
            ? <HandPaw bodyColor={bodyColor} position={[0, -0.1, 0]} />
            : <Phone themeAccentColor={themeAccentColor} />,
        }
      case 'walking':
        return {
          upperRot: [-0.3, 0, isLeft ? 0.15 : -0.15] as [number, number, number],
          forearmRot: [-0.2, 0, 0] as [number, number, number],
          handContent: <HandPaw bodyColor={bodyColor} position={[0, -0.1, 0]} />,
        }
      default: // idle
        return {
          upperRot: [-0.3, 0, isLeft ? 0.15 : -0.15] as [number, number, number],
          forearmRot: [-0.2, 0, 0] as [number, number, number],
          handContent: <HandPaw bodyColor={bodyColor} position={[0, -0.1, 0]} />,
        }
    }
  }, [pose, bodyColor, themeAccentColor, isLeft])

  useFrame((state) => {
    const t = state.clock.elapsedTime

    // 上臂动画
    if (upperArmRef.current) {
      if (pose === 'typing') {
        upperArmRef.current.rotation.z = poseConfig.upperRot[2] + Math.sin(t * 8) * 0.05
      } else if (pose === 'walking') {
        upperArmRef.current.rotation.x = poseConfig.upperRot[0] + Math.sin(t * 4 + (isLeft ? 0 : Math.PI)) * 0.2
      } else if (pose === 'chat') {
        upperArmRef.current.rotation.z = poseConfig.upperRot[2] + Math.sin(t * 3) * 0.08
      }
    }

    // 前臂动画 — 打字时手指上下敲击键盘
    if (forearmRef.current) {
      if (pose === 'typing') {
        // 模拟交替敲击键盘：上下微动
        const tapOffset = Math.sin(t * 10 + (isLeft ? 0 : 0.8)) * 0.06
        forearmRef.current.rotation.x = poseConfig.forearmRot[0] + tapOffset
      } else if (pose === 'coffee') {
        forearmRef.current.position.y = Math.sin(t * 1.5) * 0.02
      }
    }
  })

  return (
    <group position={[shoulderX, 0.48, 0]}>
      {/* 肩关节球 */}
      <mesh>
        <sphereGeometry args={[0.032, 8, 8]} />
        <meshStandardMaterial color={bodyColor} roughness={JOINT_ROUGH} />
      </mesh>

      {/* 上臂 */}
      <group ref={upperArmRef} rotation={poseConfig.upperRot}>
        <mesh position={[0, -0.06, 0]}>
          <capsuleGeometry args={[0.025, 0.1, 6, 8]} />
          <meshStandardMaterial color={bodyColor} roughness={MATTE} />
        </mesh>

        {/* 肘关节球 */}
        <mesh position={[0, -0.11, 0]}>
          <sphereGeometry args={[0.024, 8, 8]} />
          <meshStandardMaterial color={bodyColor} roughness={JOINT_ROUGH} />
        </mesh>

        {/* 前臂 */}
        <group ref={forearmRef} position={[0, -0.11, 0]} rotation={poseConfig.forearmRot}>
          <mesh position={[0, -0.05, 0]}>
            <capsuleGeometry args={[0.022, 0.08, 6, 8]} />
            <meshStandardMaterial color={bodyColor} roughness={MATTE} />
          </mesh>
          {poseConfig.handContent}
        </group>
      </group>
    </group>
  )
}

// ===== 腿部组件（含髋关节 + 膝关节，支持坐姿） =====

/** 单条腿 — 大腿 + 小腿 + 脚掌，带关节球 */
function CatLeg({
  bodyColor,
  side,
  isMoving,
  isSitting,
}: {
  bodyColor: THREE.Color
  side: 'left' | 'right'
  isMoving: boolean
  isSitting: boolean
}) {
  const thighRef = useRef<THREE.Group>(null)
  const shinRef = useRef<THREE.Group>(null)

  const isLeft = side === 'left'
  const hipX = isLeft ? -0.05 : 0.05

  useFrame((state) => {
    const t = state.clock.elapsedTime

    if (isSitting) {
      // 坐姿：大腿向前（绕X轴旋转-90°），小腿向下（绕X轴旋转+90°）
      if (thighRef.current) {
        thighRef.current.rotation.x = -Math.PI / 2
        thighRef.current.rotation.z = 0
      }
      if (shinRef.current) {
        shinRef.current.rotation.x = Math.PI / 2 + Math.sin(t * 1.2) * 0.04
        shinRef.current.rotation.z = 0
      }
    } else if (isMoving) {
      // 行走：大腿前后摆动
      if (thighRef.current) {
        thighRef.current.rotation.x = Math.sin(t * 4 + (isLeft ? 0 : Math.PI)) * 0.3
        thighRef.current.rotation.z = 0
      }
      if (shinRef.current) {
        shinRef.current.rotation.x = 0
        shinRef.current.rotation.z = 0
      }
    } else {
      // 站立：归零
      if (thighRef.current) {
        thighRef.current.rotation.x = 0
        thighRef.current.rotation.z = 0
      }
      if (shinRef.current) {
        shinRef.current.rotation.x = 0
        shinRef.current.rotation.z = 0
      }
    }
  })

  return (
    <group position={[hipX, 0.08, 0]}>
      {/* 髋关节球 */}
      <mesh>
        <sphereGeometry args={[0.035, 8, 8]} />
        <meshStandardMaterial color={bodyColor} roughness={JOINT_ROUGH} />
      </mesh>

      {/* 大腿 */}
      <group ref={thighRef}>
        <mesh position={[0, -0.1, 0]}>
          <capsuleGeometry args={[0.03, 0.18, 6, 8]} />
          <meshStandardMaterial color={bodyColor} roughness={MATTE} />
        </mesh>

        {/* 膝关节球 */}
        <mesh position={[0, -0.19, 0]}>
          <sphereGeometry args={[0.028, 8, 8]} />
          <meshStandardMaterial color={bodyColor} roughness={JOINT_ROUGH} />
        </mesh>

        {/* 小腿 */}
        <group ref={shinRef} position={[0, -0.19, 0]}>
          <mesh position={[0, -0.07, 0]}>
            <capsuleGeometry args={[0.025, 0.12, 6, 8]} />
            <meshStandardMaterial color={bodyColor} roughness={MATTE} />
          </mesh>

          {/* 脚掌 */}
          <mesh position={[0, -0.14, 0.015]}>
            <sphereGeometry args={[0.03, 6, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={MATTE} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

// ===== 尾巴组件 =====

/** 猫尾巴 — 从臀部后方翘起 */
function HumanoidCatTail({ bodyColor, isMoving, isWorking }: { bodyColor: THREE.Color; isMoving: boolean; isWorking: boolean }) {
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
    <group ref={tailRef} position={[0, 0.12, -0.12]}>
      <group rotation={[-0.8, 0, 0]}>
        <mesh position={[0, 0.08, 0]}>
          <capsuleGeometry args={[0.015, 0.14, 6, 8]} />
          <meshStandardMaterial color={bodyColor} roughness={MATTE} />
        </mesh>
        <group position={[0, 0.16, 0]} rotation={[-0.5, 0, 0]}>
          <mesh position={[0, 0.06, 0]}>
            <capsuleGeometry args={[0.01, 0.1, 6, 8]} />
            <meshStandardMaterial color={bodyColor} roughness={MATTE} />
          </mesh>
          <mesh position={[0, 0.12, 0]}>
            <sphereGeometry args={[0.008, 6, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={MATTE} />
          </mesh>
        </group>
      </group>
    </group>
  )
}

// ===== 道具组件 =====

function HandPaw({ bodyColor, position }: { bodyColor: THREE.Color; position: [number, number, number] }) {
  return (
    <mesh position={position}>
      <sphereGeometry args={[0.022, 8, 8]} />
      <meshStandardMaterial color={bodyColor} roughness={MATTE} />
    </mesh>
  )
}

function CoffeeCup() {
  return (
    <>
      <mesh position={[0, -0.1, 0]}>
        <cylinderGeometry args={[0.02, 0.018, 0.05, 8]} />
        <meshStandardMaterial color="#FAFAFA" roughness={0.4} />
      </mesh>
      <mesh position={[0, -0.07, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.005, 8]} />
        <meshStandardMaterial color="#8B6F47" roughness={0.6} />
      </mesh>
    </>
  )
}

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

// ===== 主组件 =====

/** 3D人形猫模型 — 站立像人，保留猫头和尾巴，支持坐姿 */
export function CatModel3D({
  role = 'custom',
  variant,
  status = 'idle',
  idleAction,
  scale = 1,
  onClick,
  themeAccentColor = '#39bef8',
  statusBubble,
  speechBubble,
  isSitting = false,
}: CatModel3DProps) {
  const groupRef = useRef<THREE.Group>(null)

  const catVariant: CatVariant = variant || ROLE_VARIANT[role] || 'orange'
  const accessory = ROLE_ACCESSORY[role] || 'bowtie'

  const colors = VARIANT_COLORS[catVariant]
  const bodyColor = useMemo(() => new THREE.Color(colors.body), [colors.body])
  const accentColor = useMemo(() => new THREE.Color(colors.accent), [colors.accent])

  const isWorking = status === 'working' || status === 'executing'
  const isCompleted = status === 'completed'
  const isMoving = status === 'moving'
  const action: IdleAction = (idleAction as IdleAction) || 'idle'

  const armPose: ArmPose = useMemo(() => {
    if (isWorking) return 'typing'
    if (isMoving) return 'walking'
    if (action === 'coffee') return 'coffee'
    if (action === 'smoke') return 'smoke'
    if (action === 'chat') return 'chat'
    if (action === 'phone') return 'phone'
    return 'idle'
  }, [isWorking, isMoving, action])

  // 坐姿偏移：将身体下降到椅子坐面高度
  // 髋关节在 y=0.08，大腿长 0.19，小腿长 0.12，脚掌半径 0.03
  // 站立时脚底在 y≈-0.33，坐姿时大腿前伸、小腿下垂
  const sittingOffset = isSitting ? -0.33 : 0

  // 呼吸动画 + 完成庆祝
  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (groupRef.current) {
      const breathe = 1 + Math.sin(t * 2) * 0.005
      groupRef.current.scale.y = breathe

      if (isWorking && !isSitting) {
        groupRef.current.rotation.x = 0.03
      } else {
        groupRef.current.rotation.x = 0
      }
    }
  })

  return (
    <group
      ref={groupRef}
      scale={[scale, scale, scale]}
      position={[0, sittingOffset, 0]}
      onClick={(e) => {
        e.stopPropagation()
        onClick?.()
      }}
    >
      {/* 身体（躯干） */}
      <HumanoidCatBody bodyColor={bodyColor} accentColor={accentColor} />

      {/* 脖子 — 连接头部和身体 */}
      <HumanoidCatNeck bodyColor={bodyColor} />

      {/* 头部 */}
      <HumanoidCatHead
        catVariant={catVariant}
        bodyColor={bodyColor}
        isMoving={isMoving}
        isWorking={isWorking}
        isCompleted={isCompleted}
      />

      {/* 左臂（含肩关节+肘关节） */}
      <CatArm bodyColor={bodyColor} side="left" pose={armPose} themeAccentColor={themeAccentColor} />

      {/* 右臂（含肩关节+肘关节） */}
      <CatArm bodyColor={bodyColor} side="right" pose={armPose} themeAccentColor={themeAccentColor} />

      {/* 左腿（含髋关节+膝关节） */}
      <CatLeg bodyColor={bodyColor} side="left" isMoving={isMoving} isSitting={isSitting} />

      {/* 右腿（含髋关节+膝关节） */}
      <CatLeg bodyColor={bodyColor} side="right" isMoving={isMoving} isSitting={isSitting} />

      {/* 尾巴 */}
      <HumanoidCatTail bodyColor={bodyColor} isMoving={isMoving} isWorking={isWorking} />

      {/* 配饰 */}
      <CatAccessories accessory={accessory} bodyColor={bodyColor} />

      {/* 气泡 */}
      <CatBubbles statusBubble={statusBubble} speechBubble={speechBubble} />
    </group>
  )
}

export default CatModel3D