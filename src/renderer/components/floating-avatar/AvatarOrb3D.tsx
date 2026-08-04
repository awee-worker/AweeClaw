/**
 * AvatarOrb3D - 悬浮头像 3D 球体组件
 *
 * 基于 @react-three/fiber 实现的动态 3D 球体，作为悬浮头像的核心视觉。
 *
 * 设计要点：
 * - 中心球体：使用 MeshDistortMaterial 实现有机扭曲效果（类豆包水滴感）
 * - 状态映射：不同语音状态对应不同颜色 + 动画速度
 *   · idle       → 紫色，缓慢自转 + 轻微呼吸
 *   · listening  → 蓝色，中速自转 + 音量驱动缩放
 *   · recording  → 翡翠绿，快速脉动 + 强烈扭曲
 *   · processing → 紫罗兰，快速自转 + 高频扭曲（思考中）
 *   · speaking   → 青色，随 TTS 节奏脉动 + 光晕扩散
 *   · error      → 红色，缓慢呼吸 + 警示色
 * - 光晕层：外层透明球体 + 点光源，营造发光效果
 * - 粒子环：围绕球体旋转的小粒子，增强动态感（listening/speaking 时显现）
 * - 性能：低多边形（icosahedron detail=4）、dpr 限制 [1,1.5]、frameSkip 降帧
 *
 * 交互：
 * - 鼠标悬停：球体放大 + 自转加速
 * - 点击：触发 onClick（唤醒/打开对话面板）
 * - 拖拽：由父容器处理（-webkit-app-region 或 IPC drag）
 */

import { useRef, useMemo, useState, useEffect } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { MeshDistortMaterial, Sphere, Float } from '@react-three/drei'
import * as THREE from 'three'
import type { VoiceChatState } from '../../composables/useVoiceChat'

// ============================================
// 状态配色与动画参数
// ============================================

interface OrbVisualConfig {
  /** 主色（球体材质 color） */
  color: string
  /** 自发光颜色 */
  emissive: string
  /** 自发光强度 */
  emissiveIntensity: number
  /** 扭曲速度 */
  distortSpeed: number
  /** 扭曲幅度 */
  distort: number
  /** 自转速度（弧度/秒） */
  rotationSpeed: number
  /** 基础缩放 */
  baseScale: number
  /** 光晕颜色 */
  glowColor: string
  /** 光晕强度 */
  glowIntensity: number
}

const STATE_CONFIG: Record<VoiceChatState, OrbVisualConfig> = {
  idle: {
    color: '#a78bfa',
    emissive: '#7c3aed',
    emissiveIntensity: 0.4,
    distortSpeed: 0.8,
    distort: 0.25,
    rotationSpeed: 0.3,
    baseScale: 1.0,
    glowColor: '#8b5cf6',
    glowIntensity: 0.6,
  },
  connecting: {
    color: '#fbbf24',
    emissive: '#f59e0b',
    emissiveIntensity: 0.5,
    distortSpeed: 1.5,
    distort: 0.3,
    rotationSpeed: 0.8,
    baseScale: 1.0,
    glowColor: '#f59e0b',
    glowIntensity: 0.7,
  },
  listening: {
    color: '#60a5fa',
    emissive: '#2563eb',
    emissiveIntensity: 0.6,
    distortSpeed: 1.2,
    distort: 0.3,
    rotationSpeed: 0.6,
    baseScale: 1.05,
    glowColor: '#3b82f6',
    glowIntensity: 0.9,
  },
  recording: {
    color: '#34d399',
    emissive: '#059669',
    emissiveIntensity: 0.7,
    distortSpeed: 2.0,
    distort: 0.4,
    rotationSpeed: 1.0,
    baseScale: 1.1,
    glowColor: '#10b981',
    glowIntensity: 1.0,
  },
  processing: {
    color: '#c084fc',
    emissive: '#9333ea',
    emissiveIntensity: 0.7,
    distortSpeed: 2.5,
    distort: 0.45,
    rotationSpeed: 1.5,
    baseScale: 1.05,
    glowColor: '#a855f7',
    glowIntensity: 0.9,
  },
  speaking: {
    color: '#22d3ee',
    emissive: '#0891b2',
    emissiveIntensity: 0.7,
    distortSpeed: 1.8,
    distort: 0.35,
    rotationSpeed: 1.2,
    baseScale: 1.08,
    glowColor: '#06b6d4',
    glowIntensity: 1.0,
  },
  error: {
    color: '#f87171',
    emissive: '#dc2626',
    emissiveIntensity: 0.5,
    distortSpeed: 0.5,
    distort: 0.3,
    rotationSpeed: 0.2,
    baseScale: 1.0,
    glowColor: '#ef4444',
    glowIntensity: 0.7,
  },
}

// ============================================
// 3D 子组件
// ============================================

interface OrbMeshProps {
  state: VoiceChatState
  volume: number
  isHovered: boolean
  onClick: () => void
}

/**
 * 中心球体 + 光晕 + 粒子环
 *
 * 使用 useFrame 每帧更新：
 * - 旋转角度
 * - 缩放（基于 volume + 状态基础缩放 + 悬停放大）
 * - 材质参数过渡（平滑切换状态，避免突变）
 */
function OrbMesh({ state, volume, isHovered, onClick }: OrbMeshProps) {
  const groupRef = useRef<THREE.Group>(null)
  const meshRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const materialRef = useRef<any>(null)
  const glowMaterialRef = useRef<any>(null)

  const config = STATE_CONFIG[state] || STATE_CONFIG.idle

  // 平滑过渡的材质参数（lerp 避免状态切换时颜色突变）
  const targetColor = useMemo(() => new THREE.Color(config.color), [config.color])
  const targetEmissive = useMemo(() => new THREE.Color(config.emissive), [config.emissive])
  const targetGlowColor = useMemo(() => new THREE.Color(config.glowColor), [config.glowColor])

  useFrame((_, delta) => {
    if (!groupRef.current || !meshRef.current) return

    // 自转
    groupRef.current.rotation.y += config.rotationSpeed * delta
    groupRef.current.rotation.x += config.rotationSpeed * 0.3 * delta

    // 音量驱动的缩放（listening/speaking 时显著，其他状态轻微呼吸）
    const volumeScale = state === 'listening' || state === 'recording' || state === 'speaking'
      ? Math.min(volume * 2.5, 0.25)
      : Math.sin(Date.now() * 0.002) * 0.03 // 待机呼吸

    const hoverScale = isHovered ? 0.08 : 0
    const targetScale = config.baseScale + volumeScale + hoverScale
    const currentScale = groupRef.current.scale.x
    const nextScale = THREE.MathUtils.lerp(currentScale, targetScale, 0.15)
    groupRef.current.scale.setScalar(nextScale)

    // 材质颜色平滑过渡
    if (materialRef.current) {
      materialRef.current.color.lerp(targetColor, 0.1)
      materialRef.current.emissive.lerp(targetEmissive, 0.1)
      materialRef.current.emissiveIntensity = THREE.MathUtils.lerp(
        materialRef.current.emissiveIntensity || 0,
        config.emissiveIntensity,
        0.1,
      )
      materialRef.current.distort = THREE.MathUtils.lerp(
        materialRef.current.distort || 0,
        config.distort,
        0.1,
      )
      materialRef.current.speed = THREE.MathUtils.lerp(
        materialRef.current.speed || 0,
        config.distortSpeed,
        0.1,
      )
    }

    // 光晕跟随
    if (glowMaterialRef.current) {
      glowMaterialRef.current.color.lerp(targetGlowColor, 0.1)
      glowMaterialRef.current.opacity = THREE.MathUtils.lerp(
        glowMaterialRef.current.opacity || 0,
        config.glowIntensity * (0.6 + volumeScale * 2),
        0.1,
      )
    }

    // 光晕球体脉动
    if (glowRef.current) {
      const glowScale = 1.3 + Math.sin(Date.now() * 0.003) * 0.05 + volumeScale * 0.5
      glowRef.current.scale.setScalar(glowScale)
    }
  })

  return (
    <group ref={groupRef} onClick={onClick}>
      {/* 中心球体（扭曲材质） */}
      <Sphere ref={meshRef} args={[1, 48, 48]}>
        <MeshDistortMaterial
          ref={materialRef}
          color={config.color}
          emissive={config.emissive}
          emissiveIntensity={config.emissiveIntensity}
          roughness={0.2}
          metalness={0.1}
          distort={config.distort}
          speed={config.distortSpeed}
          transparent
          opacity={0.92}
        />
      </Sphere>

      {/* 外层光晕（透明大球，反向法线，背面渲染） */}
      <Sphere ref={glowRef} args={[1.3, 32, 32]}>
        <meshBasicMaterial
          ref={glowMaterialRef}
          color={config.glowColor}
          transparent
          opacity={config.glowIntensity * 0.5}
          side={THREE.BackSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </Sphere>

      {/* 内层高光（小亮球，营造核心发光点） */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.35, 24, 24]} />
        <meshBasicMaterial
          color={config.color}
          transparent
          opacity={0.4}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </group>
  )
}

/**
 * 环绕粒子环（listening/speaking 时显现）
 *
 * 使用 Points + BufferGeometry，围绕球体旋转。
 * 性能：仅 60 个粒子，单 draw call。
 */
function ParticleRing({ state, volume }: { state: VoiceChatState; volume: number }) {
  const pointsRef = useRef<THREE.Points>(null)

  const isActive = state === 'listening' || state === 'speaking' || state === 'recording'

  // 生成粒子位置（环状分布）
  const positions = useMemo(() => {
    const count = 60
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2
      const radius = 1.6 + Math.random() * 0.3
      const y = (Math.random() - 0.5) * 0.4
      arr[i * 3] = Math.cos(angle) * radius
      arr[i * 3 + 1] = y
      arr[i * 3 + 2] = Math.sin(angle) * radius
    }
    return arr
  }, [])

  useFrame((_, delta) => {
    if (!pointsRef.current) return
    pointsRef.current.rotation.y += delta * 0.5
    pointsRef.current.rotation.z += delta * 0.2

    // 音量驱动粒子缩放
    const scale = isActive ? 1 + volume * 1.5 : 0.7
    pointsRef.current.scale.setScalar(THREE.MathUtils.lerp(pointsRef.current.scale.x, scale, 0.1))
  })

  if (!isActive) return null

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        color={STATE_CONFIG[state]?.glowColor || '#8b5cf6'}
        size={0.08}
        transparent
        opacity={0.8}
        sizeAttenuation
        blending={THREE.AdditiveBlending}
        depthWrite={false}
      />
    </points>
  )
}

// ============================================
// WebGL 检测
// ============================================

function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
    )
  } catch {
    return false
  }
}

// ============================================
// 2D 降级组件
// ============================================

/** WebGL 不可用时的 2D 降级球体（CSS 实现） */
function FallbackOrb2D({
  state,
  volume,
  isHovered,
  onClick,
}: {
  state: VoiceChatState
  volume: number
  isHovered: boolean
  onClick: () => void
}) {
  const config = STATE_CONFIG[state] || STATE_CONFIG.idle
  const scale = config.baseScale + (isHovered ? 0.08 : 0) + Math.min(volume * 2, 0.2)

  return (
    <div
      onClick={onClick}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      <div
        style={{
          width: '72%',
          height: '72%',
          borderRadius: '50%',
          background: `radial-gradient(circle at 35% 30%, ${config.color} 0%, ${config.emissive} 55%, ${config.glowColor} 100%)`,
          boxShadow: `0 0 24px ${config.glowColor}, 0 0 48px ${config.glowColor}80`,
          transform: `scale(${scale})`,
          transition: 'transform 0.15s ease-out, background 0.4s ease, box-shadow 0.4s ease',
          animation: 'avatar-breathe 3s ease-in-out infinite',
        }}
      />
      <style>{`
        @keyframes avatar-breathe {
          0%, 100% { transform: scale(${scale}); }
          50% { transform: scale(${scale * 1.05}); }
        }
      `}</style>
    </div>
  )
}

// ============================================
// 主组件
// ============================================

export interface AvatarOrb3DProps {
  /** 当前语音状态 */
  state: VoiceChatState
  /** 实时音量（0-1） */
  volume: number
  /** 鼠标是否悬停 */
  isHovered: boolean
  /** 点击回调（唤醒/打开对话） */
  onClick: () => void
}

/**
 * 悬浮头像 3D 球体
 *
 * 自动检测 WebGL，不可用时降级为 2D CSS 球体。
 * Canvas 透明背景，适配 BrowserWindow transparent:true。
 */
export function AvatarOrb3D({ state, volume, isHovered, onClick }: AvatarOrb3DProps) {
  const [webglAvailable, setWebglAvailable] = useState(true)

  useEffect(() => {
    setWebglAvailable(isWebGLAvailable())
  }, [])

  if (!webglAvailable) {
    return <FallbackOrb2D state={state} volume={volume} isHovered={isHovered} onClick={onClick} />
  }

  return (
    <Canvas
      camera={{ position: [0, 0, 4], fov: 50 }}
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: 'low-power',
      }}
      dpr={[1, 1.5]}
      style={{
        width: '100%',
        height: '100%',
        background: 'transparent',
        cursor: 'pointer',
      }}
      onPointerMissed={() => {
        // 点击空白处不触发 onClick（由 OrbMesh 的 onClick 处理）
      }}
    >
      {/* 环境光 + 点光源 */}
      <ambientLight intensity={0.4} />
      <pointLight position={[3, 3, 3]} intensity={1.2} color="#ffffff" />
      <pointLight position={[-3, -2, 2]} intensity={0.6} color={STATE_CONFIG[state]?.glowColor || '#8b5cf6'} />

      {/* 浮动包装器（轻微上下浮动，增强生命感） */}
      <Float speed={1.5} rotationIntensity={0.2} floatIntensity={0.3}>
        <OrbMesh state={state} volume={volume} isHovered={isHovered} onClick={onClick} />
        <ParticleRing state={state} volume={volume} />
      </Float>
    </Canvas>
  )
}
