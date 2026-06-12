import { useMemo } from 'react'
import * as THREE from 'three'
import type { CatVariant } from './catTypes'
import { VARIANT_COLORS } from './catTypes'

interface CatBodyProps {
  catVariant: CatVariant
  bodyColor: THREE.Color
  accentColor: THREE.Color
}

/** 猫咪身体 — 椭球体，前后略长，更自然的猫体比例 */
export function CatBody({ catVariant, bodyColor, accentColor }: CatBodyProps) {
  const colors = VARIANT_COLORS[catVariant]
  const patchColor = useMemo(() => new THREE.Color(colors.patch), [colors.patch])
  const showPatch = catVariant === 'calico' || catVariant === 'tuxedo'

  return (
    <group>
      {/* 身体 — 头到脚修长（Y轴拉长），左右适中偏窄，前后收敛 */}
      <mesh position={[0, -0.02, 0]} scale={[0.58, 1.25, 0.7]}>
        <sphereGeometry args={[0.14, 12, 10]} />
        <meshStandardMaterial color={bodyColor} roughness={0.6} />
      </mesh>

      {/* 肚子 — 浅色区域，紧贴身体前方 */}
      <mesh position={[0, -0.06, 0.04]} scale={[0.42, 0.8, 0.45]}>
        <sphereGeometry args={[0.1, 10, 8]} />
        <meshStandardMaterial color={accentColor} roughness={0.6} />
      </mesh>

      {/* 花斑 */}
      {showPatch && (
        <>
          <mesh position={[-0.08, 0.02, 0.08]} rotation={[0, 0.5, 0.3]} scale={[0.85, 0.9, 1.1]}>
            <sphereGeometry args={[0.06, 8, 8]} />
            <meshStandardMaterial color={patchColor} roughness={0.6} />
          </mesh>
          <mesh position={[0.06, -0.04, 0.1]} rotation={[0, -0.3, 0]} scale={[0.85, 0.9, 1.1]}>
            <sphereGeometry args={[0.05, 8, 8]} />
            <meshStandardMaterial color={accentColor} roughness={0.6} />
          </mesh>
        </>
      )}
    </group>
  )
}
