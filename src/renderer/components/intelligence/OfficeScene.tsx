import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import { Text } from '@react-three/drei'
import * as THREE from 'three'
import { LobsterModel3D } from './LobsterModel3D'
import type { WorkspaceAgent } from '@store'

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

function OfficeWalls({ isDaytime }: { isDaytime: boolean }) {
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

      {/* Wall decorations - picture frames */}
      {[[-2, 1.8, -4.98], [2, 1.8, -4.98]].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]}>
          <planeGeometry args={[0.8, 0.6]} />
          <meshStandardMaterial color={isDaytime ? '#c8c4bc' : '#0d1117'} roughness={0.5} />
        </mesh>
      ))}

      {/* Ceiling light strips */}
      {[-2, 2].map((x, i) => (
        <mesh key={i} position={[x, 2.95, 0]}>
          <boxGeometry args={[2, 0.05, 0.3]} />
          <meshStandardMaterial color="#ffffff" emissive="#4FC3F7" emissiveIntensity={0.3} roughness={0.2} />
        </mesh>
      ))}
    </group>
  )
}

function Monitor({ screenContent, isWorking }: { screenContent: string; isWorking: boolean }) {
  const glowRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    if (glowRef.current && isWorking) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial
      mat.emissiveIntensity = 0.3 + Math.sin(state.clock.elapsedTime * 3) * 0.15
    }
  })

  return (
    <group position={[0, 0.85, -0.2]}>
      {/* Monitor stand */}
      <mesh position={[0, -0.15, 0]}>
        <boxGeometry args={[0.04, 0.15, 0.04]} />
        <meshStandardMaterial color="#444" roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Monitor base */}
      <mesh position={[0, -0.22, 0]}>
        <boxGeometry args={[0.2, 0.02, 0.12]} />
        <meshStandardMaterial color="#444" roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Monitor screen frame */}
      <mesh>
        <boxGeometry args={[0.55, 0.35, 0.03]} />
        <meshStandardMaterial color="#222" roughness={0.5} metalness={0.3} />
      </mesh>
      {/* Screen */}
      <mesh ref={glowRef} position={[0, 0, 0.016]}>
        <planeGeometry args={[0.5, 0.3]} />
        <meshStandardMaterial
          color="#0d1117"
          emissive={isWorking ? '#4FC3F7' : '#1a1a2e'}
          emissiveIntensity={isWorking ? 0.3 : 0.05}
          roughness={0.2}
        />
      </mesh>
      {/* Screen text */}
      {screenContent && (
        <Text
          position={[0, 0, 0.02]}
          fontSize={0.04}
          color={isWorking ? '#4FC3F7' : '#666'}
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
      {/* Key rows */}
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

function OfficeDesk({ agent, onAgentClick }: { agent: WorkspaceAgent; onAgentClick: (agent: WorkspaceAgent) => void }) {
  const screenContent = useMemo(() => {
    if (agent.status === 'working') {
      return agent.currentStep ? agent.currentStep.slice(0, 25) : 'Working...'
    }
    if (agent.status === 'completed') return '✓ Done'
    if (agent.status === 'failed') return '✗ Error'
    return 'Ready'
  }, [agent.status, agent.currentStep])

  const isWorking = agent.status === 'working'

  return (
    <group>
      {/* Desk top */}
      <mesh position={[0, 0.5, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.2, 0.04, 0.7]} />
        <meshStandardMaterial color="#8B6F47" roughness={0.6} />
      </mesh>
      {/* Desk legs */}
      {[[-0.55, 0.25, -0.3], [0.55, 0.25, -0.3], [-0.55, 0.25, 0.3], [0.55, 0.25, 0.3]].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} castShadow>
          <boxGeometry args={[0.04, 0.5, 0.04]} />
          <meshStandardMaterial color="#6B5335" roughness={0.7} />
        </mesh>
      ))}
      {/* Desk side panel */}
      <mesh position={[-0.55, 0.35, 0]} castShadow>
        <boxGeometry args={[0.04, 0.7, 0.7]} />
        <meshStandardMaterial color="#7A5F3A" roughness={0.7} />
      </mesh>

      <Monitor screenContent={screenContent} isWorking={isWorking} />
      <Keyboard />
      <DeskPlant />

      {/* Chair */}
      <group position={[0, 0, 0.55]}>
        {/* Chair seat */}
        <mesh position={[0, 0.4, 0]} castShadow>
          <boxGeometry args={[0.45, 0.04, 0.4]} />
          <meshStandardMaterial color="#3a3a52" roughness={0.7} />
        </mesh>
        {/* Chair back - behind the agent (further from desk) */}
        <mesh position={[0, 0.65, 0.18]} castShadow>
          <boxGeometry args={[0.45, 0.5, 0.04]} />
          <meshStandardMaterial color="#32324a" roughness={0.7} />
        </mesh>
        {/* Chair legs */}
        {[[-0.18, 0.2, -0.15], [0.18, 0.2, -0.15], [-0.18, 0.2, 0.15], [0.18, 0.2, 0.15]].map((pos, i) => (
          <mesh key={i} position={pos as [number, number, number]}>
            <cylinderGeometry args={[0.015, 0.015, 0.4, 6]} />
            <meshStandardMaterial color="#2a2a3e" roughness={0.5} metalness={0.3} />
          </mesh>
        ))}
        {/* Chair wheels */}
        {[[-0.2, 0.02, -0.18], [0.2, 0.02, -0.18], [-0.2, 0.02, 0.18], [0.2, 0.02, 0.18], [0, 0.02, 0]].map((pos, i) => (
          <mesh key={i} position={pos as [number, number, number]}>
            <sphereGeometry args={[0.025, 6, 6]} />
            <meshStandardMaterial color="#444" roughness={0.4} metalness={0.5} />
          </mesh>
        ))}
      </group>

      {/* Agent lobster sitting in chair, facing the monitor (-z direction) */}
      <group position={[0, 0.55, 0.45]} rotation={[0, Math.PI, 0]}>
        <LobsterModel3D
          role={agent.role || 'custom'}
          status={agent.status}
          scale={0.7}
          onClick={() => onAgentClick(agent)}
        />
      </group>

      {/* Agent name label */}
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

      {/* Progress bar */}
      {agent.status === 'working' && agent.progress > 0 && (
        <group position={[0, 0.03, 0.45]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.6, 0.04]} />
            <meshStandardMaterial color="rgba(255,255,255,0.1)" transparent opacity={0.3} />
          </mesh>
          <mesh position={[-0.3 + (0.6 * agent.progress / 100) / 2, 0, 0.001]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[0.6 * agent.progress / 100, 0.04]} />
            <meshStandardMaterial color="#4FC3F7" emissive="#4FC3F7" emissiveIntensity={0.3} transparent opacity={0.8} />
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

function WalkingAgent3D({ from, to, agent, progress }: {
  from: [number, number, number]
  to: [number, number, number]
  agent: WorkspaceAgent
  progress: number
}) {
  const pos: [number, number, number] = [
    from[0] + (to[0] - from[0]) * progress,
    0.55,
    from[2] + (to[2] - from[2]) * progress,
  ]

  return (
    <group position={pos}>
      <LobsterModel3D
        role={agent.role || 'custom'}
        status="moving"
        scale={0.7}
      />
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

const DESK_LAYOUTS: Record<number, Array<[number, number, number]>> = {
  2: [[-1.5, 0, -2], [1.5, 0, -2]],
  3: [[-2.5, 0, -2], [0, 0, -2], [2.5, 0, -2]],
  4: [[-2.5, 0, -2.5], [2.5, 0, -2.5], [-2.5, 0, 0.5], [2.5, 0, 0.5]],
  5: [[-3, 0, -2.5], [-1, 0, -2.5], [1, 0, -2.5], [3, 0, -2.5], [0, 0, 0.5]],
  6: [[-3, 0, -2.5], [-1, 0, -2.5], [1, 0, -2.5], [-3, 0, 0.5], [-1, 0, 0.5], [1, 0, 0.5]],
}

export function OfficeScene({ agents, onAgentClick, handoffFrom, handoffTo }: {
  agents: WorkspaceAgent[]
  onAgentClick: (agent: WorkspaceAgent) => void
  handoffFrom?: string
  handoffTo?: string
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

  const movingAgent = agents.find(a => a.isMoving && a.moveTarget)

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
      <pointLight position={[0, 2.8, 0]} intensity={isDaytime ? 0.2 : 0.8} color={isDaytime ? '#FFE0B2' : '#4FC3F7'} />
      {!isDaytime && (
        <>
          <pointLight position={[-3, 2.5, -2]} intensity={0.6} color="#FFD54F" />
          <pointLight position={[3, 2.5, -2]} intensity={0.6} color="#FFD54F" />
          <pointLight position={[0, 2.5, -3]} intensity={0.4} color="#FFE0B2" />
        </>
      )}

      <OfficeFloor isDaytime={isDaytime} />
      <OfficeWalls isDaytime={isDaytime} />

      {/* Desks with agents */}
      {agents.map((agent, i) => {
        if (i >= positions.length) return null
        return (
          <group key={agent.id} position={positions[i]}>
            <OfficeDesk agent={agent} onAgentClick={onAgentClick} />
          </group>
        )
      })}

      {/* Handoff beam */}
      {fromPos && toPos && (
        <HandoffBeam
          from={[fromPos[0], 1.2, fromPos[2]]}
          to={[toPos[0], 1.2, toPos[2]]}
        />
      )}

      {/* Walking agent */}
      {movingAgent && movingAgent.moveTarget && (
        <WalkingAgent3D
          from={agentPositions.get(movingAgent.id) || positions[0]}
          to={agentPositions.get(movingAgent.moveTarget) || positions[1]}
          agent={movingAgent}
          progress={0.5}
        />
      )}

      {/* Corner plants */}
      <CornerPlant position={[-5.5, 0, -4.5]} />
      <CornerPlant position={[5.5, 0, -4.5]} />
      <CornerPlant position={[-5.5, 0, 4]} />
    </>
  )
}
