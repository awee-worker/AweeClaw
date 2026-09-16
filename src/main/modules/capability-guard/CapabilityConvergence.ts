/**
 * 能力一致性收敛（主进程）
 *
 * 背景
 * ----
 * 套餐能力开关（`liveInteraction` / `vts` / `vmc` / `a2a` / `externalApi` /
 * `iot` / `perception` / `proactive`）目前只在**用户主动开启的那一刻**校验。
 * 于是存在一条漏网路径：用户在 PRO 期间开启了 VTS / VMC / A2A，之后订阅到期
 * 或降级到 FREE —— 这些能力仍会继续跑（VTS 连接不断、A2A 端口仍在监听、
 * 直播适配器继续抓弹幕），付费墙形同虚设。
 *
 * 本模块提供一次**幂等的收敛**：给定「当前有效授权快照」，逐模块读取自己的
 * 配置，把无权限的能力关掉。
 *
 * 四条原则
 * ----
 * 1. **只关不删**：只翻转 `enabled` 类开关，凭证 / 房间号 / 端口 / 分类偏好
 *    一律保留。用户重新升级后无需重新配置一遍。
 * 2. **已关不动**：能力本来就关着时不做任何写入 —— 避免无意义的落盘、
 *    事件广播与 UI 抖动（收敛会在每次登录 / 支付成功后重复执行）。
 * 3. **逐项隔离**：每个模块单独 try/catch，一个模块失败不影响其余模块。
 * 4. **权限未知即不收敛**：调用方必须只在「拿到后端权威快照」时调用。
 *    渲染层在未登录、离线兜底、缓存过期时都会拿到 FREE 形状的兜底配置，
 *    那种情况下收敛会误伤付费用户，因此由调用方负责拦截（见
 *    `renderer/adapters/capabilityConvergence.ts` 的 source 判定）。
 *
 * 为什么由渲染层驱动而不是主进程自己判断
 * ----
 * 主进程没有登录态与订阅信息，「有效套餐」的唯一真相来源在后端
 * FeatureService，而该接口由渲染层的 `featureGuardService` 调用。若把
 * 令牌取回逻辑再在主进程实现一遍，等于把同一份判断标准写两处，
 * 迟早漂移。因此：**渲染层提供授权快照，主进程负责落地收敛**。
 *
 * @module capability-guard/CapabilityConvergence
 */

import { logger } from '@shared/toolkit/LogEngine'
import {
  GUARDED_CAPABILITY_KEYS,
  type CapabilityConvergeReport,
  type CapabilityConvergeResult,
  type CapabilityEntitlement,
  type GuardedCapabilityKey,
} from './types'

// ============================================
// 收敛器契约
// ============================================

/** 单个能力的收敛结果（内部形状） */
interface RevokeOutcome {
  /** 是否执行了关闭动作（false = 收敛前就已关闭） */
  changed: boolean
  /** 结果说明 */
  detail: string
}

/** 单个能力的收敛器：返回是否真的做了关闭动作；失败时抛错由外层捕获 */
type CapabilityRevoker = () => Promise<RevokeOutcome>

/** 未开启的通用结果（不写盘） */
function untouched(detail: string): RevokeOutcome {
  return { changed: false, detail }
}

// ============================================
// 各能力的收敛实现
// ============================================

/**
 * 直播互动：关闭总开关与三个平台开关。
 *
 * 只翻 `enabled`，`bilibiliSessdata` / `youtubeApiKey` 等凭证原样保留。
 */
async function revokeLiveInteraction(): Promise<RevokeOutcome> {
  const { getLiveManager, getLiveConfig } = await import('../live')
  const manager = getLiveManager()
  const config = getLiveConfig()

  const active =
    config.enabled || config.bilibiliEnabled || config.youtubeEnabled || config.twitchEnabled
  if (!active) return untouched('直播互动未开启')

  await manager.applyConfig({
    enabled: false,
    bilibiliEnabled: false,
    youtubeEnabled: false,
    twitchEnabled: false,
  })
  return { changed: true, detail: '已关闭直播互动（凭证与直播间号已保留）' }
}

/**
 * VTS 联动：关闭开关并断开与 VTube Studio 的连接。
 *
 * `applyConfig` 内部会先 `clearAudio()` 再 `disconnect()` —— 两件事缺一不可，
 * 否则 VTS 端会留着最后一个张开的嘴型。
 */
async function revokeVts(): Promise<RevokeOutcome> {
  const { getVtsManager, getVtsConfig } = await import('../vts')
  if (!getVtsConfig().enabled) return untouched('VTS 联动未开启')

  await getVtsManager().applyConfig({ enabled: false })
  return { changed: true, detail: '已断开 VTS 连接（token 已保留，重新开启无需重新授权）' }
}

/**
 * VMC 协议：关闭总开关 + 出站 + 入站。
 *
 * 三层都要关：`applyConfig` 只按 `send.enabled` / `receive.enabled` 判断启停，
 * 单关总开关不会停掉正在跑的发送器 / 接收器。
 */
async function revokeVmc(): Promise<RevokeOutcome> {
  const { getVmcManager } = await import('../vmc')
  const manager = getVmcManager()
  const config = manager.getConfig()

  const active = config.enabled || config.send.enabled || config.receive.enabled
  if (!active) return untouched('VMC 协议未开启')

  manager.updateConfig({
    enabled: false,
    send: { ...config.send, enabled: false },
    receive: { ...config.receive, enabled: false },
  })
  return { changed: true, detail: '已停止 VMC 出站与入站监听（端口配置已保留）' }
}

/**
 * A2A 协议：关闭总开关与入站服务。
 *
 * 总开关一关，渲染层的 `a2a_tool_call` 会随 `getToolPayload()` 自动消失
 * （载荷要求 `config.enabled === true`），因此无需逐个禁用 servers 条目 ——
 * 那会破坏用户配置的 agent 列表。
 */
async function revokeA2a(): Promise<RevokeOutcome> {
  const { getA2aManager } = await import('../a2a')
  const manager = getA2aManager()
  const config = manager.getConfig()

  const active = config.enabled || config.inbound.enabled
  if (!active) return untouched('A2A 协议未开启')

  await manager.applyConfig({
    enabled: false,
    inbound: { ...config.inbound, enabled: false },
  })
  return { changed: true, detail: '已关闭 A2A 出站调用与入站服务（智能体列表与凭证已保留）' }
}

/**
 * 对外 API 网关：关闭并交还 A2A 的监听权。
 *
 * 交接由 `OpenApiManager.apply()` 内部完成（停服务 → 清 A2A 公开地址 →
 * 触发 A2A 重新评估监听归属），此处不重复处理。
 */
async function revokeExternalApi(): Promise<RevokeOutcome> {
  const { getOpenApiManager } = await import('../openapi')
  const manager = getOpenApiManager()
  if (!manager.getConfig().enabled) return untouched('对外 API 未开启')

  await manager.applyConfig({ enabled: false })
  return { changed: true, detail: '已关闭对外 API 网关（API Key 与端口配置已保留）' }
}

/**
 * IoT 集成：停止 Bridge 并断开全部 Provider 连接。
 *
 * IoT 的运行态不落盘（`IoTBridge` 启动时不会自动连接任何 Provider），
 * 所以这里只处理当前进程内的运行态；重启后由渲染层按套餐决定是否允许再启动。
 */
async function revokeIot(): Promise<RevokeOutcome> {
  const { IoTBridge } = await import('../iot/IoTBridge')
  const bridge = IoTBridge.getInstance()
  if (!bridge.isRunning()) return untouched('IoT Bridge 未运行')

  await bridge.stop()
  return { changed: true, detail: '已停止 IoT Bridge 并断开全部 Provider 连接' }
}

/**
 * 感知预测：关闭总开关与行为预测开关。
 *
 * 通道开关与数据保留策略刻意不动 —— 那是隐私偏好的表达，与套餐无关，
 * 用户重新升级后应当维持原样。
 */
async function revokePerception(): Promise<RevokeOutcome> {
  const { PerceptionStore } = await import('../perception/PerceptionStore')
  const store = PerceptionStore.getInstance()
  const config = store.getPrivacyConfig()

  if (!config.enablePerception && !config.enablePrediction) return untouched('感知预测未开启')

  store.updatePrivacyConfig({ enablePerception: false, enablePrediction: false })
  return { changed: true, detail: '已关闭感知与行为预测（通道与保留策略已保留）' }
}

/**
 * 主动助手：只关全局开关。
 *
 * 刻意**不**动 `level` / `categories` / `quietHours` —— 这些是用户对打扰程度的
 * 偏好，关掉总开关已经足够让 `ProactivePermission.check()` 在第一个短路条件
 * 就拦下所有提案，再把等级改成 `off` 只会让用户重新升级后还得重配一遍。
 */
async function revokeProactive(): Promise<RevokeOutcome> {
  const { proactivePermission } = await import('../proactive/ProactivePermission')
  if (!proactivePermission.getConfig().enabled) return untouched('主动助手未开启')

  proactivePermission.updateConfig({ enabled: false })
  return { changed: true, detail: '已关闭主动助手（等级、分类与免打扰偏好已保留）' }
}

/**
 * 收敛器注册表。
 *
 * 顺序有讲究：`a2a` 必须排在 `externalApi` 之前 —— 网关托管 A2A 的入站监听，
 * 先让 A2A 落定自己的状态，网关再基于最终状态决定监听归属，可以少一次
 * 「网关先接管、A2A 再退出」的端口来回。
 */
const REVOKERS: Record<GuardedCapabilityKey, CapabilityRevoker> = {
  liveInteraction: revokeLiveInteraction,
  vts: revokeVts,
  vmc: revokeVmc,
  a2a: revokeA2a,
  externalApi: revokeExternalApi,
  iot: revokeIot,
  perception: revokePerception,
  proactive: revokeProactive,
}

// ============================================
// 对外接口
// ============================================

/** 最近一次收敛报告（供诊断 / 设置页展示） */
let lastReport: CapabilityConvergeReport | null = null

/** 读取最近一次收敛报告（未收敛过时为 null） */
export function getLastConvergeReport(): CapabilityConvergeReport | null {
  return lastReport
}

/**
 * 执行一次能力一致性收敛。
 *
 * 幂等：能力已关闭时不会产生任何写入，因此可以在登录后、支付成功后、
 * 订阅状态变化时放心重复调用。
 *
 * @param entitlement 当前有效授权快照（来自后端 FeatureService）
 */
export async function convergeCapabilities(
  entitlement: CapabilityEntitlement,
): Promise<CapabilityConvergeReport> {
  const allowed = entitlement.allowed ?? {}
  const denied = GUARDED_CAPABILITY_KEYS.filter((key) => allowed[key] !== true)

  const results: CapabilityConvergeResult[] = []

  for (const key of denied) {
    try {
      const outcome = await REVOKERS[key]()
      results.push({ key, revoked: outcome.changed, ok: true, detail: outcome.detail })
    } catch (err) {
      // 单个模块失败不影响其余模块：能力收敛是「尽力而为」的兜底，
      // 不该因为某个模块的偶发异常把整次收敛打断
      const message = err instanceof Error ? err.message : String(err)
      logger.system.error(`[CapabilityGuard] 收敛 ${key} 失败:`, err)
      results.push({ key, revoked: false, ok: false, detail: '收敛失败', error: message })
    }
  }

  const revokedKeys = results.filter((r) => r.revoked && r.ok).map((r) => r.key)
  lastReport = {
    planId: entitlement.planId ?? 'UNKNOWN',
    convergedAt: Date.now(),
    revokedKeys,
    results,
  }

  if (revokedKeys.length > 0) {
    logger.system.info(
      `[CapabilityGuard] 套餐 ${lastReport.planId} 无权限，已自动关闭: ${revokedKeys.join(', ')}`,
    )
  } else {
    logger.system.info(
      `[CapabilityGuard] 能力一致性检查通过（套餐 ${lastReport.planId}，无需收敛）`,
    )
  }

  return lastReport
}
