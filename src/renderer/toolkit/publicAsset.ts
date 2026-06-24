/**
 * 静态资源解析器 — 构建安全的公共资源 URL
 *
 * 设计理念：
 * - 分离 base 计算与路径拼接，便于单测
 * - 支持开发 / 生产双模式路径解析
 * - 内置路径遍历防护（拒绝 ../ 越权访问）
 * - 缓存已解析结果，避免重复字符串操作
 * - 支持查询参数追加（如版本戳）
 */

/** 已解析路径缓存 */
const resolvedCache = new Map<string, string>()

/** 资源根路径缓存 */
let cachedBase: string | null = null

/**
 * 获取资源根路径（带尾斜杠）
 *
 * - 开发模式：Vite dev server 的 BASE_URL（通常为 '/'）
 * - 生产模式：Electron file:// 协议下的相对路径（'./'）
 */
function getAssetBase(): string {
  if (cachedBase !== null) return cachedBase

  const raw = import.meta.env.BASE_URL || './'
  cachedBase = raw.endsWith('/') ? raw : `${raw}/`
  return cachedBase
}

/**
 * 规范化资源路径：去除前导斜杠，防止路径遍历
 *
 * @param rawPath 原始路径（如 'brand/logos/app.png'）
 * @returns 规范化后的路径
 * @throws 如果路径包含 `..` 越权片段
 */
function normalizeAssetPath(rawPath: string): string {
  // 去除前导斜杠
  const stripped = rawPath.replace(/^\/+/, '')

  // 路径遍历防护
  const segments = stripped.split('/')
  if (segments.some(seg => seg === '..')) {
    throw new Error(`[publicAsset] 路径遍历被拒绝: ${rawPath}`)
  }

  // 过滤空段并重新拼接
  return segments.filter(Boolean).join('/')
}

/**
 * 构建公共资源 URL
 *
 * @param path 相对于 public 目录的路径
 * @param options 可选配置
 * @param options.version 版本戳（用于缓存破坏，如构建哈希）
 * @returns 完整的资源 URL
 *
 * @example
 * publicAsset('brand/logos/app.png')
 * // → './brand/logos/app.png'
 *
 * publicAsset('icons/app.svg', { version: 'a1b2c3' })
 * // → './icons/app.svg?v=a1b2c3'
 */
export function publicAsset(
  path: string,
  options?: { version?: string },
): string {
  const cacheKey = `${path}::${options?.version ?? ''}`

  const cached = resolvedCache.get(cacheKey)
  if (cached) return cached

  const base = getAssetBase()
  const normalized = normalizeAssetPath(path)
  const url = options?.version
    ? `${base}${normalized}?v=${encodeURIComponent(options.version)}`
    : `${base}${normalized}`

  resolvedCache.set(cacheKey, url)
  return url
}

/** 清除路径缓存（用于测试或 BASE_URL 变更） */
export function clearAssetCache(): void {
  resolvedCache.clear()
  cachedBase = null
}

export default publicAsset
