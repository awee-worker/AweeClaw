/**
 * 数字格式化工具
 * 提供统一的数字显示格式，支持 K/M/G 简写
 */

/**
 * 格式化数字为带千位分隔符的字符串
 * @example formatNumber(1234567) => "1,234,567"
 */
export function formatNumber(n: number): string {
  if (n === undefined || n === null || isNaN(n)) return '0'
  return n.toLocaleString('en-US')
}

/**
 * 紧凑格式化数字（K/M/G 简写）
 * - < 1000: 原样显示
 * - < 1_000_000: 以 K 显示，保留 1 位小数（如 12.3K）
 * - < 1_000_000_000: 以 M 显示，保留 1 位小数
 * - >= 1_000_000_000: 以 G 显示，保留 1 位小数
 *
 * @example formatCompact(0) => "0"
 * @example formatCompact(999) => "999"
 * @example formatCompact(1500) => "1.5K"
 * @example formatCompact(1234567) => "1.2M"
 * @example formatCompact(1500000000) => "1.5G"
 */
export function formatCompact(n: number): string {
  if (n === undefined || n === null || isNaN(n)) return '0'
  if (n < 0) return `-${formatCompact(-n)}`
  if (n < 1000) return Math.floor(n).toString()

  const units = [
    { value: 1_000_000_000, symbol: 'G' },
    { value: 1_000_000, symbol: 'M' },
    { value: 1_000, symbol: 'K' },
  ]

  for (const { value, symbol } of units) {
    if (n >= value) {
      const formatted = n / value
      // 整数则不带小数，否则保留 1 位
      const str = formatted >= 100
        ? Math.round(formatted).toString()
        : formatted.toFixed(1).replace(/\.0$/, '')
      return `${str}${symbol}`
    }
  }

  return Math.floor(n).toString()
}

/**
 * 格式化 Token 用量：大数紧凑显示，小数原样显示
 * 用于状态栏、配额卡片等空间有限的场景
 *
 * @example formatTokenCount(0) => "0"
 * @example formatTokenCount(500) => "500"
 * @example formatTokenCount(1500) => "1.5K"
 * @example formatTokenCount(1234567) => "1.2M"
 */
export function formatTokenCount(n: number): string {
  return formatCompact(n)
}
