/**
 * 记忆价值闸门
 *
 * 自动抽取最容易滑向「什么都记」：一次性的问答、寒暄、助手输出回显、
 * 被截断的半句话都会沉淀下来，把真正有用的条目稀释掉。
 *
 * 这里用确定性规则做准入判断，不调用模型 —— 闸门本身要是可预测的，
 * 否则它就成了新的幻觉来源。规则只判断「值不值得记」，不判断「对不对」。
 */

export interface MemoryValueVerdict {
  /** 是否值得沉淀为记忆 */
  keep: boolean
  /** 价值分 0~1，同时作为写入时的置信度 */
  score: number
  /** 判定原因，便于排查误杀与漏网 */
  reason: string
}

/** 去空白后的最低有效长度 */
const MIN_CONTENT_LENGTH = 8

/** 低于该分值不写入 */
export const MIN_MEMORY_VALUE = 0.35

/**
 * 明确「值得记」的信号：用户显式声明的偏好、规则、约定与纠正。
 * 权重叠加后作为价值分，命中越多分越高。
 */
const HIGH_VALUE_SIGNALS: Array<{ pattern: RegExp; weight: number }> = [
  { pattern: /(记住|牢记|别忘了|以后(都|要|一律)|从现在起|永久)/, weight: 0.45 },
  { pattern: /(我(喜欢|偏好|习惯|倾向|一般|通常)|我的习惯|我讨厌|我不喜欢)/, weight: 0.4 },
  { pattern: /(不要|别|禁止|必须|一定要|绝对不|永远不|只能)/, weight: 0.3 },
  { pattern: /(规则|约定|规范|标准|原则|要求是|流程是|定义为)/, weight: 0.35 },
  { pattern: /(我的项目|我们的项目|公司|团队)(用|采用|是|使用)/, weight: 0.3 },
  { pattern: /(不对|错了|不是这样|应该是|其实是|纠正)/, weight: 0.35 },
  { pattern: /\b(remember|from now on|always|never|prefer|my rule|convention)\b/i, weight: 0.35 },
]

/**
 * 明确「不值得记」的模式：寒暄、确认、纯提问、一次性动作。
 * 这些内容跨会话没有复用价值，记下来只会污染召回结果。
 */
const LOW_VALUE_PATTERNS: RegExp[] = [
  /^(你好|您好|在吗|hi|hello|hey|早上好|中午好|晚上好|谢谢|多谢|感谢|不客气|辛苦了|ok|okay|好的|好嘞|嗯|收到|明白|了解|继续|加油|哈哈+)[\s!！。.~～]*$/i,
  /^(帮我|请|麻烦)?(看看|查一下|算一下|写一个|生成一个|改一下|优化一下|解释一下|介绍一下)/,
  /^(什么|为什么|怎么|如何|是否|能不能|可不可以|有没有|哪里|哪个|多少)/,
  /[?？]$/,
]

/** 结尾是连接词或标点，多半是正则截断后留下的残句 */
const TRUNCATED_TAIL = /[和与及或而并、，,：:；;]$/

/**
 * 从捕获到的原文里截出可独立成句的核心内容。
 *
 * 规则正则用的是贪婪捕获，会把「不要用 python，今天先看文档」整句吃进来。
 * 这里按句末标点切出第一句，避免把同一行里无关的后半段一并记下。
 */
export function extractSalientSentence(raw: string): string {
  const text = (raw ?? '').trim()
  if (!text) return ''

  const firstSentence = text.split(/[。！？；!?\n]/)[0].trim()
  const candidate = firstSentence.length > 0 ? firstSentence : text
  return candidate.slice(0, 120).trim()
}

/**
 * 评估一条待写入内容的记忆价值。
 *
 * @param content  待评估的候选内容
 * @param options  explicit=true 表示由用户显式要求记住，直接放行
 */
export function evaluateMemoryValue(
  content: string,
  options: { explicit?: boolean } = {},
): MemoryValueVerdict {
  const text = (content ?? '').trim()

  if (text.length < MIN_CONTENT_LENGTH) {
    return { keep: false, score: 0, reason: '内容过短，信息量不足' }
  }

  if (options.explicit) {
    return { keep: true, score: 0.95, reason: '用户显式要求记住' }
  }

  for (const pattern of LOW_VALUE_PATTERNS) {
    if (pattern.test(text)) {
      return { keep: false, score: 0, reason: '一次性问答或寒暄，无沉淀价值' }
    }
  }

  if (TRUNCATED_TAIL.test(text)) {
    return { keep: false, score: 0, reason: '疑似被截断的残句' }
  }

  let score = 0.3
  for (const signal of HIGH_VALUE_SIGNALS) {
    if (signal.pattern.test(text)) {
      score += signal.weight
    }
  }

  // 有一定长度的陈述句，信息量通常高于短句
  if (text.length >= 16) score += 0.05

  score = Math.max(0, Math.min(1, score))
  return {
    keep: score >= MIN_MEMORY_VALUE,
    score,
    reason: score >= MIN_MEMORY_VALUE ? '具备跨会话复用价值' : '价值分不足',
  }
}
