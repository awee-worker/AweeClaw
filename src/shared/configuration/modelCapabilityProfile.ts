/**
 * 模型能力档案 — 按模型名解析出的协议级行为约束
 *
 * 过去这些约束以正则的形式散落在四个文件里：请求参数构建、温度锁定、
 * 思考策略、prompt cache 保留时长。改一个模型要改四处，且各处判定口径
 * 不一致（例如「是否推理模型」在不同文件用不同的前缀集合）。
 *
 * 这里集中成一份档案，各处只读取档案字段，不再自行写正则。
 * 新增模型支持时只改本文件的规则表。
 */

export type ReasoningEffortLevel =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'

export interface ModelCapabilityProfile {
  /**
   * OpenAI 风格推理模型：不接受 temperature / topP / 惩罚项等采样参数，
   * 传了会被网关拒绝或静默忽略。
   */
  openAIReasoning: boolean

  /**
   * `reasoningEffort = 'none'` 时是否恢复采样参数。
   * GPT-5.1 / 5.2 在关闭推理后可正常接收采样参数，更早的推理模型不行。
   */
  samplingRestoredWhenEffortNone: boolean

  /** prompt cache 是否支持 24 小时保留 */
  promptCacheRetention24h: boolean

  /** 网关只接受的固定温度；undefined 表示温度可自由配置 */
  fixedTemperature?: number

  /** 思考强制开启，无法关闭（关闭该参数会被网关拒绝） */
  thinkingForced: boolean

  /**
   * 思考预算与输出上限的关系：
   * - `shared`：思考占用 `maxOutputTokens` 额度，预算逼近上限会导致正文为空；
   * - `additive`：SDK 把 `max_tokens` 计算为 `maxOutputTokens + thinkingBudget`，
   *   二者不争夺额度。
   */
  thinkingBudgetMode: 'shared' | 'additive'

  /** 该模型可接受的推理强度档位；undefined 表示使用协议默认全集 */
  reasoningEffortLevels?: readonly ReasoningEffortLevel[]
}

const DEFAULT_PROFILE: ModelCapabilityProfile = {
  openAIReasoning: false,
  samplingRestoredWhenEffortNone: false,
  promptCacheRetention24h: false,
  thinkingForced: false,
  thinkingBudgetMode: 'shared',
}

interface CapabilityRule {
  matches: (model: string) => boolean
  resolve: (model: string) => Partial<ModelCapabilityProfile>
}

/**
 * GPT-5 家族中的 `gpt-5-chat*` 是对话优化变体，不接受推理参数，
 * 不能按 `gpt-5` 前缀一并归为推理模型。
 */
function isOpenAIReasoningModelName(model: string): boolean {
  if (/^gpt-5-?chat/i.test(model)) return false
  return /^(gpt-5|o1|o3|o4|computer-use-preview)/i.test(model)
}

const RULES: CapabilityRule[] = [
  {
    matches: isOpenAIReasoningModelName,
    resolve: model => ({
      openAIReasoning: true,
      samplingRestoredWhenEffortNone: /^gpt-5\.(1|2)/i.test(model),
      promptCacheRetention24h: /^gpt-5/i.test(model) || /^gpt-4\.1/i.test(model),
    }),
  },
  {
    // Moonshot Kimi K2 系列为推理模型，网关只接受 temperature = 1
    matches: model => /^kimi-k2/i.test(model),
    resolve: () => ({ fixedTemperature: 1 }),
  },
  {
    // 智谱 GLM-5.x：thinking.type 仅支持 enabled，推理强度仅 low / high / max
    matches: model => /^glm-5/i.test(model),
    resolve: () => ({
      thinkingForced: true,
      reasoningEffortLevels: ['low', 'high', 'max'] as const,
    }),
  },
  {
    // Anthropic 扩展思考：SDK 按 max_tokens = maxOutputTokens + thinkingBudget 计算
    matches: model => /^claude/i.test(model),
    resolve: () => ({ thinkingBudgetMode: 'additive' }),
  },
]

/**
 * 解析模型能力档案。
 *
 * 多条规则命中时按顺序合并，后命中的字段覆盖先命中的同名字段。
 */
export function resolveModelCapabilityProfile(
  model: string | undefined,
): ModelCapabilityProfile {
  if (!model) return { ...DEFAULT_PROFILE }

  const name = model.trim()
  let profile: ModelCapabilityProfile = { ...DEFAULT_PROFILE }

  for (const rule of RULES) {
    if (!rule.matches(name)) continue
    profile = { ...profile, ...rule.resolve(name) }
  }

  return profile
}

/** 是否为 OpenAI 风格推理模型（不接受采样参数） */
export function isOpenAIReasoningModel(model: string | undefined): boolean {
  return resolveModelCapabilityProfile(model).openAIReasoning
}
