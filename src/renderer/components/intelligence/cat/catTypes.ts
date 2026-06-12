/** 猫咪毛色变体 */
export type CatVariant = 'orange' | 'tuxedo' | 'calico' | 'gray' | 'black' | 'white'

/** 猫咪空闲动作 */
export const IDLE_ACTIONS = ['idle', 'chat', 'coffee', 'smoke', 'phone'] as const
export type IdleAction = typeof IDLE_ACTIONS[number]

/** 毛色配置 */
export const VARIANT_COLORS: Record<CatVariant, {
  body: string
  accent: string
  patch: string
  nose: string
  ear: string
}> = {
  orange:  { body: '#E8913A', accent: '#F5C97A', patch: '#D47B20', nose: '#E8A0A0', ear: '#F0B0B0' },
  tuxedo:  { body: '#2A2A2A', accent: '#FAFAFA', patch: '#1A1A1A', nose: '#D08080', ear: '#C07070' },
  calico:  { body: '#F5F0E8', accent: '#E8913A', patch: '#3A3A3A', nose: '#E8A0A0', ear: '#F0B0B0' },
  gray:    { body: '#8A8A8A', accent: '#B0B0B0', patch: '#6A6A6A', nose: '#C09090', ear: '#B08080' },
  black:   { body: '#1A1A1A', accent: '#333333', patch: '#0A0A0A', nose: '#A07070', ear: '#906060' },
  white:   { body: '#F5F5F0', accent: '#FFFFFF', patch: '#E8E8E0', nose: '#E0A0A0', ear: '#F0B0B0' },
}

/** 角色 → 毛色映射 */
export const ROLE_VARIANT: Record<string, CatVariant> = {
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

/** 角色 → 配饰映射 */
export const ROLE_ACCESSORY: Record<string, string> = {
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

/** 手臂姿态类型 */
export type ArmPose = 'typing' | 'walking' | 'idle' | 'coffee' | 'smoke' | 'chat' | 'phone'

/** CatModel3D 组件 Props */
export interface CatModel3DProps {
  role?: string
  variant?: CatVariant
  status?: string
  idleAction?: string
  scale?: number
  onClick?: () => void
  themeAccentColor?: string
  statusBubble?: string
  speechBubble?: string
  /** 是否坐在椅子上（弯曲腿部，降低身体高度） */
  isSitting?: boolean
}

/** 工具函数：字符串哈希 */
export function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash |= 0
  }
  return hash
}
