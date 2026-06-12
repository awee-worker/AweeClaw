import { SCENE_COLORS } from './officeConfig'

/** 办公室地板和墙壁 */
export function OfficeFloor() {
  return (
    <group>
      {/* 地板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[12, 10]} />
        <meshStandardMaterial color={SCENE_COLORS.floor} roughness={0.8} />
      </mesh>

      {/* 地板网格线 */}
      <gridHelper args={[12, 24, SCENE_COLORS.floorGrid, SCENE_COLORS.floorGrid]} position={[0, 0.001, 0]} />

      {/* 后墙 */}
      <mesh position={[0, 2.5, -5]} receiveShadow>
        <planeGeometry args={[12, 5]} />
        <meshStandardMaterial color={SCENE_COLORS.wall} roughness={0.9} />
      </mesh>

      {/* 左墙 */}
      <mesh position={[-6, 2.5, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color={SCENE_COLORS.wall} roughness={0.9} />
      </mesh>

      {/* 右墙 */}
      <mesh position={[6, 2.5, 0]} rotation={[0, -Math.PI / 2, 0]} receiveShadow>
        <planeGeometry args={[10, 5]} />
        <meshStandardMaterial color={SCENE_COLORS.wall} roughness={0.9} />
      </mesh>

      {/* 踢脚线 */}
      <mesh position={[0, 0.05, -4.98]}>
        <boxGeometry args={[12, 0.1, 0.04]} />
        <meshStandardMaterial color={SCENE_COLORS.wallAccent} roughness={0.7} />
      </mesh>
    </group>
  )
}
