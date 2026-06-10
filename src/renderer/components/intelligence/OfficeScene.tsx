import { useRef, useMemo, useCallback, useState, useEffect } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { CatModel3D } from './CatModel3D'
import type { WorkspaceAgent } from '@store'
import type { CollaborationPhase } from '@intelligence/multiAgent/TeamCollaborationProtocol'

const IDLE_ACTIONS = ['idle', 'chat', 'coffee', 'smoke', 'phone'] as const
type IdleAction = typeof IDLE_ACTIONS[number]

const SMOKING_AREA: [number, number, number] = [5, 0, 3]

type ObstacleRect = { minX: number; maxX: number; minZ: number; maxZ: number }

function buildObstacles(deskPositions: Array<[number, number, number]>): ObstacleRect[] {
  const obstacles: ObstacleRect[] = [
    { minX: -6, maxX: -5.7, minZ: -5, maxZ: 5 },
    { minX: 5.7, maxX: 6, minZ: -5, maxZ: 5 },
    { minX: -6, maxX: 6, minZ: -5, maxZ: -4.7 },
    { minX: -0.8, maxX: 0.8, minZ: 1.2, maxZ: 2.8 },
    { minX: 4.5, maxX: 5.5, minZ: 2.5, maxZ: 3.5 },
  ]
  if (Array.isArray(deskPositions)) {
    for (const pos of deskPositions) {
      obstacles.push({
        minX: pos[0] - 0.6,
        maxX: pos[0] + 0.6,
        minZ: pos[2] - 0.5,
        maxZ: pos[2] + 0.1,
      })
    }
  }
  return obstacles
}

function isColliding(x: number, z: number, obstacles: ObstacleRect[] | undefined, radius: number): boolean {
  if (!Array.isArray(obstacles)) return false
  for (const o of obstacles) {
    const closestX = Math.max(o.minX, Math.min(x, o.maxX))
    const closestZ = Math.max(o.minZ, Math.min(z, o.maxZ))
    const dx = x - closestX
    const dz = z - closestZ
    if (dx * dx + dz * dz < radius * radius) return true
  }
  return false
}

function OfficeFloor({ isDaytime }: { isDaytime: boolean }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color={isDaytime ? '#d4cfc8' : '#2a2a42'} roughness={0.9} />
      </mesh>
      <gridHelper args={[12, 24, isDaytime ? '#bbb8b0' : '#2a2a4e', isDaytime ? '#c8c4bc' : '#222244']} position={[0, 0, 0]} />
    </group>
  )
}

function OfficeWalls({ isDaytime, accentColor }: { isDaytime: boolean; accentColor: string }) {
  const wallColor = isDaytime ? '#e8e4de' : '#243052'
  return (
    <group>
      <mesh position={[0, 1.5, -5]} receiveShadow>
        <planeGeometry args={[12, 3]} />
        <meshStandardMaterial color={wallColor} roughness={0.8} />
      </mesh>
      <mesh position={[-6, 1.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 3]} />
        <meshStandardMaterial color={wallColor} roughness={0.8} />
      </mesh>
      <mesh position={[6, 1.5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 3]} />
        <meshStandardMaterial color={wallColor} roughness={0.8} />
      </mesh>

      {[[-2, 1.8, -4.98], [2, 1.8, -4.98]].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]}>
          <planeGeometry args={[0.8, 0.6]} />
          <meshStandardMaterial color={isDaytime ? '#c8c4bc' : '#0d1117'} roughness={0.5} />
        </mesh>
      ))}

      {[-2, 2].map((x, i) => (
        <mesh key={i} position={[x, 2.95, 0]}>
          <boxGeometry args={[2, 0.05, 0.3]} />
          <meshStandardMaterial color="#ffffff" emissive={accentColor} emissiveIntensity={0.3} roughness={0.2} />
        </mesh>
      ))}
    </group>
  )
}

function Monitor({ screenContent, isWorking, accentColor }: { screenContent: string; isWorking: boolean; accentColor: string }) {
  const glowRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (glowRef.current && isWorking) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 0.3 + Math.sin(state.clock.elapsedTime * 3) * 0.15
    }
  })

  return (
    <group position={[0, 0.85, -0.2]}>
      <mesh position={[0, -0.15, 0]}>
        <boxGeometry args={[0.04, 0.15, 0.04]} />
        <meshStandardMaterial color="#444" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh position={[0, -0.22, 0]}>
        <boxGeometry args={[0.2, 0.02, 0.12]} />
        <meshStandardMaterial color="#444" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh>
        <boxGeometry args={[0.55, 0.35, 0.03]} />
        <meshStandardMaterial color="#222" roughness={0.5} metalness={0.3} />
      </mesh>
      <mesh ref={glowRef} position={[0, 0, 0.016]}>
        <planeGeometry args={[0.5, 0.3]} />
        <meshStandardMaterial
          color="#0d1117"
          emissive={isWorking ? accentColor : '#1a1a2e'}
          emissiveIntensity={isWorking ? 0.3 : 0.05}
          roughness={0.2}
        />
      </mesh>
      {screenContent && (
        <Text
          position={[0, 0, 0.02]}
          fontSize={0.04}
          color={isWorking ? accentColor : '#666'}
          anchorX="center"
          anchorY="middle"
          maxWidth={0.45}
          font={undefined}
        >
          {screenContent}
        </Text>
      )}
    </group>
  )
}

function Keyboard() {
  return (
    <group position={[0, 0.52, 0.1]}>
      <mesh>
        <boxGeometry args={[0.3, 0.015, 0.1]} />
        <meshStandardMaterial color="#333" roughness={0.6} />
      </mesh>
      {[-0.02, 0, 0.02].map((z, i) => (
        <mesh key={i} position={[0, 0.009, z]}>
          <boxGeometry args={[0.25, 0.005, 0.015]} />
          <meshStandardMaterial color="#444" roughness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

function DeskPlant() {
  return (
    <group position={[0.5, 0.55, -0.15]}>
      <mesh position={[0, -0.05, 0]}>
        <cylinderGeometry args={[0.04, 0.035, 0.1, 8]} />
        <meshStandardMaterial color="#8B6F47" roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.04, 0]}>
        <sphereGeometry args={[0.06, 8, 8]} />
        <meshStandardMaterial color="#4CAF50" roughness={0.8} />
      </mesh>
      <mesh position={[-0.02, 0.06, 0.01]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#66BB6A" roughness={0.8} />
      </mesh>
    </group>
  )
}

function CoffeeMachine({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.15, 0]}>
        <boxGeometry args={[0.15, 0.3, 0.12]} />
        <meshStandardMaterial color="#555" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <boxGeometry args={[0.12, 0.04, 0.1]} />
        <meshStandardMaterial color="#444" roughness={0.4} metalness={0.3} />
      </mesh>
      <mesh position={[0, 0.08, 0.07]}>
        <boxGeometry args={[0.06, 0.08, 0.02]} />
        <meshStandardMaterial color="#333" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.02, 0.07]}>
        <cylinderGeometry args={[0.015, 0.015, 0.01, 8]} />
        <meshStandardMaterial color="#8B6F47" roughness={0.6} />
      </mesh>
    </group>
  )
}

function OfficeDesk({ agent, onAgentClick, accentColor }: {
  agent: WorkspaceAgent
  onAgentClick: (agent: WorkspaceAgent) => void
  accentColor: string
}) {
  const screenContent = useMemo(() => {
    if (agent.status === 'working') {
      return agent.currentStep ? agent.currentStep.slice(0, 25) : 'Working...'
    }
    if (agent.status === 'completed') return '✓ Done'
    if (agent.status === 'failed') return '✗ Error'
    return 'Ready'
  }, [agent.status, agent.currentStep])

  const isWorking = agent.status === 'working'
  const isAtDesk = agent.status === 'working' || agent.status === 'failed'

  return (
    <group>
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.04, 0.7]} />
        <meshStandardMaterial color="#8B6F47" roughness={0.6} />
      </mesh>
      {[[-0.55, 0.25, -0.3], [0.55, 0.25, -0.3], [-0.55, 0.25, 0.3], [0.55, 0.25, 0.3]].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} castShadow>
          <boxGeometry args={[0.04, 0.5, 0.04]} />
          <meshStandardMaterial color="#6B5335" roughness={0.7} />
        </mesh>
      ))}
      <mesh position={[-0.55, 0.35, 0]} castShadow>
        <boxGeometry args={[0.04, 0.7, 0.7]} />
        <meshStandardMaterial color="#7A5F3A" roughness={0.7} />
      </mesh>

      <Monitor screenContent={screenContent} isWorking={isWorking} accentColor={accentColor} />
      <Keyboard />
      <DeskPlant />

      <group position={[0, 0, 0.55]}>
        <mesh position={[0, 0.4, 0]} castShadow>
          <boxGeometry args={[0.45, 0.04, 0.4]} />
          <meshStandardMaterial color="#3a3a52" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.65, 0.18]} castShadow>
          <boxGeometry args={[0.45, 0.5, 0.04]} />
          <meshStandardMaterial color="#32324a" roughness={0.7} />
        </mesh>
        {[[-0.18, 0.2, -0.15], [0.18, 0.2, -0.15], [-0.18, 0.2, 0.15], [0.18, 0.2, 0.15]].map((pos, i) => (
          <mesh key={i} position={pos as [number, number, number]}>
            <cylinderGeometry args={[0.015, 0.015, 0.4, 6]} />
            <meshStandardMaterial color="#2a2a3e" roughness={0.5} metalness={0.3} />
          </mesh>
        ))}
        {[[-0.2, 0.02, -0.18], [0.2, 0.02, -0.18], [-0.2, 0.02, 0.18], [0.2, 0.02, 0.18], [0, 0.02, 0]].map((pos, i) => (
          <mesh key={i} position={pos as [number, number, number]}>
            <sphereGeometry args={[0.025, 6, 6]} />
            <meshStandardMaterial color="#444" roughness={0.4} metalness={0.5} />
          </mesh>
        ))}
      </group>

      {isAtDesk && (
        <group position={[0, 0.55, 0.45]} rotation={[0, Math.PI, 0]}>
          <CatModel3D
            role={agent.role || 'custom'}
            status={agent.status}
            scale={1.4}
            onClick={() => onAgentClick(agent)}
            themeAccentColor={accentColor}
          />
        </group>
      )}

      <Text
        position={[0, 0.05, 0.45]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.08}
        color="#aaa"
        anchorX="center"
        anchorY="middle"
        font={undefined}
      >
        {agent.name}
      </Text>

      {agent.status === 'working' && agent.progress > 0 && (
        <group position={[0, 0.03, 0.45]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.6, 0.04]} />
            <meshStandardMaterial color="rgba(255,255,255,0.1)" transparent opacity={0.3} />
          </mesh>
          <mesh position={[-0.3 + (0.6 * agent.progress / 100) / 2, 0, 0.001]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.6 * agent.progress / 100, 0.04]} />
            <meshStandardMaterial color={accentColor} emissive={accentColor} emissiveIntensity={0.3} transparent opacity={0.8} />
          </mesh>
        </group>
      )}
    </group>
  )
}

function HandoffBeam({ from, to }: { from: [number, number, number]; to: [number, number, number] }) {
  const beamRef = useRef<THREE.Group>(null)
  const midPoint: [number, number, number] = [
    (from[0] + to[0]) / 2,
    Math.max(from[1], to[1]) + 0.8,
    (from[2] + to[2]) / 2,
  ]

  useFrame((state) => {
    if (beamRef.current) {
      beamRef.current.rotation.y = state.clock.elapsedTime * 0.5
    }
  })

  const curve = useMemo(() => {
    return new THREE.QuadraticBezierCurve3(
      new THREE.Vector3(...from),
      new THREE.Vector3(...midPoint),
      new THREE.Vector3(...to),
    )
  }, [from, to, midPoint])

  const tubeGeom = useMemo(() => {
    return new THREE.TubeGeometry(curve, 30, 0.008, 6, false)
  }, [curve])

  return (
    <group ref={beamRef}>
      <mesh geometry={tubeGeom}>
        <meshStandardMaterial color="#FFD700" emissive="#FFD700" emissiveIntensity={0.5} transparent opacity={0.6} />
      </mesh>
      <mesh position={curve.getPoint(0.5).toArray() as [number, number, number]}>
        <sphereGeometry args={[0.04, 8, 8]} />
        <meshStandardMaterial color="#FFD700" emissive="#FFD700" emissiveIntensity={1} transparent opacity={0.8} />
      </mesh>
    </group>
  )
}

function WanderingCat({ agent, deskPosition, bounds, idleAction, obstacles, ownDeskX, ownDeskZ, accentColor }: {
  agent: WorkspaceAgent
  deskPosition: [number, number, number]
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number }
  idleAction: IdleAction
  obstacles: ObstacleRect[]
  ownDeskX: number
  ownDeskZ: number
  accentColor: string
}) {
  const groupRef = useRef<THREE.Group>(null)
  const [catState, setCatState] = useState({
    isMoving: false,
    currentAction: idleAction as IdleAction,
  })
  const stateRef = useRef({
    phase: 'paused' as 'leaving' | 'wandering' | 'returning' | 'paused' | 'atDesk',
    target: null as [number, number, number] | null,
    savedTarget: null as [number, number, number] | null,
    pauseTimer: 3 + Math.random() * 8,
    initialized: false,
    currentAction: idleAction as IdleAction,
    wanderCount: 0,
    lastPhase: 'paused' as string,
    detourSide: 0,
  })

  const filteredObstacles = useMemo(() => {
    if (!Array.isArray(obstacles)) return []
    return obstacles.filter(o => {
      const isOwnDesk = Math.abs((o.minX + o.maxX) / 2 - ownDeskX) < 0.1
        && Math.abs((o.minZ + o.maxZ) / 2 - ownDeskZ) < 0.1
        && o.maxZ - o.minZ < 1
      return !isOwnDesk
    })
  }, [obstacles, ownDeskX, ownDeskZ])

  const pickWanderTarget = useCallback(() => {
    for (let attempt = 0; attempt < 10; attempt++) {
      const target = [
        bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
        0,
        bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ),
      ] as [number, number, number]
      if (!isColliding(target[0], target[2], filteredObstacles, 0.3)) {
        return target
      }
    }
    return [0, 0, 2] as [number, number, number]
  }, [bounds, filteredObstacles])

  const pickNextPhase = useCallback((s: typeof stateRef.current) => {
    s.wanderCount++
    if (s.wanderCount >= 3 || Math.random() < 0.4) {
      s.target = [deskPosition[0], 0, deskPosition[2]]
      s.phase = 'returning'
      s.wanderCount = 0
    } else if (s.currentAction === 'smoke' && Math.random() < 0.6) {
      s.target = SMOKING_AREA
      s.phase = 'wandering'
    } else {
      s.target = pickWanderTarget()
      s.phase = 'wandering'
    }
  }, [deskPosition, pickWanderTarget])

  useFrame((_state, delta) => {
    if (!groupRef.current) return
    const s = stateRef.current

    if (!s.initialized) {
      groupRef.current.position.set(deskPosition[0], 0.35, deskPosition[2])
      s.phase = 'paused'
      s.pauseTimer = 3 + Math.random() * 8
      s.initialized = true
      s.currentAction = idleAction
      s.lastPhase = 'paused'
      return
    }

    const speed = 0.8 * delta
    let phaseChanged = false

    if (s.phase === 'leaving' || s.phase === 'wandering' || s.phase === 'returning') {
      if (!s.target) {
        s.target = pickWanderTarget()
        s.phase = 'wandering'
        phaseChanged = true
      } else {
        const dx = s.target[0] - groupRef.current.position.x
        const dz = s.target[2] - groupRef.current.position.z
        const dist = Math.sqrt(dx * dx + dz * dz)

        if (dist < 0.15) {
          if (s.savedTarget) {
            s.target = s.savedTarget
            s.savedTarget = null
            s.detourSide = 0
          } else if (s.phase === 'returning') {
            s.phase = 'atDesk'
            s.pauseTimer = 5 + Math.random() * 10
            s.currentAction = 'phone'
          } else {
            s.phase = 'paused'
            s.pauseTimer = 3 + Math.random() * 6
            s.currentAction = idleAction
          }
          phaseChanged = true
        } else {
          const dirX = dx / dist
          const dirZ = dz / dist
          const nextX = groupRef.current.position.x + dirX * speed
          const nextZ = groupRef.current.position.z + dirZ * speed

          if (!isColliding(nextX, nextZ, filteredObstacles, 0.25)) {
            groupRef.current.position.x = nextX
            groupRef.current.position.z = nextZ
            groupRef.current.rotation.y = Math.atan2(dx, dz)
          } else {
            const perpX = -dirZ
            const perpZ = dirX
            if (s.detourSide === 0) {
              s.detourSide = Math.random() < 0.5 ? 1 : -1
            }
            const detourDist = 0.8
            const detourX = groupRef.current.position.x + perpX * detourDist * s.detourSide
            const detourZ = groupRef.current.position.z + perpZ * detourDist * s.detourSide

            if (!isColliding(detourX, detourZ, filteredObstacles, 0.3)) {
              s.savedTarget = s.savedTarget || s.target
              s.target = [detourX, 0, detourZ]
            } else {
              const detourX2 = groupRef.current.position.x + perpX * detourDist * (-s.detourSide)
              const detourZ2 = groupRef.current.position.z + perpZ * detourDist * (-s.detourSide)
              if (!isColliding(detourX2, detourZ2, filteredObstacles, 0.3)) {
                s.savedTarget = s.savedTarget || s.target
                s.target = [detourX2, 0, detourZ2]
                s.detourSide = -s.detourSide
              } else {
                s.savedTarget = null
                s.detourSide = 0
                s.target = pickWanderTarget()
                s.phase = 'wandering'
                phaseChanged = true
              }
            }
          }
        }
      }
    }

    if (s.phase === 'paused') {
      s.pauseTimer -= delta
      if (s.pauseTimer <= 0) {
        pickNextPhase(s)
        phaseChanged = true
      }
    }

    if (s.phase === 'atDesk') {
      groupRef.current.position.x = deskPosition[0]
      groupRef.current.position.z = deskPosition[2]
      s.pauseTimer -= delta
      if (s.pauseTimer <= 0) {
        s.phase = 'leaving'
        s.currentAction = idleAction
        s.target = pickWanderTarget()
        phaseChanged = true
      }
    }

    groupRef.current.position.y = 0.35

    if (phaseChanged || s.lastPhase !== s.phase) {
      s.lastPhase = s.phase
      const moving = s.phase === 'leaving' || s.phase === 'wandering' || s.phase === 'returning'
      setCatState({ isMoving: moving, currentAction: s.currentAction })
    }
  })

  return (
    <group ref={groupRef}>
      <CatModel3D
        role={agent.role || 'custom'}
        status={catState.isMoving ? 'moving' : 'waiting'}
        idleAction={catState.currentAction}
        scale={1.3}
        themeAccentColor={accentColor}
      />
      <Text
        position={[0, 0.55, 0]}
        fontSize={0.06}
        color="#aaa"
        anchorX="center"
        anchorY="bottom"
        font={undefined}
      >
        {agent.name}
      </Text>
    </group>
  )
}

function CornerPlant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.08, 0.1, 0.3, 8]} />
        <meshStandardMaterial color="#5D4037" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.4, 0]}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color="#388E3C" roughness={0.8} />
      </mesh>
      <mesh position={[-0.05, 0.48, 0.03]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshStandardMaterial color="#4CAF50" roughness={0.8} />
      </mesh>
    </group>
  )
}

function MeetingTable() {
  return (
    <group position={[0, 0, 2]}>
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.7, 0.7, 0.04, 16]} />
        <meshStandardMaterial color="#6B5335" roughness={0.6} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const angle = (i / 4) * Math.PI * 2
        const x = Math.cos(angle) * 0.5
        const z = Math.sin(angle) * 0.5
        return (
          <mesh key={i} position={[x, 0.19, z]} castShadow>
            <cylinderGeometry args={[0.025, 0.025, 0.38, 6]} />
            <meshStandardMaterial color="#5D4037" roughness={0.7} />
          </mesh>
        )
      })}
      {[0, 1, 2, 3].map((i) => {
        const angle = (i / 4) * Math.PI * 2
        const x = Math.cos(angle) * 0.9
        const z = Math.sin(angle) * 0.9
        const faceCenter = Math.atan2(-Math.cos(angle), -Math.sin(angle))
        return (
          <group key={`chair-${i}`} position={[x, 0, z]} rotation={[0, faceCenter, 0]}>
            <mesh position={[0, 0.25, 0]} castShadow>
              <boxGeometry args={[0.35, 0.03, 0.35]} />
              <meshStandardMaterial color="#3a3a52" roughness={0.7} />
            </mesh>
            <mesh position={[0, 0.45, -0.16]} castShadow>
              <boxGeometry args={[0.35, 0.4, 0.03]} />
              <meshStandardMaterial color="#32324a" roughness={0.7} />
            </mesh>
            {[[-0.14, 0.12, -0.14], [0.14, 0.12, -0.14], [-0.14, 0.12, 0.14], [0.14, 0.12, 0.14]].map((pos, j) => (
              <mesh key={j} position={pos as [number, number, number]}>
                <cylinderGeometry args={[0.015, 0.015, 0.25, 6]} />
                <meshStandardMaterial color="#2a2a3e" roughness={0.5} metalness={0.3} />
              </mesh>
            ))}
          </group>
        )
      })}
      <group position={[0, 0.4, 0]}>
        <mesh position={[0, 0.04, 0]}>
          <cylinderGeometry args={[0.05, 0.04, 0.08, 8]} />
          <meshStandardMaterial color="#8B6F47" roughness={0.7} />
        </mesh>
        <mesh position={[0, 0.12, 0]}>
          <sphereGeometry args={[0.07, 8, 8]} />
          <meshStandardMaterial color="#4CAF50" roughness={0.8} />
        </mesh>
        <mesh position={[-0.03, 0.15, 0.02]}>
          <sphereGeometry args={[0.05, 8, 8]} />
          <meshStandardMaterial color="#66BB6A" roughness={0.8} />
        </mesh>
        <mesh position={[0.02, 0.17, -0.02]}>
          <sphereGeometry args={[0.04, 8, 8]} />
          <meshStandardMaterial color="#388E3C" roughness={0.8} />
        </mesh>
      </group>
      <Text
        position={[0, 0.42, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.06}
        color="#888"
        anchorX="center"
        anchorY="middle"
        font={undefined}
      >
        Meeting
      </Text>
    </group>
  )
}

function SmokingArea() {
  return (
    <group position={SMOKING_AREA}>
      <mesh position={[0, 0.4, 0]} castShadow>
        <boxGeometry args={[0.8, 0.04, 0.8]} />
        <meshStandardMaterial color="#5D4037" roughness={0.7} />
      </mesh>
      {[[-0.35, 0.2, -0.35], [0.35, 0.2, -0.35], [-0.35, 0.2, 0.35], [0.35, 0.2, 0.35]].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} castShadow>
          <cylinderGeometry args={[0.02, 0.02, 0.4, 6]} />
          <meshStandardMaterial color="#444" roughness={0.5} metalness={0.3} />
        </mesh>
      ))}
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.04, 0.05, 0.15, 8]} />
        <meshStandardMaterial color="#666" roughness={0.4} metalness={0.5} />
      </mesh>
      <mesh position={[0, 0.43, 0]}>
        <cylinderGeometry args={[0.035, 0.035, 0.01, 8]} />
        <meshStandardMaterial color="#888" roughness={0.3} metalness={0.6} />
      </mesh>
      <Text
        position={[0, 0.5, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.05}
        color="#999"
        anchorX="center"
        anchorY="middle"
        font={undefined}
      >
        Smoking
      </Text>
    </group>
  )
}

function ReturningCat({ agent, from, to, onArrived, accentColor }: {
  agent: WorkspaceAgent
  from: [number, number, number]
  to: [number, number, number]
  onArrived: () => void
  accentColor: string
}) {
  const groupRef = useRef<THREE.Group>(null)
  const arrivedRef = useRef(false)

  useFrame((_state, delta) => {
    if (!groupRef.current || arrivedRef.current) return

    const speed = 3.5 * delta
    const dx = to[0] - groupRef.current.position.x
    const dz = to[2] - groupRef.current.position.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist < 0.15) {
      groupRef.current.position.set(to[0], 0.35, to[2])
      arrivedRef.current = true
      onArrived()
    } else {
      const dirX = dx / dist
      const dirZ = dz / dist
      groupRef.current.position.x += dirX * speed
      groupRef.current.position.z += dirZ * speed
      groupRef.current.position.y = 0.35
      groupRef.current.rotation.y = Math.atan2(dx, dz)
    }
  })

  return (
    <group ref={groupRef} position={[from[0], from[1], from[2]]}>
      <CatModel3D
        role={agent.role || 'custom'}
        status="moving"
        scale={1.3}
        themeAccentColor={accentColor}
      />
      <Text
        position={[0, 0.55, 0]}
        fontSize={0.06}
        color="#aaa"
        anchorX="center"
        anchorY="bottom"
        font={undefined}
      >
        {agent.name}
      </Text>
    </group>
  )
}

const DESK_LAYOUTS: Record<number, Array<[number, number, number]>> = {
  2: [[-1.5, 0, -2], [1.5, 0, -2]],
  3: [[-2.5, 0, -2], [0, 0, -2], [2.5, 0, -2]],
  4: [[-2.5, 0, -2.5], [2.5, 0, -2.5], [-2.5, 0, 0.5], [2.5, 0, 0.5]],
  5: [[-3, 0, -2.5], [-1, 0, -2.5], [1, 0, -2.5], [3, 0, -2.5], [0, 0, 0.5]],
  6: [[-3, 0, -2.5], [-1, 0, -2.5], [1, 0, -2.5], [-3, 0, 0.5], [-1, 0, 0.5], [1, 0, 0.5]],
}

function getAgentIdleAction(agentId: string): IdleAction {
  let hash = 0
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) - hash) + agentId.charCodeAt(i)
    hash |= 0
  }
  return IDLE_ACTIONS[Math.abs(hash) % IDLE_ACTIONS.length]
}

export function OfficeScene({ agents, onAgentClick, handoffFrom, handoffTo, collaborationPhase, accentColor = '#39bef8' }: {
  agents: WorkspaceAgent[]
  onAgentClick: (agent: WorkspaceAgent) => void
  handoffFrom?: string
  handoffTo?: string
  collaborationPhase?: CollaborationPhase
  accentColor?: string
}) {
  const count = Math.min(Math.max(agents.length, 2), 6)
  const positions = DESK_LAYOUTS[count] || DESK_LAYOUTS[4]

  const hour = new Date().getHours()
  const isDaytime = hour >= 6 && hour < 18

  const agentPositions = useMemo(() => {
    const map = new Map<string, [number, number, number]>()
    agents.forEach((agent, i) => {
      if (i < positions.length) {
        map.set(agent.id, positions[i])
      }
    })
    return map
  }, [agents, positions])

  const fromPos = handoffFrom ? agentPositions.get(handoffFrom) : undefined
  const toPos = handoffTo ? agentPositions.get(handoffTo) : undefined

  const idleAgents = agents.filter(a => a.status === 'waiting' || a.status === 'completed')

  const wanderBounds = { minX: -4, maxX: 4, minZ: 1, maxZ: 3.5 }

  const obstacles = useMemo(() => buildObstacles(positions), [positions])

  const isMeetingPhase = collaborationPhase === 'meeting' || collaborationPhase === 'discussion' || collaborationPhase === 'voting' || collaborationPhase === 'delegation'

  const meetingChairPositions = useMemo(() => {
    const chairPositions: Array<[number, number, number]> = []
    const tableCenter: [number, number, number] = [0, 0, 2]
    const chairCount = Math.min(agents.length, 6)
    for (let i = 0; i < chairCount; i++) {
      const angle = (i / chairCount) * Math.PI * 2 - Math.PI / 2
      const radius = 0.9
      const x = tableCenter[0] + Math.cos(angle) * radius
      const z = tableCenter[2] + Math.sin(angle) * radius
      chairPositions.push([x, 0, z])
    }
    return chairPositions
  }, [agents.length])

  const [returningAgentIds, setReturningAgentIds] = useState<Set<string>>(new Set())
  const [agentMeetingStartPositions, setAgentMeetingStartPositions] = useState<Map<string, [number, number, number]>>(new Map())
  const prevMeetingPhaseRef = useRef(false)

  useEffect(() => {
    if (isMeetingPhase) {
      setReturningAgentIds(new Set())
      setAgentMeetingStartPositions(new Map())
    } else if (prevMeetingPhaseRef.current && !isMeetingPhase) {
      const ids = new Set<string>()
      const starts = new Map<string, [number, number, number]>()
      agents.forEach((agent, i) => {
        if (i < meetingChairPositions.length) {
          ids.add(agent.id)
          starts.set(agent.id, meetingChairPositions[i])
        }
      })
      setReturningAgentIds(ids)
      setAgentMeetingStartPositions(starts)
    }
    prevMeetingPhaseRef.current = isMeetingPhase
  }, [isMeetingPhase, agents, meetingChairPositions])

  const isTransitioning = returningAgentIds.size > 0

  return (
    <>
      <ambientLight intensity={isDaytime ? 0.8 : 1.2} />
      <directionalLight
        position={isDaytime ? [5, 10, 5] : [5, 8, 3]}
        intensity={isDaytime ? 1.0 : 1.2}
        castShadow
        shadow-mapSize-width={1024}
        shadow-mapSize-height={1024}
        color={isDaytime ? '#fff5e6' : '#e8eeff'}
      />
      <pointLight position={[0, 2.8, 0]} intensity={isDaytime ? 0.2 : 0.8} color={isDaytime ? '#FFE0B2' : accentColor} />
      {!isDaytime && (
        <>
          <pointLight position={[-3, 2.5, -2]} intensity={0.6} color="#FFD54F" />
          <pointLight position={[3, 2.5, -2]} intensity={0.6} color="#FFD54F" />
          <pointLight position={[0, 2.5, -3]} intensity={0.4} color="#FFE0B2" />
        </>
      )}

      <OfficeFloor isDaytime={isDaytime} />
      <OfficeWalls isDaytime={isDaytime} accentColor={accentColor} />

      {agents.map((agent, i) => {
        if (i >= positions.length) return null
        const isReturning = returningAgentIds.has(agent.id)
        return (
          <group key={agent.id} position={positions[i]}>
            <OfficeDesk agent={{ ...agent, status: (isMeetingPhase || isReturning) ? 'waiting' : agent.status }} onAgentClick={onAgentClick} accentColor={accentColor} />
          </group>
        )
      })}

      {fromPos && toPos && !isMeetingPhase && (
        <HandoffBeam
          from={[fromPos[0], 1.2, fromPos[2]]}
          to={[toPos[0], 1.2, toPos[2]]}
        />
      )}

      {isMeetingPhase ? (
        agents.map((agent, i) => {
          if (i >= meetingChairPositions.length) return null
          const chairPos = meetingChairPositions[i]
          const angle = (i / Math.min(agents.length, 6)) * Math.PI * 2 - Math.PI / 2
          const faceCenter = Math.atan2(-Math.cos(angle), -Math.sin(angle))
          return (
            <group key={`meeting-${agent.id}`} position={[chairPos[0], 0.55, chairPos[2]]} rotation={[0, faceCenter, 0]}>
              <CatModel3D
                role={agent.role || 'custom'}
                status="waiting"
                idleAction="chat"
                scale={1.3}
                onClick={() => onAgentClick(agent)}
                themeAccentColor={accentColor}
              />
              <Text
                position={[0, 0.55, 0]}
                fontSize={0.06}
                color="#aaa"
                anchorX="center"
                anchorY="bottom"
                font={undefined}
              >
                {agent.name}
              </Text>
            </group>
          )
        })
      ) : isTransitioning ? (
        agents.filter(a => returningAgentIds.has(a.id)).map(agent => {
          const startPos = agentMeetingStartPositions.get(agent.id)
          const deskPos = agentPositions.get(agent.id)
          if (!startPos || !deskPos) return null
          return (
            <ReturningCat
              key={`return-${agent.id}`}
              agent={agent}
              from={[startPos[0], 0.55, startPos[2]]}
              to={[deskPos[0], 0.35, deskPos[2] + 0.45]}
              onArrived={() => {
                setReturningAgentIds(prev => {
                  const next = new Set(prev)
                  next.delete(agent.id)
                  return next
                })
              }}
              accentColor={accentColor}
            />
          )
        })
      ) : (
        idleAgents.map((agent) => {
          const deskPos = agentPositions.get(agent.id)
          if (!deskPos) return null
          return (
            <WanderingCat
              key={`wander-${agent.id}`}
              agent={agent}
              deskPosition={[deskPos[0], 0.35, deskPos[2] + 0.45]}
              bounds={wanderBounds}
              idleAction={getAgentIdleAction(agent.id)}
              obstacles={obstacles}
              ownDeskX={deskPos[0]}
              ownDeskZ={deskPos[2]}
              accentColor={accentColor}
            />
          )
        })
      )}

      <CoffeeMachine position={[4.5, 0.5, -3]} />
      <CoffeeMachine position={[-4.5, 0.5, -3]} />

      <MeetingTable />
      <SmokingArea />

      <CornerPlant position={[-5.5, 0, -4.5]} />
      <CornerPlant position={[5.5, 0, -4.5]} />
      <CornerPlant position={[-5.5, 0, 4]} />
    </>
  )
}
