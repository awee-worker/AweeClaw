/**
 * PlanPanel — 套餐管理面板
 *
 * 布局：左右分栏（100% 宽度）
 * - 左侧：当前套餐、用量、套餐列表
 * - 右侧：支付方式选择、支付二维码/跳转
 *
 * 响应式：移动端自动堆叠为上下布局
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import {
  Crown,
  Zap,
  Feather,
  Rocket,
  AlertCircle,
  Loader2,
  Users,
  BellRing,
  X,
  CheckCircle2,
} from 'lucide-react'
import QRCode from 'qrcode'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton } from '@components/ui'
import { t, type Language } from '@renderer/i18n'
import { backendApi } from '@services/backendApi'
import { useFeatureGuard } from '@hooks/useFeatureGuard'
import { getQuotaBarColor, getQuotaTextColor } from '@utils/quotaColors'
import { formatTokenCount } from '@utils/formatter'
import {
  type PlanItem,
  type PaymentResult,
  type PaymentChannelInfo,
  channelLabels,
  channelStyles,
  extractChannelNames,
  getChannelIconUrl,
} from './shared'
import { ChannelIcon } from '@components/payment/ChannelIcon'
import { PlanCard } from './PlanCard'

interface PlanPanelProps {
  language: Language
}

export function PlanPanel({ language }: PlanPanelProps) {
  const { cloudUser, quota, fetchQuota, fetchProfile } = useStore(useShallow(s => ({
    cloudUser: s.cloudUser,
    quota: s.quota,
    fetchQuota: s.fetchQuota,
    fetchProfile: s.fetchProfile,
  })))
  const { effectivePlanId, refresh: refreshFeatures } = useFeatureGuard()

  const [plans, setPlans] = useState<PlanItem[]>([])
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const [channelInfo, setChannelInfo] = useState<PaymentChannelInfo | null>(null)
  const [selectedPlan, setSelectedPlan] = useState<PlanItem | null>(null)
  const [paymentChannel, setPaymentChannel] = useState('')
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [paymentError, setPaymentError] = useState('')
  const [polling, setPolling] = useState(false)
  const [loadingPlans, setLoadingPlans] = useState(false)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')
  /** 支付成功标识（轮询检测到 PAID 后置为 true） */
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  /** 未读的订阅到期提醒通知 */
  const [expiryNotification, setExpiryNotification] = useState<{
    id: string
    type: 'subscription_expiring' | 'subscription_expired'
    title: string
    content: string | null
  } | null>(null)
  /** 轮询定时器引用，用于组件卸载或取消支付时清理 */
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** 停止订单状态轮询 */
  const stopPolling = useCallback(() => {
    setPolling(false)
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  // 组件卸载时清理轮询定时器，避免内存泄漏和状态更新警告
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        clearTimeout(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [])

  // 获取未读的订阅到期/过期提醒通知
  // 只展示「当前生效订阅」的提醒：已订阅新套餐后，旧订阅的残留提醒不再展示
  useEffect(() => {
    let cancelled = false
    Promise.all([
      backendApi.get<{
        items: Array<{
          id: string
          type: string
          title: string
          content: string | null
          metadata?: { subscriptionId?: string } | null
        }>
      }>('/api/v1/payment/notifications?unreadOnly=true&limit=20'),
      backendApi
        .get<{ subscription: { id: string } | null }>('/api/v1/payment/subscription')
        .catch(() => null),
    ])
      .then(([data, status]) => {
        if (cancelled) return
        const activeSubId = status?.subscription?.id ?? null
        const note = (data?.items || [])
          .filter(
            n => n.type === 'subscription_expiring' || n.type === 'subscription_expired',
          )
          .find(n => {
            const noteSubId = n.metadata?.subscriptionId
            // 无活跃订阅时只提示「已过期」，旧订阅的即将到期提醒不再展示
            if (!activeSubId) return n.type === 'subscription_expired'
            // 历史数据缺少 subscriptionId 时保守展示
            if (!noteSubId) return true
            return noteSubId === activeSubId
          })
        if (note) {
          setExpiryNotification({
            id: note.id,
            type: note.type as 'subscription_expiring' | 'subscription_expired',
            title: note.title,
            content: note.content,
          })
        } else {
          setExpiryNotification(null)
        }
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [effectivePlanId])

  /** 关闭到期提醒横幅并标记已读 */
  const dismissNotification = useCallback(() => {
    if (!expiryNotification) return
    backendApi
      .post(`/api/v1/payment/notifications/${expiryNotification.id}/read`)
      .catch(() => {})
    setExpiryNotification(null)
  }, [expiryNotification])

  useEffect(() => {
    setLoadingPlans(true)
    Promise.all([
      backendApi
        .get<PlanItem[]>('/api/v1/payment/plans')
        .then(data => {
          const sorted = (data || []).filter(p => p.isActive).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
          setPlans(sorted)

          // 默认选中当前套餐的下一级套餐（跳过 FREE，免费版不可手动订阅）
          // 若已是最后一级套餐，则选最后一级（即当前套餐本身，右侧面板显示"使用中"状态）
          if (sorted.length > 0) {
            const currentIdx = sorted.findIndex(p => p.name === effectivePlanId)
            let nextPlan: PlanItem | undefined
            if (currentIdx === -1) {
              // 未找到当前套餐，选第一个非 FREE 套餐
              nextPlan = sorted.find(p => p.name !== 'FREE') || sorted[0]
            } else if (currentIdx >= sorted.length - 1) {
              // 已是最后一级，选最后一级（跳过 FREE）
              nextPlan = sorted.slice().reverse().find(p => p.name !== 'FREE') || sorted[sorted.length - 1]
            } else {
              // 从当前位置往后找第一个非 FREE 套餐
              nextPlan = sorted.slice(currentIdx + 1).find(p => p.name !== 'FREE')
              if (!nextPlan) {
                // 后面全是 FREE，往前找
                nextPlan = sorted.slice(0, currentIdx).reverse().find(p => p.name !== 'FREE')
              }
              if (!nextPlan) nextPlan = sorted[currentIdx]
            }
            setSelectedPlan(nextPlan)
          }
        })
        .catch(() => setPlans([])),
      backendApi
        .get<PaymentChannelInfo>('/api/v1/payment/channels')
        .then(data => {
          const info = data || null
          setChannelInfo(info)
          // 默认选中微信支付（若不可用则选第一个可用渠道）
          const names = extractChannelNames(info || undefined)
          if (names.length > 0 && !paymentChannel) {
            setPaymentChannel(names.includes('WECHAT') ? 'WECHAT' : names[0])
          }
        })
        .catch(() => setChannelInfo({ channels: ['WECHAT', 'ALIPAY'], mockMode: false })),
    ]).finally(() => setLoadingPlans(false))
  }, [effectivePlanId])

  useEffect(() => {
    if (paymentResult?.qrCodeUrl) {
      QRCode.toDataURL(paymentResult.qrCodeUrl, { width: 192, margin: 2, color: { dark: '#000000', light: '#ffffff' } })
        .then(url => setQrCodeDataUrl(url))
        .catch(() => setQrCodeDataUrl(''))
    } else {
      setQrCodeDataUrl('')
    }
  }, [paymentResult?.qrCodeUrl])

  const handleUpgrade = useCallback(async () => {
    if (!selectedPlan || !paymentChannel) return
    setPaymentLoading(true)
    setPaymentError('')
    setPaymentResult(null)
    setQrCodeDataUrl('')
    setPaymentSuccess(false)
    try {
      const result = await backendApi.post<{ order: any; payment: PaymentResult }>('/api/v1/payment/create', {
        planId: selectedPlan.id,
        channel: paymentChannel,
        periodMonths: billingPeriod === 'yearly' ? 12 : 1,
      })

      // 支付网关下单失败（后端已将 success:false 转为异常，这里做二次防御）
      if (result.payment?.success === false) {
        setPaymentError(result.payment.error || t('user.failedtocreateorder', language as Language))
        return
      }

      setPaymentResult(result.payment)
      setPolling(true)
      pollOrderStatus(result.order.orderNo || result.payment.orderNo)
    } catch (e: any) {
      setPaymentError(e?.message || (t('user.failedtocreateorder', language as Language)))
    } finally {
      setPaymentLoading(false)
    }
  }, [selectedPlan, paymentChannel, language, billingPeriod])

  /** 支付确认成功：停止轮询并刷新用户权益 */
  const markPaid = useCallback(async () => {
    stopPolling()
    setPaymentSuccess(true)
    await fetchQuota()
    await fetchProfile()
    await refreshFeatures()
  }, [stopPolling, fetchQuota, fetchProfile, refreshFeatures])

  /**
   * 主动向支付网关对账（补单）
   *
   * 异步回调（notify）可能延迟、丢失，或因回调地址配置问题始终无法送达。
   * 这种情况下单纯轮询本地订单状态会永远停在 PENDING，用户看到的就是一个
   * 卡住不动的「支付确认中」。因此改为周期性调用后端 reconcile 接口，
   * 由后端直接向支付宝查询该笔交易的真实状态并在必要时补正订单。
   */
  const reconcileOrder = useCallback(async (orderNo: string): Promise<boolean> => {
    try {
      const res = await backendApi.post<{ reconciled: boolean }>(
        `/api/v1/payment/order/${orderNo}/reconcile`,
        {},
      )
      if (res?.reconciled) {
        await markPaid()
        return true
      }
    } catch (e) {
      logger.ui.warn('Failed to reconcile order:', e)
    }
    return false
  }, [markPaid])

  /** 用户自助核实：已扫码付款但界面仍停在「等待确认」时的手动入口 */
  const handleVerifyNow = useCallback(async () => {
    if (!paymentResult?.orderNo) return
    setPaymentError('')
    const done = await reconcileOrder(paymentResult.orderNo)
    if (!done) {
      setPaymentError(
        language === 'zh'
          ? '暂未查询到已支付的交易，请确认已完成付款后重试'
          : 'No completed payment found yet, please confirm you have paid',
      )
    }
  }, [paymentResult?.orderNo, reconcileOrder, language])

  const pollOrderStatus = useCallback(async (orderNo: string) => {
    let attempts = 0
    const maxAttempts = 60   // 最多轮询 60 次
    const intervalMs = 3000  // 每 3 秒轮询一次，共约 3 分钟

    const poll = async () => {
      if (attempts >= maxAttempts) {
        stopPolling()
        setPaymentError(language === 'zh' ? '支付确认超时，如已支付请点击「我已支付，立即核实」' : 'Payment confirmation timeout, if you have paid please click "I have paid, verify now"')
        return
      }
      attempts++
      try {
        // 每 5 轮（约 15 秒）主动对账一次，兜住回调延迟或丢失的情况
        if (attempts % 5 === 1 && (await reconcileOrder(orderNo))) return

        const order = await backendApi.get<any>(`/api/v1/payment/order/${orderNo}`)
        if (order?.status === 'PAID') {
          await markPaid()
          return
        }
        if (order?.status === 'CANCELLED' || order?.status === 'EXPIRED') {
          stopPolling()
          setPaymentError(t('user.order', language as Language, { status: order.status.toLowerCase(), status2: order.status === 'CANCELLED' ? '取消' : '过期' }))
          return
        }
      } catch (e) { logger.ui.warn('Failed to poll order status:', e) }
      // 继续下一轮轮询
      pollTimerRef.current = setTimeout(poll, intervalMs)
    }
    poll()
  }, [language, stopPolling, reconcileOrder, markPaid])

  const quotaPercent = quota && quota.limit > 0 ? Math.min((quota.used / quota.limit) * 100, 100) : 0
  const displayChannels = extractChannelNames(channelInfo || undefined)

  return (
    <div className="w-full">
      {/* 到期/已过期提醒横幅 */}
      {expiryNotification && (
        <div
          className={`mb-4 flex items-start gap-3 p-3 rounded-xl border ${
            expiryNotification.type === 'subscription_expired'
              ? 'bg-rose-500/10 border-rose-500/30'
              : 'bg-amber-500/10 border-amber-500/30'
          }`}
        >
          <BellRing
            className={`w-5 h-5 shrink-0 mt-0.5 ${
              expiryNotification.type === 'subscription_expired' ? 'text-rose-400' : 'text-amber-400'
            }`}
          />
          <div className="flex-1 min-w-0">
            <p
              className={`text-sm font-medium ${
                expiryNotification.type === 'subscription_expired' ? 'text-rose-400' : 'text-amber-400'
              }`}
            >
              {expiryNotification.title}
            </p>
            {expiryNotification.content && (
              <p className="text-[12px] text-text-secondary mt-1">{expiryNotification.content}</p>
            )}
          </div>
          <button
            onClick={dismissNotification}
            className="shrink-0 p-1 rounded-md text-text-muted hover:text-text-primary hover:bg-white/5 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
        {/* ======================================== */}
        {/* 左侧：当前套餐 + 用量 + 套餐列表 */}
        {/* ======================================== */}
        <div className="flex-1 min-w-0 space-y-4">
          {/* 当前套餐卡片 */}
          <div className="flex items-center gap-3 p-4 rounded-xl bg-surface/50 border border-border/40">
            {effectivePlanId === 'ENTERPRISE' ? (
              <Rocket className="w-6 h-6 text-amber-400" />
            ) : effectivePlanId === 'PRO' ? (
              <Crown className="w-6 h-6 text-violet-400" />
            ) : effectivePlanId === 'TEAM' ? (
              <Users className="w-6 h-6 text-blue-400" />
            ) : (
              <Feather className="w-6 h-6 text-text-muted" />
            )}
            <div className="flex-1">
              <p className="text-sm font-semibold text-text-primary">
                {quota?.displayName || (effectivePlanId === 'FREE'
                  ? t('user.freeplan', language as Language)
                  : effectivePlanId === 'PRO'
                    ? t('user.proplan', language as Language)
                    : effectivePlanId === 'TEAM'
                      ? (language === 'zh' ? '团队版' : 'Team')
                      : effectivePlanId === 'ENTERPRISE'
                        ? t('user.enterpriseplan', language as Language)
                        : effectivePlanId)}
              </p>
              <p className="text-xs text-text-muted">{cloudUser?.role}</p>
            </div>
          </div>

          {/* 用量进度条 */}
          {quota && (
            <div className="space-y-2 px-1">
              <div className="flex items-center justify-between text-xs">
                <span className={`flex items-center gap-1 ${getQuotaTextColor(quotaPercent)}`}>
                  <Zap className="w-3 h-3" />
                  {t('user.tokenusage', language as Language)}
                </span>
                <span className={`${getQuotaTextColor(quotaPercent)} font-mono`}>
                  {formatTokenCount(quota.used)} / {quota.remaining === -1 ? (t('user.text1', language as Language)) : formatTokenCount(quota.limit)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${getQuotaBarColor(quotaPercent)}`}
                  style={{ width: `${Math.max(quotaPercent, quotaPercent > 0 ? 3 : 0)}%` }}
                />
              </div>
            </div>
          )}

          {/* 套餐列表 */}
          <div className="border-t border-border/30 pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-text-primary">
                {t('user.upgradeplan', language as Language)}
              </h4>
              {/* 月/年付切换 */}
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-surface/50 border border-border/40">
                <button
                  onClick={() => setBillingPeriod('monthly')}
                  className={`px-3 py-1 rounded-md text-[12px] font-medium transition-all ${
                    billingPeriod === 'monthly'
                      ? 'bg-accent text-white'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {language === 'zh' ? '月付' : 'Monthly'}
                </button>
                <button
                  onClick={() => setBillingPeriod('yearly')}
                  className={`px-3 py-1 rounded-md text-[12px] font-medium transition-all ${
                    billingPeriod === 'yearly'
                      ? 'bg-accent text-white'
                      : 'text-text-muted hover:text-text-primary'
                  }`}
                >
                  {language === 'zh' ? '年付' : 'Yearly'}
                  <span className="ml-1 text-accent/80">省2月</span>
                </button>
              </div>
            </div>
            {loadingPlans ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
              </div>
            ) : plans.length === 0 ? (
              <div className="text-center py-4 text-sm text-text-muted">
                {t('user.noupgradeplansavailable', language as Language)}
              </div>
            ) : (
              <div className="space-y-2">
                {plans.map(plan => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    isCurrent={plan.name === effectivePlanId}
                    selected={selectedPlan?.id === plan.id}
                    onSelect={(p) => {
                      setSelectedPlan(p)
                      stopPolling()
                      setPaymentResult(null)
                      setPaymentError('')
                      setQrCodeDataUrl('')
                      setPaymentSuccess(false)
                      // 切换套餐后保留已选支付渠道，提升体验
                    }}
                    billingPeriod={billingPeriod}
                    language={language}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* ======================================== */}
        {/* 右侧：支付方式 + 支付信息（固定宽度 360px） */}
        {/* ======================================== */}
        <div className="w-full lg:w-[360px] shrink-0 space-y-4">
          {/* 支付方式选择 + 二维码区域 */}
          <div className="p-4 rounded-xl bg-surface/50 border border-border/40">
            <h4 className="text-sm font-medium text-text-primary mb-3">
              {t('user.selectpaymentmethod', language as Language)}
            </h4>

            {selectedPlan ? (
              <>
                {/* 已选套餐摘要 */}
                <div className="mb-3 p-3 rounded-lg bg-accent/5 border border-accent/20">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-text-primary">
                      {selectedPlan.displayName}
                    </span>
                    <span className="text-lg font-bold text-accent">
                      ¥{(billingPeriod === 'yearly' && selectedPlan.yearPrice
                        ? Number(selectedPlan.yearPrice)
                        : Number(selectedPlan.price)
                      ).toFixed(2)}
                    </span>
                  </div>
                  <p className="text-[12px] text-text-muted mt-1">
                    {billingPeriod === 'yearly' && selectedPlan.yearPrice
                      ? (language === 'zh' ? '年付' : 'Yearly')
                      : (language === 'zh' ? '月付' : 'Monthly')}
                  </p>
                </div>

                {/* 渠道列表 */}
                {displayChannels.length === 0 ? (
                  <div className="text-center py-6 text-sm text-text-muted">
                    {language === 'zh' ? '暂无可用支付方式，请联系管理员' : 'No payment channels available'}
                  </div>
                ) : (
                  <div className={`grid gap-2 ${displayChannels.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                    {displayChannels.map(ch => {
                      const style = channelStyles[ch] || { active: 'border-accent/50 bg-accent/10 ring-1 ring-accent/30', inactive: 'border-border/50 bg-surface/30 hover:border-border' }
                      const label = channelLabels[ch] || { zh: ch, en: ch }
                      const iconUrl = getChannelIconUrl(channelInfo || undefined, ch)
                      return (
                        <button
                          key={ch}
                          onClick={() => setPaymentChannel(ch)}
                          disabled={!!paymentResult}
                          className={`p-3 rounded-xl border text-center transition-all flex flex-col items-center gap-1.5 ${paymentChannel === ch ? style.active : style.inactive} ${paymentResult ? 'opacity-50 cursor-not-allowed' : ''}`}
                        >
                          <ChannelIcon channel={ch} iconUrl={iconUrl} className="w-6 h-6" />
                          <span className="text-sm font-medium text-text-primary">
                            {language === 'zh' ? label.zh : label.en}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}

                {/* 错误提示 */}
                {paymentError && (
                  <div className="flex items-center gap-2 p-3 mt-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{paymentError}</span>
                  </div>
                )}

                {/* 支付按钮 / 支付结果（二维码显示在支付方式下方） */}
                {!paymentResult ? (
                  <ActionButton
                    variant="primary"
                    className="w-full mt-3"
                    onClick={handleUpgrade}
                    disabled={!paymentChannel || paymentLoading}
                  >
                    {paymentLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : t('user.pay', language as Language, {
                      price: (billingPeriod === 'yearly' && selectedPlan.yearPrice
                        ? Number(selectedPlan.yearPrice)
                        : Number(selectedPlan.price)
                      ).toFixed(2),
                    })}
                  </ActionButton>
                ) : paymentSuccess ? (
                  /* 支付成功标识 */
                  <div className="mt-3 space-y-3 text-center">
                    <div className="py-6 flex flex-col items-center gap-3">
                      <div className="w-16 h-16 rounded-full bg-green-500/15 flex items-center justify-center">
                        <CheckCircle2 className="w-10 h-10 text-green-500" />
                      </div>
                      <div>
                        <p className="text-base font-semibold text-text-primary">
                          {language === 'zh' ? '支付成功' : 'Payment Successful'}
                        </p>
                        <p className="text-[12px] text-text-muted mt-1">
                          {language === 'zh' ? '套餐已激活，权益已更新' : 'Plan activated, benefits updated'}
                        </p>
                      </div>
                    </div>
                    <ActionButton
                      variant="ghost"
                      className="w-full"
                      onClick={() => {
                        setPaymentResult(null)
                        setPaymentSuccess(false)
                        setPaymentError('')
                        setQrCodeDataUrl('')
                      }}
                    >
                      {language === 'zh' ? '完成' : 'Done'}
                    </ActionButton>
                  </div>
                ) : (
                  <div className="mt-3 space-y-3">
                    {/* 微信支付二维码 */}
                    {paymentChannel === 'WECHAT' && paymentResult.qrCodeUrl && (
                      <div className="space-y-2 text-center">
                        <p className="text-sm text-text-primary">{t('user.scanwithwechattopay', language as Language)}</p>
                        <div className="w-48 h-48 mx-auto bg-white rounded-xl flex items-center justify-center overflow-hidden">
                          {qrCodeDataUrl ? <img src={qrCodeDataUrl} alt="QR" className="w-full h-full" /> : <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}
                        </div>
                      </div>
                    )}
                    {/* 支付宝扫码支付 */}
                    {paymentChannel === 'ALIPAY' && (paymentResult.paymentUrl || paymentResult.qrCodeUrl) && (
                      <div className="space-y-2 text-center">
                        <p className="text-sm text-text-primary">{language === 'zh' ? '请用支付宝扫码支付' : 'Scan with Alipay to pay'}</p>
                        {paymentResult.paymentUrl ? (
                          /* 电脑网站支付：iframe 内嵌支付宝收银台（qr_pay_mode=4），二维码不跳出客户端 */
                          <>
                            {/* qr_pay_mode=4 为「可定义宽度的嵌入式二维码」：支付宝按 qrcode_width
                                （后端 alipay-gateway.ts 传 200）出码，页面内容自左上角起排，
                                不会在容器内自适应居中。因此容器必须与二维码等尺寸，一旦偏大，
                                多出的宽高就会以「右侧/底部空白」显现，看起来二维码没居中。
                                另外 iframe 是 inline 元素，默认带基线间隙，需用 block 消除底部空条。
                                ⚠ 调整尺寸需同步 alipay-gateway.ts 的 qrcode_width。 */}
                            <div className="w-56 h-56 mx-auto bg-white rounded-xl overflow-hidden flex items-center justify-center">
                              <iframe
                                title="alipay-cashier"
                                src={paymentResult.paymentUrl}
                                scrolling="no"
                                className="w-[200px] h-[200px] border-0 block"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                const url = paymentResult.paymentUrl
                                if (url) window.electronAPI?.openExternalUrl?.(url)
                              }}
                              className="text-xs text-accent hover:underline"
                            >
                              {language === 'zh' ? '在浏览器中打开' : 'Open in browser'}
                            </button>
                          </>
                        ) : (
                          /* 当面付：本地渲染 qr_code 二维码 */
                          <div className="w-48 h-48 mx-auto bg-white rounded-xl flex items-center justify-center overflow-hidden">
                            {qrCodeDataUrl ? <img src={qrCodeDataUrl} alt="QR" className="w-full h-full" /> : <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}
                          </div>
                        )}
                      </div>
                    )}
                    {/* 轮询提示 */}
                    {polling && (
                      <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        {t('user.waitingforpaymentconfirmation', language as Language)}
                      </div>
                    )}
                    {/* 自助补单入口：已扫码付款但回调未送达时的自救通道。
                        刻意不放在 polling 分支内 —— 轮询超时或订单被判超时后，
                        恰恰是最需要用它的时刻，按钮必须仍然可见。 */}
                    <button
                      type="button"
                      onClick={handleVerifyNow}
                      className="w-full text-xs text-accent hover:underline"
                    >
                      {language === 'zh' ? '我已支付，立即核实' : 'I have paid, verify now'}
                    </button>
                    {/* 取消按钮 */}
                    <ActionButton variant="ghost" className="w-full" onClick={() => { stopPolling(); setPaymentResult(null); setPaymentError(''); setQrCodeDataUrl(''); setPaymentSuccess(false) }}>
                      {t('user.back', language as Language)}
                    </ActionButton>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8 text-sm text-text-muted">
                {language === 'zh' ? '请从左侧选择要升级的套餐' : 'Please select a plan from the left'}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
