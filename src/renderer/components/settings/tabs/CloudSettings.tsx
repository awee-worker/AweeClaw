import { useCallback, useEffect, useState } from 'react'
import { LogOut, CheckCircle2, CreditCard, Zap, Crown, X, ExternalLink } from 'lucide-react'
import QRCode from 'qrcode'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton } from '@components/ui'
import { backendApi } from '@services/backendApi'
import { t, type Language } from '@renderer/i18n'
import { getQuotaBarColor, getQuotaTextColor } from '@utils/quotaColors'

interface PlanItem {
  id: string
  name: string
  displayName: string
  description: string | null
  tokenLimit: number
  price: number
  isActive: boolean
  isDefault: boolean
}

interface PaymentResult {
  orderNo: string
  qrCodeUrl?: string
  paymentUrl?: string
}

interface PaymentChannelInfo {
  channels: string[]
  mockMode: boolean
}

const planIcons: Record<string, React.ReactNode> = {
  FREE: <Zap className="w-5 h-5 text-blue-400" />,
  PRO: <CreditCard className="w-5 h-5 text-violet-400" />,
  ENTERPRISE: <Crown className="w-5 h-5 text-amber-400" />,
}

const planColors: Record<string, string> = {
  FREE: 'border-blue-500/30 bg-blue-500/5',
  PRO: 'border-violet-500/30 bg-violet-500/5',
  ENTERPRISE: 'border-amber-500/30 bg-amber-500/5',
}

const channelLabels: Record<string, { zh: string; en: string }> = {
  WECHAT: { zh: '微信支付', en: 'WeChat Pay' },
  ALIPAY: { zh: '支付宝', en: 'Alipay' },
  MOCK: { zh: '模拟支付', en: 'Mock Pay' },
}

const channelStyles: Record<string, { active: string; inactive: string }> = {
  WECHAT: {
    active: 'border-green-500/50 bg-green-500/10 text-green-400',
    inactive: 'border-border/50 text-text-secondary hover:border-border',
  },
  ALIPAY: {
    active: 'border-blue-500/50 bg-blue-500/10 text-blue-400',
    inactive: 'border-border/50 text-text-secondary hover:border-border',
  },
  MOCK: {
    active: 'border-amber-500/50 bg-amber-500/10 text-amber-400',
    inactive: 'border-border/50 text-text-secondary hover:border-border',
  },
}

export function CloudSettings({ language }: { language: Language }) {
  const {
    isAuthenticated,
    cloudUser,
    serverUrl,
    quota,
    logout,
    fetchQuota,
    fetchProfile,
  } = useStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      cloudUser: s.cloudUser,
      serverUrl: s.serverUrl,
      quota: s.quota,
      logout: s.logout,
      fetchQuota: s.fetchQuota,
      fetchProfile: s.fetchProfile,
    })),
  )

  const [plans, setPlans] = useState<PlanItem[]>([])
  const [availableChannels, setAvailableChannels] = useState<string[]>([])
  const [mockMode, setMockMode] = useState(false)
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanItem | null>(null)
  const [paymentChannel, setPaymentChannel] = useState<string>('')
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [paymentError, setPaymentError] = useState('')
  const [polling, setPolling] = useState(false)
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string>('')

  useEffect(() => {
    if (isAuthenticated && !quota) {
      fetchQuota().catch(() => {})
    }
  }, [isAuthenticated])

  const fetchPlans = useCallback(async () => {
    try {
      const data = await backendApi.get<PlanItem[]>('/api/v1/payment/plans')
      setPlans((data || []).filter((p) => p.isActive && p.price > 0))
    } catch {}
  }, [])

  const fetchChannels = useCallback(async () => {
    try {
      const data = await backendApi.get<PaymentChannelInfo>('/api/v1/payment/channels')
      setAvailableChannels(data?.channels || [])
      setMockMode(data?.mockMode ?? false)
    } catch {
      setAvailableChannels(['WECHAT', 'ALIPAY'])
      setMockMode(false)
    }
  }, [])

  useEffect(() => {
    if (paymentResult?.qrCodeUrl) {
      QRCode.toDataURL(paymentResult.qrCodeUrl, {
        width: 192,
        margin: 2,
        color: { dark: '#000000', light: '#ffffff' },
      })
        .then((url) => setQrCodeDataUrl(url))
        .catch(() => setQrCodeDataUrl(''))
    } else {
      setQrCodeDataUrl('')
    }
  }, [paymentResult?.qrCodeUrl])

  const handleLogout = useCallback(() => {
    logout()
  }, [logout])

  const handleRefreshQuota = useCallback(async () => {
    try {
      await fetchQuota()
    } catch {}
  }, [fetchQuota])

  const handleUpgrade = useCallback(async () => {
    if (!selectedPlan || !paymentChannel) return
    setPaymentLoading(true)
    setPaymentError('')
    setPaymentResult(null)
    setQrCodeDataUrl('')

    try {
      const result = await backendApi.post<{ order: any; payment: PaymentResult }>(
        '/api/v1/payment/create',
        {
          planId: selectedPlan.id,
          channel: paymentChannel,
          periodMonths: 1,
        },
      )
      setPaymentResult(result.payment)

      if (paymentChannel === 'ALIPAY' && result.payment?.paymentUrl) {
        window.electronAPI?.openExternalUrl?.(result.payment.paymentUrl)
      }

      setPolling(true)
      pollOrderStatus(result.order.orderNo || result.payment.orderNo)
    } catch (e: any) {
      setPaymentError(e?.message || (t('settings.failedtocreateorder', language as Language)))
    } finally {
      setPaymentLoading(false)
    }
  }, [selectedPlan, paymentChannel, language])

  const pollOrderStatus = useCallback(async (orderNo: string) => {
    let attempts = 0
    const maxAttempts = 60

    const poll = async () => {
      if (attempts >= maxAttempts) {
        setPolling(false)
        return
      }
      attempts++

      try {
        const order = await backendApi.get<any>(`/api/v1/payment/order/${orderNo}`)
        if (order?.status === 'PAID') {
          setPolling(false)
          setShowUpgrade(false)
          setSelectedPlan(null)
          setPaymentChannel('')
          setPaymentResult(null)
          setQrCodeDataUrl('')
          await fetchQuota()
          await fetchProfile()
          return
        }
        if (order?.status === 'CANCELLED' || order?.status === 'EXPIRED') {
          setPolling(false)
          setPaymentError(
            t('settings.order', language as Language, { status: order.status.toLowerCase(), status2: order.status === 'CANCELLED' ? '取消' : '过期' }),
          )
          return
        }
      } catch {}

      setTimeout(poll, 5000)
    }

    poll()
  }, [language, fetchQuota, fetchProfile])

  const handleMockPay = useCallback(async () => {
    if (!paymentResult?.qrCodeUrl) return
    try {
      const url = paymentResult.qrCodeUrl.replace('mock://qr', `${serverUrl}/api/v1/payment/mock-pay`)
      await fetch(url)
    } catch {}
  }, [paymentResult, serverUrl])

  const handleOpenUpgrade = useCallback(() => {
    setShowUpgrade(true)
    fetchPlans()
    fetchChannels()
  }, [fetchPlans, fetchChannels])

  const handleCloseUpgrade = useCallback(() => {
    setShowUpgrade(false)
    setPaymentResult(null)
    setPaymentError('')
    setPolling(false)
    setQrCodeDataUrl('')
    setSelectedPlan(null)
    setPaymentChannel('')
  }, [])

  const displayChannels = mockMode
    ? ['MOCK', ...availableChannels.filter((c) => c !== 'MOCK')]
    : availableChannels

  if (!isAuthenticated || !cloudUser) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <p className="text-sm text-text-muted">
            {t('settings.clicktheavatarinthe', language as Language)}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 p-4 rounded-xl bg-status-success/5 border border-status-success/20">
        <CheckCircle2 className="w-5 h-5 text-status-success shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-text-primary">
            {t('settings.connectedtocloudservice', language as Language)}
          </p>
          <p className="text-xs text-text-muted mt-0.5 truncate">
            {serverUrl}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-text-primary">
          {t('settings.accountinfo', language as Language)}
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-surface/50 border border-border/50">
            <p className="text-xs text-text-muted">{t('settings.username', language as Language)}</p>
            <p className="text-sm text-text-primary font-medium mt-0.5">{cloudUser.username || '-'}</p>
          </div>
          <div className="p-3 rounded-lg bg-surface/50 border border-border/50">
            <p className="text-xs text-text-muted">{t('settings.email2', language as Language)}</p>
            <p className="text-sm text-text-primary font-medium mt-0.5 truncate">{cloudUser.email}</p>
          </div>
          <div className="p-3 rounded-lg bg-surface/50 border border-border/50">
            <p className="text-xs text-text-muted">{t('settings.role', language as Language)}</p>
            <p className="text-sm text-text-primary font-medium mt-0.5">{cloudUser.role}</p>
          </div>
          <div className="p-3 rounded-lg bg-surface/50 border border-border/50">
            <p className="text-xs text-text-muted">{t('settings.plan', language as Language)}</p>
            <p className="text-sm text-text-primary font-medium mt-0.5">{quota?.displayName || cloudUser.planId}</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-text-primary">
            {t('settings.usagequota', language as Language)}
          </h4>
          <button
            onClick={handleRefreshQuota}
            className="text-xs text-accent hover:text-accent-hover transition-colors"
          >
            {t('settings.refresh', language as Language)}
          </button>
        </div>
        {quota ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className={getQuotaTextColor(quota.limit === -1 || quota.remaining === -1 ? 0 : (quota.used / quota.limit) * 100)}>
                {t('settings.used', language as Language)}: {quota.used.toLocaleString()} tokens
              </span>
              <span className={getQuotaTextColor(quota.limit === -1 || quota.remaining === -1 ? 0 : (quota.used / quota.limit) * 100)}>
                {quota.remaining === -1
                  ? t('settings.unlimited', language as Language)
                  : `${quota.remaining.toLocaleString()} tokens`}
              </span>
            </div>
            <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${getQuotaBarColor(quota.limit === -1 || quota.remaining === -1 ? 0 : (quota.used / quota.limit) * 100)}`}
                style={{
                  width:
                    quota.limit === -1 || quota.remaining === -1
                      ? '5%'
                      : `${Math.min(100, (quota.used / quota.limit) * 100)}%`,
                }}
              />
            </div>
            <p className="text-xs text-text-muted">
              {t('settings.billingperiod', language as Language)}: {new Date(quota.periodStart).toLocaleDateString()} - {new Date(quota.periodEnd).toLocaleDateString()}
            </p>
          </div>
        ) : (
          <p className="text-xs text-text-muted">{t('settings.progressindicator', language as Language)}</p>
        )}
      </div>

      <div className="pt-2 space-y-3">
        <ActionButton
          variant="secondary"
          onClick={handleOpenUpgrade}
          className="w-full"
        >
          <CreditCard className="w-4 h-4" />
          {t('settings.upgradeplan', language as Language)}
        </ActionButton>
        <ActionButton variant="danger" onClick={handleLogout} className="w-full">
          <LogOut className="w-4 h-4" />
          {t('settings.signout', language as Language)}
        </ActionButton>
      </div>

      {showUpgrade && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={handleCloseUpgrade}>
          <div className="bg-surface border border-border rounded-2xl p-6 max-w-md w-full mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">
                {t('settings.upgradeplan2', language as Language)}
              </h3>
              <button onClick={handleCloseUpgrade} className="text-text-muted hover:text-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!paymentResult ? (
              <>
                <div className="space-y-3 mb-4">
                  {plans.map((plan) => (
                    <button
                      key={plan.id}
                      onClick={() => {
                        setSelectedPlan(plan)
                        setPaymentChannel('')
                        setPaymentError('')
                      }}
                      className={`w-full p-4 rounded-xl border text-left transition-all ${
                        selectedPlan?.id === plan.id
                          ? `${planColors[plan.name] || 'border-accent/30 bg-accent/5'} border-accent/50 ring-1 ring-accent/30`
                          : 'border-border/50 bg-surface/30 hover:border-border'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {planIcons[plan.name] || <CreditCard className="w-5 h-5 text-text-muted" />}
                        <div className="flex-1">
                          <p className="text-sm font-medium text-text-primary">{plan.displayName}</p>
                          {plan.description && (
                            <p className="text-xs text-text-muted mt-0.5">{plan.description}</p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-text-primary">¥{Number(plan.price).toFixed(0)}</p>
                          <p className="text-xs text-text-muted">{t('settings.mo', language as Language)}</p>
                        </div>
                      </div>
                      <p className="text-xs text-text-muted mt-2">
                        {plan.tokenLimit === -1
                          ? t('settings.unlimitedtokens', language as Language)
                          : `${(plan.tokenLimit / 10000).toFixed(0)}${t('settings.0k', language as Language)} tokens/${t('settings.mo2', language as Language)}`}
                      </p>
                    </button>
                  ))}
                </div>

                {selectedPlan && (
                  <div className="space-y-3">
                    <p className="text-xs text-text-muted">
                      {t('settings.dropdownselectorpaymentmethod', language as Language)}
                    </p>
                    <div className={`grid gap-2 ${displayChannels.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
                      {displayChannels.map((ch) => {
                        const style = channelStyles[ch] || channelStyles.MOCK
                        const label = channelLabels[ch] || { zh: ch, en: ch }
                        return (
                          <button
                            key={ch}
                            onClick={() => setPaymentChannel(ch)}
                            className={`p-3 rounded-xl border text-sm transition-all ${
                              paymentChannel === ch ? style.active : style.inactive
                            }`}
                          >
                            {language === 'zh' ? label.zh : label.en}
                          </button>
                        )
                      })}
                    </div>

                    {paymentError && (
                      <p className="text-xs text-status-error">{paymentError}</p>
                    )}

                    <ActionButton
                      variant="primary"
                      className="w-full"
                      onClick={handleUpgrade}
                      isLoading={paymentLoading}
                      disabled={!paymentChannel}
                    >
                      {t('settings.pay', language as Language, { price: Number(selectedPlan.price).toFixed(2) })}
                    </ActionButton>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center space-y-4">
                <div className="p-6 rounded-xl bg-surface/50 border border-border/50">
                  {paymentChannel === 'WECHAT' && paymentResult.qrCodeUrl && (
                    <div className="space-y-3">
                      <p className="text-sm text-text-primary">
                        {t('settings.scanwithwechattopay', language as Language)}
                      </p>
                      <div className="w-48 h-48 mx-auto bg-white rounded-xl flex items-center justify-center overflow-hidden">
                        {qrCodeDataUrl ? (
                          <img src={qrCodeDataUrl} alt="WeChat QR Code" className="w-full h-full" />
                        ) : (
                          <p className="text-xs text-gray-500">
                            {t('settings.generatingqrcode', language as Language)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                  {paymentChannel === 'ALIPAY' && paymentResult.paymentUrl && (
                    <div className="space-y-3">
                      <p className="text-sm text-text-primary">
                        {t('settings.redirectingtoalipay', language as Language)}
                      </p>
                      <ActionButton
                        variant="secondary"
                        onClick={() => window.electronAPI?.openExternalUrl?.(paymentResult.paymentUrl!)}
                        leftIcon={<ExternalLink className="w-4 h-4" />}
                      >
                        {t('settings.gotopay', language as Language)}
                      </ActionButton>
                    </div>
                  )}
                  {paymentChannel === 'MOCK' && (
                    <div className="space-y-3">
                      <p className="text-sm text-text-primary">
                        {t('settings.mockpaymentmode', language as Language)}
                      </p>
                      <ActionButton variant="success" onClick={handleMockPay}>
                        {t('settings.mockpaysuccess', language as Language)}
                      </ActionButton>
                    </div>
                  )}
                </div>

                {polling && (
                  <p className="text-xs text-text-muted">
                    {t('settings.waitingforpaymentconfirmation', language as Language)}
                  </p>
                )}

                {paymentError && (
                  <p className="text-xs text-status-error">{paymentError}</p>
                )}

                <ActionButton
                  variant="ghost"
                  onClick={() => {
                    setPaymentResult(null)
                    setPaymentError('')
                    setPolling(false)
                    setQrCodeDataUrl('')
                  }}
                >
                  {t('settings.back', language as Language)}
                </ActionButton>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
