/**
 * capabilityConvergence.ts — 能力一致性收敛触发（渲染层）
 *
 * 职责
 * ----
 * 把「当前有效套餐权益」翻译成一次主进程收敛调用，让降级后残留的
 * 运行时能力（VTS 连接、VMC 端口、A2A 入站、对外 API 网关、IoT Bridge、
 * 感知预测、主动助手、直播适配器）自动关闭。
 *
 * 为什么由渲染层发起
 * ----
 * 「有效套餐」的唯一真相来源是后端 FeatureService，而该接口由渲染层的
 * `featureGuardService` 调用并缓存。主进程没有登录态，如果自己再实现一遍
 * 权益判断，同一套规则就会有两份实现。因此：**渲染层出快照，主进程落收敛**。
 *
 * 触发时机（`useFeatureGuard` 负责调度）
 * ----
 * - 应用启动 / 恢复登录态后首次拿到有效功能配置
 * - 支付成功后（`refresh()`）
 * - 订阅状态变化后手动刷新
 *
 * 幂等：主进程侧对已关闭的能力不做任何写入，重复调用无副作用。
 *
 * 安全闸门（必须保留）
 * ----
 * 只在「已登录」且「快照来源可信」时调用：
 *   - 未登录 = 纯本地模式，客户端本就不做付费拦截（保持既有行为）
 *   - 离线兜底 / 令牌失效得到的 FREE 形状配置不代表真实权益，用它收敛
 *     会把付费用户的 VTS / A2A 等一并关掉
 *
 * @module adapters/capabilityConvergence
 */

import { api } from '@services/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import {
  buildCapabilityEntitlement,
  isAuthoritativeFeatures,
  type EffectiveFeatures,
} from '@services/featureGuardService'

/** 收敛结果（供调用方决定是否提示用户） */
export interface ConvergenceOutcome {
  /** 是否真的执行了收敛（闸门未通过 / IPC 失败时为 false） */
  ran: boolean
  /** 本次被关闭的能力键 */
  revokedKeys: string[]
  /** 未执行的原因（诊断用） */
  skippedReason?: 'snapshot-not-authoritative' | 'ipc-failed' | 'no-api'
}

/**
 * 基于有效功能配置执行一次能力一致性收敛。
 *
 * @param eff 有效功能配置（来自 `getEffectiveFeatures()`）
 * @param isAuthenticated 是否已登录；未登录直接跳过
 */
export async function convergeCapabilitiesFor(
  eff: EffectiveFeatures | null | undefined,
  isAuthenticated: boolean,
): Promise<ConvergenceOutcome> {
  // 闸门 1：未登录 = 本地模式，不做付费拦截（与 useFeatureGuard 的既有策略一致）
  if (!isAuthenticated) {
    return { ran: false, revokedKeys: [], skippedReason: 'snapshot-not-authoritative' }
  }

  // 闸门 2：只有真实权益快照才允许收敛
  if (!isAuthoritativeFeatures(eff)) {
    logger.system.warn(
      '[CapabilityGuard] 跳过收敛：当前功能配置来自兜底（后端不可达或未登录）',
    )
    return { ran: false, revokedKeys: [], skippedReason: 'snapshot-not-authoritative' }
  }

  const capabilityGuard = api.capabilityGuard
  if (!capabilityGuard?.converge) {
    return { ran: false, revokedKeys: [], skippedReason: 'no-api' }
  }

  try {
    const res = await capabilityGuard.converge(buildCapabilityEntitlement(eff))
    if (!res?.success || !res.data) {
      logger.system.warn('[CapabilityGuard] 收敛失败:', res?.error)
      return { ran: false, revokedKeys: [], skippedReason: 'ipc-failed' }
    }

    return { ran: true, revokedKeys: res.data.revokedKeys ?? [] }
  } catch (e) {
    logger.system.warn('[CapabilityGuard] 收敛调用异常:', e)
    return { ran: false, revokedKeys: [], skippedReason: 'ipc-failed' }
  }
}
