/**
 * 角色描述符 — 角色库的数据模型
 *
 * 角色是场景内部的专业分工身份：场景决定「在什么场合」，角色决定「由谁来做」。
 * 角色人设追加在场景人设之后（不替换），安全边界与记忆域约束仍由场景层负责。
 *
 * @see aweeclaw-client/docs/role-library/01-role-library-design.md 设计文档
 */

import type { SceneMode } from '@protocols/sceneModeProtocol'
import type { WorkMode } from '@protocols/workModeProtocol'

/** 意图标签：轻量意图识别的结果，用于规则层匹配得分 */
export type RoleIntent =
  | 'drafting'      // 起草、撰写、润色
  | 'summarizing'   // 总结、纪要、提炼
  | 'analyzing'     // 数据分析、指标解读
  | 'reviewing'     // 审查、检查、找问题
  | 'planning'      // 规划、排期、拆解
  | 'explaining'    // 讲解、答疑、教学
  | 'practicing'    // 出题、演练、复习
  | 'reminding'     // 提醒、跟踪
  | 'companioning'  // 陪伴、情绪交流
  | 'deciding'      // 决策、选型、对比
  | 'translating'   // 翻译、多语言转换
  | 'coding'        // 编码、调试、重构
  | 'researching'   // 检索、调研、资料收集
  | 'brainstorming' // 头脑风暴、创意发散
  | 'communicating' // 沟通措辞、对外回复
  | 'extracting'    // 信息提取、结构化整理

/** 所有意图标签清单（供遍历与 UI 多选） */
export const ALL_ROLE_INTENTS: RoleIntent[] = [
  'drafting', 'summarizing', 'analyzing', 'reviewing', 'planning',
  'explaining', 'practicing', 'reminding', 'companioning', 'deciding',
  'translating', 'coding', 'researching', 'brainstorming', 'communicating',
  'extracting',
]

/** 角色触发配置：决定自动匹配时的候选资格 */
export interface RoleTriggers {
  /** 关键词：命中即计入规则层得分（禁用「写/做/帮我」等泛化词） */
  keywords: string[]
  /** 意图标签：与轻量意图识别结果比对 */
  intents: RoleIntent[]
  /** 按附件类型命中，如 ['xlsx', 'csv'] → 数据分析角色 */
  fileTypes?: string[]
  /** 负面关键词：命中即一票否决（如「随便聊聊」不应命中工作报告角色） */
  excludeKeywords?: string[]
}

/** 角色的模型偏好（全部可选，留空则继承当前会话配置） */
export interface RoleModelPreference {
  provider?: string
  model?: string
  /** 推理深度，复用既有 WorkMode */
  workMode?: WorkMode
  /** 采样温度，输出型角色可调高，分析型角色可调低 */
  temperature?: number
}

/** 角色描述符 */
export interface RoleDescriptor {
  /** 全局唯一 id，命名规则：<scene>.<slug>，如 work.legal-counsel、study.feynman-tutor */
  id: string
  /** 所属场景 */
  sceneMode: SceneMode

  /** 显示名称（英文） */
  name: string
  /** 显示名称（中文） */
  nameZh: string
  /** 一句话说明（用于角色清单注入与卡片展示） */
  description: string
  /** lucide 图标名 */
  icon: string
  /** 可选头像（自定义角色可用；内置角色用图标） */
  avatar?: string

  /** 角色人设，追加在场景人设之后，不替换 */
  personaPrompt: string
  /** 可选：复用 promptLibrary 的模板作为人设底层 */
  templateId?: string

  /** 引用的技能名，必须 ⊆ 所属场景 modeSkills ∪ 全局已安装技能 */
  skillRefs: string[]
  /** 允许使用的工具组，必须 ⊆ 全局已授权范围（不可提权） */
  toolScopes: string[]

  modelPreference?: RoleModelPreference

  triggers: RoleTriggers

  /** 输出契约：对结果格式的硬性约定，如「必须给出结论 → 依据 → 建议三段」 */
  outputContract?: string

  /** 匹配优先级，取值 0~100（内置角色建议 50~80），数值越大越优先（同分时打破平局） */
  priority: number
  enabled: boolean
  /** 内置角色不可删除，只能停用或复制为自定义 */
  builtin: boolean
  version: number
  createdAt: number
  updatedAt: number
}

/** 角色清单注入预算（token），超出按 priority 从低到高截断 */
export const ROLE_MANIFEST_BUDGET_TOKENS = 1200

/** 规则层匹配的采纳阈值：得分 ≥ 该值才进入候选 */
export const ROLE_MATCH_THRESHOLD = 0.6

/** 规则层得分权重 */
export const ROLE_MATCH_WEIGHTS = {
  /** 每个关键词命中的得分，累计上限 KEYWORDS_CAP */
  perKeyword: 0.25,
  /** 关键词得分累计上限 */
  keywordsCap: 0.75,
  /** 意图标签与意图识别结果一致的得分 */
  intentHit: 0.3,
  /** 附件扩展名命中的得分 */
  fileTypeHit: 0.2,
} as const

/** 唯一候选判定：最高分比第二名高出的最小差距 */
export const ROLE_MATCH_GAP = 0.2

/**
 * 角色体系生效的工作模式
 *
 * 只有思考（agent）与专家（expert）模式会匹配角色、注入角色人设与角色清单，
 * 并参与多角色子任务分派；快速模式（chat）作为轻量问答通道，不进入角色体系。
 */
export function isRoleAgentEnabled(mode: WorkMode): boolean {
  return mode === 'agent' || mode === 'expert'
}
