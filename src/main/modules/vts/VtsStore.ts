/**
 * VTS 配置存储（主进程）
 *
 * 存储布局：
 *   <userData>/vts/vts_config.json
 *
 * 与 LiveStore / OverlayStore 保持一致的做法：直读直写 JSON，读取失败回落默认值，
 * 不做 schema 校验（配置项都有默认值，非法值在合并阶段被忽略）。
 *
 * 安全约定：`token` 是 VTS 下发的插件凭据（等于本机的模型控制权），落盘前必须
 * 用 safeStorage 加密（`enc:v1:` 前缀），读盘后解密回内存。
 *
 * 路径约定：token 落在 AweeClaw 标准用户配置目录（`app.getPath('userData')`），
 * 不写项目根 —— 源项目把它写在 `USER_DATA_DIR`，语义一致。
 *
 * @module vts/VtsStore
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { decryptString, encryptString } from '../../guard/safeStorageUtil'
import type { VtsConfig } from './types'

// ============================================
// 常量
// ============================================

const VTS_DIR_NAME = 'vts'
const CONFIG_FILE_NAME = 'vts_config.json'

/** 需要加密落盘的字段（token 等同于本机模型控制权） */
const SECRET_FIELDS: readonly (keyof VtsConfig)[] = ['token'] as const

/** VTS 公共 API 默认地址（VTS 设置里开启「允许插件访问」后监听） */
export const DEFAULT_VTS_URL = 'ws://127.0.0.1:8001'

/**
 * 默认配置。
 *
 * `enabled: false` —— 与直播模块同一铁律：外部应用的接管能力必须由用户主动开启。
 */
export const DEFAULT_VTS_CONFIG: VtsConfig = {
  enabled: false,
  url: DEFAULT_VTS_URL,
  token: '',
  pluginName: 'AweeClaw',
  pluginDeveloper: 'AweeClaw',
  lipSyncMode: 'fft',
  autoLipSync: true,
  enabledExpressions: true,
  enabledMotions: true,
}

// ============================================
// 路径工具
// ============================================

/** VTS 模块数据目录（<userData>/vts） */
export function getVtsDataDir(): string {
  return path.join(app.getPath('userData'), VTS_DIR_NAME)
}

/** 配置文件绝对路径 */
export function getVtsConfigPath(): string {
  return path.join(getVtsDataDir(), CONFIG_FILE_NAME)
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.system.warn('[VTS] ensureDir failed:', dir, err)
  }
}

// ============================================
// 深合并
// ============================================

/**
 * 深合并：只覆盖 fallback 中已声明的键，且类型必须一致。
 *
 * 旧版本配置文件缺字段时不会丢默认值；用户手改出非法类型时也不会污染内存。
 */
function mergeConfig<T>(fallback: T, patch: unknown): T {
  if (patch === null || patch === undefined || typeof patch !== 'object') return fallback
  if (Array.isArray(fallback)) return fallback

  const source = patch as Record<string, unknown>
  const base = fallback as unknown as Record<string, unknown>
  const out: Record<string, unknown> = { ...base }

  for (const key of Object.keys(base)) {
    const next = source[key]
    if (next === undefined) continue
    const current = base[key]
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      out[key] = mergeConfig(current, next)
    } else if (typeof next === typeof current) {
      out[key] = next
    }
  }

  return out as T
}

// ============================================
// 凭证加解密
// ============================================

/** 落盘前：加密 token（返回可直接 JSON.stringify 的对象） */
function encryptSecrets(config: VtsConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config }
  for (const field of SECRET_FIELDS) {
    const value = config[field]
    out[field] = typeof value === 'string' && value ? encryptString(value) : ''
  }
  return out
}

/** 读盘后：解密 token（兼容旧版明文：decryptString 对无前缀值原样返回） */
function decryptSecrets(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw }
  for (const field of SECRET_FIELDS) {
    const value = out[field]
    out[field] = typeof value === 'string' && value ? decryptString(value) : ''
  }
  return out
}

// ============================================
// 配置读写
// ============================================

/** 内存缓存（避免每次读磁盘 + 重复解密） */
let cached: VtsConfig | null = null

/** 读取配置（带内存缓存，token 已解密） */
export function getConfig(): VtsConfig {
  if (cached) return cached

  const filePath = getVtsConfigPath()
  try {
    if (!fs.existsSync(filePath)) {
      cached = { ...DEFAULT_VTS_CONFIG }
      return cached
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    cached = mergeConfig(DEFAULT_VTS_CONFIG, decryptSecrets(parsed))
    // 地址是本地环回，允许用户在配置里改端口；但空值回落默认，避免连到空字符串
    if (!cached.url) cached.url = DEFAULT_VTS_URL
  } catch (err) {
    logger.system.warn('[VTS] read config failed, fallback to default:', err)
    cached = { ...DEFAULT_VTS_CONFIG }
  }
  return cached
}

/** 写入配置（token 加密后落盘） */
export function saveConfig(next: VtsConfig): void {
  cached = next
  try {
    ensureDir(getVtsDataDir())
    const payload = JSON.stringify(encryptSecrets(next), null, 2)
    fs.writeFileSync(getVtsConfigPath(), payload, 'utf-8')
  } catch (err) {
    logger.system.error('[VTS] save config failed:', err)
  }
}

/** 局部更新配置（深合并到当前值，落盘并返回新值） */
export function updateConfig(patch: unknown): VtsConfig {
  const next = mergeConfig(getConfig(), patch)
  saveConfig(next)
  return next
}

/** 重置为默认配置（会清掉 token，等于撤销授权） */
export function resetConfig(): VtsConfig {
  const next = { ...DEFAULT_VTS_CONFIG }
  saveConfig(next)
  return next
}

/** 单独写入 token（鉴权成功后由 VtsClient 回写） */
export function saveToken(token: string): VtsConfig {
  return updateConfig({ token })
}

/** 清除内存缓存（测试 / 热重载用） */
export function clearConfigCache(): void {
  cached = null
}

/** 配置是否完整（用于 UI 提示，不阻断保存） */
export function validateConfig(config: VtsConfig): string[] {
  const issues: string[] = []

  if (config.enabled) {
    if (!config.url) {
      issues.push('未填写 VTS 地址')
    } else if (!/^wss?:\/\/(127\.0\.0\.1|localhost|\[::1])(:\d+)?/.test(config.url)) {
      // VTS 只提供本机 API；远程地址应当被明确拦截，而不是连上去才发现失败
      issues.push('VTS 地址必须指向本机环回地址（127.0.0.1 / localhost）')
    }
    if (!config.token) {
      issues.push('尚未授权：连接后在 VTS 弹窗中点击「允许」，或重新连接以发起授权')
    }
    if (!config.pluginName) issues.push('未填写插件名')
  }

  return issues
}
