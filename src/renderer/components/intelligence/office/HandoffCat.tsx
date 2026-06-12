import { useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CatModel3D } from '../cat/CatModel3D'
import { HANDOFF_SPEECHES } from './officeConfig'
import { getAllObstacles, getSteeredDirection } from './obstacleCollision'
import type { ObstacleBox } from './obstacleCollision'
import type { WorkspaceAgent } from '../../../state/slices/agentWorkspaceSlice'

interface HandoffCatProps {
  fromAgent: WorkspaceAgent
  toAgent: WorkspaceAgent
  fromPosition: [number, number, number]
  toPosition: [number, number, number]
  onComplete: () => void
}

/** 交接猫咪 — A走到B身边交接任务，含碰撞避让和文件飞递效果 */
export function HandoffCat({ fromAgent, toAgent, fromPosition, toPosition, onComplete }: HandoffCatProps) {
  const fromRef = useRef<THREE.Group>(null)
  const toRef = useRef<THREE.Group>(null)
  const fileRef = useRef<THREE.Group>(null)
  const [phase, setPhase] = useState<'walking' | 'handoff' | 'returning' | 'done'>('walking')
  const speechRef = useRef(HANDOFF_SPEECHES[Math.floor(Math.random() * HANDOFF_SPEECHES.length)])
  const timerRef = useRef(0)
  const obstaclesRef = useRef<ObstacleBox[]>([])

  // 初始化障碍物列表
  if (obstaclesRef.current.length === 0) {
    obstaclesRef.current = getAllObstacles()
  }

  useFrame((state) => {
    const delta = state.clock.getDelta()
    const from = fromRef.current
    const to = toRef.current
    const file = fileRef.current
    if (!from || !to) return

    const speed = 1.5
    const obstacles = obstaclesRef.current

    if (phase === 'walking') {
      // A走向B，含碰撞避让
      const [nx, nz, dist] = getSteeredDirection(
        from.position.x, from.position.z,
        toPosition[0], toPosition[2],
        obstacles
      )

      if (dist < 0.3) {
        setPhase('handoff')
        timerRef.current = 0
      } else if (dist > 0.01) {
        from.position.x += nx * speed * delta
        from.position.z += nz * speed * delta
        from.rotation.y = Math.atan2(nx, nz)
      }
    } else if (phase === 'handoff') {
      // 交接中 — 文件从A飞到B
      timerRef.current += delta
      from.rotation.y = Math.atan2(
        toPosition[0] - from.position.x,
        toPosition[2] - from.position.z
      )

      // 文件飞递动画
      if (file) {
        const progress = Math.min(timerRef.current / 1.5, 1)
        const eased = 1 - Math.pow(1 - progress, 3) // ease-out
        file.position.x = from.position.x + (toPosition[0] - from.position.x) * eased
        file.position.z = from.position.z + (toPosition[2] - from.position.z) * eased
        file.position.y = 0.8 + Math.sin(progress * Math.PI) * 0.3 // 抛物线
        file.rotation.y += delta * 5
        file.visible = progress < 1
      }

      if (timerRef.current > 2.5) {
        setPhase('returning')
      }
    } else if (phase === 'returning') {
      // A返回工位，含碰撞避让
      const [nx, nz, dist] = getSteeredDirection(
        from.position.x, from.position.z,
        fromPosition[0], fromPosition[2],
        obstacles
      )

      if (dist < 0.15) {
        setPhase('done')
        onComplete()
      } else if (dist > 0.01) {
        from.position.x += nx * speed * delta
        from.position.z += nz * speed * delta
        from.rotation.y = Math.atan2(nx, nz)
      }
    }

    from.position.y = 0.25
  })

  if (phase === 'done') return null

  return (
    <>
      {/* 交接的A猫 */}
      <group ref={fromRef} position={[fromPosition[0], 0.25, fromPosition[2]]}>
        <CatModel3D
          role={fromAgent.role || 'custom'}
          status={phase === 'handoff' ? 'working' : 'moving'}
          idleAction="chat"
          scale={1.2}
          speechBubble={phase === 'handoff' ? speechRef.current : undefined}
          themeAccentColor={fromAgent.role === 'designer' ? '#a855f7' : '#39bef8'}
        />
      </group>

      {/* B猫（在工位接收） */}
      <group ref={toRef} position={[toPosition[0], 0.25, toPosition[2]]}>
        <CatModel3D
          role={toAgent.role || 'custom'}
          status={phase === 'handoff' ? 'working' : 'waiting'}
          idleAction={phase === 'handoff' ? 'chat' : 'idle'}
          scale={1.2}
          themeAccentColor={toAgent.role === 'designer' ? '#a855f7' : '#39bef8'}
        />
      </group>

      {/* 飞递的文件 */}
      <group ref={fileRef} visible={phase === 'handoff'}>
        <mesh>
          <boxGeometry args={[0.15, 0.2, 0.01]} />
          <meshStandardMaterial color="#F5F0E8" roughness={0.5} />
        </mesh>
        {/* 文件上的文字线条 */}
        {[-0.04, 0, 0.04].map((y, i) => (
          <mesh key={i} position={[0, y, 0.006]}>
            <planeGeometry args={[0.1, 0.01]} />
            <meshStandardMaterial color="#666" roughness={0.5} />
          </mesh>
        ))}
      </group>
    </>
  )
}
