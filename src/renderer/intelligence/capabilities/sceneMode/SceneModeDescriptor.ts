/**
 * 场景模式描述符 — 定义单个场景模式的完整配置
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/02-mode-profile.md} 设计文档
 */

import type { SceneMode } from '@protocols/sceneModeProtocol'
import type { WorkMode } from '@protocols/workModeProtocol'

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
