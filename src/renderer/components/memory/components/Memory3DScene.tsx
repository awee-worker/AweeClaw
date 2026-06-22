/**
 * 记忆 3D 可视化场景
 * 基于 Three.js 实现大脑粒子模型、记忆节点、时间轴
 * 支持 WebGL 降级到 Canvas 2D
 */
import { useEffect, useRef, useState, useMemo, Suspense } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Html } from '@react-three/drei'
import * as THREE from 'three'
import { Loader2, AlertTriangle, Maximize2, Minimize2, RefreshCw } from 'lucide-react'
import { useMemoryStore } from '../store'
import { CATEGORY_META, type VisualizationNode, type VisualizationEdge } from '../types'

// ============ WebGL 检测 ============
function isWebGLAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl')))
  } catch {
    return false
  }
}

// ============ 主组件 ============
export function Memory3DScene() {
  const { visualizationData, fetchVisualizationData } = useMemoryStore()
  const [webglAvailable] = useState(isWebGLAvailable)
  const [fullscreen, setFullscreen] = useState(false)
  const [hovering, setHovering] = useState(false)

  useEffect(() => {
    fetchVisualizationData()
  }, [fetchVisualizationData])

  if (!webglAvailable) {
    return <FallbackCanvas2D />
  }

  return (
    <div className={`relative w-full h-full overflow-hidden bg-black ${fullscreen ? 'fixed inset-0 z-50' : ''}`}>
      {/* 顶部控制栏 */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2">
        <button
          onClick={() => fetchVisualizationData()}
          className="p-2 rounded-lg bg-white/5 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          title="刷新"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={() => setFullscreen((f) => !f)}
          className="p-2 rounded-lg bg-white/5 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          title={fullscreen ? '退出全屏' : '全屏'}
        >
          {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
      </div>

      {/* 加载状态 */}
      {!visualizationData && (
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <div className="flex items-center gap-2 text-white/70 text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            加载 3D 场景...
          </div>
        </div>
      )}

      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 0, 8], fov: 60 }}
        gl={{ antialias: true, alpha: true }}
        dpr={[1, 2]}
        onPointerOver={() => setHovering(true)}
        onPointerOut={() => setHovering(false)}
      >
        <Suspense fallback={null}>
          {/* 夜空星空背景 */}
          <StarField />

          {/* 光照：为记忆节点提供照明（粒子点云不受光照影响） */}
          <ambientLight intensity={0.4} color="#8899bb" />
          <pointLight position={[8, 6, 8]} intensity={1.0} color="#fff5ee" />
          <pointLight position={[-5, -2, 3]} intensity={0.4} color="#c8d8f0" />

          {/* 大脑粒子模型 */}
          <BrainParticleModel />

          {/* 记忆节点 */}
          {visualizationData && (
            <MemoryNodes
              nodes={visualizationData.nodes}
              edges={visualizationData.edges}
            />
          )}

          {/* 相机控制：鼠标悬停时停止自动旋转 */}
          <OrbitControls
            enablePan={false}
            minDistance={4}
            maxDistance={20}
            autoRotate={!hovering}
            autoRotateSpeed={0.3}
          />
        </Suspense>
      </Canvas>

      {/* 图例 */}
      <SceneLegend />

      {/* 统计信息 */}
      {visualizationData && (
        <div className="absolute bottom-3 left-3 z-10 px-3 py-2 rounded-lg bg-white/5 backdrop-blur border border-white/10 text-xs">
          <div className="flex items-center gap-3 text-white/60">
            <span>节点: <span className="text-white font-mono">{visualizationData.nodes.length}</span></span>
            <span>关联: <span className="text-white font-mono">{visualizationData.edges.length}</span></span>
            <span>平均重要性: <span className="text-blue-400 font-mono">{((visualizationData.meta.avgImportance ?? 0) * 100).toFixed(0)}%</span></span>
          </div>
        </div>
      )}
    </div>
  )
}

// ============ 夜空星空背景 ============
function StarField() {
  const pointsRef = useRef<THREE.Points>(null)

  // 生成星星：远处的静态星空 + 近处的闪烁星
  const { positions, colors, sizes } = useMemo(() => {
    const count = 2000
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const sizes = new Float32Array(count)

    for (let i = 0; i < count; i++) {
      // 球面随机分布，半径足够大以包裹整个场景
      const r = 40 + Math.random() * 20
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      positions[i * 3 + 2] = r * Math.cos(phi)

      // 星星颜色：白色、淡蓝、淡黄、淡紫
      const colorType = Math.random()
      if (colorType < 0.6) {
        // 白色星（ majority）
        const brightness = 0.7 + Math.random() * 0.3
        colors[i * 3] = brightness
        colors[i * 3 + 1] = brightness
        colors[i * 3 + 2] = brightness
      } else if (colorType < 0.8) {
        // 淡蓝星
        colors[i * 3] = 0.6
        colors[i * 3 + 1] = 0.8
        colors[i * 3 + 2] = 1.0
      } else if (colorType < 0.95) {
        // 淡黄星
        colors[i * 3] = 1.0
        colors[i * 3 + 1] = 0.9
        colors[i * 3 + 2] = 0.6
      } else {
        // 淡紫星
        colors[i * 3] = 0.8
        colors[i * 3 + 1] = 0.6
        colors[i * 3 + 2] = 1.0
      }

      // 星星大小：大部分小，少数大
      sizes[i] = Math.random() < 0.05 ? 0.15 + Math.random() * 0.1 : 0.03 + Math.random() * 0.05
    }

    return { positions, colors, sizes }
  }, [])

  useFrame((state) => {
    if (pointsRef.current) {
      // 缓慢旋转星空
      pointsRef.current.rotation.y = state.clock.elapsedTime * 0.005
      pointsRef.current.rotation.x = state.clock.elapsedTime * 0.002
    }
  })

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={colors.length / 3}
          array={colors}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-size"
          count={sizes.length}
          array={sizes}
          itemSize={1}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.08}
        vertexColors
        transparent
        opacity={0.9}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

// ============ 圆形点纹理（程序化生成） ============
/**
 * 生成一个径向渐变的圆形 Sprite 纹理
 * 用于 PointsMaterial，使每个粒子渲染为柔和的圆点而非方块
 */
function createCircleTexture(): THREE.Texture {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  )
  gradient.addColorStop(0.0, 'rgba(255,255,255,1.0)')
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.85)')
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.35)')
  gradient.addColorStop(1.0, 'rgba(255,255,255,0.0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, size, size)
  const tex = new THREE.CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

// ============ 脑回褶皱计算（核心算法） ============
/**
 * 计算脑表面褶皱位移量
 *
 * 优化点：
 *  - 5 层倍频（新增超高频层），褶皱细节更丰富
 *  - 双轴 domain warping（x + z 方向），脑回走向更自然
 *  - 3 条主要解剖沟（中央沟 + 外侧裂 + 顶枕沟）
 *
 * @returns 位移值，正值 = 向外凸（脑回），负值 = 向内凹（脑沟）
 */
function computeBrainFold(x: number, y: number, z: number): number {
  // Domain warping —— 双轴蜿蜒
  const warp1 = Math.sin(z * 0.65 + y * 0.45) * 1.3
  const warp2 = Math.cos(z * 0.85 - x * 0.35) * 0.8
  const warp3 = Math.sin(z * 1.1 + y * 0.6) * 0.5
  const warp4 = Math.cos(x * 0.5 + z * 0.8) * 0.6

  // 第 1 层：主沟（低频大振幅，约 6-7 条主脑回）
  const g1 = 1.0 - Math.abs(Math.sin(x * 5.2 + warp1))
  const fold1 = (g1 - 0.38) * 0.14

  // 第 2 层：分支沟（中频，在主沟之间分叉）
  const g2 = 1.0 - Math.abs(Math.sin(x * 11.0 + warp2 + y * 0.5))
  const fold2 = (g2 - 0.38) * 0.065

  // 第 3 层：细纹（高频，丰富表面细节）
  const g3 = 1.0 - Math.abs(Math.sin(x * 22.0 + warp3 + z * 0.3))
  const fold3 = (g3 - 0.4) * 0.03

  // 第 4 层：微细纹（超高频，最浅的纹理）
  const g4 = 1.0 - Math.abs(Math.sin(x * 38.0 + warp4 * 0.8))
  const fold4 = (g4 - 0.42) * 0.014

  // 第 5 层：纳米级纹理（新增，让表面更"活"）
  const g5 = 1.0 - Math.abs(Math.sin(x * 60.0 + z * 2.0 + warp1 * 0.3))
  const fold5 = (g5 - 0.44) * 0.006

  let fold = fold1 + fold2 + fold3 + fold4 + fold5

  // 中央沟（central sulcus）：额叶与顶叶之间的主要沟
  const centralZ = z * 0.35 + x * 0.15
  if (centralZ > -0.3 && centralZ < 1.15 && y > -0.6) {
    const cs = Math.exp(-Math.pow(centralZ - 0.4, 2) * 6.0) * (1.0 - Math.abs(y) * 0.3)
    fold -= cs * 0.1
  }

  // 外侧裂（Sylvian fissure）：颞叶与额/顶叶之间的水平沟
  const absX = Math.abs(x)
  if (absX > 0.6 && y > -0.5 && y < 0.4) {
    const sf = Math.exp(-Math.pow(y + 0.05, 2) * 18.0) * ((absX - 0.6) / 2.0)
    fold -= Math.min(sf, 1.0) * 0.08
  }

  // 顶枕沟（parieto-occipital fissure）：后部半球的横沟
  if (z < -1.0 && z > -2.5 && y > -0.2) {
    const po = Math.exp(-Math.pow(z + 1.8, 2) * 4.0) * (1.0 - Math.abs(y) * 0.4)
    fold -= po * 0.06
  }

  return fold
}

// ============ 脑表面点采样 ============
/**
 * 将球面上的一个点变换到脑表面上的对应位置
 *
 * 流程：
 *  1. 按脑比例缩放
 *  2. 半球分割 + 纵裂
 *  3. 整体形状调整（顶平、底平、额叶收窄等）
 *  4. 脑回褶皱位移
 *
 * @param dir  球面上的单位方向向量
 * @param side 左/右半球
 * @returns [x, y, z] 脑表面坐标 + fold 值
 */
function sampleBrainSurface(
  dx: number, dy: number, dz: number,
  side: 'left' | 'right',
): { pos: [number, number, number]; fold: number } {
  // 接近球形的比例：略微竖长
  const scaleX = 2.6   // 左右宽
  const scaleY = 3.0   // 上下略高
  const scaleZ = 2.8   // 前后长

  let x = dx * scaleX
  let y = dy * scaleY
  let z = dz * scaleZ

  const nx = dx, ny = dy, nz = dz

  // 上大下小微收：底部仅比顶部小 15%
  const yNorm = y / scaleY  // -1 ~ 1
  const taper = 1.0 - (1.0 - yNorm) * 0.5 * 0.15  // 底部最多收窄到 85%
  x *= taper
  z *= taper

  // 半球分割
  if (side === 'left' && x > 0.05) { x = 0.05 }
  if (side === 'right' && x < -0.05) { x = -0.05 }

  // 纵裂
  const absX = Math.abs(x)
  if (absX < 0.5) {
    const t = (0.5 - absX) / 0.5
    const cleftDepth = t * t * 0.38
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    x -= (nx / nLen) * cleftDepth * 0.6
    y -= (ny / nLen) * cleftDepth * 0.3
    z -= (nz / nLen) * cleftDepth * 0.3
  }

  // 顶部略圆收（保持椭圆轮廓，不做强压平）
  if (y > 2.5) {
    const f = (y - 2.5) / (scaleY - 2.5)
    y -= f * f * 0.2
  }

  // 底部略收
  if (y < -2.5) {
    const f = (-2.5 - y) / (scaleY + 2.5)
    y += f * f * 0.2
  }

  // 前部（额叶）微收
  if (z > 1.8) {
    const f = (z - 1.8) / (scaleZ - 1.8)
    x *= 1.0 - f * 0.25
    y *= 1.0 - f * 0.1
  }

  // 后部（枕叶）微收
  if (z < -1.8) {
    const f = (-z - 1.8) / (scaleZ - 1.8)
    x *= 1.0 - f * 0.2
    y *= 1.0 - f * 0.08
  }

  // 脑回褶皱
  const fold = computeBrainFold(x, y, z)
  const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
  x += (nx / nLen) * fold * 0.7
  y += (ny / nLen) * fold * 0.7
  z += (nz / nLen) * fold * 0.7

  return { pos: [x, y, z], fold }
}

// ============ Fibonacci 球面采样 ============
/**
 * Fibonacci 螺旋分布：在球面上均匀生成 N 个点
 * 比随机分布更均匀，比经纬度网格无极点聚集
 */
function fibonacciSphere(n: number): Array<[number, number, number]> {
  const points: Array<[number, number, number]> = []
  const phi = Math.PI * (3 - Math.sqrt(5)) // 黄金角
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2 // y: 1 → -1
    const radius = Math.sqrt(1 - y * y)
    const theta = phi * i
    const x = Math.cos(theta) * radius
    const z = Math.sin(theta) * radius
    points.push([x, y, z])
  }
  return points
}

// ============ 大脑粒子点云生成 ============
interface BrainPointCloud {
  positions: Float32Array
  colors: Float32Array
  sizes: Float32Array
  activity: Float32Array  // 神经元活动相位（用于脉冲动画）
  count: number
}

/**
 * 生成大脑粒子点云数据
 *
 * 仅包含左右大脑半球（cerebrum），不含小脑和脑干。
 *
 * 组成：
 *  - 左半球表面点（~12000，密度提升）
 *  - 右半球表面点（~12000）
 *  - 内部填充点（~5000，增加体积感）
 */
function generateBrainPointCloud(): BrainPointCloud {
  const positions: number[] = []
  const colors: number[] = []
  const sizes: number[] = []
  const activity: number[] = []

  // ---- 左半球 ----
  const leftPts = fibonacciSphere(12000)
  for (const [dx, dy, dz] of leftPts) {
    if (dx > 0.02) continue
    const { pos, fold } = sampleBrainSurface(dx, dy, dz, 'left')
    positions.push(...pos)
    // 着色：脑回凸起处偏暖粉白，脑沟深处偏冷暗紫
    const brightness = 0.5 + fold * 3.5
    const warmth = Math.max(0, fold * 2.0) // 脑回偏暖
    colors.push(
      Math.min(1.0, 0.92 + brightness * 0.08),
      Math.min(1.0, 0.52 + brightness * 0.25 + warmth * 0.05),
      Math.min(1.0, 0.65 + brightness * 0.18 - warmth * 0.03),
    )
    sizes.push(0.04 + Math.random() * 0.025)
    activity.push(Math.random() * Math.PI * 2)
  }

  // ---- 右半球 ----
  const rightPts = fibonacciSphere(12000)
  for (const [dx, dy, dz] of rightPts) {
    if (dx < -0.02) continue
    const { pos, fold } = sampleBrainSurface(dx, dy, dz, 'right')
    positions.push(...pos)
    const brightness = 0.5 + fold * 3.5
    const warmth = Math.max(0, fold * 2.0)
    colors.push(
      Math.min(1.0, 0.92 + brightness * 0.08),
      Math.min(1.0, 0.52 + brightness * 0.25 + warmth * 0.05),
      Math.min(1.0, 0.65 + brightness * 0.18 - warmth * 0.03),
    )
    sizes.push(0.04 + Math.random() * 0.025)
    activity.push(Math.random() * Math.PI * 2)
  }

  // ---- 内部填充点（增加体积感） ----
  for (let i = 0; i < 5000; i++) {
    const side = i % 2 === 0 ? -1 : 1
    const r = Math.cbrt(Math.random()) * 2.2
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const x = side * Math.abs(Math.sin(phi) * Math.cos(theta)) * r * 1.3
    const y = Math.sin(phi) * Math.sin(theta) * r * 1.5
    const z = Math.cos(phi) * r * 1.4

    // 椭球轮廓剔除
    const dist = Math.sqrt((x / 2.6) ** 2 + (y / 3.0) ** 2 + (z / 2.8) ** 2)
    if (dist > 0.88) continue

    positions.push(x, y, z)
    // 内部点偏暗，模拟脑灰质深部
    const dim = 0.25 + Math.random() * 0.2
    colors.push(0.55 * dim, 0.32 * dim, 0.48 * dim)
    sizes.push(0.022 + Math.random() * 0.012)
    activity.push(Math.random() * Math.PI * 2)
  }

  return {
    positions: new Float32Array(positions),
    colors: new Float32Array(colors),
    sizes: new Float32Array(sizes),
    activity: new Float32Array(activity),
    count: positions.length / 3,
  }
}

// ============ 大脑粒子模型组件 ============
/**
 * 人脑粒子点云模型
 *
 * 使用 Fibonacci 球面采样在脑表面均匀分布粒子，
 * 通过脑回褶皱算法让粒子沿真实脑沟脑回分布，
 * 配合神经活动脉冲动画，呈现活的"点状大脑"效果。
 */
function BrainParticleModel() {
  const groupRef = useRef<THREE.Group>(null)

  const circleTexture = useMemo(() => createCircleTexture(), [])
  const cloud = useMemo(() => generateBrainPointCloud(), [])

  // 命令式创建几何体，直接持有 attribute 引用以便动画修改
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(cloud.positions, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(cloud.colors, 3))
    geo.setAttribute('size', new THREE.BufferAttribute(cloud.sizes, 1))
    return geo
  }, [cloud])

  // 持有 size attribute 的引用，用于每帧更新
  const sizeAttr = geometry.getAttribute('size') as THREE.BufferAttribute

  useFrame((state) => {
    const time = state.clock.elapsedTime

    // 整体旋转 + 呼吸缩放
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(time * 0.12) * 0.25 + time * 0.04
      groupRef.current.rotation.x = Math.sin(time * 0.08) * 0.04
      const scale = 1 + Math.sin(time * 0.6) * 0.008
      groupRef.current.scale.set(scale, scale, scale)
    }

    // 神经活动脉冲：动态调整每个粒子的大小
    // 使用稀疏放电模式（pow 8），大部分粒子保持基础大小，
    // 少量粒子随机变亮，模拟神经元放电
    for (let i = 0; i < cloud.count; i++) {
      const phase = cloud.activity[i]
      const pulse = Math.sin(time * 2.0 + phase) * 0.5 + 0.5 // 0~1
      const fire = Math.pow(pulse, 8) * 0.04
      sizeAttr.setX(i, cloud.sizes[i] + fire)
    }
    sizeAttr.needsUpdate = true
  })

  // 组件卸载时释放几何体
  useEffect(() => {
    return () => geometry.dispose()
  }, [geometry])

  return (
    <group ref={groupRef}>
      <points geometry={geometry}>
        <pointsMaterial
          size={0.06}
          map={circleTexture}
          vertexColors
          transparent
          opacity={0.85}
          sizeAttenuation
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  )
}

// ============ 记忆节点 ============
interface MemoryNodesProps {
  nodes: VisualizationNode[]
  edges: VisualizationEdge[]
}

// 大脑椭球尺寸（与 sampleBrainSurface 保持一致）
const BRAIN_SCALE_X = 2.6
const BRAIN_SCALE_Y = 3.0
const BRAIN_SCALE_Z = 2.8

/**
 * 为每个分类生成一个固定的"区域中心方向"
 * 相近分类的中心方向也接近，让同类记忆在脑上聚拢
 */
const CATEGORY_DIRECTIONS: Record<string, [number, number, number]> = {
  LIFE:         [ 0.3,  0.6,  0.4],
  WORK:         [-0.4, 0.5, -0.3],
  PEOPLE:       [ 0.5, 0.2,  0.5],
  KNOWLEDGE:    [-0.5, 0.6,  0.4],
  PREFERENCE:   [ 0.4, -0.2, 0.6],
  EVENT:        [-0.3, -0.3, -0.5],
  EMOTION:      [ 0.2, 0.7, -0.4],
  FINANCE:      [-0.5, -0.4, 0.3],
  UNCATEGORIZED:[ 0.0, -0.6, -0.2],
}

function normalizeVec3(v: [number, number, number]): [number, number, number] {
  const len = Math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2) || 1
  return [v[0] / len, v[1] / len, v[2] / len]
}

function MemoryNodes({ nodes, edges }: MemoryNodesProps) {
  const [hovered, setHovered] = useState<string | null>(null)
  const groupRef = useRef<THREE.Group>(null)

  // 限制显示节点数量（性能考虑）
  const displayNodes = useMemo(() => nodes.slice(0, 80), [nodes])

  const displayEdges = useMemo(() => {
    const nodeIds = new Set(displayNodes.map((n) => n.id))
    return edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target)).slice(0, 100)
  }, [edges, displayNodes])

  /**
   * 节点位置：定位在大脑椭球表面或浅层内部
   * 策略：
   *  1. 按分类取区域中心方向（已归一化）
   *  2. 在中心方向周围用球面扰动散开（同类聚拢）
   *  3. 按方向投射到脑椭球表面，乘以 0.82~0.98 的半径系数（部分在表面、部分在内部）
   */
  const nodePositions = useMemo(() => {
    const map = new Map<string, [number, number, number]>()
    // 按分类分组，每组内做局部散布
    const byCategory = new Map<string, VisualizationNode[]>()
    displayNodes.forEach((n) => {
      const arr = byCategory.get(n.category) ?? []
      arr.push(n)
      byCategory.set(n.category, arr)
    })

    byCategory.forEach((items, category) => {
      const center = normalizeVec3(
        CATEGORY_DIRECTIONS[category] ?? CATEGORY_DIRECTIONS.UNCATEGORIZED
      )
      items.forEach((node, i) => {
        // 在中心方向周围做球面扰动：用 Fibonacci 局部散布
        const golden = Math.PI * (1 + Math.sqrt(5))
        const t = (i + 0.5) / items.length
        const localPhi = Math.acos(1 - 2 * t)
        const localTheta = golden * (i + 0.5)
        // 扰动幅度：分类内点数越多散得越开，但控制在 0.12 弧度内（同类紧密聚拢）
        const spread = Math.min(0.12, 0.05 + Math.log10(items.length + 1) * 0.04)
        const dx = Math.sin(localPhi) * Math.cos(localTheta) * spread
        const dy = Math.sin(localPhi) * Math.sin(localTheta) * spread
        const dz = Math.cos(localPhi) * spread

        // 合成方向 = 中心 + 扰动，再归一化
        let dir: [number, number, number] = [
          center[0] + dx,
          center[1] + dy,
          center[2] + dz,
        ]
        dir = normalizeVec3(dir)

        // 投射到脑椭球表面：r 满足 (rx/a)² + (ry/b)² + (rz/c)² = 1
        // 沿方向 dir 的表面点 = dir * k，k = 1 / sqrt((dx/a)² + (dy/b)² + (dz/c)²)
        const k = 1 / Math.sqrt(
          (dir[0] / BRAIN_SCALE_X) ** 2 +
          (dir[1] / BRAIN_SCALE_Y) ** 2 +
          (dir[2] / BRAIN_SCALE_Z) ** 2
        )
        // 重要性高的更靠表面，低的更靠内部（0.82~0.98）
        const surfaceFactor = 0.82 + (node.importance ?? 0.5) * 0.16
        const r = k * surfaceFactor

        map.set(node.id, [
          dir[0] * r,
          dir[1] * r,
          dir[2] * r,
        ])
      })
    })
    return map
  }, [displayNodes])

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.02
    }
  })

  return (
    <group ref={groupRef}>
      {/* 关联线 */}
      {displayEdges.map((edge, i) => {
        const sourcePos = nodePositions.get(edge.source)
        const targetPos = nodePositions.get(edge.target)
        if (!sourcePos || !targetPos) return null

        return (
          <line key={`edge-${i}`}>
            <bufferGeometry>
              <bufferAttribute
                attach="attributes-position"
                count={2}
                array={new Float32Array([...sourcePos, ...targetPos])}
                itemSize={3}
              />
            </bufferGeometry>
            <lineBasicMaterial
              color="#60A5FA"
              transparent
              opacity={0.2 + edge.weight * 0.3}
            />
          </line>
        )
      })}

      {/* 节点：缩小尺寸 + 分类色 + 高发光 */}
      {displayNodes.map((node) => {
        const pos = nodePositions.get(node.id)
        if (!pos) return null
        const meta = CATEGORY_META[node.category] ?? CATEGORY_META.UNCATEGORIZED
        const color = new THREE.Color(meta.color)
        // 进一步缩小节点尺寸：0.03~0.055
        const size = 0.03 + (node.importance ?? 0.5) * 0.025
        const isHovered = hovered === node.id

        return (
          <group key={node.id} position={pos}>
            {/* 外层光晕（缩小但更亮） */}
            <mesh>
              <sphereGeometry args={[size * 2.0, 10, 10]} />
              <meshBasicMaterial
                color={color}
                transparent
                opacity={isHovered ? 0.35 : 0.2}
                depthWrite={false}
                blending={THREE.AdditiveBlending}
              />
            </mesh>

            {/* 主节点：高发光 */}
            <mesh
              onPointerOver={(e) => {
                e.stopPropagation()
                setHovered(node.id)
                document.body.style.cursor = 'pointer'
              }}
              onPointerOut={() => {
                setHovered(null)
                document.body.style.cursor = 'default'
              }}
            >
              <sphereGeometry args={[size, 10, 10]} />
              <meshStandardMaterial
                color={color}
                emissive={color}
                emissiveIntensity={isHovered ? 2.8 : 1.8}
                transparent
                opacity={1.0}
              />
            </mesh>

            {/* 悬停时显示标签（不随距离缩放） */}
            {isHovered && (
              <Html position={[0, size + 0.2, 0]} center>
                <div className="px-1.5 py-0.5 rounded bg-black/90 backdrop-blur border border-white/20 whitespace-nowrap pointer-events-none" style={{ fontSize: '10px' }}>
                  <div className="text-white font-medium max-w-[180px] truncate leading-tight">
                    {node.label}
                  </div>
                  <div className="text-white/60 mt-0.5 leading-tight">
                    {meta.label} · {(node.importance * 100).toFixed(0)}%
                  </div>
                </div>
              </Html>
            )}
          </group>
        )
      })}
    </group>
  )
}

// ============ 场景图例 ============
function SceneLegend() {
  const categories = Object.entries(CATEGORY_META).slice(0, 8)
  return (
    <div className="absolute top-3 left-3 z-10 px-3 py-2 rounded-lg bg-white/5 backdrop-blur border border-white/10">
      <div className="text-[10px] text-white/50 mb-1.5">分类图例</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {categories.map(([key, meta]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: meta.color }}
            />
            <span className="text-[10px] text-white/70">{meta.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ============ Canvas 2D 降级方案 ============
function FallbackCanvas2D() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const { visualizationData, fetchVisualizationData } = useMemoryStore()

  useEffect(() => {
    fetchVisualizationData()
  }, [fetchVisualizationData])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !visualizationData) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    const centerX = width / 2
    const centerY = height / 2

    // 清空画布：黑色夜空背景
    ctx.fillStyle = '#000000'
    ctx.fillRect(0, 0, width, height)

    // 绘制星星
    for (let i = 0; i < 150; i++) {
      const x = Math.random() * width
      const y = Math.random() * height
      const r = Math.random() * 1.2
      const alpha = 0.3 + Math.random() * 0.6
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`
      ctx.fill()
    }

    // 绘制中心大脑
    ctx.beginPath()
    ctx.arc(centerX, centerY, 80, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(96, 165, 250, 0.4)'
    ctx.lineWidth = 1.5
    ctx.stroke()

    // 绘制节点
    const nodes = visualizationData.nodes.slice(0, 50)
    nodes.forEach((node, i) => {
      const angle = (i / nodes.length) * Math.PI * 2
      const r = 120 + (node.importance ?? 0.5) * 40
      const x = centerX + Math.cos(angle) * r
      const y = centerY + Math.sin(angle) * r
      const meta = CATEGORY_META[node.category] ?? CATEGORY_META.UNCATEGORIZED

      ctx.beginPath()
      ctx.arc(x, y, 3 + (node.importance ?? 0.5) * 4, 0, Math.PI * 2)
      ctx.fillStyle = meta.color
      ctx.fill()

      // 节点光晕
      ctx.beginPath()
      ctx.arc(x, y, 8 + (node.importance ?? 0.5) * 6, 0, Math.PI * 2)
      ctx.fillStyle = meta.color + '20'
      ctx.fill()
    })

    // 绘制关联线
    const nodeIds = new Set(nodes.map((n) => n.id))
    visualizationData.edges
      .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
      .slice(0, 50)
      .forEach((edge) => {
        const sourceIdx = nodes.findIndex((n) => n.id === edge.source)
        const targetIdx = nodes.findIndex((n) => n.id === edge.target)
        if (sourceIdx === -1 || targetIdx === -1) return

        const sourceAngle = (sourceIdx / nodes.length) * Math.PI * 2
        const targetAngle = (targetIdx / nodes.length) * Math.PI * 2
        const sourceR = 120 + (nodes[sourceIdx].importance ?? 0.5) * 40
        const targetR = 120 + (nodes[targetIdx].importance ?? 0.5) * 40

        ctx.beginPath()
        ctx.moveTo(
          centerX + Math.cos(sourceAngle) * sourceR,
          centerY + Math.sin(sourceAngle) * sourceR,
        )
        ctx.lineTo(
          centerX + Math.cos(targetAngle) * targetR,
          centerY + Math.sin(targetAngle) * targetR,
        )
        ctx.strokeStyle = `rgba(96, 165, 250, ${0.2 + edge.weight * 0.3})`
        ctx.lineWidth = 0.5
        ctx.stroke()
      })
  }, [visualizationData])

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center bg-black">
      <div className="absolute top-3 left-3 px-3 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2 text-xs text-amber-500">
        <AlertTriangle className="w-3.5 h-3.5" />
        WebGL 不可用，已降级为 2D 视图
      </div>
      <canvas
        ref={canvasRef}
        width={800}
        height={600}
        className="max-w-full max-h-full"
      />
    </div>
  )
}
