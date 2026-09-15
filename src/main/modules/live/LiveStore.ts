/**
 * 直播互动配置存储（主进程）
 *
 * 存储布局：
 *   <userData>/live/live_config.json
 *
 * 与 OverlayStore / VrmCompanionStore 保持一致的做法：直读直写 JSON，
 * 读取失败回落默认值，不做 schema 校验（配置项都有默认值，非法值在合并阶段被忽略）。
 *
 * 安全约定（本模块与其它 Store 的唯一差异）：
 * 凭证字段（SESSDATA / access_key_secret / api_key / token …）在**落盘前**
 * 用 safeStorage 加密（`enc:v1:` 前缀），读盘后解密回内存。
 * safeStorage 不可用时（Linux 无 libsecret）会降级为明文并打安全告警 —— 这是既有约定，不额外处理。
 *
 * @module live/LiveStore
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { decryptString, encryptString } from '../../guard/safeStorageUtil'
import type { LiveConfig } from './types'

// ============================================
// 常量
// ============================================

const LIVE_DIR_NAME = 'live'
const CONFIG_FILE_NAME = 'live_config.json'

/**
 * 需要加密落盘的字段。
 *
 * 只列凭证类字段；`roomId` / `videoId` / `channel` 这些是公开标识，明文便于排障。
 */
const SECRET_FIELDS: readonly (keyof LiveConfig)[] = [
  'bilibiliAccessKeyId',
  'bilibiliAccessKeySecret',
  'bilibiliAppId',
  'bilibiliRoomOwnerAuthCode',
  'bilibiliSessdata',
  'youtubeApiKey',
  'twitchAccessToken',
]

/**
 * 默认配置。
 *
 * 所有 enabled 均为 false —— 合规铁律：直播功能必须由用户主动开启。
 */
export const DEFAULT_LIVE_CONFIG: LiveConfig = {
  enabled: false,

  bilibiliEnabled: false,
  bilibiliType: 'open_live',
  bilibiliRoomId: '',
  bilibiliAccessKeyId: '',
  bilibiliAccessKeySecret: '',
  bilibiliAppId: '',
  bilibiliRoomOwnerAuthCode: '',
  bilibiliSessdata: '',
  bilibiliWebRiskAccepted: false,

  youtubeEnabled: false,
  youtubeVideoId: '',
  youtubeApiKey: '',

  twitchEnabled: false,
  twitchChannel: '',
  twitchAccessToken: '',
  twitchUsername: '',
}

// ============================================
// 路径工具
// ============================================

/** 直播模块数据目录（<userData>/live） */
export function getLiveDataDir(): string {
  return path.join(app.getPath('userData'), LIVE_DIR_NAME)
}

/** 配置文件绝对路径 */
export function getLiveConfigPath(): string {
  return path.join(getLiveDataDir(), CONFIG_FILE_NAME)
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.system.warn('[Live] ensureDir failed:', dir, err)
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

/** 落盘前：加密全部凭证字段（返回可直接 JSON.stringify 的对象） */
function encryptSecrets(config: LiveConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { ...config }
  for (const field of SECRET_FIELDS) {
    const value = config[field]
    out[field] = typeof value === 'string' && value ? encryptString(value) : ''
  }
  return out
}

/** 读盘后：解密全部凭证字段（兼容旧版明文：decryptString 对无前缀值原样返回） */
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
let cached: LiveConfig | null = null

/** 读取配置（带内存缓存，凭证已解密） */
export function getConfig(): LiveConfig {
  if (cached) return cached

  const filePath = getLiveConfigPath()
  try {
    if (!fs.existsSync(filePath)) {
      cached = { ...DEFAULT_LIVE_CONFIG }
      return cached
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    cached = mergeConfig(DEFAULT_LIVE_CONFIG, decryptSecrets(parsed))
  } catch (err) {
    logger.system.warn('[Live] read config failed, fallback to default:', err)
    cached = { ...DEFAULT_LIVE_CONFIG }
  }
  return cached
}

/** 写入配置（凭证加密后落盘） */
export function saveConfig(next: LiveConfig): void {
  cached = next
  try {
    ensureDir(getLiveDataDir())
    const payload = JSON.stringify(encryptSecrets(next), null, 2)
    fs.writeFileSync(getLiveConfigPath(), payload, 'utf-8')
  } catch (err) {
    logger.system.error('[Live] save config failed:', err)
  }
}

/** 局部更新配置（深合并到当前值，落盘并返回新值） */
export function updateConfig(patch: unknown): LiveConfig {
  const next = mergeConfig(getConfig(), patch)
  saveConfig(next)
  return next
}

/** 重置为默认配置 */
export function resetConfig(): LiveConfig {
  const next = { ...DEFAULT_LIVE_CONFIG }
  saveConfig(next)
  return next
}

/** 清除内存缓存（测试 / 热重载用） */
export function clearConfigCache(): void {
  cached = null
}

/** 配置是否完整（用于 UI 提示，不阻断保存） */
export function validateConfig(config: LiveConfig): string[] {
  const issues: string[] = []

  if (config.bilibiliEnabled) {
    if (config.bilibiliType === 'open_live') {
      const missing = (
        [
          ['AccessKeyId', config.bilibiliAccessKeyId],
          ['AccessKeySecret', config.bilibiliAccessKeySecret],
          ['AppId', config.bilibiliAppId],
          ['主播身份码', config.bilibiliRoomOwnerAuthCode],
        ] as const
      )
        .filter(([, value]) => !value)
        .map(([label]) => label)
      if (missing.length) issues.push(`B站开放平台缺少：${missing.join(' / ')}`)
    } else {
      if (!config.bilibiliWebRiskAccepted) issues.push('B站网页模式需先勾选风险确认')
      if (!config.bilibiliRoomId) issues.push('B站网页模式缺少直播间号')
      if (!config.bilibiliSessdata) issues.push('B站网页模式缺少 SESSDATA')
    }
  }

  if (config.youtubeEnabled) {
    if (!config.youtubeVideoId) issues.push('YouTube 缺少 videoId')
    if (!config.youtubeApiKey) issues.push('YouTube 缺少 API Key')
  }

  if (config.twitchEnabled) {
    if (!config.twitchChannel) issues.push('Twitch 缺少频道名')
    if (config.twitchAccessToken && !config.twitchUsername) {
      issues.push('Twitch 填写了 Token 时必须同时填写登录名（NICK 需与 Token 归属一致）')
    }
  }

  return issues
}
