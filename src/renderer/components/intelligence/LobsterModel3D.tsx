import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const ROLE_COLORS: Record<string, { body: string; shell: string; accent: string }> = {
  pm: { body: '#E85D3A', shell: '#C94422', accent: '#FFD700' },
  architect: { body: '#4A90D9', shell: '#3570B0', accent: '#7EC8E3' },
  frontend: { body: '#9B59B6', shell: '#7D3C98', accent: '#E8DAEF' },
  backend: { body: '#27AE60', shell: '#1E8449', accent: '#82E0AA' },
  designer: { body: '#E91E8C', shell: '#C2185B', accent: '#F8BBD0' },
  tester: { body: '#F39C12', shell: '#D68910', accent: '#FDEBD0' },
  devops: { body: '#1ABC9C', shell: '#16A085', accent: '#A3E4D7' },
  analyst: { body: '#3498DB', shell: '#2E86C1', accent: '#AED6F1' },
  custom: { body: '#E67E22', shell: '#CA6F1E', accent: '#FAD7A0' },
}

function CrownAccessory({ color }: { color: string }) {
  return (
    <group position={[0, 0.55, 0]}>
      <mesh position={[0, 0.08, 0]}>
        <boxGeometry args={[0.3, 0.06, 0.2]} />
        <meshStandardMaterial color={color} metalness={0.6} roughness={0.3} />
      </mesh>
      {[[-0.1, 0], [0, 0], [0.1, 0]].map(([x], i) => (
        <mesh key={i} position={[x, 0.16, 0]}>
          <coneGeometry args={[0.03, 0.1, 4]} />
          <meshStandardMaterial color={color} metalness={0.6} roughness={0.3} />
        </mesh>
      ))}
    </group>
  )
}

function HardhatAccessory({ color }: { color: string }) {
  return (
    <group position={[0, 0.48, 0]}>
      <mesh>
        <sphereGeometry args={[0.22, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.24, 0.24, 0.03, 12]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
    </group>
  )
}

function GlassesAccessory() {
  return (
    <group position={[0, 0.1, 0.18]}>
      {[[-0.08, 0], [0.08, 0]].map(([x], i) => (
        <mesh key={i} position={[x, 0, 0]}>
          <torusGeometry args={[0.04, 0.008, 8, 16]} />
          <meshStandardMaterial color="#333" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.04, 0.008, 0.008]} />
        <meshStandardMaterial color="#333" metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  )
}

function BowtieAccessory({ color }: { color: string }) {
  return (
    <group position={[0, -0.15, 0.2]} rotation={[0, 0, 0]}>
      {[[-0.05, 0], [0.05, 0]].map(([x], i) => (
        <mesh key={i} position={[x, 0, 0]}>
          <coneGeometry args={[0.04, 0.08, 3]} />
          <meshStandardMaterial color={color} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.015, 8, 8]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
    </group>
  )
}

function BeretAccessory({ color }: { color: string }) {
  return (
    <group position={[0.02, 0.45, -0.02]} rotation={[0.1, 0.2, 0]}>
      <mesh>
        <cylinderGeometry args={[0.18, 0.16, 0.05, 16]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
    </group>
  )
}

function MagnifierAccessory() {
  return (
    <group position={[0.25, 0.05, 0.1]} rotation={[0, 0, -0.3]}>
      <mesh>
        <torusGeometry args={[0.05, 0.008, 8, 16]} />
        <meshStandardMaterial color="#888" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[0.04, -0.06, 0]} rotation={[0, 0, 0.5]}>
        <cylinderGeometry args={[0.01, 0.01, 0.1, 6]} />
        <meshStandardMaterial color="#666" metalness={0.6} roughness={0.3} />
      </mesh>
    </group>
  )
}

function WrenchAccessory() {
  return (
    <group position={[0.25, 0.05, 0]} rotation={[0, 0, 0.8]}>
      <mesh>
        <cylinderGeometry args={[0.012, 0.012, 0.15, 6]} />
        <meshStandardMaterial color="#999" metalness={0.7} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.08, 0]}>
        <torusGeometry args={[0.025, 0.008, 6, 8, Math.PI]} />
        <meshStandardMaterial color="#999" metalness={0.7} roughness={0.3} />
      </mesh>
    </group>
  )
}

function ClipboardAccessory() {
  return (
    <group position={[0.25, 0, 0.05]} rotation={[0.2, 0, -0.3]}>
      <mesh>
        <boxGeometry args={[0.1, 0.14, 0.008]} />
        <meshStandardMaterial color="#F5F5DC" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.06, 0.005]}>
        <boxGeometry args={[0.05, 0.02, 0.005]} />
        <meshStandardMaterial color="#8B7355" roughness={0.6} />
      </mesh>
    </group>
  )
}

function Accessory3D({ type, color }: { type: string; color: string }) {
  switch (type) {
    case 'crown': return <CrownAccessory color={color} />
    case 'hardhat': return <HardhatAccessory color={color} />
    case 'glasses': return <GlassesAccessory />
    case 'bowtie': return <BowtieAccessory color={color} />
    case 'beret': return <BeretAccessory color={color} />
    case 'magnifier': return <MagnifierAccessory />
    case 'wrench': return <WrenchAccessory />
    case 'clipboard': return <ClipboardAccessory />
    default: return null
  }
}

const ROLE_ACCESSORY: Record<string, string> = {
  pm: 'crown',
  architect: 'hardhat',
  frontend: 'glasses',
  backend: 'bowtie',
  designer: 'beret',
  tester: 'magnifier',
  devops: 'wrench',
  analyst: 'clipboard',
  custom: 'crown',
}

interface LobsterModel3DProps {
  role?: string
  status?: string
  scale?: number
  onClick?: () => void
}

export function LobsterModel3D({ role = 'custom', status = 'waiting', scale = 1, onClick }: LobsterModel3DProps) {
  const groupRef = useRef<THREE.Group>(null)
  const colors = ROLE_COLORS[role] || ROLE_COLORS.custom
  const accessoryType = ROLE_ACCESSORY[role] || 'crown'

  const bodyColor = useMemo(() => new THREE.Color(colors.body), [colors.body])
  const shellColor = useMemo(() => new THREE.Color(colors.shell), [colors.shell])

  useFrame((state) => {
    if (!groupRef.current) return
    if (status === 'working') {
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 2) * 0.03
    } else if (status === 'moving') {
      groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 4) * 0.1
    } else {
      groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, 0, 0.1)
      groupRef.current.rotation.z = THREE.MathUtils.lerp(groupRef.current.rotation.z, 0, 0.1)
    }
  })

  return (
    <group ref={groupRef} scale={scale} onClick={onClick}>
      {/* Tail fan */}
      <group position={[0, -0.25, -0.15]}>
        <mesh rotation={[0.3, 0, 0]}>
          <coneGeometry args={[0.12, 0.15, 4]} />
          <meshStandardMaterial color={shellColor} roughness={0.6} />
        </mesh>
        {[-0.06, 0, 0.06].map((x, i) => (
          <mesh key={i} position={[x, -0.08, 0]} rotation={[0.5, 0, 0]}>
            <cylinderGeometry args={[0.005, 0.015, 0.1, 4]} />
            <meshStandardMaterial color={shellColor} roughness={0.6} />
          </mesh>
        ))}
      </group>

      {/* Body */}
      <mesh position={[0, -0.05, 0]}>
        <sphereGeometry args={[0.18, 12, 10]} />
        <meshStandardMaterial color={bodyColor} roughness={0.5} />
      </mesh>
      {/* Shell segments */}
      {[-0.03, 0.02, 0.07].map((y, i) => (
        <mesh key={i} position={[0, y, 0.14]}>
          <boxGeometry args={[0.28 - i * 0.04, 0.01, 0.02]} />
          <meshStandardMaterial color={shellColor} roughness={0.5} transparent opacity={0.4} />
        </mesh>
      ))}

      {/* Head */}
      <mesh position={[0, 0.2, 0.02]}>
        <sphereGeometry args={[0.14, 12, 10]} />
        <meshStandardMaterial color={bodyColor} roughness={0.5} />
      </mesh>

      {/* Eyes */}
      {[[-0.06, 0.24, 0.12], [0.06, 0.24, 0.12]].map((pos, i) => (
        <group key={i} position={pos as [number, number, number]}>
          <mesh>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshStandardMaterial color="white" roughness={0.3} />
          </mesh>
          <mesh position={[0, 0, 0.025]}>
            <sphereGeometry args={[0.018, 8, 8]} />
            <meshStandardMaterial color="#1a1a2e" roughness={0.3} />
          </mesh>
          <mesh position={[0.005, 0.005, 0.035]}>
            <sphereGeometry args={[0.006, 6, 6]} />
            <meshStandardMaterial color="white" roughness={0.2} emissive="white" emissiveIntensity={0.3} />
          </mesh>
        </group>
      ))}

      {/* Smile */}
      <mesh position={[0, 0.17, 0.15]} rotation={[0.3, 0, 0]}>
        <torusGeometry args={[0.04, 0.005, 8, 12, Math.PI]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.5} />
      </mesh>

      {/* Left claw */}
      <group position={[-0.22, 0.05, 0.05]} rotation={[0, 0, 0.4]}>
        <mesh>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[-0.03, 0.04, 0]}>
          <coneGeometry args={[0.035, 0.08, 4]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[0.02, 0.04, 0]}>
          <coneGeometry args={[0.035, 0.08, 4]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
      </group>

      {/* Right claw */}
      <group position={[0.22, 0.05, 0.05]} rotation={[0, 0, -0.4]}>
        <mesh>
          <sphereGeometry args={[0.06, 8, 8]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[-0.02, 0.04, 0]}>
          <coneGeometry args={[0.035, 0.08, 4]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[0.03, 0.04, 0]}>
          <coneGeometry args={[0.035, 0.08, 4]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
      </group>

      {/* Antennae */}
      {[[-0.05, 0.32, 0.05, 0.3], [0.05, 0.32, 0.05, -0.3]].map(([x, y, z, rz], i) => (
        <group key={i} position={[x, y, z] as [number, number, number]} rotation={[0.5, 0, rz as number]}>
          <mesh>
            <cylinderGeometry args={[0.005, 0.008, 0.18, 4]} />
            <meshStandardMaterial color={shellColor} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.1, 0]}>
            <sphereGeometry args={[0.012, 6, 6]} />
            <meshStandardMaterial color={colors.accent} emissive={colors.accent} emissiveIntensity={0.4} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* Small legs */}
      {[[-0.1, -0.1, 0.1], [-0.08, -0.15, 0.1], [0.1, -0.1, 0.1], [0.08, -0.15, 0.1]].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]} rotation={[0.8, 0, pos[0] > 0 ? -0.3 : 0.3]}>
          <cylinderGeometry args={[0.005, 0.005, 0.08, 4]} />
          <meshStandardMaterial color={shellColor} roughness={0.5} />
        </mesh>
      ))}

      {/* Role accessory */}
      <Accessory3D type={accessoryType} color={colors.accent} />

      {/* Working sparkles */}
      {status === 'working' && (
        <>
          {[[-0.15, 0.35, 0.1], [0.18, 0.3, 0.08], [0.1, 0.4, -0.05]].map((pos, i) => (
            <mesh key={i} position={pos as [number, number, number]}>
              <sphereGeometry args={[0.015, 6, 6]} />
              <meshStandardMaterial
                color={colors.accent}
                emissive={colors.accent}
                emissiveIntensity={1.5}
                transparent
                opacity={0.8}
              />
            </mesh>
          ))}
        </>
      )}
    </group>
  )
}
