/**
 * 能力一致性收敛模块入口（主进程）
 *
 * 职责：注册 IPC，把「渲染层拿到的授权快照」落到各能力模块的配置上。
 *
 * 初始化时机：`bootstrap/moduleInitializer.ts` 中**必须晚于** live / vts /
 * vmc / a2a / openapi / iot / perception / proactive 各模块的初始化 ——
 * 收敛要读它们的配置，模块没起来时读到的都是默认值。
 *
 * 注意：此模块**不在启动时自动执行收敛**。主进程没有登录态与订阅信息，
 * 收敛必须等渲染层拿到后端权威快照后主动调用（应用启动 → 恢复登录态 →
 * 拉取有效功能 → 调用 `capability:converge`）。
 *
 * @module capability-guard
 */

import { registerCapabilityGuardIpc, cleanupCapabilityGuardIpc } from './CapabilityGuardIpc'
import { convergeCapabilities, getLastConvergeReport } from './CapabilityConvergence'
import { GUARDED_CAPABILITY_KEYS } from './types'
import type {
  CapabilityConvergeReport,
  CapabilityEntitlement,
  GuardedCapabilityKey,
} from './types'

export { registerCapabilityGuardIpc, cleanupCapabilityGuardIpc }
export { convergeCapabilities, getLastConvergeReport }
export { GUARDED_CAPABILITY_KEYS }
export type {
  CapabilityConvergeReport,
  CapabilityEntitlement,
  GuardedCapabilityKey,
}

/** 初始化能力一致性收敛模块 */
export function initCapabilityGuardModule(): void {
  registerCapabilityGuardIpc()
}
