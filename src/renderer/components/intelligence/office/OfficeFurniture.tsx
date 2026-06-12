import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { SCENE_COLORS, COFFEE_AREA_LEFT, SMOKING_AREA, MEETING_AREA } from './officeConfig'

/** 咖啡机区域 */
function CoffeeArea() {
  return (
    <group position={COFFEE_AREA_LEFT}>
      {/* 咖啡机台面 */}
      <mesh position={[0, 0.6, 0]}>
        <boxGeometry args={[1.2, 0.05, 0.5]} />
        <meshStandardMaterial color={SCENE_COLORS.deskTop} roughness={0.5} />
      </mesh>
      {/* 桌腿 */}
      {[[-0.5, 0.3, -0.18], [0.5, 0.3, -0.18], [-0.5, 0.3, 0.18], [0.5, 0.3, 0.18]].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]}>
          <boxGeometry args={[0.04, 0.6, 0.04]} />
          <meshStandardMaterial color={SCENE_COLORS.desk} roughness={0.6} />
        </mesh>
      ))}
      {/* 咖啡机 */}
      <mesh position={[-0.3, 0.8, 0]}>
        <boxGeometry args={[0.2, 0.3, 0.2]} />
        <meshStandardMaterial color={SCENE_COLORS.coffee} roughness={0.4} />
      </mesh>
      {/* 杯子 */}
      <mesh position={[0.2, 0.68, 0.1]}>
        <cylinderGeometry args={[0.04, 0.035, 0.08, 8]} />
        <meshStandardMaterial color="#FAFAFA" roughness={0.3} />
      </mesh>
      <mesh position={[0.3, 0.68, -0.05]}>
        <cylinderGeometry args={[0.04, 0.035, 0.08, 8]} />
        <meshStandardMaterial color="#FAFAFA" roughness={0.3} />
      </mesh>
      {/* 标签 */}
      <mesh position={[0, 0.63, 0.26]}>
        <planeGeometry args={[0.6, 0.08]} />
        <meshStandardMaterial color="#2d6a4f" roughness={0.5} />
      </mesh>
    </group>
  )
}

/** 抽烟区 */
function SmokingArea() {
  return (
    <group position={SMOKING_AREA}>
      {/* 烟灰缸柱 */}
      <mesh position={[0, 0.5, 0]}>
        <cylinderGeometry args={[0.15, 0.12, 1, 8]} />
        <meshStandardMaterial color="#555" roughness={0.6} metalness={0.3} />
      </mesh>
      {/* 烟灰缸顶部 */}
      <mesh position={[0, 1, 0]}>
        <cylinderGeometry args={[0.2, 0.15, 0.08, 8]} />
        <meshStandardMaterial color="#666" roughness={0.5} metalness={0.4} />
      </mesh>
    </group>
  )
}

/** 会议椅 — 可复用，椅背在z负方向（旋转后远离桌子） */
function MeetingChair({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      {/* 椅座 */}
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.4, 0.04, 0.4]} />
        <meshStandardMaterial color={SCENE_COLORS.desk} roughness={0.6} />
      </mesh>
      {/* 椅背 — z负方向，旋转后始终远离桌子 */}
      <mesh position={[0, 0.6, -0.18]}>
        <boxGeometry args={[0.4, 0.45, 0.04]} />
        <meshStandardMaterial color={SCENE_COLORS.desk} roughness={0.6} />
      </mesh>
      {/* 椅腿 */}
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.3, 8]} />
        <meshStandardMaterial color="#777" roughness={0.3} metalness={0.5} />
      </mesh>
      {/* 星形脚架 — 连接中心柱与轮子 */}
      {[0, 1.257, 2.514, 3.771, 5.028].map((angle, i) => (
        <mesh key={`arm-${i}`} position={[Math.sin(angle) * 0.08, 0.06, Math.cos(angle) * 0.08]}
          rotation={[0, -angle, 0]}>
          <boxGeometry args={[0.16, 0.015, 0.02]} />
          <meshStandardMaterial color="#777" roughness={0.3} metalness={0.5} />
        </mesh>
      ))}
      {/* 脚轮 */}
      {[0, 1.257, 2.514, 3.771, 5.028].map((angle, i) => (
        <mesh key={`wheel-${i}`} position={[Math.sin(angle) * 0.16, 0.03, Math.cos(angle) * 0.16]}>
          <cylinderGeometry args={[0.015, 0.015, 0.05, 6]} />
          <meshStandardMaterial color="#555" roughness={0.3} metalness={0.5} />
        </mesh>
      ))}
    </group>
  )
}

/** 会议桌 — 6把椅子围坐 */
function MeetingTable() {
  return (
    <group position={MEETING_AREA}>
      {/* 桌面 */}
      <mesh position={[0, 0.4, 0]}>
        <boxGeometry args={[2, 0.05, 1]} />
        <meshStandardMaterial color={SCENE_COLORS.meetingTable} roughness={0.5} />
      </mesh>
      {/* 桌腿 */}
      {[[-0.8, 0.2, -0.4], [0.8, 0.2, -0.4], [-0.8, 0.2, 0.4], [0.8, 0.2, 0.4]].map((pos, i) => (
        <mesh key={i} position={pos as [number, number, number]}>
          <boxGeometry args={[0.04, 0.4, 0.04]} />
          <meshStandardMaterial color={SCENE_COLORS.desk} roughness={0.6} />
        </mesh>
      ))}
      {/* 6把椅子 — 前排3把，后排3把 */}
      {/* 前排（z正方向），面朝桌子（z负方向） */}
      <MeetingChair position={[-0.6, 0, 0.8]} rotation={Math.PI} />
      <MeetingChair position={[0, 0, 0.8]} rotation={Math.PI} />
      <MeetingChair position={[0.6, 0, 0.8]} rotation={Math.PI} />
      {/* 后排（z负方向），面朝桌子（z正方向） */}
      <MeetingChair position={[-0.6, 0, -0.8]} rotation={0} />
      <MeetingChair position={[0, 0, -0.8]} rotation={0} />
      <MeetingChair position={[0.6, 0, -0.8]} rotation={0} />
    </group>
  )
}

/** 电子屏 — 替代白板，实时滚屏显示工作进度 */
function DigitalScreen() {
  const scrollRef = useRef<THREE.Group>(null)

  useFrame((state) => {
    if (scrollRef.current) {
      // 模拟滚屏效果
      const t = state.clock.elapsedTime
      scrollRef.current.position.y = (t * 0.02) % 0.6 - 0.3
    }
  })

  return (
    <group position={[0, 2.2, -4.95]}>
      {/* 屏幕外壳 */}
      <mesh>
        <boxGeometry args={[2.8, 1.8, 0.06]} />
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} metalness={0.4} />
      </mesh>
      {/* 屏幕边框 */}
      <mesh position={[0, 0, 0.031]}>
        <boxGeometry args={[2.7, 1.7, 0.01]} />
        <meshStandardMaterial color="#222" roughness={0.5} />
      </mesh>
      {/* 屏幕内容 — 深蓝色背景 */}
      <mesh position={[0, 0, 0.036]}>
        <planeGeometry args={[2.5, 1.5]} />
        <meshStandardMaterial
          color="#0a1628"
          emissive="#0a1628"
          emissiveIntensity={0.3}
          roughness={0.2}
        />
      </mesh>
      {/* 模拟进度条和文字行 */}
      <group ref={scrollRef} position={[0, 0, 0.04]}>
        {/* 进度条 */}
        {[-0.4, -0.15, 0.1, 0.35].map((y, i) => {
          const widths = [1.8, 1.2, 2.0, 0.8]
          const colors = ['#39bef8', '#4ade80', '#a855f7', '#f59e0b']
          return (
            <group key={i} position={[-0.3, y, 0]}>
              {/* 标签行 */}
              <mesh position={[-0.5, 0, 0]}>
                <planeGeometry args={[0.6, 0.04]} />
                <meshStandardMaterial color="#334" roughness={0.5} />
              </mesh>
              {/* 进度条背景 */}
              <mesh position={[0.5, 0, 0]}>
                <planeGeometry args={[1.5, 0.06]} />
                <meshStandardMaterial color="#1a2a3e" roughness={0.5} />
              </mesh>
              {/* 进度条填充 */}
              <mesh position={[0.5 - (1.5 - widths[i]) / 2, 0, 0.001]}>
                <planeGeometry args={[widths[i], 0.04]} />
                <meshStandardMaterial
                  color={colors[i]}
                  emissive={colors[i]}
                  emissiveIntensity={0.5}
                  roughness={0.3}
                />
              </mesh>
            </group>
          )
        })}
      </group>
      {/* 屏幕发光效果 */}
      <pointLight position={[0, 0, 0.5]} intensity={0.3} color="#39bef8" distance={3} decay={2} />
    </group>
  )
}

/** 沙发休息区 */
function Sofa() {
  return (
    <group position={[-4.5, 0, 2]}>
      {/* 座垫 */}
      <mesh position={[0, 0.3, 0]}>
        <boxGeometry args={[1.5, 0.2, 0.6]} />
        <meshStandardMaterial color={SCENE_COLORS.sofa} roughness={0.7} />
      </mesh>
      {/* 靠背 */}
      <mesh position={[0, 0.55, -0.25]}>
        <boxGeometry args={[1.5, 0.5, 0.1]} />
        <meshStandardMaterial color={SCENE_COLORS.sofa} roughness={0.7} />
      </mesh>
      {/* 扶手 */}
      <mesh position={[-0.7, 0.45, 0]}>
        <boxGeometry args={[0.1, 0.3, 0.6]} />
        <meshStandardMaterial color={SCENE_COLORS.sofa} roughness={0.7} />
      </mesh>
      <mesh position={[0.7, 0.45, 0]}>
        <boxGeometry args={[0.1, 0.3, 0.6]} />
        <meshStandardMaterial color={SCENE_COLORS.sofa} roughness={0.7} />
      </mesh>
    </group>
  )
}

/** 窗户 — 贴在墙面上，面朝室内 */
function Window({ position, wallSide }: {
  position: [number, number, number]
  wallSide: 'left' | 'right' | 'back'
}) {
  // 根据墙壁方向调整窗户朝向
  const rotation: [number, number, number] = wallSide === 'left'
    ? [0, Math.PI / 2, 0]
    : wallSide === 'right'
      ? [0, -Math.PI / 2, 0]
      : [0, 0, 0]

  // 窗户面朝室内方向偏移
  const faceOffset: [number, number, number] = wallSide === 'left'
    ? [0.04, 0, 0]
    : wallSide === 'right'
      ? [-0.04, 0, 0]
      : [0, 0, 0.04]

  return (
    <group position={position}>
      {/* 窗框 — 薄板贴墙 */}
      <mesh rotation={rotation}>
        <boxGeometry args={[1.2, 1.5, 0.06]} />
        <meshStandardMaterial color={SCENE_COLORS.windowFrame} roughness={0.3} metalness={0.3} />
      </mesh>
      {/* 玻璃 — 面朝室内 */}
      <mesh position={faceOffset} rotation={rotation}>
        <planeGeometry args={[1.0, 1.3]} />
        <meshStandardMaterial
          color={SCENE_COLORS.window}
          transparent
          opacity={0.5}
          roughness={0.1}
          metalness={0.1}
        />
      </mesh>
      {/* 十字窗格 */}
      <mesh position={faceOffset} rotation={rotation}>
        <boxGeometry args={[1.1, 0.04, 0.02]} />
        <meshStandardMaterial color={SCENE_COLORS.windowFrame} roughness={0.3} metalness={0.3} />
      </mesh>
      <mesh position={faceOffset} rotation={rotation}>
        <boxGeometry args={[0.04, 1.3, 0.02]} />
        <meshStandardMaterial color={SCENE_COLORS.windowFrame} roughness={0.3} metalness={0.3} />
      </mesh>
    </group>
  )
}

/** 植物 */
function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* 花盆 */}
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.1, 0.08, 0.3, 8]} />
        <meshStandardMaterial color={SCENE_COLORS.plantPot} roughness={0.6} />
      </mesh>
      {/* 植物 */}
      <mesh position={[0, 0.45, 0]}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial color={SCENE_COLORS.plant} roughness={0.8} />
      </mesh>
      <mesh position={[0.05, 0.55, 0.05]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshStandardMaterial color="#3d8b5e" roughness={0.8} />
      </mesh>
    </group>
  )
}

/** 办公室家具 */
export function OfficeFurniture() {
  return (
    <group>
      <CoffeeArea />
      <SmokingArea />
      <MeetingTable />
      <DigitalScreen />
      <Sofa />

      {/* 窗户 — 左墙2扇，右墙2扇，后墙2扇 */}
      <Window position={[-5.97, 2.5, -2]} wallSide="left" />
      <Window position={[-5.97, 2.5, 1]} wallSide="left" />
      <Window position={[5.97, 2.5, -2]} wallSide="right" />
      <Window position={[5.97, 2.5, 1]} wallSide="right" />
      <Window position={[-2, 2.5, -4.97]} wallSide="back" />
      <Window position={[2, 2.5, -4.97]} wallSide="back" />

      {/* 植物 */}
      <Plant position={[-4.5, 0, -4]} />
      <Plant position={[4.5, 0, -4]} />
      <Plant position={[-4.5, 0, 4]} />
      <Plant position={[4.5, 0, 4]} />
    </group>
  )
}
