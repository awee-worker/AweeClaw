/**
 * 能力一致性收敛 IPC（主进程）
 *
 * 通道清单：
 * - `capability:converge`      执行一次收敛（入参：授权快照）
 * - `capability:last-report`   读取最近一次收敛报告（诊断用）
 *
 * 约定：与项目其它模块一致，通过 `safeIpcHandle` 注册，返回
 * `{ success, data }` / `{ success:false, error }`。
 *
 * 安全说明：`allowed` 由渲染层传入，主进程不校验其真实性 —— 这是一条
 * **降级**通道（把多余的能力关掉），不是提权通道。即使渲染层被篡改传入
 * 全 true，能得到的也只是「能力不被自动关闭」，与收敛功能上线前的行为
 * 完全一致，没有引入新的攻击面。
 *
 * @module capability-guard/CapabilityGuardIpc
 */

import { ipcMain } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { convergeCapabilities, getLastConvergeReport } from './CapabilityConvergence'
import type { CapabilityEntitlement } from './types'

/** 本模块占用的 IPC 通道（退出时按表清理） */
const IPC_CHANNELS = ['capability:converge', 'capability:last-report'] as const

/** 是否已注册（幂等保护） */
let registered = false

/** 把任意入参收窄成授权快照，非法形状按「全部未授权」处理 */
function normalizeEntitlement(raw: unknown): CapabilityEntitlement {
  if (!raw || typeof raw !== 'object') return { allowed: {} }
  const source = raw as { planId?: unknown; allowed?: unknown }

  const allowed: CapabilityEntitlement['allowed'] = {}
  if (source.allowed && typeof source.allowed === 'object') {
    for (const [key, value] of Object.entries(source.allowed as Record<string, unknown>)) {
      if (typeof value === 'boolean') allowed[key as keyof typeof allowed] = value
    }
  }

  return {
    planId: typeof source.planId === 'string' ? source.planId : undefined,
    allowed,
  }
}

/** 注册能力收敛 IPC（幂等） */
export function registerCapabilityGuardIpc(): void {
  if (registered) return
  registered = true

  safeIpcHandle('capability:converge', async (_event, raw: unknown) => {
    try {
      const report = await convergeCapabilities(normalizeEntitlement(raw))
      return { success: true, data: report }
    } catch (err) {
      logger.system.error('[CapabilityGuard] converge failed:', err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  safeIpcHandle('capability:last-report', async () => {
    return { success: true, data: getLastConvergeReport() }
  })

  logger.system.info('[CapabilityGuard] Handlers registered')
}

/** 取消注册（退出 / 热重载） */
export function cleanupCapabilityGuardIpc(): void {
  for (const channel of IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }
  registered = false
  logger.system.info('[CapabilityGuard] Handlers cleaned up')
}
