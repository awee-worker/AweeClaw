/**
 * useFeatureGuard — 付费墙响应式 Hook
 *
 * 职责：
 * 1. 提供响应式的功能权限检查（基于缓存的 effectiveFeatures）
 * 2. 登录状态变化时自动预加载功能配置
 * 3. 提供 requireMode / requireFeature：关键操作前的异步校验 + 升级引导
 *
 * 使用示例：
 *   const { canUseMode, requireMode, isPaidPlan } = useFeatureGuard()
 *   if (!canUseMode('plan')) { ... 显示锁定标识 }
 *   const ok = await requireMode('plan')  // 校验+拦截，不通过则弹升级提示
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { toast } from '@components/foundation/NotificationProvider'
import { t, type Language } from '@renderer/i18n'
import {
  getEffectiveFeatures,
  preloadFeatures,
  clearFeatureGuardCache,
  canUseWorkModeSync,
  canUseFeatureSync,
  isPaidPlanSync,
  getScenarioDiscountSync,
  getFeatureLimitSync,
  isWithinQuotaSync,
  checkWorkMode,
  checkFeature,
  checkQuota,
  type EffectiveFeatures,
  type PlanFeatures,
  type PlanQuotaKey,
} from '@services/featureGuardService'
import {
  convergeCapabilitiesFor,
  type ConvergenceOutcome,
} from '@services/capabilityConvergence'
import type { WorkMode } from '@/renderer/modes/workModeTypes'

export interface UseFeatureGuardReturn {
  /** 有效功能配置（登录后自动加载） */
  effectiveFeatures: EffectiveFeatures | null
  /** 是否正在加载 */
  loading: boolean
  /** 有效套餐 ID（考虑订阅过期） */
  effectivePlanId: string
  /** 是否为付费版（PRO/TEAM/ENTERPRISE） */
  isPaidPlan: boolean
  /** 是否有活跃订阅 */
  hasActiveSubscription: boolean
  /** 是否已登录（未登录为本地模式，不做付费拦截） */
  isAuthenticated: boolean

  /** 同步判断工作模式是否可用 */
  canUseMode: (mode: WorkMode) => boolean
  /** 同步判断布尔型功能是否可用 */
  canUseFeature: (key: keyof PlanFeatures) => boolean
  /** 同步获取场景折扣（0.8 或 1） */
  getScenarioDiscount: () => number

  /** 同步获取数量上限（-1 表示无限） */
  getLimit: (key: PlanQuotaKey) => number
  /** 同步判断是否还能新增（数量未达上限） */
  canAddMore: (key: PlanQuotaKey, currentCount: number) => boolean

  /** 异步校验工作模式权限（不通过则弹升级提示），通过返回 true */
  requireMode: (mode: WorkMode) => Promise<boolean>
  /** 异步校验功能权限（不通过则弹升级提示），通过返回 true */
  requireFeature: (key: keyof PlanFeatures) => Promise<boolean>
  /** 异步校验数量上限（不通过则弹升级提示），通过返回 true */
  requireQuota: (key: PlanQuotaKey, currentCount: number) => Promise<boolean>

  /** 弹出升级引导（自定义提示文案时使用） */
  promptUpgrade: (reason?: string) => void

  /** 强制刷新功能配置（支付成功后调用） */
  refresh: () => Promise<void>
}

export function useFeatureGuard(): UseFeatureGuardReturn {
  const { isAuthenticated, cloudUser, setShowUserProfilePage } = useStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      cloudUser: s.cloudUser,
      setShowUserProfilePage: s.setShowUserProfilePage,
    })),
  )

  const [effectiveFeatures, setEffectiveFeatures] =
    useState<EffectiveFeatures | null>(null)
  const [loading, setLoading] = useState(false)

  const language = useStore((s) => s.language) as Language

  /**
   * 语言的最新值。
   *
   * 提示文案要跟随当前语言，但「收敛」的调用方是登录态副作用 —— 若把
   * `language` 直接写进依赖，切换语言会让副作用重跑，顺带触发一次
   * `getEffectiveFeatures(true)` 的强制刷新（多余的后端请求）。
   * 因此用 ref 取值，让收敛函数保持稳定引用。
   */
  const languageRef = useRef(language)
  useEffect(() => {
    languageRef.current = language
  }, [language])

  /**
   * 能力一致性收敛：把后端权益落到本地模块配置上。
   *
   * 处理「降级后不回收」——用户在 PRO 期间开启的 VTS / VMC / A2A 等，
   * 降级或订阅到期后仍会继续运行。收敛只在拿到可信快照时执行（见
   * capabilityConvergence 的闸门），且主进程侧幂等，可放心重复调用。
   */
  const runConvergence = useCallback(
    async (eff: EffectiveFeatures | null, authenticated: boolean): Promise<ConvergenceOutcome> => {
      const outcome = await convergeCapabilitiesFor(eff, authenticated)
      if (outcome.revokedKeys.length > 0) {
        const lang = languageRef.current
        const names = outcome.revokedKeys
          .map((key) => t(`featureguard.capability.${key}`, lang) || key)
          .join(lang === 'zh' ? '、' : ', ')
        toast.info(
          t('featureguard.capabilityrevoked', lang),
          t('featureguard.capabilityrevokeddesc', lang, { items: names }),
        )
      }
      return outcome
    },
    [],
  )

  // 登录状态变化时预加载 / 登出时清空
  useEffect(() => {
    if (isAuthenticated) {
      setLoading(true)
      preloadFeatures()
        .then(() => getEffectiveFeatures())
        .then(async (eff) => {
          setEffectiveFeatures(eff)
          await runConvergence(eff, true)
        })
        .finally(() => setLoading(false))
    } else {
      clearFeatureGuardCache()
      setEffectiveFeatures(null)
    }
  }, [isAuthenticated, runConvergence])

  // 兜底 planId（缓存为空时使用 cloudUser.planId）
  const fallbackPlanId = cloudUser?.planId

  const effectivePlanId = effectiveFeatures?.planId || fallbackPlanId || 'FREE'
  const isPaid = isPaidPlanSync(fallbackPlanId)
  const hasActiveSub = effectiveFeatures?.hasActiveSubscription ?? false

  /** 升级引导：弹出提示并打开套餐页面 */
  const promptUpgrade = useCallback(
    (reason?: string) => {
      const title = t('featureguard.upgraderequired', language)
      const desc =
        reason ||
        t('featureguard.upgradetouse', language) ||
        '当前套餐不支持此功能，请升级到 PRO 或更高版本'
      toast.warning(title, desc)
      setShowUserProfilePage(true)
    },
    [language, setShowUserProfilePage],
  )

  const canUseMode = useCallback(
    (mode: WorkMode) => canUseWorkModeSync(mode, fallbackPlanId),
    [fallbackPlanId],
  )

  const canUseFeature = useCallback(
    (key: keyof PlanFeatures) => {
      // 未登录（纯本地模式）不做付费拦截
      if (!isAuthenticated) return true
      return canUseFeatureSync(key, fallbackPlanId)
    },
    [fallbackPlanId, isAuthenticated],
  )

  const getLimit = useCallback(
    (key: PlanQuotaKey) => getFeatureLimitSync(key, fallbackPlanId),
    [fallbackPlanId],
  )

  const canAddMore = useCallback(
    (key: PlanQuotaKey, currentCount: number) => {
      if (!isAuthenticated) return true
      return isWithinQuotaSync(key, currentCount, fallbackPlanId)
    },
    [fallbackPlanId, isAuthenticated],
  )

  const getScenarioDiscount = useCallback(
    () => getScenarioDiscountSync(fallbackPlanId),
    [fallbackPlanId],
  )

  const requireMode = useCallback(
    async (mode: WorkMode): Promise<boolean> => {
      // 未登录直接放行（本地模式不拦截）
      if (!isAuthenticated) return true
      const result = await checkWorkMode(mode)
      if (!result.allowed) {
        promptUpgrade(result.reason)
        return false
      }
      return true
    },
    [isAuthenticated, promptUpgrade],
  )

  const requireFeature = useCallback(
    async (key: keyof PlanFeatures): Promise<boolean> => {
      if (!isAuthenticated) return true
      const result = await checkFeature(key)
      if (!result.allowed) {
        promptUpgrade(result.reason)
        return false
      }
      return true
    },
    [isAuthenticated, promptUpgrade],
  )

  const requireQuota = useCallback(
    async (key: PlanQuotaKey, currentCount: number): Promise<boolean> => {
      if (!isAuthenticated) return true
      const result = await checkQuota(key, currentCount)
      if (!result.allowed) {
        promptUpgrade(result.reason)
        return false
      }
      return true
    },
    [isAuthenticated, promptUpgrade],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const eff = await getEffectiveFeatures(true)
      setEffectiveFeatures(eff)
      // 支付成功 / 订阅变更后重新收敛：升级时无副作用（全部有权限），
      // 降级时把已开启的能力关掉
      await runConvergence(eff, true)
    } finally {
      setLoading(false)
    }
  }, [runConvergence])

  return {
    effectiveFeatures,
    loading,
    effectivePlanId,
    isPaidPlan: isPaid,
    hasActiveSubscription: hasActiveSub,
    isAuthenticated,
    canUseMode,
    canUseFeature,
    getScenarioDiscount,
    getLimit,
    canAddMore,
    requireMode,
    requireFeature,
    requireQuota,
    promptUpgrade,
    refresh,
  }
}
