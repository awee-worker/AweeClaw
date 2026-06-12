import * as THREE from 'three'

interface CatAccessoriesProps {
  accessory: string
  bodyColor: THREE.Color
}

/** 领结 */
function Bowtie({ color }: { color: string }) {
  return (
    <group position={[0, 0.56, 0.1]}>
      <mesh position={[-0.025, 0, 0]}>
        <octahedronGeometry args={[0.02, 0]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      <mesh position={[0.025, 0, 0]}>
        <octahedronGeometry args={[0.02, 0]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
      <mesh>
        <sphereGeometry args={[0.008, 6, 6]} />
        <meshStandardMaterial color={color} roughness={0.4} />
      </mesh>
    </group>
  )
}

/** 眼镜 */
function Glasses() {
  return (
    <group position={[0, 0.74, 0.1]}>
      {[-0.04, 0.04].map((x, i) => (
        <mesh key={i} position={[x, 0, 0]}>
          <torusGeometry args={[0.025, 0.003, 6, 12]} />
          <meshStandardMaterial color="#333" roughness={0.3} metalness={0.5} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[0.002, 0.002, 0.08, 4]} />
        <meshStandardMaterial color="#333" roughness={0.3} metalness={0.5} />
      </mesh>
    </group>
  )
}

/** 贝雷帽 */
function Beret({ color }: { color: string }) {
  return (
    <group position={[0, 0.85, -0.02]}>
      <mesh scale={[1.2, 0.5, 1.1]}>
        <sphereGeometry args={[0.08, 10, 8]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
      <mesh position={[0, 0.03, 0]}>
        <sphereGeometry args={[0.01, 6, 6]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
    </group>
  )
}

/** 围巾 */
function Scarf({ color }: { color: string }) {
  return (
    <group position={[0, 0.56, 0.08]}>
      <mesh rotation={[0.3, 0, 0]}>
        <torusGeometry args={[0.06, 0.015, 6, 12]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      <mesh position={[0.04, -0.04, 0.04]} rotation={[0.2, 0, 0.3]}>
        <boxGeometry args={[0.02, 0.06, 0.01]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
    </group>
  )
}

/** 安全帽 */
function HardHat({ color }: { color: string }) {
  return (
    <group position={[0, 0.87, 0]}>
      <mesh scale={[1.1, 0.6, 1]}>
        <sphereGeometry args={[0.09, 10, 8]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[0, -0.03, 0]} scale={[1.3, 0.3, 1.2]}>
        <sphereGeometry args={[0.08, 10, 8]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.2} />
      </mesh>
    </group>
  )
}

/** 剪贴板 */
function Clipboard() {
  return (
    <group position={[0.14, 0.4, 0.08]} rotation={[0.5, 0, -0.3]}>
      <mesh>
        <boxGeometry args={[0.06, 0.08, 0.003]} />
        <meshStandardMaterial color="#8B6F47" roughness={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0.002]}>
        <planeGeometry args={[0.04, 0.05]} />
        <meshStandardMaterial color="#F5F0E8" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0.04, 0.002]}>
        <boxGeometry args={[0.03, 0.005, 0.005]} />
        <meshStandardMaterial color="#666" roughness={0.5} metalness={0.3} />
      </mesh>
    </group>
  )
}

/** 猫咪配饰 — 根据角色显示不同配饰 */
export function CatAccessories({ accessory }: CatAccessoriesProps) {
  switch (accessory) {
    case 'bowtie':
      return <Bowtie color="#C0392B" />
    case 'glasses':
      return <Glasses />
    case 'beret':
      return <Beret color="#8E44AD" />
    case 'scarf':
      return <Scarf color="#2980B9" />
    case 'hardhat':
      return <HardHat color="#F39C12" />
    case 'clipboard':
      return <Clipboard />
    default:
      return null
  }
}
