import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CatModel3D } from '../cat/CatModel3D'
import { SCENE_COLORS } from './officeConfig'
import type { WorkspaceAgent } from '../../../state/slices/agentWorkspaceSlice'

interface OfficeDeskProps {
  deskPosition: [number, number, number]
  rotation: number
  agent: WorkspaceAgent | null
  onAgentClick: (agent: WorkspaceAgent) => void
}

/**
 * 单个办公桌
 *
 * 坐标系约定（rotation=0 时）：
 *   - 显示器在 z 负方向（桌子后方），屏幕面朝 z 正方向
 *   - 椅子在 z 正方向（桌子前方），椅背在 z 正方向（人背后）
 *   - 猫咪坐在椅子上，面朝 z 负方向（朝向显示器）
 *   - 整个 group 通过 rotation 统一旋转
 */
export function OfficeDesk({ deskPosition, rotation, agent, onAgentClick }: OfficeDeskProps) {
  const screenRef = useRef<THREE.Mesh>(null)
  const isWorking = agent?.status === 'working'
  const isCompleted = agent?.status === 'completed'
  const isAtDesk = agent && agent.status !== 'moving'

  useFrame((state) => {
    if (screenRef.current && isWorking) {
      const t = state.clock.elapsedTime
      const intensity = 0.3 + Math.sin(t * 2) * 0.1
      const mat = screenRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = intensity
    }
  })

  return (
    <group position={deskPosition} rotation={[0, rotation, 0]}>
      {/* 桌面 */}
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.05, 0.7]} />
        <meshStandardMaterial color={SCENE_COLORS.deskTop} roughness={0.5} />
      </mesh>

      {/* 桌腿 */}
      {[[-0.5, 0.225, -0.28], [0.5, 0.225, -0.28], [-0.5, 0.225, 0.28], [0.5, 0.225, 0.28]].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} castShadow>
          <boxGeometry args={[0.04, 0.45, 0.04]} />
          <meshStandardMaterial color={SCENE_COLORS.desk} roughness={0.6} />
        </mesh>
      ))}

      {/* 显示器 — 在桌子后方（z负方向） */}
      <group position={[0, 0.75, -0.2]}>
        {/* 屏幕外壳 */}
        <mesh castShadow>
          <boxGeometry args={[0.5, 0.35, 0.02]} />
          <meshStandardMaterial color={SCENE_COLORS.monitorFrame} roughness={0.3} metalness={0.5} />
        </mesh>
        {/* 屏幕内容 — 面朝z正方向（朝向猫咪） */}
        <mesh ref={screenRef} position={[0, 0, 0.011]}>
          <planeGeometry args={[0.46, 0.31]} />
          <meshStandardMaterial
            color={isWorking ? '#1a3a5c' : isCompleted ? '#1a3c2a' : SCENE_COLORS.monitorScreen}
            emissive={isWorking ? '#39bef8' : isCompleted ? '#4ade80' : '#1a1a3e'}
            emissiveIntensity={isWorking ? 0.3 : isCompleted ? 0.2 : 0.05}
            roughness={0.2}
          />
        </mesh>
        {/* 支架 — 在屏幕后方（z负方向），不遮挡屏幕 */}
        <mesh position={[0, -0.14, -0.04]}>
          <boxGeometry args={[0.03, 0.1, 0.03]} />
          <meshStandardMaterial color={SCENE_COLORS.monitorFrame} roughness={0.3} metalness={0.5} />
        </mesh>
        {/* 底座 — 在屏幕后方 */}
        <mesh position={[0, -0.19, -0.06]}>
          <boxGeometry args={[0.2, 0.02, 0.12]} />
          <meshStandardMaterial color={SCENE_COLORS.monitorFrame} roughness={0.3} metalness={0.5} />
        </mesh>
      </group>

      {/* 键盘 */}
      <mesh position={[0, 0.48, 0.1]}>
        <boxGeometry args={[0.3, 0.01, 0.1]} />
        <meshStandardMaterial color={SCENE_COLORS.keyboard} roughness={0.5} />
      </mesh>

      {/* 椅子 — 在桌子前方（z正方向），面向桌子 */}
      <group position={[0, 0, 0.6]}>
        {/* 椅座 */}
        <mesh position={[0, 0.35, 0]}>
          <boxGeometry args={[0.45, 0.05, 0.45]} />
          <meshStandardMaterial color="#555" roughness={0.6} />
        </mesh>
        {/* 椅背 — 在远离桌子的一侧（z正方向，人背后） */}
        <mesh position={[0, 0.6, 0.2]}>
          <boxGeometry args={[0.45, 0.5, 0.05]} />
          <meshStandardMaterial color="#555" roughness={0.6} />
        </mesh>
        {/* 椅腿/中心柱 */}
        <mesh position={[0, 0.15, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.3, 8]} />
          <meshStandardMaterial color="#777" roughness={0.3} metalness={0.5} />
        </mesh>
        {/* 星形脚架 — 连接中心柱与轮子 */}
        {[0, 1.257, 2.514, 3.771, 5.028].map((angle, i) => (
          <mesh key={`arm-${i}`} position={[Math.sin(angle) * 0.1, 0.06, Math.cos(angle) * 0.1]}
            rotation={[0, -angle, 0]}>
            <boxGeometry args={[0.2, 0.015, 0.025]} />
            <meshStandardMaterial color="#777" roughness={0.3} metalness={0.5} />
          </mesh>
        ))}
        {/* 椅子脚轮 */}
        {[0, 1.257, 2.514, 3.771, 5.028].map((angle, i) => (
          <mesh key={`wheel-${i}`} position={[Math.sin(angle) * 0.2, 0.03, Math.cos(angle) * 0.2]}>
            <cylinderGeometry args={[0.02, 0.02, 0.06, 6]} />
            <meshStandardMaterial color="#555" roughness={0.3} metalness={0.5} />
          </mesh>
        ))}
      </group>

      {/* 猫咪 — 坐在椅子上，旋转180°面朝显示器（-Z方向）
          坐姿时猫模型内部下沉 -0.33，使髋关节对齐椅面 */}
      {isAtDesk && agent && (
        <group position={[0, 0.6, 0.5]} rotation={[0, Math.PI, 0]}>
          <CatModel3D
            role={agent.role || 'custom'}
            status={agent.status}
            scale={1.2}
            isSitting={true}
            onClick={() => onAgentClick(agent)}
            themeAccentColor={agent.role === 'designer' ? '#a855f7' : '#39bef8'}
          />
        </group>
      )}
    </group>
  )
}
