/**
 * 场景模式描述符 — 定义单个场景模式的完整配置
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/02-mode-profile.md} 设计文档
 */

import type { SceneMode } from '@protocols/sceneModeProtocol'
import type { WorkMode } from '@protocols/workModeProtocol'

/**
 * 编程能力增强开关（由代码开发场景独享的能力集）
 *
 * 四个场景的基础工具完全一致（文件 / 搜索 / 终端 / office 等），
 * 差异只体现在：
 * - dev 独有开发类工具（git_*、LSP 代码智能、codebase_search）按场景下发；
 * - 工具层的编程能力增强（编辑验证闭环、失败反思、命令代价预检、质量埋点）仅在 dev 生效。
 */
export interface CodingEnhancements {
  /** 工具门控：dev 独有开发类工具仅在代码开发场景下发 */
  toolGating: boolean
  /** 编辑后自动验证：编辑类工具成功后自动跑 lint 并附加诊断结果 */
  postEditVerify: boolean
  /** 工具失败时附加反思引导 */
  failureReflection: boolean
  /** 高代价命令预检与降级建议 */
  commandCostGuard: boolean
  /** 会话质量埋点（工具失败率 / 验证通过率） */
  qualityMetrics: boolean
}

/** 非 dev 场景的默认增强配置：仅启用工具门控，编程能力增强全部关闭 */
export const DEFAULT_NON_DEV_CODING_ENHANCEMENTS: CodingEnhancements = {
  toolGating: true,
  postEditVerify: false,
  failureReflection: false,
  commandCostGuard: false,
  qualityMetrics: false,
}

/** dev 场景的默认增强配置：全部开启 */
export const DEV_CODING_ENHANCEMENTS: CodingEnhancements = {
  toolGating: true,
  postEditVerify: true,
  failureReflection: true,
  commandCostGuard: true,
  qualityMetrics: true,
}

/**
 * 读取场景的编程能力增强配置。
 *
 * profile 未声明 codingEnhancements 时按场景 ID 回退到内置默认值，
 * 保证旧数据 / 自定义 profile 不丢行为。
 */
export function getCodingEnhancements(profile?: { id?: SceneMode; codingEnhancements?: CodingEnhancements }): CodingEnhancements {
  if (profile?.codingEnhancements) return profile.codingEnhancements
  return profile?.id === 'dev'
    ? { ...DEV_CODING_ENHANCEMENTS }
    : { ...DEFAULT_NON_DEV_CODING_ENHANCEMENTS }
}

/** 悬浮头像风格 */
export interface AvatarStyle {
  theme: 'professional' | 'warm' | 'focused'
  primaryColor: string
  secondaryColor: string
  animation: 'subtle' | 'lively' | 'calm'
  expression: 'focused' | 'happy' | 'thoughtful'
  size: 'small' | 'medium' | 'large'
}

/** 语音音色配置 */
export interface VoiceProfile {
  voiceId: string
  speed: number
  pitch: number
  volume: number
}

/** 感知策略：控制各感知信号的启停 */
export interface PerceptionFilter {
  /** 桌面窗口切换检测（专注度） */
  desktopWindowSwitching: boolean
  /** 活动应用检测 */
  activeAppTracking: boolean
  /** 日历事件 */
  calendarEvents: boolean
  /** 工作区文件改动 */
  workspaceFileChanges: boolean
  /** 屏幕久坐时长 */
  screenIdleTime: boolean
  /** 天气 */
  weather: boolean
  /** IoT 健康设备 */
  iotHealth: boolean
  /** 情绪分析（语音/文本） */
  emotionAnalysis: boolean
  /** IoT 环境传感器 */
  iotEnvironment: boolean
  /** 学习时长 */
  studyDuration: boolean
  /** 遗忘曲线计算 */
  forgettingCurve: boolean
}

/** 主动行为规则 */
export interface ProactiveRule {
  id: string
  name: string
  /** 触发条件描述（供规则引擎评估） */
  condition: string
  /** 行为类型 */
  action: 'notify' | 'remind' | 'suggest' | 'trigger-skill' | 'iot-control'
  /** 行为内容 */
  payload: string
  /** 是否启用 */
  enabled: boolean
}

/** 场景专属 Cron 任务 */
export interface SceneCronJob {
  id: string
  name: string
  /** Cron 表达式 */
  schedule: string
  /** 触发的技能或行为标识 */
  action: string
  enabled: boolean
}

/** 工作时间配置（仅工作模式有效） */
export interface WorkHoursConfig {
  start: string
  end: string
  /** 生效日期（0=周日, 1-6=周一到周六） */
  days: number[]
}

/** 问候时段（用于时段问候动态选择） */
export type TimePeriod = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night'

/** 场景模式完整配置描述符 */
export interface SceneModeProfile {
  /** 模式 ID */
  id: SceneMode
  /** 显示名称（英文） */
  displayName: string
  /** 显示名称（中文） */
  displayNameZh: string
  /** 模式描述 */
  description: string
  /** 图标名（lucide-react 图标） */
  icon: string

  /** 智能体人设提示词 */
  personaPrompt: string

  /**
   * 编程能力增强开关（可选，缺省按场景 ID 回退内置默认值）
   *
   * dev 场景全开；其余场景仅 toolGating 生效（裁剪 dev 独有开发类工具）。
   * 见 getCodingEnhancements()。
   */
  codingEnhancements?: CodingEnhancements

  /** 挂载的技能白名单（SkillItem.name 列表） */
  modeSkills: string[]

  /** 记忆域 tag（domain:work / domain:life / domain:study） */
  memoryDomainTag: string

  /** 感知策略 */
  perceptionFilter: PerceptionFilter

  /** 主动行为规则 */
  proactiveRules: ProactiveRule[]

  /** 悬浮头像风格 */
  avatarStyle: AvatarStyle

  /** 语音音色 */
  voiceProfile: VoiceProfile

  /** Cron 任务 */
  cronJobs: SceneCronJob[]

  /** 推荐的默认 WorkMode（推理深度） */
  defaultWorkMode: WorkMode

  /** 工作时间配置（仅工作模式有效） */
  workHours?: WorkHoursConfig

  /** 空对话态问候语（多句轮换，UI1） */
  greetings?: {
    zh: string[]
    en: string[]
    /** 时段问候：按当前时间动态选择（morning/noon/afternoon/evening/night），优先于静态池轮换 */
    timeGreetings?: {
      zh: Partial<Record<TimePeriod, string>>
      en: Partial<Record<TimePeriod, string>>
    }
  }

  /** 空对话态快捷引导卡片（UI3） */
  quickPrompts?: QuickPromptItem[]
}

/** 快捷引导卡片项 */
export interface QuickPromptItem {
  /** lucide icon name */
  icon: string
  /** 显示文本（中文） */
  label: string
  /** 显示文本（英文，可选） */
  labelEn?: string
  /** 点击发送的 prompt */
  prompt: string
}
