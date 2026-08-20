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
import { useState, useEffect, useCallback } from 'react'
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
  checkWorkMode,
  checkFeature,
  type EffectiveFeatures,
  type PlanFeatures,
} from '@services/featureGuardService'
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

  /** 同步判断工作模式是否可用 */
  canUseMode: (mode: WorkMode) => boolean
  /** 同步判断布尔型功能是否可用 */
  canUseFeature: (key: keyof PlanFeatures) => boolean
  /** 同步获取场景折扣（0.8 或 1） */
  getScenarioDiscount: () => number

  /** 异步校验工作模式权限（不通过则弹升级提示），通过返回 true */
  requireMode: (mode: WorkMode) => Promise<boolean>
  /** 异步校验功能权限（不通过则弹升级提示），通过返回 true */
  requireFeature: (key: keyof PlanFeatures) => Promise<boolean>

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

  // 登录状态变化时预加载 / 登出时清空
  useEffect(() => {
    if (isAuthenticated) {
      setLoading(true)
      preloadFeatures()
        .then(() => getEffectiveFeatures())
        .then((eff) => setEffectiveFeatures(eff))
        .finally(() => setLoading(false))
    } else {
      clearFeatureGuardCache()
      setEffectiveFeatures(null)
    }
  }, [isAuthenticated])

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
    (key: keyof PlanFeatures) => canUseFeatureSync(key, fallbackPlanId),
    [fallbackPlanId],
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

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const eff = await getEffectiveFeatures(true)
      setEffectiveFeatures(eff)
    } finally {
      setLoading(false)
    }
  }, [])

  return {
    effectiveFeatures,
    loading,
    effectivePlanId,
    isPaidPlan: isPaid,
    hasActiveSubscription: hasActiveSub,
    canUseMode,
    canUseFeature,
    getScenarioDiscount,
    requireMode,
    requireFeature,
    refresh,
  }
}
