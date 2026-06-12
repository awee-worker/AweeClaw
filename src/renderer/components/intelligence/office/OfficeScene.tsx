import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text, Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { OfficeFloor } from './OfficeFloor'
import { OfficeDesk } from './OfficeDesk'
import { OfficeFurniture } from './OfficeFurniture'
import { WanderingCat } from './WanderingCat'
import { HandoffCat } from './HandoffCat'
import { CatModel3D } from '../cat/CatModel3D'
import { DESK_LAYOUTS, MEETING_AREA, getDeskChairPosition } from './officeConfig'
import type { WorkspaceAgent, TeamChatMessage } from '../../../state/slices/agentWorkspaceSlice'
import type { CollaborationPhase } from '../../../intelligence/multiAgent/TeamCollaborationProtocol'

interface OfficeSceneProps {
  agents: WorkspaceAgent[]
  onAgentClick: (agent: WorkspaceAgent) => void
  handoffFrom?: string
  handoffTo?: string
  collaborationPhase?: CollaborationPhase
  accentColor?: string
  teamChat?: TeamChatMessage[]
  isDaytime?: boolean
}

/** 阶段指示器 — 在电子屏上方显示当前阶段 */
function PhaseIndicator({ phase }: { phase: CollaborationPhase }) {
  const PHASE_LABELS: Record<CollaborationPhase, { text: string; color: string }> = {
    meeting: { text: '团队会议', color: '#3B82F6' },
    discussion: { text: '讨论中', color: '#8B5CF6' },
    voting: { text: '投票中', color: '#F59E0B' },
    delegation: { text: '任务分配', color: '#10B981' },
    execution: { text: '执行中', color: '#39bef8' },
    handoff: { text: '任务交接', color: '#EC4899' },
    review: { text: '代码审查', color: '#6366F1' },
    completed: { text: '已完成', color: '#4ADE80' },
  }
  const info = PHASE_LABELS[phase] || PHASE_LABELS.meeting

  return (
    <Billboard position={[0, 3.4, -4.9]} follow lockX={false} lockY={false} lockZ={false}>
      <mesh position={[0, 0, -0.005]}>
        <planeGeometry args={[1.6, 0.3]} />
        <meshStandardMaterial color={info.color} transparent opacity={0.85} roughness={0.3} />
      </mesh>
      <Text
        fontSize={0.12}
        color="white"
        anchorX="center"
        anchorY="middle"
        font={undefined}
      >
        {info.text}
      </Text>
    </Billboard>
  )
}

// ===== 猫咪模型常量 =====

/** 人形猫模型脚底 Y 偏移 — 模型脚底在 y≈-0.25，需要抬高到地面 */
const CAT_GROUND_Y = 0.25

/** 人形猫模型缩放 — 适配办公室场景比例 */
const CAT_SCALE = 1.2

// ===== 会议座位分配 =====

/** 会议椅位置 — 前排3把（面朝z负方向，即面朝桌子），后排3把（面朝z正方向，即面朝桌子），左右各1把 */
const MEETING_SEAT_POOL: Array<{ position: [number, number, number]; rotationY: number }> = [
  // 前排（z正方向，靠近摄像机），面朝z负方向（面朝桌子）→ 旋转PI
  { position: [MEETING_AREA[0] - 0.6, CAT_GROUND_Y, MEETING_AREA[2] + 0.8], rotationY: Math.PI },
  { position: [MEETING_AREA[0], CAT_GROUND_Y, MEETING_AREA[2] + 0.8], rotationY: Math.PI },
  { position: [MEETING_AREA[0] + 0.6, CAT_GROUND_Y, MEETING_AREA[2] + 0.8], rotationY: Math.PI },
  // 后排（z负方向，远离摄像机），面朝z正方向（面朝桌子）→ 旋转0
  { position: [MEETING_AREA[0] - 0.6, CAT_GROUND_Y, MEETING_AREA[2] - 0.8], rotationY: 0 },
  { position: [MEETING_AREA[0], CAT_GROUND_Y, MEETING_AREA[2] - 0.8], rotationY: 0 },
  { position: [MEETING_AREA[0] + 0.6, CAT_GROUND_Y, MEETING_AREA[2] - 0.8], rotationY: 0 },
]

/**
 * 根据猫咪数量动态分配座位 — 少于4只时面对面坐
 *
 * 策略：
 *   1只 → 前排中间
 *   2只 → 前排中间 + 后排中间（面对面）
 *   3只 → 前排2 + 后排1（三角形围坐）
 *   4只 → 前排2 + 后排2（2v2面对面）
 *   5只 → 前排3 + 后排2
 *   6只 → 前排3 + 后排3
 */
function allocateMeetingSeats(count: number): Array<{ position: [number, number, number]; rotationY: number }> {
  if (count <= 0) return []

  const seats: Array<{ position: [number, number, number]; rotationY: number }> = []

  if (count === 1) {
    // 1只：前排中间
    seats.push(MEETING_SEAT_POOL[1])
  } else if (count === 2) {
    // 2只：前排中间 + 后排中间（面对面）
    seats.push(MEETING_SEAT_POOL[1])
    seats.push(MEETING_SEAT_POOL[4])
  } else if (count === 3) {
    // 3只：前排2 + 后排1（三角形围坐）
    seats.push(MEETING_SEAT_POOL[0])
    seats.push(MEETING_SEAT_POOL[2])
    seats.push(MEETING_SEAT_POOL[4])
  } else if (count === 4) {
    // 4只：前排2 + 后排2（2v2面对面）
    seats.push(MEETING_SEAT_POOL[0])
    seats.push(MEETING_SEAT_POOL[2])
    seats.push(MEETING_SEAT_POOL[3])
    seats.push(MEETING_SEAT_POOL[5])
  } else if (count === 5) {
    // 5只：前排3 + 后排2
    seats.push(MEETING_SEAT_POOL[0])
    seats.push(MEETING_SEAT_POOL[1])
    seats.push(MEETING_SEAT_POOL[2])
    seats.push(MEETING_SEAT_POOL[3])
    seats.push(MEETING_SEAT_POOL[5])
  } else {
    // 6只：全部
    seats.push(...MEETING_SEAT_POOL)
  }

  return seats.slice(0, count)
}

// ===== 猫咪移动组件 =====

/** 单只猫咪从起点走到终点的过渡动画 — 纯线性插值，无避障逻辑 */
function WalkingCat({
  agent,
  fromPosition,
  toPosition,
  onArrived,
}: {
  agent: WorkspaceAgent
  fromPosition: [number, number, number]
  toPosition: [number, number, number]
  onArrived: () => void
}) {
  const groupRef = useRef<THREE.Group>(null)
  const elapsedRef = useRef(0)
  const arrivedRef = useRef(false)
  const initializedRef = useRef(false)
  const DURATION = 1.5 // 动画时长（秒）

  useFrame((_state, delta) => {
    const group = groupRef.current
    if (!group || arrivedRef.current) return

    // 首帧：设置起始位置
    if (!initializedRef.current) {
      group.position.set(fromPosition[0], CAT_GROUND_Y, fromPosition[2])
      initializedRef.current = true
      console.log(`[WalkingCat] ${agent.name} 从 (${fromPosition[0].toFixed(1)}, ${fromPosition[2].toFixed(1)}) 出发 → (${toPosition[0].toFixed(1)}, ${toPosition[2].toFixed(1)})`)
    }

    elapsedRef.current += delta
    const t = Math.min(elapsedRef.current / DURATION, 1.0)

    // 线性插值：从起点到终点
    group.position.x = fromPosition[0] + (toPosition[0] - fromPosition[0]) * t
    group.position.z = fromPosition[2] + (toPosition[2] - fromPosition[2]) * t
    group.position.y = CAT_GROUND_Y

    // 朝向移动方向
    const dx = toPosition[0] - fromPosition[0]
    const dz = toPosition[2] - fromPosition[2]
    if (Math.abs(dx) > 0.01 || Math.abs(dz) > 0.01) {
      group.rotation.y = Math.atan2(dx, dz)
    }

    if (t >= 1.0) {
      console.log(`[WalkingCat] ${agent.name} 到达目标`)
      arrivedRef.current = true
      onArrived()
    }
  })

  return (
    <group ref={groupRef}>
      <CatModel3D
        role={agent.role || 'custom'}
        status="moving"
        idleAction="idle"
        scale={CAT_SCALE}
        onClick={() => {}}
        themeAccentColor={agent.role === 'designer' ? '#a855f7' : '#39bef8'}
      />
    </group>
  )
}

/** 3D办公室场景 — 办公桌始终显示，猫咪根据阶段在工位/会议桌间切换 */
export function OfficeScene({
  agents,
  onAgentClick,
  handoffFrom,
  handoffTo,
  collaborationPhase = 'meeting',
  teamChat = [],
  isDaytime = true,
}: OfficeSceneProps) {
  const isMeetingPhase = collaborationPhase === 'meeting' || collaborationPhase === 'discussion'
  const isVotingPhase = collaborationPhase === 'voting'
  const isDelegationPhase = collaborationPhase === 'delegation'
  const isExecutionPhase = collaborationPhase === 'execution' || collaborationPhase === 'review' || collaborationPhase === 'completed'
  const isHandoffPhase = collaborationPhase === 'handoff'

  // 是否在会议相关阶段（猫咪在会议桌旁）
  const isInMeeting = isMeetingPhase || isVotingPhase || isDelegationPhase

  // 走回工位的过渡状态（预存起点和终点，避免后续 agents 引用变化导致查找失败）
  const [returningCats, setReturningCats] = useState<Array<{
    agent: WorkspaceAgent
    fromPosition: [number, number, number]
    toPosition: [number, number, number]
    id: string
  }>>([])

  // 使用 ref 追踪阶段变化，避免 useEffect 依赖 agents 导致误触发
  const prevIsInMeetingRef = useRef(isInMeeting)

  // 检测从会议阶段退出 → 触发走回动画
  useEffect(() => {
    console.log(`[OfficeScene] isInMeeting: ${prevIsInMeetingRef.current} → ${isInMeeting}, phase: ${collaborationPhase}, returningCats: ${returningCats.length}`)
    if (prevIsInMeetingRef.current && !isInMeeting) {
      console.log(`[OfficeScene] 会议结束，生成走回工位列表，agents: ${agents.length}`)
      const seats = allocateMeetingSeats(agents.length)
      const cats = agents.slice(0, seats.length).map((agent, i) => {
        const deskIndex = agents.findIndex(a => a.id === agent.id)
        const desk = DESK_LAYOUTS[deskIndex] || DESK_LAYOUTS[0]
        return {
          agent,
          fromPosition: seats[i].position,
          toPosition: getDeskChairPosition(desk),
          id: `return-${agent.id}`,
        }
      })
      console.log(`[OfficeScene] 生成 ${cats.length} 只猫咪走回动画`)
      setReturningCats(cats)
    }
    prevIsInMeetingRef.current = isInMeeting
  }, [isInMeeting]) // eslint-disable-line react-hooks/exhaustive-deps

  // 猫咪到达工位回调
  const handleCatArrived = useCallback((catId: string) => {
    setReturningCats(prev => prev.filter(c => c.id !== catId))
  }, [])

  // 是否有猫咪正在走回工位
  const hasReturningCats = returningCats.length > 0

  // 将智能体分配到工位 — 根据角色数量动态决定显示多少办公桌
  const deskAssignments = useMemo(() => {
    const deskCount = Math.max(agents.length, 1)
    const assignments = []
    for (let i = 0; i < deskCount; i++) {
      const desk = DESK_LAYOUTS[i] || {
        id: `desk-dynamic-${i}`,
        position: [
          (i % 2 === 0 ? -1 : 1) * (1.2 + Math.floor(i / 2) * 1.7),
          0,
          3.5,
        ] as [number, number, number],
        rotation: Math.PI,
      }
      assignments.push({
        desk,
        agent: agents[i] || null,
      })
    }
    return assignments
  }, [agents])

  // 交接信息
  const handoffInfo = useMemo(() => {
    if (!handoffFrom || !handoffTo) return null
    const fromAgent = agents.find(a => a.id === handoffFrom)
    const toAgent = agents.find(a => a.id === handoffTo)
    if (!fromAgent || !toAgent) return null
    const fromIndex = agents.findIndex(a => a.id === handoffFrom)
    const toIndex = agents.findIndex(a => a.id === handoffTo)
    const fromDesk = DESK_LAYOUTS[fromIndex]
    const toDesk = DESK_LAYOUTS[toIndex]
    if (!fromDesk || !toDesk) return null
    return {
      fromAgent,
      toAgent,
      fromPosition: fromDesk.position,
      toPosition: toDesk.position,
    }
  }, [handoffFrom, handoffTo, agents])

  // 正在闲逛的智能体
  const wanderingAgents = useMemo(() => {
    return agents.filter(a => a.isMoving)
  }, [agents])

  // 会议阶段：根据猫咪数量动态分配座位
  const meetingPositions = useMemo(() => {
    if (!isInMeeting) return []
    const seats = allocateMeetingSeats(Math.min(agents.length, 6))
    return agents.slice(0, seats.length).map((agent, i) => ({
      agent,
      position: seats[i].position,
      rotationY: seats[i].rotationY,
    }))
  }, [agents, isInMeeting])

  // 判断某只猫是否正在走回工位（走回期间不在工位显示）
  const returningAgentIds = useMemo(
    () => new Set(returningCats.map(c => c.agent.id)),
    [returningCats]
  )

  return (
    <>
      {/* 灯光 — 白天自然光，夜间室内灯 */}
      <ambientLight intensity={isDaytime ? 0.8 : 0.5} />
      <directionalLight
        position={[5, 8, 5]}
        intensity={isDaytime ? 0.8 : 0.2}
        castShadow
      />
      {/* 天花板室内灯 — 夜间亮起 */}
      {!isDaytime && (
        <>
          <pointLight position={[0, 4.5, 1]} intensity={1.2} color="#FFF5E6" distance={15} decay={1.5} />
          <pointLight position={[-3, 4.5, 1]} intensity={0.6} color="#FFF5E6" distance={10} decay={2} />
          <pointLight position={[3, 4.5, 1]} intensity={0.6} color="#FFF5E6" distance={10} decay={2} />
          <pointLight position={[0, 4.5, -2]} intensity={0.5} color="#FFF5E6" distance={10} decay={2} />
        </>
      )}
      {/* 氛围灯 */}
      <pointLight
        position={[-3, 2, -3]}
        intensity={isMeetingPhase ? 0.3 : 0.1}
        color={isMeetingPhase ? '#8B5CF6' : '#39bef8'}
      />
      <pointLight position={[3, 2, -3]} intensity={0.1} color="#a855f7" />

      {/* 场景元素 */}
      <OfficeFloor />
      <OfficeFurniture />

      {/* 阶段指示器 */}
      <PhaseIndicator phase={collaborationPhase} />

      {/* 办公桌 — 始终显示 */}
      {deskAssignments.map(({ desk, agent }) => {
        // 会议阶段或走回过渡期间：猫咪不在工位
        const showAgentAtDesk = !isInMeeting && !returningAgentIds.has(agent?.id || '')
        return (
          <OfficeDesk
            key={desk.id}
            deskPosition={desk.position}
            rotation={desk.rotation}
            agent={showAgentAtDesk ? agent : null}
            onAgentClick={onAgentClick}
          />
        )
      })}

      {/* 执行/交接阶段：闲逛的猫咪 */}
      {(isExecutionPhase || isHandoffPhase) && !hasReturningCats && wanderingAgents.map((agent) => {
        const deskIndex = agents.findIndex(a => a.id === agent.id)
        const desk = DESK_LAYOUTS[deskIndex]
        if (!desk) return null
        return (
          <WanderingCat
            key={`wander-${agent.id}`}
            agent={agent}
            deskPosition={desk.position}
            deskRotation={desk.rotation}
            recentChat={teamChat}
            onAgentClick={onAgentClick}
          />
        )
      })}

      {/* 会议/讨论/投票/分配阶段：猫咪坐在会议椅上 */}
      {isInMeeting && meetingPositions.map(({ agent, position, rotationY }) => (
        <group key={`meeting-${agent.id}`} position={position}>
          <group rotation={[0, rotationY, 0]}>
            <CatModel3D
              role={agent.role || 'custom'}
              status={agent.status}
              idleAction={isVotingPhase ? 'idle' : 'chat'}
              scale={CAT_SCALE}
              onClick={() => onAgentClick(agent)}
              themeAccentColor={agent.role === 'designer' ? '#a855f7' : '#39bef8'}
            />
          </group>
        </group>
      ))}

      {/* 走回工位的过渡动画 — 纯线性插值，无避障 */}
      {returningCats.map(({ agent, fromPosition, toPosition, id }) => (
        <WalkingCat
          key={id}
          agent={agent}
          fromPosition={fromPosition}
          toPosition={toPosition}
          onArrived={() => handleCatArrived(id)}
        />
      ))}

      {/* 交接动画 */}
      {handoffInfo && (
        <HandoffCat
          fromAgent={handoffInfo.fromAgent}
          toAgent={handoffInfo.toAgent}
          fromPosition={handoffInfo.fromPosition}
          toPosition={handoffInfo.toPosition}
          onComplete={() => {}}
        />
      )}
    </>
  )
}

export default OfficeScene
