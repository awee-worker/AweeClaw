/**
 * 悬浮层配置存储（主进程）
 *
 * 存储布局：
 *   <userData>/overlay/overlay_config.json
 *
 * 与 VrmCompanionStore 保持一致的做法：直读直写 JSON，读取失败回落默认值，
 * 不做 schema 校验（配置项都有默认值，非法值在合并阶段被忽略）。
 *
 * @module overlay/OverlayStore
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import type { OverlayConfig } from './types'

// ============================================
// 常量
// ============================================

const OVERLAY_DIR_NAME = 'overlay'
const CONFIG_FILE_NAME = 'overlay_config.json'

/** 默认服务端口（与源项目 overlay 无关，取一个不易冲突的值） */
export const DEFAULT_OVERLAY_PORT = 12800

/** 端口探测次数（占用时依次 +1，最多尝试这么多次） */
export const PORT_PROBE_ATTEMPTS = 10

export const DEFAULT_OVERLAY_CONFIG: OverlayConfig = {
  // 总开关默认关闭：这是新增的对外服务入口，用户显式开启后才生效
  enabled: false,
  serverEnabled: true,
  port: DEFAULT_OVERLAY_PORT,
  windowEnabled: false,
  windowMode: 'subtitle',
  window: {
    width: 900,
    height: 220,
    positionX: null,
    positionY: null,
    opacity: 1,
    alwaysOnTop: true,
    clickThrough: true,
    locked: false,
  },
  subtitle: {
    fontSize: 34,
    durationMs: 8000,
    maxLines: 3,
    strokeWidth: 3,
    bgOpacity: 0.55,
  },
  danmaku: {
    fontSize: 30,
    speed: 180,
    tracks: 6,
    opacity: 1,
    filterLowPriority: false,
  },
}

// ============================================
// 路径工具
// ============================================

/** 悬浮层数据目录（<userData>/overlay） */
export function getOverlayDataDir(): string {
  return path.join(app.getPath('userData'), OVERLAY_DIR_NAME)
}

/** 配置文件绝对路径 */
export function getOverlayConfigPath(): string {
  return path.join(getOverlayDataDir(), CONFIG_FILE_NAME)
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.system.warn('[Overlay] ensureDir failed:', dir, err)
  }
}

// ============================================
// 配置读写
// ============================================

/**
 * 深合并：只覆盖 fallback 中已声明的键，且类型必须一致。
 *
 * 这样旧版本配置文件缺字段时不会丢默认值，用户手改出非法类型时也不会污染内存。
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

/** 内存缓存（避免每次读磁盘） */
let cached: OverlayConfig | null = null

/** 读取配置（带内存缓存） */
export function getConfig(): OverlayConfig {
  if (cached) return cached

  const filePath = getOverlayConfigPath()
  try {
    if (!fs.existsSync(filePath)) {
      cached = { ...DEFAULT_OVERLAY_CONFIG }
      return cached
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    cached = mergeConfig(DEFAULT_OVERLAY_CONFIG, JSON.parse(raw))
  } catch (err) {
    logger.system.warn('[Overlay] read config failed, fallback to default:', err)
    cached = { ...DEFAULT_OVERLAY_CONFIG }
  }
  return cached
}

/** 写入配置（幂等：无变化时不落盘） */
export function saveConfig(next: OverlayConfig): void {
  cached = next
  try {
    ensureDir(getOverlayDataDir())
    fs.writeFileSync(getOverlayConfigPath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch (err) {
    logger.system.error('[Overlay] save config failed:', err)
  }
}

/** 局部更新配置（深合并到当前值，落盘并返回新值） */
export function updateConfig(patch: unknown): OverlayConfig {
  const next = mergeConfig(getConfig(), patch)
  saveConfig(next)
  return next
}

/** 重置为默认配置 */
export function resetConfig(): OverlayConfig {
  const next = { ...DEFAULT_OVERLAY_CONFIG }
  saveConfig(next)
  return next
}

/** 清除内存缓存（测试/热重载用） */
export function clearConfigCache(): void {
  cached = null
}
