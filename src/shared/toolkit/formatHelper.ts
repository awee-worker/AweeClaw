/**
 * 显示格式化工具集
 *
 * 职责：
 * - 用户名、邮箱、手机号等敏感信息的脱敏显示
 * - 统一格式化规则，确保各 UI 位置显示一致
 */

/**
 * 格式化邮箱地址（脱敏显示）。
 *
 * 规则：
 * - @ 前部分：保留首尾各 3 字符，中间用 4 个 * 替代
 * - 若 @ 前部分长度 ≤ 6，则保留首尾各 1 字符，中间用 ** 替代
 * - @ 后部分（域名）保持不变
 *
 * @example
 * formatEmail('4021910@qq.com')     → '402****10@qq.com'
 * formatEmail('abc@gmail.com')      → 'a***c@gmail.com'
 * formatEmail('ab@gmail.com')       → 'a*b@gmail.com'
 */
export function formatEmail(email: string): string {
  if (!email || !email.includes('@')) return email || ''
  const [local, domain] = email.split('@')
  if (!domain) return email

  if (local.length <= 2) {
    // 极短用户名：原样返回
    return `${local}@${domain}`
  }

  if (local.length <= 6) {
    // 短用户名：保留首尾各 1 字符
    return `${local[0]}${'*'.repeat(Math.max(2, local.length - 2))}${local[local.length - 1]}@${domain}`
  }

  // 常规用户名：保留首尾各 3 字符，中间用 **** 替代
  return `${local.slice(0, 3)}${'*'.repeat(4)}${local.slice(-3)}@${domain}`
}

/**
 * 格式化手机号（脱敏显示）。
 *
 * 规则：保留前 3 位和后 4 位，中间用 **** 替代。
 *
 * @example
 * formatPhone('13612345678') → '136****5678'
 * formatPhone('13800138000') → '138****8000'
 */
export function formatPhone(phone: string): string {
  if (!phone || phone.length < 7) return phone || ''
  // 中国手机号：11 位，保留前 3 + 后 4
  if (phone.length === 11) {
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`
  }
  // 其他长度：保留前 2 + 后 2
  return `${phone.slice(0, 2)}${'*'.repeat(Math.min(4, phone.length - 4))}${phone.slice(-2)}`
}

/**
 * 格式化用户名（脱敏显示）。
 *
 * 规则：
 * - 长度 ≤ 2：原样返回
 * - 长度 ≤ 4：保留首尾各 1 字符，中间用 ** 替代
 * - 长度 > 4：保留首尾各 2 字符，中间用 ** 替代
 *
 * @example
 * formatUsername('jwlee')      → 'jw**ee'
 * formatUsername('john')       → 'j**n'
 * formatUsername('ab')         → 'ab'
 * formatUsername('zhangsan')   → 'zh**an'
 */
export function formatUsername(username: string): string {
  if (!username || username.length <= 2) return username || ''

  if (username.length <= 4) {
    return `${username[0]}**${username[username.length - 1]}`
  }

  return `${username.slice(0, 2)}**${username.slice(-2)}`
}

/**
 * 智能格式化用户显示名称。
 *
 * 根据输入值自动判断类型（手机号 / 邮箱 / 用户名），并调用对应的格式化函数。
 *
 * @param identifier - 用户标识（手机号、邮箱或用户名）
 * @returns 格式化后的显示文本
 *
 * @example
 * formatUserDisplayName('13612345678')  → '136****5678'
 * formatUserDisplayName('4021910@qq.com') → '402****10@qq.com'
 * formatUserDisplayName('jwlee')          → 'jw**ee'
 */
export function formatUserDisplayName(identifier: string): string {
  if (!identifier) return ''

  // 手机号：11 位数字，以 1 开头
  if (/^1[3-9]\d{9}$/.test(identifier)) {
    return formatPhone(identifier)
  }

  // 邮箱：包含 @
  if (identifier.includes('@')) {
    return formatEmail(identifier)
  }

  // 其他：按用户名处理
  return formatUsername(identifier)
}
