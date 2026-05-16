import { useState, useCallback, useEffect } from 'react'
import {
  Crown,
  Zap,
  Feather,
  Rocket,
  CreditCard,
  ExternalLink,
  AlertCircle,
  Loader2,
} from 'lucide-react'
import QRCode from 'qrcode'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton } from '@components/ui'
import { type Language } from '@renderer/i18n'
import { backendApi } from '@services/backendApi'
import { getQuotaBarColor, getQuotaTextColor } from '@utils/quotaColors'
import {
  type PlanItem,
  type PaymentResult,
  type PaymentChannelInfo,
  planIcons,
  planColors,
  channelLabels,
  channelStyles,
} from './shared'

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

  const [plans, setPlans] = useState<PlanItem[]>([])
  const [availableChannels, setAvailableChannels] = useState<string[]>([])
  const [mockMode, setMockMode] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanItem | null>(null)
  const [paymentChannel, setPaymentChannel] = useState('')
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [paymentError, setPaymentError] = useState('')
  const [polling, setPolling] = useState(false)
  const [loadingPlans, setLoadingPlans] = useState(false)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState('')

  useEffect(() => {
    setLoadingPlans(true)
    Promise.all([
      backendApi
        .get<PlanItem[]>('/api/v1/payment/plans')
        .then(data => setPlans((data || []).filter(p => p.isActive && Number(p.price) > 0 && p.name !== cloudUser?.planId)))
        .catch(() => setPlans([])),
      backendApi
        .get<PaymentChannelInfo>('/api/v1/payment/channels')
        .then(data => {
          setAvailableChannels(data?.channels || [])
          setMockMode(data?.mockMode ?? false)
        })
        .catch(() => {
          setAvailableChannels(['WECHAT', 'ALIPAY'])
          setMockMode(false)
        }),
    ]).finally(() => setLoadingPlans(false))
  }, [cloudUser?.planId])

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
    try {
      const result = await backendApi.post<{ order: any; payment: PaymentResult }>('/api/v1/payment/create', {
        planId: selectedPlan.id,
        channel: paymentChannel,
        periodMonths: 1,
      })
      setPaymentResult(result.payment)
      if (paymentChannel === 'ALIPAY' && result.payment?.paymentUrl) {
        window.electronAPI?.openExternalUrl?.(result.payment.paymentUrl)
      }
      setPolling(true)
      pollOrderStatus(result.order.orderNo || result.payment.orderNo)
    } catch (e: any) {
      setPaymentError(e?.message || (language === 'zh' ? '创建订单失败' : 'Failed to create order'))
    } finally {
      setPaymentLoading(false)
    }
  }, [selectedPlan, paymentChannel, language])

  const pollOrderStatus = useCallback(async (orderNo: string) => {
    let attempts = 0
    const maxAttempts = 60
    const poll = async () => {
      if (attempts >= maxAttempts) { setPolling(false); return }
      attempts++
      try {
        const order = await backendApi.get<any>(`/api/v1/payment/order/${orderNo}`)
        if (order?.status === 'PAID') {
          setPolling(false)
          await fetchQuota()
          await fetchProfile()
          return
        }
        if (order?.status === 'CANCELLED' || order?.status === 'EXPIRED') {
          setPolling(false)
          setPaymentError(language === 'zh' ? `订单已${order.status === 'CANCELLED' ? '取消' : '过期'}` : `Order ${order.status.toLowerCase()}`)
          return
        }
      } catch {}
      setTimeout(poll, 5000)
    }
    poll()
  }, [language, fetchQuota, fetchProfile])

  const quotaPercent = quota && quota.limit > 0 ? Math.min((quota.used / quota.limit) * 100, 100) : 0
  const displayChannels = mockMode ? ['MOCK', ...availableChannels.filter(c => c !== 'MOCK')] : availableChannels

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 p-4 rounded-xl bg-surface/50 border border-border/40">
        {cloudUser?.planId === 'ENTERPRISE' ? (
          <Rocket className="w-6 h-6 text-amber-400" />
        ) : cloudUser?.planId === 'PRO' || cloudUser?.planId === 'PROFESSIONAL' ? (
          <Crown className="w-6 h-6 text-violet-400" />
        ) : (
          <Feather className="w-6 h-6 text-text-muted" />
        )}
        <div className="flex-1">
          <p className="text-sm font-semibold text-text-primary">
            {quota?.displayName || (cloudUser?.planId === 'FREE'
              ? language === 'zh' ? '免费版' : 'Free Plan'
              : cloudUser?.planId === 'PRO' || cloudUser?.planId === 'PROFESSIONAL'
                ? language === 'zh' ? '专业版' : 'Pro Plan'
                : cloudUser?.planId === 'ENTERPRISE'
                  ? language === 'zh' ? '企业版' : 'Enterprise Plan'
                  : cloudUser?.planId)}
          </p>
          <p className="text-xs text-text-muted">{cloudUser?.role}</p>
        </div>
      </div>

      {quota && (
        <div className="space-y-2 px-1">
          <div className="flex items-center justify-between text-xs">
            <span className={`flex items-center gap-1 ${getQuotaTextColor(quotaPercent)}`}>
              <Zap className="w-3 h-3" />
              {language === 'zh' ? 'Token 用量' : 'Token Usage'}
            </span>
            <span className={`${getQuotaTextColor(quotaPercent)} font-mono`}>
              {quota.used.toLocaleString()} / {quota.remaining === -1 ? (language === 'zh' ? '无限' : '∞') : quota.limit.toLocaleString()}
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

      <div className="border-t border-border/30 pt-4">
        {cloudUser?.planId !== 'ENTERPRISE' && !paymentResult && (
          <>
            <h4 className="text-sm font-medium text-text-primary mb-3">
              {language === 'zh' ? '升级套餐' : 'Upgrade Plan'}
            </h4>
            {loadingPlans ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
              </div>
            ) : plans.length === 0 ? (
              <div className="text-center py-4 text-sm text-text-muted">
                {language === 'zh' ? '暂无可升级套餐' : 'No upgrade plans available'}
              </div>
            ) : (
              <div className="space-y-2">
                {plans.map(plan => (
                  <button
                    key={plan.id}
                    onClick={() => { setSelectedPlan(plan); setPaymentChannel(''); setPaymentError('') }}
                    className={`w-full p-3 rounded-xl border text-left transition-all ${
                      selectedPlan?.id === plan.id
                        ? `${planColors[plan.name] || 'border-accent/30 bg-accent/5'} border-accent/50 ring-1 ring-accent/30`
                        : 'border-border/50 bg-surface/30 hover:border-border'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {planIcons[plan.name] || <CreditCard className="w-5 h-5 text-text-muted" />}
                      <div className="flex-1">
                        <p className="text-sm font-medium text-text-primary">{plan.displayName}</p>
                        {plan.description && <p className="text-xs text-text-muted mt-0.5">{plan.description}</p>}
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-text-primary">¥{Number(plan.price).toFixed(0)}</p>
                        <p className="text-xs text-text-muted">{language === 'zh' ? '/月' : '/mo'}</p>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {selectedPlan && (
              <div className="space-y-3 mt-4">
                <p className="text-xs text-text-muted">{language === 'zh' ? '选择支付方式' : 'Select payment method'}</p>
                <div className={`grid gap-2 ${displayChannels.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                  {displayChannels.map(ch => {
                    const style = channelStyles[ch] || channelStyles.MOCK
                    const label = channelLabels[ch] || { zh: ch, en: ch }
                    return (
                      <button
                        key={ch}
                        onClick={() => setPaymentChannel(ch)}
                        className={`p-3 rounded-xl border text-center transition-all ${paymentChannel === ch ? style.active : style.inactive}`}
                      >
                        <span className="text-sm font-medium text-text-primary">{language === 'zh' ? label.zh : label.en}</span>
                      </button>
                    )
                  })}
                </div>
                {paymentError && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{paymentError}</span>
                  </div>
                )}
                <ActionButton variant="primary" className="w-full" onClick={handleUpgrade} disabled={!paymentChannel || paymentLoading}>
                  {paymentLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : language === 'zh' ? `支付 ¥${Number(selectedPlan.price).toFixed(2)}` : `Pay ¥${Number(selectedPlan.price).toFixed(2)}`}
                </ActionButton>
              </div>
            )}
          </>
        )}
      </div>

      {paymentResult && (
        <div className="text-center space-y-4">
          <div className="p-6 rounded-xl bg-surface/50 border border-border/50">
            {paymentChannel === 'WECHAT' && paymentResult.qrCodeUrl && (
              <div className="space-y-3">
                <p className="text-sm text-text-primary">{language === 'zh' ? '请使用微信扫码支付' : 'Scan with WeChat to pay'}</p>
                <div className="w-48 h-48 mx-auto bg-white rounded-xl flex items-center justify-center overflow-hidden">
                  {qrCodeDataUrl ? <img src={qrCodeDataUrl} alt="QR" className="w-full h-full" /> : <Loader2 className="w-5 h-5 animate-spin text-gray-400" />}
                </div>
              </div>
            )}
            {paymentChannel === 'ALIPAY' && paymentResult.paymentUrl && (
              <div className="space-y-3">
                <p className="text-sm text-text-primary">{language === 'zh' ? '即将跳转到支付宝' : 'Redirecting to Alipay'}</p>
                <ActionButton variant="secondary" onClick={() => window.electronAPI?.openExternalUrl?.(paymentResult.paymentUrl!)} leftIcon={<ExternalLink className="w-4 h-4" />}>
                  {language === 'zh' ? '前往支付' : 'Go to Pay'}
                </ActionButton>
              </div>
            )}
            {paymentChannel === 'MOCK' && (
              <div className="space-y-3">
                <p className="text-sm text-text-primary">{language === 'zh' ? '模拟支付模式' : 'Mock Payment Mode'}</p>
                <ActionButton variant="success" onClick={async () => {
                  if (!paymentResult.qrCodeUrl) return
                  try {
                    const serverUrl = useStore.getState().serverUrl
                    const url = paymentResult.qrCodeUrl.replace('mock://qr', `${serverUrl}/api/v1/payment/mock-pay`)
                    await fetch(url)
                  } catch {}
                }}>
                  {language === 'zh' ? '模拟支付成功' : 'Mock Pay Success'}
                </ActionButton>
              </div>
            )}
          </div>
          {polling && (
            <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
              <Loader2 className="w-3 h-3 animate-spin" />
              {language === 'zh' ? '等待支付确认...' : 'Waiting for payment confirmation...'}
            </div>
          )}
          <ActionButton variant="ghost" onClick={() => { setPaymentResult(null); setPaymentError(''); setPolling(false); setQrCodeDataUrl('') }}>
            {language === 'zh' ? '返回' : 'Back'}
          </ActionButton>
        </div>
      )}
    </div>
  )
}
