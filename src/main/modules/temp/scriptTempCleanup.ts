/**
 * AI 临时目录兜底清理
 *
 * AI 产生的临时文件统一存放在工作空间的 `.aweeclaw/temp`（见 shared/brand 的 paths.temp）。
 * 该目录位于工作空间内、且已列入可删除白名单，用户与 AI 都能自由清理，
 * 因此不需要应用侧定时清理。
 *
 * 本模块只负责清理「应用级回退临时目录」（userData/tmp）——即没有打开工作空间、
 * 无法使用工作空间临时目录时的兜底位置：
 * - 应用启动时清空一次（此时不会有正在执行的脚本）；
 * - 运行期间定时清理超过 TTL 的残留文件。
 *
 * 放在主进程执行，是为了不经过渲染进程的工作空间边界与 .aweeclaw 保护校验。
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { APP_TEMP_ROOT_NAME } from '@shared/appConstants'

/** 定时清理周期：30 分钟 */
const CLEANUP_INTERVAL_MS = 30 * 60 * 1000
/** 运行期残留文件的过期阈值：2 小时 */
const STALE_TTL_MS = 2 * 60 * 60 * 1000

let timer: NodeJS.Timeout | null = null

/** 应用级回退临时目录（无工作空间时使用） */
function fallbackTempDir(): string {
  return path.join(app.getPath('userData'), APP_TEMP_ROOT_NAME)
}

/**
 * 清理单个目录下的残留文件
 *
 * @param dir 目标目录
 * @param force 为 true 时清空全部内容（启动时使用），否则仅清超过 STALE_TTL_MS 的文件
 */
function cleanDir(dir: string, force: boolean): void {
  if (!fs.existsSync(dir)) return

  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }

  const now = Date.now()
  for (const entry of entries) {
    const target = path.join(dir, entry.name)
    try {
      if (!force) {
        const stat = fs.statSync(target)
        if (now - stat.mtimeMs <= STALE_TTL_MS) continue
      }
      fs.rmSync(target, { recursive: true, force: true })
    } catch {
      // 单个条目删除失败不影响其余清理
    }
  }
}

/** 执行一次回退临时目录清理 */
export function cleanupScriptTempDirs(force = false): void {
  cleanDir(fallbackTempDir(), force)
}

/**
 * 启动临时目录清理兜底
 *
 * 应用启动时清空一次（此时无脚本在执行），随后按固定周期清理过期残留。
 */
export function startScriptTempCleanup(): void {
  try {
    cleanupScriptTempDirs(true)
  } catch (err) {
    logger.system.warn('[TempCleanup] 启动清理失败:', (err as Error)?.message)
  }

  if (timer) return
  timer = setInterval(() => {
    try {
      cleanupScriptTempDirs(false)
    } catch {
      // 定时清理失败静默忽略，下个周期重试
    }
  }, CLEANUP_INTERVAL_MS)
  // 不阻止应用退出
  if (typeof timer.unref === 'function') timer.unref()
}
