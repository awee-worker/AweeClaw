/**
 * 防休眠配置存储（主进程）
 *
 * 存储布局：
 *   <userData>/power-guard/power_guard_config.json   配置
 *   <userData>/power-guard/guard.json                残留守护进程记录（见下）
 *
 * `guard.json` 不是配置，而是**崩溃自恢复的现场记录**：记录「哪个子进程正在替我们
 * 阻止休眠」。正常退出时会删除它；只有应用被强杀（SIGKILL / 断电 / 卸载器结束进程）
 * 时才会留下，下次启动据此清理，避免「AweeClaw 已经没了但系统还是睡不了」的僵尸状态。
 *
 * 无凭证字段，因此不做加密落盘（与 VtsStore 的 token 处理不同）。
 *
 * @module power-guard/PowerGuardStore
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import type { PowerGuardConfig, PowerGuardStateFile } from './types'

export type { PowerGuardConfig, PowerGuardStateFile }

// ============================================
// 常量
// ============================================

const GUARD_DIR_NAME = 'power-guard'
const CONFIG_FILE_NAME = 'power_guard_config.json'
const STATE_FILE_NAME = 'guard.json'

/** 最低触发时长下限：再小就退化成「每个任务都 spawn 进程」，不如直接 0 */
export const MIN_DURATION_FLOOR_MS = 0

/** 最高触发时长上限：5 分钟。再长就失去了「避免起停抖动」的意义 */
export const MIN_DURATION_CEILING_MS = 5 * 60 * 1000

/**
 * 默认配置。
 *
 * `enabled: true` —— P1 通用要求「所有新增能力默认 enabled:false」的**唯一例外**，
 * 因为防休眠本身就是为 Agent 长任务服务的，默认关掉等于把能力藏起来。
 * 它的安全性由另外两道闸门保证：`mode` 默认只阻止系统空闲休眠（不阻止显示器关闭），
 * 且只在真有任务持有时才生效（空闲时不 spawn 任何进程）。
 */
export const DEFAULT_POWER_GUARD_CONFIG: PowerGuardConfig = {
  enabled: true,
  mode: 'idle',
  autoTriggerAgentTask: true,
  minDurationMs: 15_000,
  manualHold: false,
}

// ============================================
// 路径工具
// ============================================

/** 模块数据目录（<userData>/power-guard） */
export function getPowerGuardDataDir(): string {
  return path.join(app.getPath('userData'), GUARD_DIR_NAME)
}

/** 配置文件绝对路径 */
export function getPowerGuardConfigPath(): string {
  return path.join(getPowerGuardDataDir(), CONFIG_FILE_NAME)
}

/** 残留记录文件绝对路径 */
export function getPowerGuardStatePath(): string {
  return path.join(getPowerGuardDataDir(), STATE_FILE_NAME)
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.system.warn('[PowerGuard] ensureDir failed:', dir, err)
  }
}

// ============================================
// 深合并
// ============================================

/**
 * 深合并：只覆盖 fallback 中已声明的键，且类型必须一致。
 *
 * 与 VtsStore / LiveStore 同一套实现语义，保证「旧配置缺字段不丢默认值、
 * 用户手改出非法类型也不污染内存」。
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

/** 归一化枚举字段：非法值一律回落默认，避免手改配置把状态机搞成不可达态 */
function normalize(config: PowerGuardConfig): PowerGuardConfig {
  const out = { ...config }
  if (out.mode !== 'off' && out.mode !== 'idle' && out.mode !== 'system') {
    out.mode = DEFAULT_POWER_GUARD_CONFIG.mode
  }
  if (!Number.isFinite(out.minDurationMs)) {
    out.minDurationMs = DEFAULT_POWER_GUARD_CONFIG.minDurationMs
  } else {
    out.minDurationMs = Math.max(
      MIN_DURATION_FLOOR_MS,
      Math.min(MIN_DURATION_CEILING_MS, Math.floor(out.minDurationMs)),
    )
  }
  return out
}

// ============================================
// 配置读写
// ============================================

/** 内存缓存（避免每次读磁盘） */
let cached: PowerGuardConfig | null = null

/** 读取配置 */
export function getConfig(): PowerGuardConfig {
  if (cached) return cached

  const filePath = getPowerGuardConfigPath()
  try {
    if (!fs.existsSync(filePath)) {
      cached = { ...DEFAULT_POWER_GUARD_CONFIG }
      return cached
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    cached = normalize(mergeConfig(DEFAULT_POWER_GUARD_CONFIG, parsed))
  } catch (err) {
    logger.system.warn('[PowerGuard] read config failed, fallback to default:', err)
    cached = { ...DEFAULT_POWER_GUARD_CONFIG }
  }
  return cached
}

/** 写入配置 */
export function saveConfig(next: PowerGuardConfig): void {
  cached = next
  try {
    ensureDir(getPowerGuardDataDir())
    fs.writeFileSync(getPowerGuardConfigPath(), JSON.stringify(next, null, 2), 'utf-8')
  } catch (err) {
    logger.system.error('[PowerGuard] save config failed:', err)
  }
}

/** 局部更新配置（深合并到当前值，落盘并返回新值） */
export function updateConfig(patch: unknown): PowerGuardConfig {
  const next = normalize(mergeConfig(getConfig(), patch))
  saveConfig(next)
  return next
}

/** 重置为默认配置 */
export function resetConfig(): PowerGuardConfig {
  const next = { ...DEFAULT_POWER_GUARD_CONFIG }
  saveConfig(next)
  return next
}

/** 清除内存缓存（测试用） */
export function clearConfigCache(): void {
  cached = null
}

/** 配置提示（不阻断保存，仅 UI 引导） */
export function validateConfig(config: PowerGuardConfig): string[] {
  const issues: string[] = []
  if (config.enabled && config.mode === 'off') {
    issues.push('模块已启用但强度为「关闭」，不会阻止任何睡眠')
  }
  if (config.enabled && !config.autoTriggerAgentTask && !config.manualHold) {
    issues.push('自动触发已关闭且未手动保持唤醒，模块当前无生效场景')
  }
  return issues
}

// ============================================
// 残留守护进程记录
// ============================================

/** 写入残留记录（守护进程起来后立刻写） */
export function writeGuardState(state: Omit<PowerGuardStateFile, 'version' | 'ownerPid'>): void {
  try {
    ensureDir(getPowerGuardDataDir())
    const payload: PowerGuardStateFile = {
      version: 1,
      ownerPid: process.pid,
      ...state,
    }
    fs.writeFileSync(getPowerGuardStatePath(), JSON.stringify(payload, null, 2), 'utf-8')
  } catch (err) {
    // 写不进去只影响崩溃自恢复，不影响当前功能，降级为 warn
    logger.system.warn('[PowerGuard] write guard state failed:', err)
  }
}

/** 读取残留记录（不存在 / 损坏时返回 null） */
export function readGuardState(): PowerGuardStateFile | null {
  const filePath = getPowerGuardStatePath()
  try {
    if (!fs.existsSync(filePath)) return null
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Partial<PowerGuardStateFile>
    if (
      parsed.version !== 1 ||
      typeof parsed.ownerPid !== 'number' ||
      typeof parsed.guardPid !== 'number' ||
      typeof parsed.kind !== 'string'
    ) {
      return null
    }
    return parsed as PowerGuardStateFile
  } catch (err) {
    logger.system.warn('[PowerGuard] read guard state failed:', err)
    return null
  }
}

/** 删除残留记录（正常停止 / 清理完成后调用） */
export function clearGuardState(): void {
  try {
    const filePath = getPowerGuardStatePath()
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
  } catch (err) {
    logger.system.warn('[PowerGuard] clear guard state failed:', err)
  }
}
