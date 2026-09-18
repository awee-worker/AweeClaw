/**
 * 版本比较工具集
 *
 * 职责：
 * - 按分段数值比较版本号，避免字符串字典序带来的误判
 *   （字典序下 "1.10.0" < "1.9.0"，直接把 1.10 当成旧版本）
 * - 从目录名列表中识别版本号目录，并挑出最新版本
 */

/** 版本号目录名：可选 v 前缀 + 数字点分段 + 可选 -/+ 后缀（如 1.10.0、v1.2、1.0.0-rc1） */
const VERSION_DIR_PATTERN = /^v?\d+(?:\.\d+)*(?:[-+][0-9A-Za-z.-]+)?$/

/**
 * 判断目录名是否形如版本号。
 *
 * 版本目录下可能混有临时目录、备份目录等非版本条目，挑选前需要先排除。
 */
export function isVersionDirName(name: string): boolean {
  return VERSION_DIR_PATTERN.test(name.trim())
}

/**
 * 比较两个版本号。
 *
 * 按点分段的数值逐段比较（而非字符串字典序），缺段按 0 处理，
 * 前导 v 与 -/+ 后缀不参与比较（后缀段经 parseInt 自然归零）。
 *
 * @returns 正数表示 a 更新，负数表示 b 更新，0 表示相同
 *
 * @example
 * compareVersions('1.10.0', '1.9.0')  // → 1，字典序比较会得到相反结果
 * compareVersions('1.2.0', '1.2')     // → 0
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) =>
    v
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((n) => parseInt(n, 10) || 0)

  const pa = parse(a)
  const pb = parse(b)
  const len = Math.max(pa.length, pb.length)

  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na !== nb) return na - nb
  }
  return 0
}

/**
 * 从目录名列表中挑出最新版本目录。
 *
 * 优先在可识别的版本号目录中取语义版本最大者；若列表中没有版本号目录，
 * 退回字典序最大者——保持调用方原有的兜底行为，避免返回空导致路径缺少版本段。
 *
 * @param names 目录名列表（单层目录名，非完整路径）
 * @returns 最新的目录名；列表为空时返回 null
 */
export function pickLatestVersionDir(names: string[]): string | null {
  if (names.length === 0) return null

  const versioned = names.filter(isVersionDirName)
  if (versioned.length > 0) {
    return versioned.reduce((best, cur) => (compareVersions(cur, best) > 0 ? cur : best))
  }

  return [...names].sort()[names.length - 1]
}
