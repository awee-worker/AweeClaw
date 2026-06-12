import type { IdleAction } from '../cat/catTypes'

/** 目的地类型 */
export type DestinationType = 'coffee' | 'smoke' | 'chat' | 'desk'

/** 场景区域坐标 */
export const COFFEE_AREA_LEFT: [number, number, number] = [-3.5, 0, -2]
export const COFFEE_AREA_RIGHT: [number, number, number] = [-2.5, 0, -2]
export const SMOKING_AREA: [number, number, number] = [3.5, 0, -2]
export const CHAT_AREA: [number, number, number] = [0, 0, -3.5]
export const MEETING_AREA: [number, number, number] = [0, 0, -3]

/** 工位布局 — rotation 控制整个办公桌朝向，显示器/椅子/猫咪随桌子旋转 */
export const DESK_LAYOUTS: Array<{
  id: string
  position: [number, number, number]
  rotation: number
}> = [
  { id: 'desk-1', position: [-2.5, 0, 1], rotation: 0 },
  { id: 'desk-2', position: [-0.8, 0, 1], rotation: 0 },
  { id: 'desk-3', position: [0.8, 0, 1], rotation: 0 },
  { id: 'desk-4', position: [2.5, 0, 1], rotation: 0 },
  { id: 'desk-5', position: [-2.5, 0, 3.5], rotation: Math.PI },
  { id: 'desk-6', position: [-0.8, 0, 3.5], rotation: Math.PI },
  { id: 'desk-7', position: [0.8, 0, 3.5], rotation: Math.PI },
  { id: 'desk-8', position: [2.5, 0, 3.5], rotation: Math.PI },
]

/**
 * 计算办公桌对应的椅子位置（猫咪走回工位的目标点）
 *
 * 椅子在桌子前方 z+0.6 处（局部坐标），旋转后映射到世界坐标。
 * 猫咪坐在椅子前方 z+0.5 处，但走回时只需到椅子附近即可。
 */
export function getDeskChairPosition(desk: { position: [number, number, number]; rotation: number }): [number, number, number] {
  const cos = Math.cos(desk.rotation)
  const sin = Math.sin(desk.rotation)
  // 椅子在局部坐标 [0, 0, 0.6]，旋转到世界坐标
  const chairOffsetX = sin * 0.6
  const chairOffsetZ = cos * 0.6
  return [desk.position[0] + chairOffsetX, desk.position[1], desk.position[2] + chairOffsetZ]
}

/** 目的地配置 */
export const DESTINATIONS: Record<DestinationType, {
  positions: Array<[number, number, number]>
  action: IdleAction
  label: string
}> = {
  coffee: { positions: [COFFEE_AREA_LEFT, COFFEE_AREA_RIGHT], action: 'coffee', label: '喝水' },
  smoke: { positions: [SMOKING_AREA], action: 'smoke', label: '抽烟' },
  chat: { positions: [CHAT_AREA], action: 'chat', label: '交流' },
  desk: { positions: [], action: 'idle', label: '' },
}

/** 交接对话 */
export const HANDOFF_SPEECHES = [
  '接下来交给你了！',
  '我的部分完成了，该你了~',
  '任务交接，拜托啦！',
  '搞定！轮到你上场了',
  '这边OK，接手吧！',
]

/** 场景颜色 — 明亮办公室风格，白天夜间一致 */
export const SCENE_COLORS = {
  floor: '#d4cfc8',
  floorGrid: '#c4bfb8',
  wall: '#f0ece6',
  wallAccent: '#b8b0a4',
  desk: '#8b7355',
  deskTop: '#a08968',
  monitor: '#1a1a2e',
  monitorScreen: '#0a0a1e',
  monitorFrame: '#333',
  keyboard: '#3a3a4e',
  plant: '#2d6a4f',
  plantPot: '#8B6F47',
  coffee: '#8B6F47',
  meetingTable: '#8b7355',
  whiteboard: '#f8f8f8',
  whiteboardFrame: '#888',
  sofa: '#6b7280',
  window: '#87CEEB',
  windowFrame: '#ddd',
}
