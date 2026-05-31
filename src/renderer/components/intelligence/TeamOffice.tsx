import { Suspense, memo } from 'react'
import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { OfficeScene } from './OfficeScene'
import type { WorkspaceAgent } from '@store'
import type { CollaborationPhase } from '@intelligence/multiAgent/TeamCollaborationProtocol'

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#333" wireframe />
    </mesh>
  )
}

function DaytimeAwareScene({ agents, onAgentClick, handoffFrom, handoffTo, collaborationPhase }: {
  agents: WorkspaceAgent[]
  onAgentClick: (agent: WorkspaceAgent) => void
  handoffFrom?: string
  handoffTo?: string
  collaborationPhase?: CollaborationPhase
}) {
  const hour = new Date().getHours()
  const isDaytime = hour >= 6 && hour < 18
  const bgColor = isDaytime ? '#e8e4de' : '#1e1e36'
  const fogColor = isDaytime ? '#e8e4de' : '#1e1e36'

  return (
    <div className="w-full h-full rounded-xl overflow-hidden" style={{ backgroundColor: bgColor }}>
      <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, alpha: false }}>
        <color attach="background" args={[bgColor]} />
        <PerspectiveCamera makeDefault position={[0, 6, 8]} fov={50} />
        <OrbitControls
          makeDefault
          target={[0, 0.5, 0]}
          minDistance={4}
          maxDistance={15}
          minPolarAngle={0.3}
          maxPolarAngle={Math.PI / 2.2}
          enablePan={true}
          enableDamping
          dampingFactor={0.05}
        />
        <Suspense fallback={<LoadingFallback />}>
          <OfficeScene
            agents={agents}
            onAgentClick={onAgentClick}
            handoffFrom={handoffFrom}
            handoffTo={handoffTo}
            collaborationPhase={collaborationPhase}
          />
        </Suspense>
        <fog attach="fog" args={[fogColor, 10, 22]} />
      </Canvas>
    </div>
  )
}

export const TeamOffice = memo(function TeamOffice({
  agents,
  onAgentClick,
  handoffFrom,
  handoffTo,
  collaborationPhase,
}: {
  agents: WorkspaceAgent[]
  onAgentClick: (agent: WorkspaceAgent) => void
  handoffFrom?: string
  handoffTo?: string
  collaborationPhase?: CollaborationPhase
}) {
  return (
    <DaytimeAwareScene
      agents={agents}
      onAgentClick={onAgentClick}
      handoffFrom={handoffFrom}
      handoffTo={handoffTo}
      collaborationPhase={collaborationPhase}
    />
  )
})
