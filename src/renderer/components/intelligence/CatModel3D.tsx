import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

type CatVariant = 'orange' | 'tuxedo' | 'calico' | 'gray' | 'black' | 'white'

const VARIANT_COLORS: Record<CatVariant, { body: string; accent: string; patch: string; nose: string; ear: string }> = {
  orange: { body: '#E8913A', accent: '#F5C97A', patch: '#D47B20', nose: '#E8A0A0', ear: '#F0B0B0' },
  tuxedo: { body: '#2A2A2A', accent: '#FAFAFA', patch: '#1A1A1A', nose: '#D08080', ear: '#C07070' },
  calico: { body: '#F5F0E8', accent: '#E8913A', patch: '#3A3A3A', nose: '#E8A0A0', ear: '#F0B0B0' },
  gray: { body: '#8A8A8A', accent: '#B0B0B0', patch: '#6A6A6A', nose: '#C09090', ear: '#B08080' },
  black: { body: '#1A1A1A', accent: '#333333', patch: '#0A0A0A', nose: '#A07070', ear: '#906060' },
  white: { body: '#F5F5F0', accent: '#FFFFFF', patch: '#E8E8E0', nose: '#E0A0A0', ear: '#F0B0B0' },
}

const ROLE_VARIANT: Record<string, CatVariant> = {
  pm: 'orange',
  architect: 'gray',
  frontend: 'calico',
  backend: 'tuxedo',
  designer: 'white',
  tester: 'black',
  devops: 'orange',
  analyst: 'calico',
  custom: 'orange',
}

const ROLE_ACCESSORY: Record<string, string> = {
  pm: 'bowtie',
  architect: 'glasses',
  frontend: 'scarf',
  backend: 'bowtie',
  designer: 'beret',
  tester: 'glasses',
  devops: 'hardhat',
  analyst: 'clipboard',
  custom: 'bowtie',
}

function CatBowtie({ color }: { color: string }) {
  return (
    <group position={[0, -0.08, 0.16]} rotation={[0, 0, 0]}>
      {[[-0.04, 0], [0.04, 0]].map(([x], i) => (
        <mesh key={i} position={[x, 0, 0]} rotation={[0, 0, i === 0 ? 0.3 : -0.3]}>
          <boxGeometry args={[0.05, 0.04, 0.01]} />
          <meshStandardMaterial color={color} roughness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.01, 8, 8]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
    </group>
  )
}

function CatGlasses() {
  return (
    <group position={[0, 0.08, 0.14]}>
      {[[-0.05, 0], [0.05, 0]].map(([x], i) => (
        <mesh key={i} position={[x, 0, 0]}>
          <torusGeometry args={[0.03, 0.004, 8, 16]} />
          <meshStandardMaterial color="#333" metalness={0.8} roughness={0.2} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.03, 0.004, 0.004]} />
        <meshStandardMaterial color="#333" metalness={0.8} roughness={0.2} />
      </mesh>
    </group>
  )
}

function CatScarf({ color }: { color: string }) {
  return (
    <group position={[0, -0.04, 0.12]}>
      <mesh>
        <torusGeometry args={[0.1, 0.02, 8, 16]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0.08, -0.06, 0.04]} rotation={[0.2, 0, -0.3]}>
        <boxGeometry args={[0.03, 0.1, 0.01]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
    </group>
  )
}

function CatBeret({ color }: { color: string }) {
  return (
    <group position={[0.02, 0.22, -0.02]} rotation={[0.1, 0.2, 0]}>
      <mesh>
        <cylinderGeometry args={[0.1, 0.09, 0.03, 16]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <sphereGeometry args={[0.015, 8, 8]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
    </group>
  )
}

function CatHardhat({ color }: { color: string }) {
  return (
    <group position={[0, 0.24, 0]}>
      <mesh>
        <sphereGeometry args={[0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.13, 0.13, 0.015, 12]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
    </group>
  )
}

function CatClipboard() {
  return (
    <group position={[0.2, 0.05, 0.05]} rotation={[0.2, 0, -0.3]}>
      <mesh>
        <boxGeometry args={[0.08, 0.1, 0.005]} />
        <meshStandardMaterial color="#F5F5DC" roughness={0.8} />
      </mesh>
      <mesh position={[0, 0.04, 0.003]}>
        <boxGeometry args={[0.04, 0.015, 0.003]} />
        <meshStandardMaterial color="#8B7355" roughness={0.6} />
      </mesh>
    </group>
  )
}

function CatAccessory({ type, color }: { type: string; color: string }) {
  switch (type) {
    case 'bowtie': return <CatBowtie color={color} />
    case 'glasses': return <CatGlasses />
    case 'scarf': return <CatScarf color={color} />
    case 'beret': return <CatBeret color={color} />
    case 'hardhat': return <CatHardhat color={color} />
    case 'clipboard': return <CatClipboard />
    default: return null
  }
}

function TypingArms({ bodyColor }: { bodyColor: THREE.Color }) {
  const leftArmRef = useRef<THREE.Group>(null)
  const rightArmRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (leftArmRef.current) {
      leftArmRef.current.rotation.z = Math.sin(t * 8) * 0.15
    }
    if (rightArmRef.current) {
      rightArmRef.current.rotation.z = Math.sin(t * 8 + 1) * 0.15
    }
  })

  return (
    <group position={[0, -0.02, 0.08]}>
      <group ref={leftArmRef} position={[-0.1, 0, 0]} rotation={[0.6, 0, 0]}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.18, 0.02]} rotation={[0.3, 0, 0]}>
          <sphereGeometry args={[0.022, 8, 8]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
      </group>
      <group ref={rightArmRef} position={[0.1, 0, 0]} rotation={[0.6, 0, 0]}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.18, 0.02]} rotation={[0.3, 0, 0]}>
          <sphereGeometry args={[0.022, 8, 8]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

function WalkingArms({ bodyColor, idleAction, themeAccentColor = '#39bef8' }: { bodyColor: THREE.Color; idleAction: string; themeAccentColor?: string }) {
  const leftArmRef = useRef<THREE.Group>(null)
  const rightArmRef = useRef<THREE.Group>(null)
  const rightItemRef = useRef<THREE.Group>(null)
  const actionRef = useRef(idleAction)
  actionRef.current = idleAction

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const action = actionRef.current
    const leftSway = Math.sin(t * 1.5) * 0.05

    if (leftArmRef.current) {
      leftArmRef.current.rotation.x = 0.2 + leftSway
    }

    if (rightArmRef.current) {
      if (action === 'coffee') {
        const sipOffset = Math.sin(t * 1.5) * 0.03
        rightArmRef.current.position.y = -0.02 + sipOffset
      }
      if (action === 'chat') {
        const waveAngle = Math.sin(t * 2) * 0.15
        rightArmRef.current.rotation.x = 0.5 + waveAngle
      }
    }

    if (rightItemRef.current) {
      if (action === 'phone') {
        const scrollFinger = Math.sin(t * 4) * 0.05
        rightItemRef.current.position.z = 0.02 + scrollFinger
      }
    }
  })

  if (idleAction === 'coffee') {
    return (
      <group position={[0, -0.02, 0.08]}>
        <group ref={leftArmRef} position={[-0.1, 0, 0]} rotation={[0.2, 0, 0.15]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
        <group ref={rightArmRef} position={[0.1, -0.02, 0.08]} rotation={[0.6, 0, -0.2]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.18, 0]}>
            <cylinderGeometry args={[0.02, 0.018, 0.05, 8]} />
            <meshStandardMaterial color="#FAFAFA" roughness={0.4} />
          </mesh>
          <mesh position={[0, -0.15, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.005, 8]} />
            <meshStandardMaterial color="#8B6F47" roughness={0.6} />
          </mesh>
        </group>
      </group>
    )
  }

  if (idleAction === 'smoke') {
    return (
      <group position={[0, -0.02, 0.08]}>
        <group ref={leftArmRef} position={[-0.1, 0, 0]} rotation={[0.2, 0, 0.15]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
        <group position={[0.1, 0.02, 0.08]} rotation={[0.4, 0, -0.4]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.06, 0]}>
            <cylinderGeometry args={[0.004, 0.003, 0.06, 6]} />
            <meshStandardMaterial color="#DDD" roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.09, 0]}>
            <sphereGeometry args={[0.008, 6, 6]} />
            <meshStandardMaterial color="#AAA" transparent opacity={0.4} />
          </mesh>
        </group>
      </group>
    )
  }

  if (idleAction === 'phone') {
    return (
      <group position={[0, -0.02, 0.08]}>
        <group ref={leftArmRef} position={[-0.1, 0, 0]} rotation={[0.2, 0, 0.15]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
        <group position={[0.08, 0.05, 0.12]} rotation={[0.7, 0.2, -0.3]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
          <group ref={rightItemRef} position={[0, -0.16, 0.02]} rotation={[0.3, 0, 0]}>
            <mesh>
              <boxGeometry args={[0.04, 0.06, 0.005]} />
              <meshStandardMaterial color="#1A1A2E" roughness={0.3} metalness={0.5} />
            </mesh>
          </group>
          <mesh position={[0, -0.16, 0.023]} rotation={[0.3, 0, 0]}>
            <planeGeometry args={[0.035, 0.05]} />
            <meshStandardMaterial color={themeAccentColor} emissive={themeAccentColor} emissiveIntensity={0.3} roughness={0.2} />
          </mesh>
        </group>
      </group>
    )
  }

  if (idleAction === 'chat') {
    return (
      <group position={[0, -0.02, 0.08]}>
        <group ref={leftArmRef} position={[-0.1, 0, 0]} rotation={[0.2, 0, 0.15]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
        <group ref={rightArmRef} position={[0.1, 0.03, 0.06]} rotation={[0.5, 0, -0.15]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.18, 0.02]} rotation={[0.2, 0, 0]}>
            <sphereGeometry args={[0.022, 8, 8]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
      </group>
    )
  }

  return (
    <group position={[0, -0.02, 0.08]}>
      <group ref={leftArmRef} position={[-0.1, 0, 0]} rotation={[0.2, 0, 0.15]}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
      </group>
      <group ref={rightArmRef} position={[0.1, 0, 0]} rotation={[0.2, 0, -0.15]}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

function IdleArms({ bodyColor, idleAction, themeAccentColor = '#39bef8' }: { bodyColor: THREE.Color; idleAction: string; themeAccentColor?: string }) {
  const leftArmRef = useRef<THREE.Group>(null)
  const rightArmRef = useRef<THREE.Group>(null)
  const rightItemRef = useRef<THREE.Group>(null)
  const actionRef = useRef(idleAction)
  actionRef.current = idleAction

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const action = actionRef.current

    if (rightArmRef.current) {
      if (action === 'coffee') {
        const sipOffset = Math.sin(t * 1.5) * 0.05
        rightArmRef.current.position.y = -0.02 + sipOffset
      }
      if (action === 'chat') {
        const waveAngle = Math.sin(t * 3) * 0.3
        rightArmRef.current.rotation.z = waveAngle
      }
    }

    if (rightItemRef.current) {
      if (action === 'phone') {
        const scrollFinger = Math.sin(t * 4) * 0.05
        rightItemRef.current.position.z = 0.02 + scrollFinger
      }
    }
  })

  if (idleAction === 'coffee') {
    return (
      <group position={[0, -0.02, 0.08]}>
        <group ref={leftArmRef} position={[-0.1, 0, 0]} rotation={[0.3, 0, 0.2]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
        <group ref={rightArmRef} position={[0.1, -0.02, 0.1]} rotation={[0.8, 0, -0.3]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.18, 0]}>
            <cylinderGeometry args={[0.02, 0.018, 0.05, 8]} />
            <meshStandardMaterial color="#FAFAFA" roughness={0.4} />
          </mesh>
          <mesh position={[0, -0.15, 0]}>
            <cylinderGeometry args={[0.025, 0.025, 0.005, 8]} />
            <meshStandardMaterial color="#8B6F47" roughness={0.6} />
          </mesh>
        </group>
      </group>
    )
  }

  if (idleAction === 'smoke') {
    return (
      <group position={[0, -0.02, 0.08]}>
        <group ref={leftArmRef} position={[-0.1, 0, 0]} rotation={[0.3, 0, 0.2]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
        <group position={[0.1, 0.02, 0.1]} rotation={[0.5, 0, -0.5]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
          <mesh position={[0, 0.06, 0]} rotation={[0, 0, 0]}>
            <cylinderGeometry args={[0.004, 0.003, 0.06, 6]} />
            <meshStandardMaterial color="#DDD" roughness={0.3} />
          </mesh>
          <mesh position={[0, 0.09, 0]}>
            <sphereGeometry args={[0.008, 6, 6]} />
            <meshStandardMaterial color="#AAA" transparent opacity={0.4} />
          </mesh>
        </group>
      </group>
    )
  }

  if (idleAction === 'chat') {
    return (
      <group position={[0, -0.02, 0.08]}>
        <group ref={leftArmRef} position={[-0.1, 0, 0]} rotation={[0.3, 0, 0.2]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
        <group ref={rightArmRef} position={[0.1, 0.05, 0.08]} rotation={[0.8, 0, 0]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
          <mesh position={[0, -0.18, 0.02]} rotation={[0.3, 0, 0]}>
            <sphereGeometry args={[0.022, 8, 8]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
      </group>
    )
  }

  if (idleAction === 'phone') {
    return (
      <group position={[0, -0.02, 0.08]}>
        <group ref={leftArmRef} position={[-0.1, 0, 0]} rotation={[0.3, 0, 0.2]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
        </group>
        <group position={[0.08, 0.05, 0.12]} rotation={[0.8, 0.2, -0.3]}>
          <mesh position={[0, -0.08, 0]}>
            <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
            <meshStandardMaterial color={bodyColor} roughness={0.5} />
          </mesh>
          <group ref={rightItemRef} position={[0, -0.16, 0.02]} rotation={[0.3, 0, 0]}>
            <mesh>
              <boxGeometry args={[0.04, 0.06, 0.005]} />
              <meshStandardMaterial color="#1A1A2E" roughness={0.3} metalness={0.5} />
            </mesh>
          </group>
          <mesh position={[0, -0.16, 0.023]} rotation={[0.3, 0, 0]}>
            <planeGeometry args={[0.035, 0.05]} />
            <meshStandardMaterial color={themeAccentColor} emissive={themeAccentColor} emissiveIntensity={0.3} roughness={0.2} />
          </mesh>
        </group>
      </group>
    )
  }

  return (
    <group position={[0, -0.02, 0.08]}>
      <group ref={leftArmRef} position={[-0.1, 0, 0]} rotation={[0.3, 0, 0.2]}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
      </group>
      <group ref={rightArmRef} position={[0.1, 0, 0]} rotation={[0.3, 0, -0.2]}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.015, 0.012, 0.18, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

function WalkingLegs({ bodyColor, accentColor }: { bodyColor: THREE.Color; accentColor: THREE.Color }) {
  const leftLegRef = useRef<THREE.Group>(null)
  const rightLegRef = useRef<THREE.Group>(null)
  const leftFootRef = useRef<THREE.Mesh>(null)
  const rightFootRef = useRef<THREE.Mesh>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    const leftSwing = Math.sin(t * 6) * 0.5
    const rightSwing = Math.sin(t * 6 + Math.PI) * 0.5
    const leftLift = Math.max(0, Math.sin(t * 6)) * 0.04
    const rightLift = Math.max(0, Math.sin(t * 6 + Math.PI)) * 0.04

    if (leftLegRef.current) leftLegRef.current.rotation.x = leftSwing
    if (rightLegRef.current) rightLegRef.current.rotation.x = rightSwing
    if (leftFootRef.current) leftFootRef.current.position.z = leftLift + 0.02
    if (rightFootRef.current) rightFootRef.current.position.z = rightLift + 0.02
  })

  return (
    <group>
      <group ref={leftLegRef} position={[-0.05, -0.1, 0]}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.03, 0.024, 0.16, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh ref={leftFootRef} position={[0, -0.17, 0.02]}>
          <sphereGeometry args={[0.032, 8, 6]} />
          <meshStandardMaterial color={accentColor} roughness={0.5} />
        </mesh>
      </group>
      <group ref={rightLegRef} position={[0.05, -0.1, 0]}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.03, 0.024, 0.16, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh ref={rightFootRef} position={[0, -0.17, 0.02]}>
          <sphereGeometry args={[0.032, 8, 6]} />
          <meshStandardMaterial color={accentColor} roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

function SittingLegs({ bodyColor, accentColor }: { bodyColor: THREE.Color; accentColor: THREE.Color }) {
  return (
    <group>
      <group position={[-0.05, -0.1, 0]}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.03, 0.024, 0.16, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.17, 0.02]}>
          <sphereGeometry args={[0.032, 8, 6]} />
          <meshStandardMaterial color={accentColor} roughness={0.5} />
        </mesh>
      </group>
      <group position={[0.05, -0.1, 0]}>
        <mesh position={[0, -0.08, 0]}>
          <cylinderGeometry args={[0.03, 0.024, 0.16, 6]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.17, 0.02]}>
          <sphereGeometry args={[0.032, 8, 6]} />
          <meshStandardMaterial color={accentColor} roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

function CatTail({ bodyColor, isMoving }: { bodyColor: THREE.Color; isMoving: boolean }) {
  const tailRef = useRef<THREE.Group>(null)
  const isMovingRef = useRef(isMoving)
  isMovingRef.current = isMoving

  useFrame((state) => {
    if (tailRef.current) {
      const t = state.clock.elapsedTime
      const moving = isMovingRef.current
      const wagSpeed = moving ? 6 : 2
      const wagAmount = moving ? 0.4 : 0.15
      tailRef.current.rotation.y = Math.sin(t * wagSpeed) * wagAmount
    }
  })

  const tailGeom = useMemo(() => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0.06, -0.06),
      new THREE.Vector3(0.02, 0.12, -0.10),
      new THREE.Vector3(0.04, 0.18, -0.11),
      new THREE.Vector3(0.05, 0.22, -0.08),
    ])

    const tubularSegments = 16
    const radialSegments = 8
    const radiusStart = 0.024
    const radiusEnd = 0.006

    const vertices: number[] = []
    const indices: number[] = []
    const normals: number[] = []

    const frames = curve.computeFrenetFrames(tubularSegments, false)

    for (let i = 0; i <= tubularSegments; i++) {
      const t = i / tubularSegments
      const P = curve.getPoint(t)
      const N = frames.normals[i]
      const B = frames.binormals[i]
      const r = radiusStart + (radiusEnd - radiusStart) * t

      for (let j = 0; j <= radialSegments; j++) {
        const v = (j / radialSegments) * Math.PI * 2
        const sin = Math.sin(v)
        const cos = -Math.cos(v)

        const nx = cos * N.x + sin * B.x
        const ny = cos * N.y + sin * B.y
        const nz = cos * N.z + sin * B.z

        normals.push(nx, ny, nz)
        vertices.push(P.x + r * nx, P.y + r * ny, P.z + r * nz)
      }
    }

    for (let i = 0; i < tubularSegments; i++) {
      for (let j = 0; j < radialSegments; j++) {
        const a = i * (radialSegments + 1) + j
        const b = (i + 1) * (radialSegments + 1) + j
        const c = (i + 1) * (radialSegments + 1) + (j + 1)
        const d = i * (radialSegments + 1) + (j + 1)
        indices.push(a, b, d)
        indices.push(b, c, d)
      }
    }

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3))
    geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3))
    geom.setIndex(indices)
    return geom
  }, [])

  return (
    <group ref={tailRef} position={[0, -0.04, -0.1]}>
      <mesh geometry={tailGeom}>
        <meshStandardMaterial color={bodyColor} roughness={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

const IDLE_ACTIONS = ['idle', 'chat', 'coffee', 'smoke', 'phone'] as const

interface CatModel3DProps {
  role?: string
  variant?: CatVariant
  status?: string
  idleAction?: string
  scale?: number
  onClick?: () => void
  themeAccentColor?: string
}

export function CatModel3D({
  role = 'custom',
  variant,
  status = 'waiting',
  idleAction,
  scale = 1,
  onClick,
  themeAccentColor = '#39bef8',
}: CatModel3DProps) {
  const groupRef = useRef<THREE.Group>(null)
  const catVariant = variant || ROLE_VARIANT[role] || 'orange'
  const colors = VARIANT_COLORS[catVariant]
  const accessoryType = ROLE_ACCESSORY[role] || 'bowtie'

  const bodyColor = useMemo(() => new THREE.Color(colors.body), [colors.body])
  const accentColor = useMemo(() => new THREE.Color(colors.accent), [colors.accent])
  const patchColor = useMemo(() => new THREE.Color(colors.patch), [colors.patch])

  const action = idleAction || IDLE_ACTIONS[Math.abs(hashString(role)) % IDLE_ACTIONS.length]
  const isMoving = status === 'moving'

  useFrame((state) => {
    if (!groupRef.current) return
    const t = state.clock.elapsedTime

    if (status === 'working') {
      groupRef.current.position.y = Math.sin(t * 2) * 0.01
      groupRef.current.rotation.z = 0
      groupRef.current.rotation.x = 0
    } else if (isMoving) {
      groupRef.current.position.y = Math.abs(Math.sin(t * 6)) * 0.015
      groupRef.current.rotation.z = Math.sin(t * 3) * 0.02
      groupRef.current.rotation.x = 0.05
    } else {
      groupRef.current.position.y = Math.sin(t * 1.5) * 0.005
      groupRef.current.rotation.z = 0
      groupRef.current.rotation.x = 0
    }
  })

  const showPatch = catVariant === 'calico' || catVariant === 'tuxedo'

  return (
    <group ref={groupRef} scale={scale} onClick={onClick}>
      <mesh position={[0, -0.02, 0]}>
        <sphereGeometry args={[0.14, 12, 10]} />
        <meshStandardMaterial color={bodyColor} roughness={0.6} />
      </mesh>

      <mesh position={[0, -0.05, 0.1]}>
        <sphereGeometry args={[0.08, 10, 8]} />
        <meshStandardMaterial color={accentColor} roughness={0.6} />
      </mesh>

      {showPatch && (
        <>
          <mesh position={[-0.08, 0.02, 0.08]} rotation={[0, 0.5, 0.3]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color={patchColor} roughness={0.6} />
          </mesh>
          <mesh position={[0.06, -0.04, 0.1]} rotation={[0, -0.3, 0]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color={colors.accent} roughness={0.6} />
          </mesh>
        </>
      )}

      <mesh position={[0, 0.18, 0.02]}>
        <sphereGeometry args={[0.12, 12, 10]} />
        <meshStandardMaterial color={bodyColor} roughness={0.5} />
      </mesh>

      <group position={[-0.07, 0.28, 0]}>
        <mesh rotation={[0, 0, 0.2]}>
          <coneGeometry args={[0.04, 0.08, 4]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.01, 0.01]} rotation={[0, 0, 0.2]}>
          <coneGeometry args={[0.025, 0.05, 4]} />
          <meshStandardMaterial color={colors.ear} roughness={0.5} />
        </mesh>
      </group>

      <group position={[0.07, 0.28, 0]}>
        <mesh rotation={[0, 0, -0.2]}>
          <coneGeometry args={[0.04, 0.08, 4]} />
          <meshStandardMaterial color={bodyColor} roughness={0.5} />
        </mesh>
        <mesh position={[0, -0.01, 0.01]} rotation={[0, 0, -0.2]}>
          <coneGeometry args={[0.025, 0.05, 4]} />
          <meshStandardMaterial color={colors.ear} roughness={0.5} />
        </mesh>
      </group>

      {[[-0.04, 0.2, 0.11], [0.04, 0.2, 0.11]].map((pos, i) => (
        <group key={i} position={pos as [number, number, number]}>
          <mesh position={[0, 0, 0.005]}>
            <sphereGeometry args={[0.022, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#2A2A3E" roughness={0.3} />
          </mesh>
          <mesh position={[0, 0, 0.012]}>
            <sphereGeometry args={[0.014, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#5BA3C9" roughness={0.2} />
          </mesh>
          <mesh position={[0, 0, 0.016]} scale={[0.3, 1, 1]}>
            <sphereGeometry args={[0.01, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#111" roughness={0.2} />
          </mesh>
          <mesh position={[0.003, 0.003, 0.018]}>
            <sphereGeometry args={[0.003, 4, 4]} />
            <meshStandardMaterial color="white" emissive="white" emissiveIntensity={0.3} roughness={0.2} />
          </mesh>
        </group>
      ))}

      <mesh position={[0, 0.15, 0.13]}>
        <sphereGeometry args={[0.012, 6, 6]} />
        <meshStandardMaterial color={colors.nose} roughness={0.4} />
      </mesh>

      <mesh position={[0, 0.13, 0.12]} rotation={[0.2, 0, 0]}>
        <torusGeometry args={[0.015, 0.003, 6, 8, Math.PI]} />
        <meshStandardMaterial color="#5A3A3A" roughness={0.5} />
      </mesh>

      {[[-0.02, 0.14, 0.12], [0.02, 0.14, 0.12]].map((base, i) => (
        <group key={i} position={base as [number, number, number]}>
          {[-0.15, 0, 0.15].map((angle, j) => (
            <mesh key={j} rotation={[angle * 0.5, 0, i === 0 ? -0.3 : 0.3]}>
              <cylinderGeometry args={[0.001, 0.001, 0.08, 4]} />
              <meshStandardMaterial color="#CCC" roughness={0.5} transparent opacity={0.6} />
            </mesh>
          ))}
        </group>
      ))}

      <CatTail bodyColor={bodyColor} isMoving={isMoving} />

      {isMoving ? (
        <WalkingLegs bodyColor={bodyColor} accentColor={accentColor} />
      ) : (
        <SittingLegs bodyColor={bodyColor} accentColor={accentColor} />
      )}

      {status === 'working' ? (
        <TypingArms bodyColor={bodyColor} />
      ) : isMoving ? (
        <WalkingArms bodyColor={bodyColor} idleAction={action} themeAccentColor={themeAccentColor} />
      ) : (
        <IdleArms bodyColor={bodyColor} idleAction={action} themeAccentColor={themeAccentColor} />
      )}

      <CatAccessory type={accessoryType} color="#FFD700" />

      {status === 'working' && (
        <>
          {[[-0.12, 0.28, 0.08], [0.14, 0.24, 0.06], [0.08, 0.32, -0.04]].map((pos, i) => (
            <mesh key={i} position={pos as [number, number, number]}>
              <sphereGeometry args={[0.01, 6, 6]} />
              <meshStandardMaterial
                color={themeAccentColor}
                emissive={themeAccentColor}
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

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash
}

export { CatModel3D as default }
export type { CatVariant }
