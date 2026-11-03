/**
 * 服务商参数兼容降级
 *
 * 不同服务商对标准参数的支持并不一致：有的拒收 `top_k`，有的在开启思考后
 * 拒收 `temperature`，有的不认 `reasoning_effort`。过去只能靠为每个模型手工
 * 写兼容档案，新模型上线即出现「400 参数不支持，整轮对话不可用」。
 *
 * 这里的策略是自适应：请求被 400 拒绝时识别出是哪个参数引起的，标记该参数
 * 在当前 provider/model 组合下不可用（带冷却期），然后去掉它重试一次。
 * 与 prompt cache 的降级重试同构，区别是降级对象从「缓存特性」换成了
 * 「单个请求参数」。
 */

import type { LLMConfig } from '@protocols'
import { logger } from '@shared/toolkit/LogEngine'

export type SuppressibleParameter =
  | 'temperature'
  | 'topP'
  | 'topK'
  | 'frequencyPenalty'
  | 'presencePenalty'
  | 'stopSequences'
  | 'seed'
  | 'reasoningEffort'
  | 'thinking'
  | 'parallelToolCalls'
  | 'logitBias'

/** 冷静期：该组合下的同类请求直接不再下发该参数，过期后重新探测 */
const SUPPRESSION_TTL_MS = 10 * 60 * 1000

/** key: provider|protocol|baseUrl|model → 参数 → 过期时间 */
const suppressedParameters = new Map<string, Map<SuppressibleParameter, number>>()

function getConfigKey(
  config: Pick<LLMConfig, 'provider' | 'protocol' | 'baseUrl' | 'model'>,
): string {
  return JSON.stringify({
    provider: config.provider,
    protocol: config.protocol || '',
    baseUrl: config.baseUrl || '',
    model: config.model,
  })
}

/** 该参数在当前 provider/model 组合下是否已被标记为不可用 */
export function isParameterSuppressed(
  config: Pick<LLMConfig, 'provider' | 'protocol' | 'baseUrl' | 'model'>,
  parameter: SuppressibleParameter,
): boolean {
  const key = getConfigKey(config)
  const parameters = suppressedParameters.get(key)
  if (!parameters) return false

  const expiresAt = parameters.get(parameter)
  if (!expiresAt) return false

  if (expiresAt <= Date.now()) {
    parameters.delete(parameter)
    if (parameters.size === 0) suppressedParameters.delete(key)
    return false
  }

  return true
}

/** 标记参数不可用 */
export function markParameterSuppressed(
  config: Pick<LLMConfig, 'provider' | 'protocol' | 'baseUrl' | 'model'>,
  parameter: SuppressibleParameter,
  reason?: string,
): void {
  const key = getConfigKey(config)
  const parameters = suppressedParameters.get(key) ?? new Map<SuppressibleParameter, number>()
  const expiresAt = Date.now() + SUPPRESSION_TTL_MS
  parameters.set(parameter, expiresAt)
  suppressedParameters.set(key, parameters)

  logger.llm.warn('[ParameterCompatibility] 服务商拒绝该参数，本次会话内不再下发', {
    provider: config.provider,
    protocol: config.protocol,
    model: config.model,
    baseUrl: config.baseUrl,
    parameter,
    reason,
    cooldownMs: SUPPRESSION_TTL_MS,
    retryAfter: new Date(expiresAt).toISOString(),
  })
}

/** 清空降级状态（切换 provider / 测试用） */
export function clearParameterSuppressionState(): void {
  suppressedParameters.clear()
}

const PARAMETER_PATTERNS: ReadonlyArray<{
  parameter: SuppressibleParameter
  pattern: RegExp
}> = [
  { parameter: 'topK', pattern: /\btop_?k\b/i },
  { parameter: 'topP', pattern: /\btop_?p\b/i },
  { parameter: 'temperature', pattern: /\btemperature\b/i },
  { parameter: 'frequencyPenalty', pattern: /frequency_?penalty/i },
  { parameter: 'presencePenalty', pattern: /presence_?penalty/i },
  { parameter: 'stopSequences', pattern: /\bstop(?:_sequences|_sequence)?\b/i },
  { parameter: 'seed', pattern: /\bseed\b/i },
  { parameter: 'reasoningEffort', pattern: /reasoning_?effort/i },
  { parameter: 'parallelToolCalls', pattern: /parallel_?tool_?calls/i },
  { parameter: 'logitBias', pattern: /logit_?bias/i },
  { parameter: 'thinking', pattern: /\bthinking\b/i },
]

/** 表示「这个参数不被接受」的判定词 */
const UNSUPPORTED_SIGNAL_RE =
  /unsupported|not\s+supported|not\s+allowed|not\s+permitted|not\s+accepted|unknown\s+(parameter|field|argument)|invalid\s+(parameter|argument|value)|unrecognized|unexpected|does\s+not\s+support|extra\s+(fields|inputs|keys)/i

/** 把错误里可能藏正文的字段拼成可搜索文本 */
function buildErrorSearchText(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return typeof error === 'string' ? error : ''
  }

  const record = error as Record<string, unknown>
  const parts: string[] = []
  if (typeof record.message === 'string') parts.push(record.message)

  for (const field of ['responseBody', 'data', 'cause', 'body', 'details']) {
    const value = record[field]
    if (typeof value === 'string') {
      parts.push(value)
    } else if (value && typeof value === 'object') {
      try {
        parts.push(JSON.stringify(value))
      } catch {
        // 不可序列化的字段忽略，保留其余部分继续匹配
      }
    }
  }

  return parts.join('\n')
}

/**
 * 判断错误是否指向某个不被支持的具体参数。
 *
 * 要求参数名与「不支持」判定词出现在同一句（按换行 / 分号切分）里，
 * 避免请求体回显里的参数名被误判。
 */
export function detectUnsupportedParameter(
  error: unknown,
): { parameter: SuppressibleParameter; reason: string } | null {
  const haystack = buildErrorSearchText(error)
  if (!haystack) return null

  const sentences = haystack.split(/[\n\r;；。]/)

  for (const sentence of sentences) {
    if (!UNSUPPORTED_SIGNAL_RE.test(sentence)) continue

    for (const { parameter, pattern } of PARAMETER_PATTERNS) {
      if (pattern.test(sentence)) {
        return { parameter, reason: sentence.trim().slice(0, 300) }
      }
    }
  }

  return null
}
