/**
 * 能力一致性收敛 preload API
 *
 * 暴露到 `window.electronAPI.capabilityGuard`，服务于一个消费者：
 * 渲染层的付费墙服务（`adapters/capabilityConvergence.ts`）。
 *
 * 用法：应用启动（恢复登录态 + 拉取到权威功能配置）后调用一次，之后每次
 * 订阅状态变化（登录 / 支付成功 / 手动刷新）再调用一次。接口幂等，
 * 能力本来就关着时不会产生任何写入。
 *
 * @module preload/api/capabilityGuard
 */

import { ipcRenderer } from 'electron'
import { invoke } from '../ipcHelpers'

/** 统一 IPC 响应结构（与 ipcGuard 的 IpcGuardResponse 对齐） */
export interface CapabilityGuardIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 受套餐约束的客户端能力键（与主进程 capability-guard/types 对齐） */
export type GuardedCapabilityKey =
  | 'liveInteraction'
  | 'vts'
  | 'vmc'
  | 'a2a'
  | 'externalApi'
  | 'iot'
  | 'perception'
  | 'proactive'

/** 授权快照：只表达「能力是否被授权」 */
export interface CapabilityEntitlement {
  planId?: string
  allowed: Partial<Record<GuardedCapabilityKey, boolean>>
}

/** 单个能力的收敛结果 */
export interface CapabilityConvergeResult {
  key: GuardedCapabilityKey
  /** 是否真的执行了关闭动作（false = 收敛前就已关闭） */
  revoked: boolean
  ok: boolean
  detail: string
  error?: string
}

/** 一次收敛的完整报告 */
export interface CapabilityConvergeReport {
  planId: string
  convergedAt: number
  /** 本次被关闭的能力键（UI 据此提示用户） */
  revokedKeys: GuardedCapabilityKey[]
  results: CapabilityConvergeResult[]
}

/** 创建能力收敛 API 集合 */
export function createCapabilityGuardApi() {
  return {
    /**
     * 执行一次能力一致性收敛（幂等）。
     *
     * @param entitlement 当前有效授权快照。**必须来自后端权威响应**：
     *   未登录 / 离线兜底得到的 FREE 形状配置会误伤付费用户。
     */
    converge: (entitlement: CapabilityEntitlement) =>
      ipcRenderer.invoke('capability:converge', entitlement) as Promise<
        CapabilityGuardIpcResponse<CapabilityConvergeReport>
      >,

    /** 读取最近一次收敛报告（诊断用；未收敛过时 data 为 null） */
    getLastReport: invoke<CapabilityGuardIpcResponse<CapabilityConvergeReport | null>>(
      'capability:last-report',
    ),
  }
}
