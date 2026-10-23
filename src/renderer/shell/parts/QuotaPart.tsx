/**
 * 套餐 / Token 用量部件（quota）
 *
 * 从 AppTitleBar 中拆出，供两条路径共用：
 * - 声明式：区域树写 { type:'part', id:'quota' }，由 RegionRenderer 摆放
 * - 命令式：场景通过 SDK 直接渲染 <HostPart id="quota" />
 *
 * 该入口同时承担「查看 Token 用量」与「查看 / 管理套餐」两个职责，因此门禁
 * 只校验登录态，不与云端模式强绑定：
 * - cloudMode === 'cloud'：云朵图标 + 剩余百分比，弹层展示用量明细
 * - cloudMode === 'local'：Crown 图标、不显示百分比，弹层只保留套餐与入口
 */

import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Calendar, Clock, Cloud, Crown } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { getQuotaBarColor, getQuotaTextColor, getQuotaGlowColor } from '@utils/quotaColors'
import { formatTokenCount } from '@utils/formatter'
import { getSubscriptionStatus, type SubscriptionStatus } from '@services/featureGuardService'
import DockPopover from '@components/ui/DockPopover'
import type { HostPartComponentProps } from '../HostPartRegistry'

/** 格式化订阅日期（与 SubscriptionPanel 的展示口径保持一致） */
function formatPlanDate(dateStr: string, language: Language): string {
  try {
    return new Date(dateStr).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return dateStr
  }
}

export function QuotaPart({ placement = 'compact' }: HostPartComponentProps & { placement?: 'compact' | 'full' }) {
  const language = useStore((s) => s.language)
  const { isAuthenticated, cloudMode, quota, fetchQuota } = useStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      cloudMode: s.cloudMode,
      quota: s.quota,
      fetchQuota: s.fetchQuota,
    })),
  )

  const [subscription, setSubscription] = useState<SubscriptionStatus | null>(null)

  // 云端模式用于 Token 用量，本地模式仅需套餐名做展示，两者都依赖账号级配额数据
  const isCloud = cloudMode === 'cloud'

  useEffect(() => {
    if (isAuthenticated && !quota) {
      fetchQuota().catch(() => {})
    }
  }, [isAuthenticated, quota, fetchQuota])

  /**
   * 订阅状态按需拉取：/payment/subscription 接口后端不做缓存，
   * 因此只在面板展开时请求，避免顶部图标常驻发起无效请求。
   */
  const refreshSubscription = useCallback(() => {
    void getSubscriptionStatus().then((status) => {
      // 请求失败时该接口返回 null，此时保留上一次结果，避免弹层闪现空白
      if (status) setSubscription(status)
    })
  }, [])

  // 只要已登录就渲染：本地模式下仍保留套餐查看入口
  if (!isAuthenticated) return null

  // 非云端模式下不计算/展示 Token 百分比
  const usedPercent = isCloud && quota && quota.limit !== -1
    ? Math.min(100, (quota.used / quota.limit) * 100)
    : 0

  const quotaPercent = isCloud && quota && quota.remaining !== -1
    ? Math.max(0, Math.round((1 - quota.used / quota.limit) * 100))
    : null

  const isQuotaExceeded = quotaPercent !== null && quotaPercent <= 0
  const isQuotaLow = quotaPercent !== null && quotaPercent <= 20

  const cloudColorClass = getQuotaTextColor(usedPercent)
  const quotaLabel = isCloud && quota
    ? quota.remaining === -1
      ? '∞'
      : `${quotaPercent}%`
    : ''
  const quotaColorClass = getQuotaTextColor(usedPercent)

  const subInfo = subscription?.subscription ?? null
  const hasActive = Boolean(subscription?.hasActiveSubscription && subInfo)
  // 套餐名优先取订阅接口的最新值，回落用量接口，最后为免费版
  const planName = subscription?.planName || quota?.displayName || (t('layout.free', language as Language))
  // 免费版用户从未订阅、无订阅记录，此时不显示「已过期」徽章
  const showStatusBadge = Boolean(subInfo)

  const iconTitle = isCloud
    ? quota
      ? `Token: ${formatTokenCount(quota.used)} / ${quota.limit === -1 ? '∞' : formatTokenCount(quota.limit)}${isQuotaExceeded ? (t('layout.exceeded', language as Language)) : isQuotaLow ? (t('layout.low', language as Language)) : ''}`
      : ''
    : `${t('layout.plan', language as Language)}: ${planName}`

  // placement === 'full' 时省略百分比文本，只保留图标（场景自己排版时更省空间）
  const showPercentLabel = placement !== 'full' && Boolean(quotaLabel)

  const trigger = (
    <div
      className="flex items-center gap-1.5 px-1.5 py-0.5 h-6 rounded-md cursor-pointer group hover:bg-white/5 transition-colors"
    >
      {isCloud ? (
        <Cloud className={`w-3 h-3 ${cloudColorClass} ${getQuotaGlowColor(usedPercent)}`} />
      ) : (
        <Crown className="w-3.5 h-3.5 text-amber-400" />
      )}
      {showPercentLabel && (
        <span className={`text-[10px] font-mono ${quotaColorClass} transition-colors`}>
          {quotaLabel}
        </span>
      )}
    </div>
  )

  return (
    <DockPopover
      placement="bottom"
      icon={trigger}
      tooltip={iconTitle}
      title={isCloud ? t('layout.tokenusage', language as Language) : t('layout.plan', language as Language)}
      width={300}
      height={isCloud ? 320 : 200}
      language={language as 'en' | 'zh'}
      onOpen={refreshSubscription}
    >
      <div className="p-3 space-y-4">
        {/* 当前套餐 + 订阅情况（到期时间 / 剩余天数） */}
        <div className="px-3 py-2.5 rounded-xl bg-accent/5 border border-accent/10 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted shrink-0">
              {t('subscription.currentplan', language as Language)}
            </span>
            <span className="text-xs font-medium text-accent ml-auto truncate">{planName}</span>
            {showStatusBadge && (
              <span className={`shrink-0 px-1.5 py-0.5 rounded-full text-[10px] font-medium border ${
                hasActive
                  ? 'bg-green-500/10 text-green-400 border-green-500/20'
                  : 'bg-text-muted/10 text-text-muted border-text-muted/20'
              }`}>
                {hasActive
                  ? t('subscription.active', language as Language)
                  : t('subscription.expired', language as Language)}
              </span>
            )}
          </div>

          {subInfo && (
            <>
              <div className="flex items-center gap-1.5 text-[11px]">
                <Calendar className="w-3 h-3 text-text-muted shrink-0" />
                <span className="text-text-muted">
                  {t('subscription.periodend', language as Language)}
                </span>
                <span className={`ml-auto ${hasActive ? 'text-text-primary' : 'text-text-muted'}`}>
                  {formatPlanDate(subInfo.currentPeriodEnd, language)}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[11px]">
                <Clock className="w-3 h-3 text-text-muted shrink-0" />
                <span className="text-text-muted">
                  {t('subscription.daysremaining', language as Language)}
                </span>
                <span className={`ml-auto font-medium ${hasActive ? 'text-text-primary' : 'text-amber-400'}`}>
                  {hasActive
                    ? t('featureguard.daysremaining', language as Language, { days: String(subInfo.daysRemaining) })
                    : t('subscription.expired', language as Language)}
                </span>
              </div>
            </>
          )}
        </div>

        {/* 云端模式：Token 用量明细（本地模式无云端配额概念） */}
        {isCloud && quota && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="flex flex-col items-center p-2.5 rounded-xl bg-surface/80">
                <span className="text-[10px] text-text-muted mb-1">{t('layout.used', language as Language)}</span>
                <span className="text-sm font-bold text-text-primary">{formatTokenCount(quota.used)}</span>
              </div>
              <div className="flex flex-col items-center p-2.5 rounded-xl bg-surface/80">
                <span className="text-[10px] text-text-muted mb-1">{t('layout.remaining', language as Language)}</span>
                <span className="text-sm font-bold text-text-primary">
                  {quota.remaining === -1
                    ? (t('layout.text0', language as Language))
                    : formatTokenCount(quota.remaining)}
                </span>
              </div>
              <div className="flex flex-col items-center p-2.5 rounded-xl bg-surface/80">
                <span className="text-[10px] text-text-muted mb-1">{t('layout.total', language as Language)}</span>
                <span className="text-sm font-bold text-text-primary">
                  {quota.limit === -1
                    ? (t('layout.text1', language as Language))
                    : formatTokenCount(quota.limit)}
                </span>
              </div>
            </div>

            {quota.limit !== -1 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-muted">
                    {t('layout.progress', language as Language)}
                  </span>
                  <span className={`font-mono ${getQuotaTextColor(usedPercent)}`}>
                    {usedPercent.toFixed(1)}%
                  </span>
                </div>
                <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${getQuotaBarColor(usedPercent)}`}
                    style={{ width: `${usedPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={() => {
            useStore.getState().setShowUserProfilePage(true)
          }}
          className="w-full py-2 text-xs text-accent hover:text-accent-hover transition-colors text-center"
        >
          {t('layout.manageplan', language as Language)}
        </button>
      </div>
    </DockPopover>
  )
}

export default QuotaPart
