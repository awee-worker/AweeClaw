/**
 * A2A 配置存储（主进程）
 *
 * 存储布局：
 *   <userData>/a2a/a2a_config.json
 *
 * 与 LiveStore / VtsStore / OverlayStore 一致的做法：直读直写 JSON，
 * 读取失败回落默认值，非法值在合并阶段被忽略（不做 schema 库校验）。
 *
 * 安全约定（两处凭证都需要加密落盘）：
 *   - `servers[url].token`  外部 agent 的访问凭证
 *   - `inbound.token`       入站服务的访问凭证（等于「谁都能指挥本机 AI」的钥匙）
 *
 * 为什么 servers 用 **map 而不是数组**：URL 是天然主键，且与源项目
 * `settings["a2aServers"]` 同构，便于行为对齐；数组还需要处理重复 URL。
 *
 * @module a2a/A2aStore
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { decryptString, encryptString } from '../../guard/safeStorageUtil'
import type { A2aConfig, A2aInboundConfig, A2aServerEntry } from '@shared/protocols/a2aProtocol'

// ============================================
// 常量
// ============================================

const A2A_DIR_NAME = 'a2a'
const CONFIG_FILE_NAME = 'a2a_config.json'

/** 入站服务默认端口（避开 overlay / 常见开发端口） */
export const DEFAULT_A2A_PORT = 8790

/** 入站服务默认监听地址：只允许本机 */
export const DEFAULT_INBOUND_HOST = '127.0.0.1'

/** 环回地址白名单（非白名单地址必须在 UI 显式确认后才允许监听） */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/** 单个 agent 配置的默认值（合并时的形状基准） */
export const DEFAULT_SERVER_ENTRY: A2aServerEntry = {
  enabled: false,
  description: '',
  skills: [],
  token: '',
  headers: {},
  addedAt: 0,
}

/** 入站配置默认值 */
export const DEFAULT_INBOUND_CONFIG: A2aInboundConfig = {
  enabled: false,
  host: DEFAULT_INBOUND_HOST,
  port: DEFAULT_A2A_PORT,
  token: '',
  allowExternal: false,
  agentName: 'AweeClaw',
  agentDescription: 'AweeClaw 本地智能体（A2A Agent2Agent 协议）',
}

/** 默认配置（每次调用返回新对象，避免共享可变状态） */
export function createDefaultConfig(): A2aConfig {
  return {
    enabled: false,
    servers: {},
    inbound: { ...DEFAULT_INBOUND_CONFIG },
  }
}

/** 默认配置的只读快照（供 UI 展示 / 重置使用） */
export const DEFAULT_A2A_CONFIG: A2aConfig = createDefaultConfig()

// ============================================
// 路径工具
// ============================================

/** A2A 模块数据目录（<userData>/a2a） */
export function getA2aDataDir(): string {
  return path.join(app.getPath('userData'), A2A_DIR_NAME)
}

/** 配置文件绝对路径 */
export function getA2aConfigPath(): string {
  return path.join(getA2aDataDir(), CONFIG_FILE_NAME)
}

function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.system.warn('[A2A] ensureDir failed:', dir, err)
  }
}

// ============================================
// URL 规范化与校验
// ============================================

/**
 * 规范化 agent URL：去空白、去尾部斜杠、小写协议与主机。
 *
 * 作为 map 的键必须稳定 —— 否则用户手输 `Http://Host:8080/` 与
 * `http://host:8080` 会变成两个 agent。
 */
export function normalizeAgentUrl(raw: string): string {
  const trimmed = (raw || '').trim()
  if (!trimmed) return ''
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    // pathname 形如 '/' 时统一归零，其余保留（部分实现把 agent 挂在子路径）
    const pathname = url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, '')
    return `${url.protocol}//${url.host}${pathname}${url.search}`
  } catch {
    return ''
  }
}

/** URL 是否合法（http/https） */
export function isValidAgentUrl(raw: string): boolean {
  return normalizeAgentUrl(raw) !== ''
}

// ============================================
// 深合并
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

/** 合并单个 agent 条目 */
function mergeServerEntry(patch: unknown): A2aServerEntry {
  const merged = mergeShallow(DEFAULT_SERVER_ENTRY as unknown as Record<string, unknown>, patch)
  const entry = merged as unknown as A2aServerEntry
  return {
    enabled: entry.enabled === true,
    description: typeof entry.description === 'string' ? entry.description : '',
    skills: Array.isArray(entry.skills) ? entry.skills : [],
    token: typeof entry.token === 'string' ? entry.token : '',
    headers:
      entry.headers && typeof entry.headers === 'object' && !Array.isArray(entry.headers)
        ? entry.headers
        : {},
    addedAt: typeof entry.addedAt === 'number' && entry.addedAt > 0 ? entry.addedAt : 0,
  }
}

/** 合并 servers map（键统一规范化；非法 URL 直接丢弃） */
function mergeServers(patch: unknown): Record<string, A2aServerEntry> {
  const out: Record<string, A2aServerEntry> = {}
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return out

  for (const [rawUrl, rawEntry] of Object.entries(patch as Record<string, unknown>)) {
    const url = normalizeAgentUrl(rawUrl)
    if (!url) {
      logger.system.warn('[A2A] ignore invalid agent url in config:', rawUrl)
      continue
    }
    out[url] = mergeServerEntry(rawEntry)
  }
  return out
}

/** 合并入站配置 */
function mergeInbound(patch: unknown): A2aInboundConfig {
  const merged = mergeShallow(
    DEFAULT_INBOUND_CONFIG as unknown as Record<string, unknown>,
    patch,
  ) as unknown as A2aInboundConfig

  const host = typeof merged.host === 'string' && merged.host.trim() ? merged.host.trim() : DEFAULT_INBOUND_HOST
  const port =
    typeof merged.port === 'number' && Number.isInteger(merged.port) && merged.port > 0 && merged.port < 65536
      ? merged.port
      : DEFAULT_A2A_PORT

  return {
    enabled: merged.enabled === true,
    host,
    port,
    token: typeof merged.token === 'string' ? merged.token : '',
    // 允许外网是「危险能力」：任何一次读盘都要重新计算，不能只信存量标记
    allowExternal: merged.allowExternal === true && !LOOPBACK_HOSTS.has(host),
    agentName: typeof merged.agentName === 'string' && merged.agentName.trim() ? merged.agentName.trim() : 'AweeClaw',
    agentDescription:
      typeof merged.agentDescription === 'string' ? merged.agentDescription : DEFAULT_INBOUND_CONFIG.agentDescription,
  }
}

/** 合并整体配置 */
export function mergeConfig(patch: unknown): A2aConfig {
  const source = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>
  return {
    enabled: source.enabled === true,
    servers: mergeServers(source.servers),
    inbound: mergeInbound(source.inbound),
  }
}

// ============================================
// 凭证加解密
// ============================================

/** 落盘前：加密 token（servers 与 inbound 各一处） */
function encryptSecrets(config: A2aConfig): A2aConfig {
  const servers: Record<string, A2aServerEntry> = {}
  for (const [url, entry] of Object.entries(config.servers)) {
    servers[url] = { ...entry, token: entry.token ? encryptString(entry.token) : '' }
  }
  return {
    ...config,
    servers,
    inbound: {
      ...config.inbound,
      token: config.inbound.token ? encryptString(config.inbound.token) : '',
    },
  }
}

/** 读盘后：解密 token（兼容旧版明文：decryptString 对无前缀值原样返回） */
function decryptSecrets(config: A2aConfig): A2aConfig {
  const servers: Record<string, A2aServerEntry> = {}
  for (const [url, entry] of Object.entries(config.servers)) {
    servers[url] = { ...entry, token: entry.token ? decryptString(entry.token) : '' }
  }
  return {
    ...config,
    servers,
    inbound: {
      ...config.inbound,
      token: config.inbound.token ? decryptString(config.inbound.token) : '',
    },
  }
}

// ============================================
// 配置读写
// ============================================

/** 内存缓存（避免每次读盘 + 重复解密） */
let cached: A2aConfig | null = null

/** 读取配置（带内存缓存，token 已解密） */
export function getConfig(): A2aConfig {
  if (cached) return cached

  const filePath = getA2aConfigPath()
  try {
    if (!fs.existsSync(filePath)) {
      cached = createDefaultConfig()
      return cached
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    cached = decryptSecrets(mergeConfig(parsed))
  } catch (err) {
    logger.system.warn('[A2A] read config failed, fallback to default:', err)
    cached = createDefaultConfig()
  }
  return cached
}

/** 写入配置（token 加密后落盘） */
export function saveConfig(next: A2aConfig): void {
  cached = next
  try {
    ensureDir(getA2aDataDir())
    fs.writeFileSync(getA2aConfigPath(), JSON.stringify(encryptSecrets(next), null, 2), 'utf-8')
  } catch (err) {
    logger.system.error('[A2A] save config failed:', err)
  }
}

/**
 * 局部更新配置。
 *
 * ⚠️ 刻意**不做**「patch 里没有的 server 就删除」的语义：
 * servers 是整表替换（patch 里的 servers 若存在即为完整新表），
 * 单点增删由 `upsertServer / removeServer` 提供，语义更明确。
 */
export function updateConfig(patch: unknown): A2aConfig {
  const current = getConfig()
  const source = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>

  const next: A2aConfig = {
    enabled: source.enabled === undefined ? current.enabled : source.enabled === true,
    servers: source.servers === undefined ? current.servers : mergeServers(source.servers),
    inbound: source.inbound === undefined ? current.inbound : mergeInbound(source.inbound),
  }

  saveConfig(next)
  return next
}

/** 新增 / 局部更新一个 agent（patch 为 partial，未提供的字段保留原值） */
export function upsertServer(url: string, patch: Partial<A2aServerEntry>): A2aConfig {
  const normalized = normalizeAgentUrl(url)
  if (!normalized) throw new Error('无效的 A2A 智能体地址（必须以 http:// 或 https:// 开头）')

  const current = getConfig()
  const existing = current.servers[normalized]
  const merged = mergeServerEntry({ ...(existing ?? {}), ...patch, addedAt: existing?.addedAt ?? Date.now() })

  return saveConfigImmediate({
    ...current,
    servers: { ...current.servers, [normalized]: merged },
  })
}

/** 删除一个 agent */
export function removeServer(url: string): A2aConfig {
  const normalized = normalizeAgentUrl(url)
  const current = getConfig()
  if (!normalized || !current.servers[normalized]) return current

  const servers = { ...current.servers }
  delete servers[normalized]
  return saveConfigImmediate({ ...current, servers })
}

/** 重置为默认配置（会清掉所有 token） */
export function resetConfig(): A2aConfig {
  const next = createDefaultConfig()
  saveConfig(next)
  return next
}

/** 内部：立即写入并返回（等价 saveConfig 但返回同一对象） */
function saveConfigImmediate(next: A2aConfig): A2aConfig {
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
export function validateConfig(config: A2aConfig): string[] {
  const issues: string[] = []

  const enabledEntries = Object.entries(config.servers).filter(([, entry]) => entry.enabled)
  if (config.enabled && enabledEntries.length === 0) {
    issues.push('已开启 A2A 出站，但没有任何「已启用」的智能体，模型将看不到 a2a_tool_call 工具')
  }
  for (const [url, entry] of enabledEntries) {
    if (!entry.description.trim()) issues.push(`智能体 ${url} 未填写用途描述（模型将难以判断何时调用）`)
  }

  if (config.inbound.enabled) {
    const host = config.inbound.host
    if (!LOOPBACK_HOSTS.has(host) && !config.inbound.allowExternal) {
      issues.push('入站服务监听非本机地址，但未勾选「允许外部访问」，将回退为 127.0.0.1')
    }
    if (!LOOPBACK_HOSTS.has(host) && !config.inbound.token) {
      issues.push('入站服务对外暴露时必须设置访问 Token，否则任何人都能调用本机 AI')
    }
  }

  return issues
}

/** 入站监听地址是否会被安全策略降级为环回地址 */
export function shouldFallbackToLoopback(inbound: A2aInboundConfig): boolean {
  return !LOOPBACK_HOSTS.has(inbound.host) && !inbound.allowExternal
}
