/**
 * featureGuardService.ts — 客户端付费墙服务
 *
 * 职责：
 * 1. 对接后端 FeatureGuardService API（/api/v1/payment/features）
 * 2. 本地缓存有效功能配置，避免每次操作都请求后端
 * 3. 处理 WorkMode（chat/agent/plan）与后端 mode（quick/think/expert）的映射
 * 4. 提供同步快速判断（基于缓存）与异步精确判断（请求后端）
 *
 * 设计原则：
 * - "有效套餐"（effectivePlanId）是功能判断的唯一依据，而非 cloudUser.planId
 *   原因：订阅过期时 user.planId 可能仍为 PRO，但实际应按 FREE 处理
 * - 登录后 / 支付成功后主动刷新缓存
 * - 离线或后端不可达时降级为宽松策略（避免阻塞用户正常使用）
 */
import { backendApi, BackendApiError } from '@services/backendApi'
import { logger } from '@shared/toolkit/LogEngine'
import type { WorkMode } from '@/renderer/modes/workModeTypes'

// ─── 类型定义（与后端 FeatureGuardService 对齐） ─────────

/** 套餐功能配置结构（对应后端 PlanFeatures） */
export interface PlanFeatures {
  modes?: string[]
  toolsLimit?: number
  mcp?: boolean
  skill?: boolean
  codebaseIndex?: boolean
  scenarioDiscount?: number
  prioritySupport?: boolean
  seats?: number
  teamCollaboration?: boolean
  privateDeployment?: boolean
  sla?: boolean

  // ── 能力数量上限（-1 表示无限） ──
  /** 自定义智能体数量上限 */
  customAgentsLimit?: number
  /** 桌面伴侣角色模型数量上限 */
  companionModelsLimit?: number

  // ── 客户端功能开关 ──
  /** 直播互动（B站 / YouTube / Twitch 弹幕接入） */
  liveInteraction?: boolean
  /** VTS（VTube Studio）联动 */
  vts?: boolean
  /** A2A（Agent2Agent）协议 */
  a2a?: boolean
  /** 对外 OpenAPI 服务 */
  externalApi?: boolean
  /** VMC（Virtual Motion Capture）协议 */
  vmc?: boolean
  /** IoT 集成 */
  iot?: boolean
  /** 感知预测（行为预测 / 场景感知） */
  perception?: boolean
  /** 主动助手（主动建议与预授权动作） */
  proactive?: boolean
}

/** 数量上限类功能键（值为 number，-1 = 无限） */
export const PLAN_QUOTA_KEYS = [
  'customAgentsLimit',
  'companionModelsLimit',
] as const

export type PlanQuotaKey = (typeof PLAN_QUOTA_KEYS)[number]

/** 客户端能力开关键（含 UI 展示所需的名称） */
export const CLIENT_CAPABILITY_KEYS = [
  'liveInteraction',
  'vts',
  'a2a',
  'externalApi',
  'vmc',
  'iot',
  'perception',
  'proactive',
] as const

export type ClientCapabilityKey = (typeof CLIENT_CAPABILITY_KEYS)[number]

/** 有效功能配置（对应后端 getEffectiveFeatures 返回值） */
export interface EffectiveFeatures {
  planId: string
  features: PlanFeatures
  hasActiveSubscription: boolean
  /**
   * 数据来源（客户端补充字段，不由后端返回）
   *
   * - `'server'`：本次由后端权威返回，反映真实权益
   * - `'cache'`：命中本地缓存（缓存本身来自某次后端权威返回）
   * - `'fallback'`：后端不可达 / 未登录的兜底（FREE 形状，**不代表真实权益**）
   * - `undefined`：来源不明，按 `'fallback'` 对待
   *
   * 用途：能力一致性收敛（`capabilityConvergence.ts`）只能基于真实权益执行，
   * 用 `'fallback'` 快照收敛会误伤离线 / 令牌失效的付费用户。
   */
  source?: 'server' | 'cache' | 'fallback'
}

/** 订阅状态（对应后端 getSubscriptionStatus 返回值） */
export interface SubscriptionStatus {
  planId: string
  planName: string
  hasActiveSubscription: boolean
  subscription: {
    id: string
    planId: string
    status: string
    currentPeriodStart: string
    currentPeriodEnd: string
    cancelAtPeriodEnd: boolean
    daysRemaining: number
  } | null
}

/** 功能检查结果（对应后端 FeatureCheckResult） */
export interface FeatureCheckResult {
  allowed: boolean
  reason?: string
  currentPlanId: string
  upgradeRequired?: string
}

/** 加油包配置（对应后端 BoosterPackConfig） */
export interface BoosterPackConfig {
  id: string
  name: string
  quotaAmount: number
  price: number
  description: string
}

// ─── WorkMode 映射 ──────────────────────────────────────

/**
 * 客户端 WorkMode ↔ 后端 mode 映射
 * 客户端使用语义化命名（chat/agent/plan），后端 features.modes 使用能力命名（quick/think/expert）
 */
const WORK_MODE_TO_BACKEND_MODE: Record<WorkMode, string> = {
  chat: 'quick',
  agent: 'think',
  plan: 'expert',
}

// ─── FREE 兜底配置（后端不可达 / 未登录时使用） ─────────

const FREE_FEATURES_FALLBACK: PlanFeatures = {
  modes: ['quick'],
  toolsLimit: 10,
  mcp: false,
  skill: false,
  codebaseIndex: false,
  scenarioDiscount: 1,
  prioritySupport: false,
  seats: 1,
  // 数量上限兜底：与后端 FREE_FEATURES 保持一致
  customAgentsLimit: 2,
  companionModelsLimit: 1,
  // 高级能力默认关闭
  liveInteraction: false,
  vts: false,
  a2a: false,
  externalApi: false,
  vmc: false,
  iot: false,
  perception: false,
  proactive: false,
}

const FREE_EFFECTIVE: EffectiveFeatures = {
  planId: 'FREE',
  features: FREE_FEATURES_FALLBACK,
  hasActiveSubscription: false,
  // 兜底配置不代表真实权益：能力收敛会据此跳过（见 EffectiveFeatures.source）
  source: 'fallback',
}

// ─── planId 归一化（兼容历史别名） ─────────────────────
// 数据库统一使用 PRO，但历史代码中曾出现 PROFESSIONAL 别名。
// 此处做防御性归一化，确保下游判断始终基于规范 planId。
const PLAN_ALIAS_MAP: Record<string, string> = {
  PROFESSIONAL: 'PRO',
}

function normalizePlanId(planId: string | undefined | null): string {
  if (!planId) return 'FREE'
  return PLAN_ALIAS_MAP[planId] ?? planId
}

// ─── 模块级缓存 ─────────────────────────────────────────

let cachedFeatures: EffectiveFeatures | null = null
let lastFetchTime = 0
let isFetching = false

/** 缓存有效期：5 分钟（减少后端压力，同时保证订阅状态相对及时） */
const CACHE_TTL_MS = 5 * 60 * 1000

// ─── 公共 API ───────────────────────────────────────────

/**
 * 获取有效功能配置（带缓存）
 *
 * 优先返回缓存；缓存过期或无缓存时请求后端。
 * 后端不可达时降级为 FREE 配置，避免阻塞用户。
 *
 * @param forceRefresh 强制刷新缓存（支付成功后调用）
 */
export async function getEffectiveFeatures(
  forceRefresh = false,
): Promise<EffectiveFeatures> {
  const now = Date.now()

  // 缓存命中且未过期
  if (!forceRefresh && cachedFeatures && now - lastFetchTime < CACHE_TTL_MS) {
    return cachedFeatures
  }

  // 防止并发重复请求
  if (isFetching) {
    // 等待进行中的请求完成，复用其结果
    return waitForFetch()
  }

  isFetching = true
  try {
    const result = await backendApi.get<EffectiveFeatures>(
      '/api/v1/payment/features',
    )
    // 归一化 planId：兼容历史别名（PROFESSIONAL → PRO）
    cachedFeatures = result
      ? { ...result, planId: normalizePlanId(result.planId), source: 'server' }
      : FREE_EFFECTIVE
    lastFetchTime = now
    return cachedFeatures
  } catch (e) {
    // 后端不可达：降级为缓存或 FREE
    const isNetworkError = e instanceof TypeError
    if (isNetworkError) {
      logger.system.warn('[FeatureGuard] Backend unreachable, using fallback')
    } else if (e instanceof BackendApiError && e.status === 401) {
      // 未登录，清空缓存
      cachedFeatures = null
      return FREE_EFFECTIVE
    } else {
      logger.system.error('[FeatureGuard] Fetch features failed:', e)
    }
    return cachedFeatures || FREE_EFFECTIVE
  } finally {
    isFetching = false
  }
}

/** 等待进行中的 fetch 完成（防并发） */
async function waitForFetch(): Promise<EffectiveFeatures> {
  const maxWait = 3000
  const interval = 50
  let waited = 0
  while (isFetching && waited < maxWait) {
    await new Promise((r) => setTimeout(r, interval))
    waited += interval
  }
  return cachedFeatures || FREE_EFFECTIVE
}

/**
 * 获取订阅状态（不缓存，每次请求后端获取最新状态）
 */
export async function getSubscriptionStatus(): Promise<SubscriptionStatus | null> {
  try {
    return await backendApi.get<SubscriptionStatus>(
      '/api/v1/payment/subscription',
    )
  } catch (e) {
    const isNetworkError = e instanceof TypeError
    if (isNetworkError) {
      logger.system.warn('[FeatureGuard] Fetch subscription failed: backend unreachable')
    } else {
      logger.system.error('[FeatureGuard] Fetch subscription failed:', e)
    }
    return null
  }
}

/**
 * 取消订阅（到期不续费，保留当前周期权益）
 */
export async function cancelSubscription(): Promise<void> {
  await backendApi.post('/api/v1/payment/subscription/cancel')
  // 取消后刷新缓存
  await getEffectiveFeatures(true)
}

/**
 * 精确检查指定功能是否可用（请求后端，不依赖缓存）
 *
 * 适用于关键操作前的权限校验（如启动 Think 模式、访问 MCP 市场）
 */
export async function checkFeature(
  featureKey: keyof PlanFeatures,
): Promise<FeatureCheckResult> {
  try {
    return await backendApi.get<FeatureCheckResult>(
      `/api/v1/payment/features/check?key=${String(featureKey)}`,
    )
  } catch (e) {
    logger.system.warn('[FeatureGuard] Check feature failed, using cache:', e)
    // 降级：基于缓存判断
    const eff = await getEffectiveFeatures()
    const allowed = Boolean(eff.features[featureKey])
    return {
      allowed,
      currentPlanId: eff.planId,
      upgradeRequired: allowed ? undefined : 'PRO',
    }
  }
}

/**
 * 精确检查工作模式权限（请求后端）
 *
 * @param workMode 客户端 WorkMode（chat/agent/plan）
 */
export async function checkWorkMode(
  workMode: WorkMode,
): Promise<FeatureCheckResult> {
  const backendMode = WORK_MODE_TO_BACKEND_MODE[workMode]
  try {
    return await backendApi.get<FeatureCheckResult>(
      `/api/v1/payment/features/check?mode=${backendMode}`,
    )
  } catch (e) {
    logger.system.warn('[FeatureGuard] Check mode failed, using cache:', e)
    const eff = await getEffectiveFeatures()
    const allowedModes = eff.features.modes ?? ['quick']
    const allowed = allowedModes.includes(backendMode)
    return {
      allowed,
      reason: allowed ? undefined : `${backendMode} 模式需要 PRO 或更高版本套餐`,
      currentPlanId: eff.planId,
      upgradeRequired: allowed ? undefined : 'PRO',
    }
  }
}

// ─── 能力一致性收敛支撑 ─────────────────────────────────

/**
 * 该快照是否可用作「能力一致性收敛」的依据。
 *
 * 只有真实权益快照（后端返回 / 其后端来源的缓存）才可以收敛；
 * 兜底快照与未知来源一律返回 false —— 否则离线用户或令牌失效的
 * 付费用户会被误关闭全部高级能力。
 */
export function isAuthoritativeFeatures(
  eff: EffectiveFeatures | null | undefined,
): eff is EffectiveFeatures {
  if (!eff) return false
  return eff.source === 'server' || eff.source === 'cache'
}

/**
 * 从有效功能配置中抽取客户端能力授权快照。
 *
 * 只取 8 个客户端能力开关，不携带 modes / toolsLimit 等其它维度 ——
 * 主进程的收敛器只认这一组键，多传无益且会让两侧契约含糊。
 * 未配置的能力按 `false` 传给主进程（缺省即未授权）。
 */
export function buildCapabilityEntitlement(eff: EffectiveFeatures): {
  planId: string
  allowed: Record<ClientCapabilityKey, boolean>
} {
  const allowed = {} as Record<ClientCapabilityKey, boolean>
  for (const key of CLIENT_CAPABILITY_KEYS) {
    allowed[key] = eff.features[key] === true
  }
  return { planId: eff.planId, allowed }
}

// ─── 同步快速判断（基于缓存，无网络开销） ───────────────

/**
 * 同步判断当前有效套餐是否为付费版（PRO/TEAM/ENTERPRISE）
 *
 * 基于 latest 缓存，登录后已预加载。
 * 若缓存为空（极端情况），回退到 cloudUser.planId 判断（兼容旧逻辑）。
 */
export function isPaidPlanSync(
  fallbackPlanId?: string,
): boolean {
  if (cachedFeatures) {
    return cachedFeatures.planId !== 'FREE'
  }
  // 缓存为空时回退到 planId 判断（不完美，但避免阻塞）
  const planId = normalizePlanId(fallbackPlanId)
  return planId === 'PRO' || planId === 'TEAM' || planId === 'ENTERPRISE'
}

/**
 * 同步判断工作模式是否可用（基于缓存）
 */
export function canUseWorkModeSync(
  workMode: WorkMode,
  fallbackPlanId?: string,
): boolean {
  const backendMode = WORK_MODE_TO_BACKEND_MODE[workMode]

  if (cachedFeatures) {
    const allowedModes = cachedFeatures.features.modes ?? ['quick']
    return allowedModes.includes(backendMode)
  }

  // 缓存为空：FREE 用户仅允许 quick，付费用户允许全部（宽松降级）
  if (workMode === 'chat') return true
  return isPaidPlanSync(fallbackPlanId)
}

/**
 * 同步判断布尔型功能是否可用（基于缓存）
 */
export function canUseFeatureSync(
  featureKey: keyof PlanFeatures,
  fallbackPlanId?: string,
): boolean {
  if (cachedFeatures) {
    return Boolean(cachedFeatures.features[featureKey])
  }
  // 缓存为空降级
  return isPaidPlanSync(fallbackPlanId)
}

/**
 * 同步获取数量上限（基于缓存）
 *
 * @returns -1 表示无限；缓存缺失字段时回落 FREE 默认值
 */
export function getFeatureLimitSync(
  key: PlanQuotaKey,
  fallbackPlanId?: string,
): number {
  void fallbackPlanId
  if (cachedFeatures) {
    const value = cachedFeatures.features[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
  }
  const fallback = FREE_FEATURES_FALLBACK[key]
  return typeof fallback === 'number' ? fallback : 0
}

/**
 * 同步判断「还能再新增一个」是否允许（数量未达上限）
 *
 * @param currentCount 当前已有数量
 */
export function isWithinQuotaSync(
  key: PlanQuotaKey,
  currentCount: number,
  fallbackPlanId?: string,
): boolean {
  const limit = getFeatureLimitSync(key, fallbackPlanId)
  if (limit === -1) return true
  return currentCount < limit
}

/**
 * 精确检查数量上限（请求后端，不依赖缓存）
 *
 * @param key 数量类功能键
 * @param currentCount 当前已有数量
 */
export async function checkQuota(
  key: PlanQuotaKey,
  currentCount: number,
): Promise<FeatureCheckResult & { limit?: number }> {
  try {
    return await backendApi.get<FeatureCheckResult & { limit?: number }>(
      `/api/v1/payment/features/quota?key=${key}&count=${currentCount}`,
    )
  } catch (e) {
    logger.system.warn('[FeatureGuard] Check quota failed, using cache:', e)
    // 降级：基于缓存判断
    const eff = await getEffectiveFeatures()
    const limit = getFeatureLimitSync(key, eff.planId)
    const allowed = limit === -1 || currentCount < limit
    return {
      allowed,
      currentPlanId: eff.planId,
      upgradeRequired: allowed ? undefined : 'PRO',
      limit,
    }
  }
}

/**
 * 同步获取有效套餐 ID（基于缓存）
 */
export function getEffectivePlanIdSync(fallbackPlanId?: string): string {
  return cachedFeatures?.planId || normalizePlanId(fallbackPlanId)
}

/**
 * 同步获取场景折扣（基于缓存）
 */
export function getScenarioDiscountSync(fallbackPlanId?: string): number {
  if (cachedFeatures) {
    return cachedFeatures.features.scenarioDiscount ?? 1
  }
  return isPaidPlanSync(fallbackPlanId) ? 0.8 : 1
}

// ─── 加油包 API ─────────────────────────────────────────

/** 获取可购买的加油包列表 */
export async function getBoosterPacks(): Promise<BoosterPackConfig[]> {
  try {
    return await backendApi.get<BoosterPackConfig[]>('/api/v1/payment/boosters')
  } catch (e) {
    logger.system.error('[FeatureGuard] Fetch booster packs failed:', e)
    return []
  }
}

/**
 * 创建加油包订单
 * @returns { order, payment } 订单与支付信息
 */
export async function createBoosterOrder(
  packId: string,
  channel: string,
): Promise<{
  order: { orderNo: string }
  payment: {
    /** 网关下单是否成功（失败时 error 有值，需由调用方展示） */
    success?: boolean
    orderNo?: string
    qrCodeUrl?: string
    paymentUrl?: string
    error?: string
  }
}> {
  return backendApi.post('/api/v1/payment/booster-order', { packId, channel })
}

// ─── 缓存管理 ───────────────────────────────────────────

/**
 * 清除缓存（登出时调用）
 */
export function clearFeatureGuardCache(): void {
  cachedFeatures = null
  lastFetchTime = 0
}

/**
 * 预加载有效功能配置（登录成功后调用）
 */
export async function preloadFeatures(): Promise<void> {
  try {
    await getEffectiveFeatures(true)
  } catch {
    // 预加载失败不阻塞登录流程
  }
}
