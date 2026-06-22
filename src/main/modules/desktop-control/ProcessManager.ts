/**
 * 进程管理器（L3）
 * 封装平台适配器，提供进程列表、查找、终止能力
 */

import { logger } from '@shared/toolkit/LogEngine'
import type { PlatformAdapter } from './platform/types'
import type { ProcessInfo, ActionResult } from './types/actions'

/** 受保护进程名单（禁止终止） */
const PROTECTED_PROCESSES = new Set([
  'kernel_task',
  'launchd',
  'WindowServer',
  'System',
  'Registry',
  'smss.exe',
  'csrss.exe',
  'wininit.exe',
  'services.exe',
  'lsass.exe',
  'svchost.exe',
  'explorer.exe',
])

export class ProcessManager {
  constructor(private adapter: PlatformAdapter) {}

  /** 列出所有进程 */
  async list(): Promise<ProcessInfo[]> {
    return this.adapter.listProcesses()
  }

  /** 查找进程 */
  async find(query: string | number): Promise<ProcessInfo[]> {
    return this.adapter.findProcess(query)
  }

  /** 终止进程（带保护机制） */
  async kill(pid: number, force = false): Promise<ActionResult> {
    // 检查受保护进程
    try {
      const procs = await this.adapter.findProcess(pid)
      if (procs.length > 0) {
        const name = procs[0].name
        if (PROTECTED_PROCESSES.has(name)) {
          logger.desktop.warn(`[ProcessManager] Refused to kill protected process: ${name} (${pid})`)
          return {
            success: false,
            operation: 'killProcess',
            target: String(pid),
            error: `Refused to kill protected system process: ${name}`,
            duration: 0,
          }
        }
      }
    } catch {
      // 查找失败不阻断终止操作
    }

    logger.desktop.info(`[ProcessManager] kill pid=${pid} force=${force}`)
    return this.adapter.killProcess(pid, force)
  }

  /** 检查进程是否在运行 */
  async isRunning(name: string): Promise<boolean> {
    const found = await this.adapter.findProcess(name)
    return found.length > 0
  }
}
