/**
 * 对外 API 网关配置存储（主进程）
 *
 * 存储布局：
 *   <userData>/openapi/openapi_config.json
 *
 * 与 A2aStore / OverlayStore 一致的做法：直读直写 JSON，读取失败回落默认值，
 * 非法值在合并阶段被忽略（不做 schema 库校验）。内存缓存避免每次读盘 + 重复解密。
 *
 * 安全约定（两道联动铁律）：
 *   1. `allowExternal` 只在 **host 非环回** 且 **apiKey 非空** 时才成立。
 *      任何一次读盘都要重新计算 —— 「许可证」不能是存量标记：
 *      用户先勾了对外、后来又清空密钥，此时存量标记若被信任就等于裸奔。
 *   2. `apiKey` 用 safeStorage 加密落盘（读取时解密返回）。
 *
 * @module openapi/OpenApiStore
 */

import { app } from 'electron'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { decryptString, encryptString } from '../../guard/safeStorageUtil'
import {
  DEFAULT_CORS_ORIGINS,
  DEFAULT_OPEN_API_HOST,
  DEFAULT_OPEN_API_PORT,
  OPEN_API_LOOPBACK_HOSTS,
} from '@shared/protocols/openApiProtocol'
import type { OpenApiConfig } from '@shared/protocols/openApiProtocol'

// ============================================
// 常量
// ============================================

const OPEN_API_DIR_NAME = 'openapi'
const CONFIG_FILE_NAME = 'openapi_config.json'

/** 默认配置 */
export const DEFAULT_OPEN_API_CONFIG: OpenApiConfig = {
  enabled: false,
  host: DEFAULT_OPEN_API_HOST,
  port: DEFAULT_OPEN_API_PORT,
  apiKey: '',
  allowExternal: false,
  corsOrigins: [...DEFAULT_CORS_ORIGINS],
  allowDangerousToolCall: false,
}

/** 默认配置（每次调用返回新对象，避免共享可变状态） */
export function createDefaultConfig(): OpenApiConfig {
  return { ...DEFAULT_OPEN_API_CONFIG, corsOrigins: [...DEFAULT_OPEN_API_CONFIG.corsOrigins] }
}

// ============================================
// 路径工具
// ============================================

/** 网关数据目录（<userData>/openapi） */
export function getOpenApiDataDir(): string {
  return path.join(app.getPath('userData'), OPEN_API_DIR_NAME)
}

/** 配置文件绝对路径 */
export function getOpenApiConfigPath(): string {
  return path.join(getOpenApiDataDir(), CONFIG_FILE_NAME)
}

function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.system.warn('[OpenApi] ensureDir failed:', dir, err)
  }
}

// ============================================
// 校验工具
// ============================================

/** 地址是否环回（决定能否对外监听） */
export function isLoopbackHost(host: string): boolean {
  return OPEN_API_LOOPBACK_HOSTS.includes(host)
}

/** 端口是否合法 */
export function isValidPort(port: unknown): port is number {
  return typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536
}

/**
 * 规范化来源：只保留 `<scheme>://<host>[:port]`，丢弃路径与尾斜杠。
 *
 * 作为白名单必须能精确比对 —— 浏览器发来的 Origin 头永远不带尾斜杠，
 * 用户在设置页手输 `http://localhost:3000/` 却匹配不上是典型的「配了没生效」。
 */
export function normalizeOrigin(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `http://${trimmed}`)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return `${url.protocol}//${url.host}`
  } catch {
    return ''
  }
}

/** 生成随机 apiKey（设置页「生成」按钮用，也可由用户自填） */
export function generateApiKey(): string {
  return `sk-awee-${crypto.randomBytes(24).toString('base64url')}`
}

// ============================================
// 合并
// ============================================

/** 合并基础字段（只覆盖 fallback 中已声明且类型一致的键） */
function mergeShallow<T extends Record<string, unknown>>(fallback: T, patch: unknown): T {
  if (patch === null || patch === undefined || typeof patch !== 'object') return { ...fallback }
  const source = patch as Record<string, unknown>
  const out: Record<string, unknown> = { ...fallback }

  for (const key of Object.keys(fallback)) {
    const next = source[key]
    if (next === undefined) continue
    const current = fallback[key]
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      if (next !== null && typeof next === 'object' && !Array.isArray(next)) {
        out[key] = { ...(current as object), ...(next as object) }
      }
      continue
    }
    if (Array.isArray(current)) {
      if (Array.isArray(next)) {
        out[key] = next.filter((item): item is string => typeof item === 'string')
      }
      continue
    }
    if (typeof next === typeof current) out[key] = next
  }

  return out as T
}

/**
 * 合并配置。
 *
 * 两道安全联动都在这里做（**每次读盘与每次写入都会经过**）：
 *   - host 非环回但未勾 allowExternal → 降级回环
 *   - 勾了 allowExternal 但 apiKey 为空 → 降级 allowExternal
 * 降级而不是拒绝，理由同 A2A：用户配置不该因为一条安全策略就丢掉。
 */
export function mergeConfig(patch: unknown): OpenApiConfig {
  const source = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
  const merged = mergeShallow(
    DEFAULT_OPEN_API_CONFIG as unknown as Record<string, unknown>,
    source,
  ) as unknown as OpenApiConfig

  const host = typeof merged.host === 'string' && merged.host.trim() ? merged.host.trim() : DEFAULT_OPEN_API_HOST
  const port = isValidPort(merged.port) ? merged.port : DEFAULT_OPEN_API_PORT
  const apiKey = typeof merged.apiKey === 'string' ? merged.apiKey.trim() : ''

  const rawOrigins = Array.isArray(merged.corsOrigins) ? merged.corsOrigins : []
  const corsOrigins = Array.from(
    new Set(rawOrigins.map((o) => normalizeOrigin(String(o))).filter(Boolean)),
  )

  const externalAllowed = merged.allowExternal === true && !isLoopbackHost(host) && Boolean(apiKey)

  return {
    enabled: merged.enabled === true,
    host,
    port,
    apiKey,
    allowExternal: externalAllowed,
    corsOrigins,
    allowDangerousToolCall: merged.allowDangerousToolCall === true,
  }
}

// ============================================
// 凭证加解密
// ============================================

/** 落盘前：加密 apiKey */
function encryptSecrets(config: OpenApiConfig): OpenApiConfig {
  return { ...config, apiKey: config.apiKey ? encryptString(config.apiKey) : '' }
}

/** 读盘后：解密 apiKey（decryptString 对无前缀值原样返回，兼容旧版明文） */
function decryptSecrets(config: OpenApiConfig): OpenApiConfig {
  return { ...config, apiKey: config.apiKey ? decryptString(config.apiKey) : '' }
}

// ============================================
// 配置读写
// ============================================

/** 内存缓存（避免每次读盘 + 重复解密） */
let cached: OpenApiConfig | null = null

/** 读取配置（带内存缓存，apiKey 已解密） */
export function getConfig(): OpenApiConfig {
  if (cached) return cached

  const filePath = getOpenApiConfigPath()
  try {
    if (!fs.existsSync(filePath)) {
      cached = createDefaultConfig()
      return cached
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    cached = decryptSecrets(mergeConfig(parsed))
  } catch (err) {
    logger.system.warn('[OpenApi] read config failed, fallback to default:', err)
    cached = createDefaultConfig()
  }
  return cached
}

/** 写入配置（apiKey 加密后落盘） */
export function saveConfig(next: OpenApiConfig): void {
  cached = next
  try {
    ensureDir(getOpenApiDataDir())
    fs.writeFileSync(getOpenApiConfigPath(), JSON.stringify(encryptSecrets(next), null, 2), 'utf-8')
  } catch (err) {
    logger.system.error('[OpenApi] save config failed:', err)
  }
}

/** 局部更新配置（未提供的字段保留原值） */
export function updateConfig(patch: unknown): OpenApiConfig {
  const current = getConfig()
  const source = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>

  // apiKey 空串视为「沿用已保存的密钥」而非「清空」：
  // 设置页为避免把密钥平铺进 DOM，编辑时输入框是空的；
  // 若把空串当清空，用户改一下端口就会顺手把准入凭证抹掉。
  const mergedSource = { ...source }
  if (mergedSource.apiKey === '' || mergedSource.apiKey === undefined) {
    delete mergedSource.apiKey
  }

  const next = mergeConfig({ ...current, ...mergedSource })
  saveConfig(next)
  return next
}

/** 重置为默认配置（会清掉 apiKey） */
export function resetConfig(): OpenApiConfig {
  const next = createDefaultConfig()
  saveConfig(next)
  return next
}

/** 清除内存缓存（测试 / 热重载用） */
export function clearConfigCache(): void {
  cached = null
}

// ============================================
// 校验
// ============================================

/** 配置是否完整（返回中文提示列表，不阻断保存） */
export function validateConfig(config: OpenApiConfig): string[] {
  const issues: string[] = []

  if (config.enabled && !config.apiKey) {
    issues.push('未设置准入密钥：任何本机程序都能调用本机模型额度，建议点击「生成」并保存')
  }

  if (!isLoopbackHost(config.host)) {
    if (!config.allowExternal) {
      issues.push('监听地址非本机，但未勾选「允许外部访问」，将回退为 127.0.0.1')
    } else if (!config.apiKey) {
      issues.push('对外暴露时必须设置准入密钥，否则整个局域网都能调用本机模型')
    }
  }

  if (config.allowDangerousToolCall) {
    issues.push('已允许外部通过 /mcp 执行写文件、执行命令等操作：请确认仅在完全可信的网络中使用')
  }

  if (config.corsOrigins.length === 0) {
    issues.push('CORS 白名单为空：仅本机来源（localhost / 127.0.0.1）的 Web 客户端可访问，桌面客户端不受影响')
  }

  return issues
}

/** 监听地址是否会被安全策略降级为环回地址 */
export function shouldFallbackToLoopback(config: OpenApiConfig): boolean {
  return !isLoopbackHost(config.host) && !config.allowExternal
}
