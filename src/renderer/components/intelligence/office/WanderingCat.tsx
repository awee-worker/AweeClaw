import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { CatModel3D } from '../cat/CatModel3D'
import { DESTINATIONS, getDeskChairPosition } from './officeConfig'
import { getAllObstacles, getSteeredDirection } from './obstacleCollision'
import type { ObstacleBox } from './obstacleCollision'
import type { DestinationType } from './officeConfig'
import type { IdleAction } from '../cat/catTypes'
import type { WorkspaceAgent, TeamChatMessage } from '../../../state/slices/agentWorkspaceSlice'

interface WanderingCatProps {
  agent: WorkspaceAgent
  deskPosition: [number, number, number]
  deskRotation?: number
  recentChat: TeamChatMessage[]
  onAgentClick: (agent: WorkspaceAgent) => void
}

/** 选择下一个目的地 — 仅限喝水、抽烟、交流 */
function pickDestination(): { target: [number, number, number]; destType: DestinationType; action: IdleAction } {
  const rand = Math.random()
  let destType: DestinationType
  if (rand < 0.4) {
    destType = 'coffee'
  } else if (rand < 0.75) {
    destType = 'chat'
  } else {
    destType = 'smoke'
  }

  const dest = DESTINATIONS[destType]
  const positions = dest.positions
  const target = positions[Math.floor(Math.random() * positions.length)]
  const offset: [number, number, number] = [
    target[0] + (Math.random() - 0.5) * 0.6,
    0,
    target[2] + (Math.random() - 0.5) * 0.4,
  ]
  return { target: offset, destType, action: dest.action }
}

function pickNextPhase(s: {
  phase: string
  currentAction: IdleAction
  currentDest: DestinationType
  target: [number, number, number] | null
  pauseTimer: number
}) {
  const { target, destType, action } = pickDestination()
  s.phase = 'leaving'
  s.currentAction = action
  s.currentDest = destType
  s.target = target
}

/** 闲逛猫咪 — 低频走动，仅限喝水/抽烟/交流，含碰撞避让 */
export function WanderingCat({ agent, deskPosition, deskRotation = 0, recentChat, onAgentClick }: WanderingCatProps) {
  const groupRef = useRef<THREE.Group>(null)
  const obstaclesRef = useRef<ObstacleBox[]>([])
  const idleAction: IdleAction = 'idle'

  // 计算椅子位置（猫咪回到工位的目标点，而非桌子中心）
  const chairPosition = useMemo(
    () => getDeskChairPosition({ position: deskPosition, rotation: deskRotation }),
    [deskPosition, deskRotation]
  )

  // 初始化障碍物列表
  if (obstaclesRef.current.length === 0) {
    obstaclesRef.current = getAllObstacles()
  }

  const stateRef = useRef({
    phase: 'paused' as 'leaving' | 'wandering' | 'returning' | 'paused' | 'atDesk',
    target: null as [number, number, number] | null,
    savedTarget: null as [number, number, number] | null,
    pauseTimer: 8 + Math.random() * 20,
    initialized: false,
    currentAction: idleAction as IdleAction,
    currentDest: 'desk' as DestinationType,
    wanderCount: 0,
    lastPhase: 'paused' as string,
    detourSide: 0,
  })

  // 猫咪状态
  const catState = useMemo(() => ({
    isMoving: stateRef.current.phase === 'leaving' || stateRef.current.phase === 'returning' || stateRef.current.phase === 'wandering',
    currentAction: stateRef.current.currentAction,
    currentDest: stateRef.current.currentDest,
  }), [])

  // 状态气泡：只在移动时短暂显示目的地
  const statusBubbleText = useMemo(() => {
    if (catState.isMoving) {
      const dest = DESTINATIONS[catState.currentDest]
      return dest ? `前往${dest.label}...` : ''
    }
    return ''
  }, [catState.isMoving, catState.currentDest])

  // 对话气泡：只在交流时显示
  const speechBubbleText = useMemo(() => {
    if (catState.currentAction !== 'chat' || catState.isMoving) return ''
    if (!recentChat || recentChat.length === 0) return ''
    const myMessage = [...recentChat].reverse().find(m => m.fromAgentId === agent.id)
    if (myMessage) {
      return myMessage.content.length > 20 ? myMessage.content.slice(0, 20) + '...' : myMessage.content
    }
    return ''
  }, [catState.currentAction, catState.isMoving, recentChat, agent.id])

  useFrame((state) => {
    const delta = state.clock.getDelta()
    const s = stateRef.current
    const group = groupRef.current
    if (!group) return

    let phaseChanged = false

    // 初始化
    if (!s.initialized) {
      group.position.set(chairPosition[0], 0.25, chairPosition[2])
      s.phase = 'paused'
      s.pauseTimer = 8 + Math.random() * 20
      s.initialized = true
      s.currentAction = idleAction
      s.lastPhase = 'paused'
      return
    }

    // 智能体正在工作 → 强制回到工位
    if (agent.status === 'working') {
      if (s.phase !== 'atDesk' && s.phase !== 'paused') {
        s.phase = 'returning'
        s.target = chairPosition
        s.currentAction = 'idle'
        s.currentDest = 'desk'
      }
    }

    const speed = 1.2
    const obstacles = obstaclesRef.current

    if (s.phase === 'atDesk') {
      group.position.x = chairPosition[0]
      group.position.z = chairPosition[2]
      s.pauseTimer -= delta
      if (s.pauseTimer <= 0) {
        if (Math.random() < 0.3) {
          s.phase = 'leaving'
          const { target, destType, action } = pickDestination()
          s.currentAction = action
          s.currentDest = destType
          s.target = target
        } else {
          s.pauseTimer = 10 + Math.random() * 25
        }
        phaseChanged = true
      }
    } else if (s.phase === 'paused') {
      s.pauseTimer -= delta
      if (s.pauseTimer <= 0) {
        if (Math.random() < 0.3) {
          pickNextPhase(s)
        } else {
          s.pauseTimer = 8 + Math.random() * 20
        }
        phaseChanged = true
      }
    } else if (s.phase === 'leaving') {
      const target = s.target!
      const [nx, nz, dist] = getSteeredDirection(
        group.position.x, group.position.z,
        target[0], target[2],
        obstacles
      )

      if (dist < 0.15) {
        s.phase = 'wandering'
        s.pauseTimer = 6 + Math.random() * 12
        phaseChanged = true
      } else if (dist > 0.01) {
        group.position.x += nx * speed * delta
        group.position.z += nz * speed * delta
        group.rotation.y = Math.atan2(nx, nz)
      }
    } else if (s.phase === 'wandering') {
      s.pauseTimer -= delta
      if (s.pauseTimer <= 0) {
        s.phase = 'returning'
        s.target = chairPosition
        s.currentAction = 'idle'
        s.currentDest = 'desk'
        phaseChanged = true
      }
    } else if (s.phase === 'returning') {
      const target = s.target!
      const [nx, nz, dist] = getSteeredDirection(
        group.position.x, group.position.z,
        target[0], target[2],
        obstacles
      )

      if (dist < 0.15) {
        s.phase = 'atDesk'
        s.pauseTimer = 10 + Math.random() * 25
        s.currentAction = 'idle'
        s.currentDest = 'desk'
        phaseChanged = true
      } else if (dist > 0.01) {
        group.position.x += nx * speed * delta
        group.position.z += nz * speed * delta
        group.rotation.y = Math.atan2(nx, nz)
      }
    }

    // 更新状态
    if (phaseChanged) {
      catState.isMoving = s.phase === 'leaving' || s.phase === 'returning' || s.phase === 'wandering'
      catState.currentAction = s.currentAction
      catState.currentDest = s.currentDest
    }

    group.position.y = 0.25
  })

  return (
    <group ref={groupRef}>
      <CatModel3D
        role={agent.role || 'custom'}
        status={catState.isMoving ? 'moving' : agent.status}
        idleAction={catState.currentAction}
        scale={1.2}
        onClick={() => onAgentClick(agent)}
        themeAccentColor={agent.role === 'designer' ? '#a855f7' : '#39bef8'}
        statusBubble={statusBubbleText || undefined}
        speechBubble={speechBubbleText || undefined}
      />
    </group>
  )
}
