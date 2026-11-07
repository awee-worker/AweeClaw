/**
 * 工具调用统一脱敏
 *
 * 用途很窄，边界必须清楚：**只给记录用**——运行记录、日志、审计。
 * 绝不能作用于发给模型的 `content`，否则模型拿到的 key 会变成 `***`，
 * 工具会「莫名其妙失效」，比不脱敏更难排查。
 *
 * 原则是「不确定就当敏感」：
 * - 键名像密钥的字段一律打码，不猜它是不是真的密钥
 * - 命令、脚本源码整段打码：密码可能以任何形式出现（直接写、存变量、拼接），
 *   逐个识别必然漏，索性全打
 * - 常见密钥形态用正则兜底，覆盖用户随手贴进参数里的凭证
 *
 * @module shared/toolkit/redact
 */

/** 打码后的占位 */
const MASK = '***'

/** 常见密钥形态：命中即整体替换 */
const SECRET_PATTERNS: RegExp[] = [
  // OpenAI / 兼容厂商：sk-xxx
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  // GitHub token：ghp_ / gho_ / ghu_ / ghs_ / ghr_
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  // Google API Key
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  // Bearer 头
  /\bBearer\s+[A-Za-z0-9._~+/-]{10,}=*/gi,
  // Slack token
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
  // JWT（三段式）
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // AWS Access Key
  /\bAKIA[0-9A-Z]{16}\b/g,
]

/** 键名像密钥的字段：值整段打码 */
const SENSITIVE_KEY =
  /(pass(word|wd)?|secret|token|api[-_]?key|access[-_]?key|private[-_]?key|credential|authorization|cookie|session[-_]?id|signature)/i

/**
 * 这些工具的这次调用整体算敏感
 *
 * - 终端命令：参数里可能带 token、密码、连接串
 * - 写文件 / 编辑文件：内容可能是 .env、密钥配置、含密码的脚本
 */
const FULLY_REDACTED_TOOLS = new Set([
  'run_command',
  'write_file',
  'edit_file',
  'multi_edit_file',
  'apply_patch',
  'execute_sql',
])

/** 递归深度上限，防御异常嵌套结构 */
const MAX_DEPTH = 6

/** 对字符串做正则兜底打码 */
export function redactText(text: string): string {
  if (!text) return text
  let out = text
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, MASK)
  }
  return out
}

/**
 * 递归脱敏任意值
 *
 * 不修改入参：返回结构相同的新对象/数组，字符串按规则替换。
 * 超出深度上限时整体打成 `***`，宁可丢信息不可泄密。
 */
function redactValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return MASK
  if (typeof value === 'string') return redactText(value)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => redactValue(item, depth + 1))

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? MASK : redactValue(item, depth + 1)
  }
  return out
}

/**
 * 脱敏工具调用参数（写日志 / 运行记录 / 审计前调用）
 *
 * @param toolName 工具名；整体敏感的工具有单独处理
 * @param args 原始参数
 */
export function redactArgs(toolName: string, args: unknown): unknown {
  if (args === undefined || args === null) return args
  if (FULLY_REDACTED_TOOLS.has(toolName)) {
    // 命令与脚本源码整段打码：内容里任何一处都可能是凭证
    return { redacted: true, tool: toolName, reason: 'sensitive_tool' }
  }
  return redactValue(args)
}

/**
 * 脱敏工具结果（写日志 / 运行记录前调用）
 *
 * 结果通常是字符串；非字符串走递归脱敏后序列化，保证日志里不出现原文。
 */
export function redactResult(toolName: string, result: unknown): string {
  if (FULLY_REDACTED_TOOLS.has(toolName)) {
    const length = typeof result === 'string' ? result.length : 0
    return `[redacted ${length} chars]`
  }
  if (typeof result === 'string') return redactText(result)
  try {
    return JSON.stringify(redactValue(result))
  } catch {
    // 序列化失败（循环引用等）：整段不记，宁可丢信息
    return '[redacted: unserializable result]'
  }
}
