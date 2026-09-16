/**
 * SubscriptionPanel — 订阅管理面板
 *
 * 职责：
 * 1. 展示当前订阅状态（套餐、到期时间、剩余天数）
 * 2. 说明到期后自动降级为免费版（系统无自动续费机制，无需手动取消）
 * 3. 无订阅时引导升级
 *
 * 独立组件，不与 PlanPanel 混合，遵循"每个页面独立组件"原则。
 */
import { useState, useEffect, useCallback } from 'react'
import {
  Crown,
  Rocket,
  Feather,
  Calendar,
  Clock,
  AlertCircle,
  Loader2,
  CheckCircle2,
  XCircle,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { t, type Language } from '@renderer/i18n'
import {
  getSubscriptionStatus,
  type SubscriptionStatus,
} from '@services/featureGuardService'

interface SubscriptionPanelProps {
  language: Language
}

/** 格式化日期为本地化字符串 */
function formatDate(dateStr: string, language: Language): string {
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export function SubscriptionPanel({ language }: SubscriptionPanelProps) {
  const cloudUser = useStore(useShallow((s) => s.cloudUser))

  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchSubscription = useCallback(async () => {
    setLoading(true)
    try {
      const status = await getSubscriptionStatus()
      setSubscription(status)
    } catch {
      setSubscription(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchSubscription()
  }, [fetchSubscription])

  // 加载中
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-accent" />
      </div>
    )
  }

  const sub = subscription?.subscription
  const hasActive = subscription?.hasActiveSubscription && sub

  // 套餐图标
  const planIcon =
    subscription?.planId === 'ENTERPRISE' ? (
      <Rocket className="w-5 h-5 text-amber-400" />
    ) : subscription?.planId === 'PRO' || subscription?.planId === 'TEAM' ? (
      <Crown className="w-5 h-5 text-violet-400" />
    ) : (
      <Feather className="w-5 h-5 text-text-muted" />
    )

  return (
    <div className="space-y-6">
      {/* 订阅状态卡片 */}
      <div className="p-5 rounded-xl bg-surface/50 border border-border/40">
        <div className="flex items-start gap-4">
          <div className="shrink-0 p-2.5 rounded-lg bg-accent/10">
            {planIcon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h4 className="text-base font-semibold text-text-primary">
                {subscription?.planName || cloudUser?.planId || 'FREE'}
              </h4>
              {hasActive ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-green-500/10 text-green-400 border border-green-500/20">
                  <CheckCircle2 className="w-3 h-3" />
                  {t('subscription.active', language)}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[12px] font-medium bg-text-muted/10 text-text-muted border border-text-muted/20">
                  <XCircle className="w-3 h-3" />
                  {t('subscription.expired', language)}
                </span>
              )}
            </div>

            {hasActive && sub ? (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-text-muted shrink-0" />
                  <div>
                    <p className="text-text-muted text-[12px]">{t('subscription.periodstart', language)}</p>
                    <p className="text-text-primary">{formatDate(sub.currentPeriodStart, language)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Calendar className="w-4 h-4 text-text-muted shrink-0" />
                  <div>
                    <p className="text-text-muted text-[12px]">{t('subscription.periodend', language)}</p>
                    <p className="text-text-primary">{formatDate(sub.currentPeriodEnd, language)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock className="w-4 h-4 text-text-muted shrink-0" />
                  <div>
                    <p className="text-text-muted text-[12px]">{t('subscription.daysremaining', language)}</p>
                    <p className="text-text-primary">
                      {t('featureguard.daysremaining', language, { days: String(sub.daysRemaining) })}
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-text-muted">
                {t('subscription.nosubscriptiondesc', language)}
              </p>
            )}
          </div>
        </div>

        {hasActive && (
          <p className="mt-4 pt-4 border-t border-border/30 text-[12px] text-text-muted">
            {t('subscription.autodowngrade', language)}
          </p>
        )}
      </div>

      {/* 无订阅引导 */}
      {!hasActive && (
        <div className="p-5 rounded-xl bg-accent/[0.04] border border-accent/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-accent shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-text-primary">
                {t('subscription.nosubscription', language)}
              </p>
              <p className="text-[12px] text-text-muted mt-1">
                {t('subscription.nosubscriptiondesc', language)}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
