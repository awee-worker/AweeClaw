import { useCallback, useEffect, useState } from 'react'
import { LogOut, CheckCircle2, CreditCard, Zap, Crown, X, ExternalLink } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@components/ui'
import { backendApi } from '@renderer/services/backendApi'
import { type Language } from '@renderer/i18n'

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
  const [showUpgrade, setShowUpgrade] = useState(false)
  const [selectedPlan, setSelectedPlan] = useState<PlanItem | null>(null)
  const [paymentChannel, setPaymentChannel] = useState<string>('')
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [paymentError, setPaymentError] = useState('')
  const [polling, setPolling] = useState(false)

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

      if (result.payment?.paymentUrl) {
        window.open(result.payment.paymentUrl, '_blank')
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
          await fetchQuota()
          await fetchProfile()
          return
        }
        if (order?.status === 'CANCELLED' || order?.status === 'EXPIRED') {
          setPolling(false)
          setPaymentError(
            language === 'zh'
              ? `订单已${order.status === 'CANCELLED' ? '取消' : '过期'}`
              : `Order ${order.status.toLowerCase()}`,
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

  if (!isAuthenticated || !cloudUser) {
    return (
      <div className="space-y-6">
        <div className="text-center py-12">
          <p className="text-sm text-text-muted">
            {language === 'zh'
              ? '请点击左下角头像登录以查看云端服务信息'
              : 'Click the avatar in the bottom left to sign in and view cloud service info'}
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
            {language === 'zh' ? '已连接到云端服务' : 'Connected to cloud service'}
          </p>
          <p className="text-xs text-text-muted mt-0.5 truncate">
            {serverUrl}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <h4 className="text-sm font-semibold text-text-primary">
          {language === 'zh' ? '账户信息' : 'Account Info'}
        </h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="p-3 rounded-lg bg-surface/50 border border-border/50">
            <p className="text-xs text-text-muted">{language === 'zh' ? '用户名' : 'Username'}</p>
            <p className="text-sm text-text-primary font-medium mt-0.5">{cloudUser.username || '-'}</p>
          </div>
          <div className="p-3 rounded-lg bg-surface/50 border border-border/50">
            <p className="text-xs text-text-muted">{language === 'zh' ? '邮箱' : 'Email'}</p>
            <p className="text-sm text-text-primary font-medium mt-0.5 truncate">{cloudUser.email}</p>
          </div>
          <div className="p-3 rounded-lg bg-surface/50 border border-border/50">
            <p className="text-xs text-text-muted">{language === 'zh' ? '角色' : 'Role'}</p>
            <p className="text-sm text-text-primary font-medium mt-0.5">{cloudUser.role}</p>
          </div>
          <div className="p-3 rounded-lg bg-surface/50 border border-border/50">
            <p className="text-xs text-text-muted">{language === 'zh' ? '订阅计划' : 'Plan'}</p>
            <p className="text-sm text-text-primary font-medium mt-0.5">{quota?.displayName || cloudUser.planId}</p>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-text-primary">
            {language === 'zh' ? '用量配额' : 'Usage Quota'}
          </h4>
          <button
            onClick={handleRefreshQuota}
            className="text-xs text-accent hover:text-accent-hover transition-colors"
          >
            {language === 'zh' ? '刷新' : 'Refresh'}
          </button>
        </div>
        {quota ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-text-muted">
                {language === 'zh' ? '已使用' : 'Used'}: {quota.used.toLocaleString()} tokens
              </span>
              <span className="text-text-muted">
                {quota.remaining === -1
                  ? language === 'zh'
                    ? '无限'
                    : 'Unlimited'
                  : `${quota.remaining.toLocaleString()} tokens`}
              </span>
            </div>
            <div className="h-2 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{
                  width:
                    quota.limit === -1 || quota.remaining === -1
                      ? '5%'
                      : `${Math.min(100, (quota.used / quota.limit) * 100)}%`,
                }}
              />
            </div>
            <p className="text-xs text-text-muted">
              {language === 'zh' ? '计费周期' : 'Billing period'}: {new Date(quota.periodStart).toLocaleDateString()} - {new Date(quota.periodEnd).toLocaleDateString()}
            </p>
          </div>
        ) : (
          <p className="text-xs text-text-muted">{language === 'zh' ? '加载中...' : 'Loading...'}</p>
        )}
      </div>

      <div className="pt-2 space-y-3">
        <Button
          variant="secondary"
          onClick={() => {
            setShowUpgrade(true)
            fetchPlans()
          }}
          className="w-full"
        >
          <CreditCard className="w-4 h-4" />
          {language === 'zh' ? '升级套餐' : 'Upgrade Plan'}
        </Button>
        <Button variant="danger" onClick={handleLogout} className="w-full">
          <LogOut className="w-4 h-4" />
          {language === 'zh' ? '退出登录' : 'Sign Out'}
        </Button>
      </div>

      {showUpgrade && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => setShowUpgrade(false)}>
          <div className="bg-surface border border-border rounded-2xl p-6 max-w-md w-full mx-4 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-text-primary">
                {language === 'zh' ? '升级套餐' : 'Upgrade Plan'}
              </h3>
              <button onClick={() => setShowUpgrade(false)} className="text-text-muted hover:text-text-primary">
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
                          <p className="text-xs text-text-muted">{language === 'zh' ? '/月' : '/mo'}</p>
                        </div>
                      </div>
                      <p className="text-xs text-text-muted mt-2">
                        {plan.tokenLimit === -1
                          ? language === 'zh'
                            ? '无限 Token 配额'
                            : 'Unlimited tokens'
                          : `${(plan.tokenLimit / 10000).toFixed(0)}${language === 'zh' ? '万' : '0k'} tokens/${language === 'zh' ? '月' : 'mo'}`}
                      </p>
                    </button>
                  ))}
                </div>

                {selectedPlan && (
                  <div className="space-y-3">
                    <p className="text-xs text-text-muted">
                      {language === 'zh' ? '选择支付方式' : 'Select payment method'}
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => setPaymentChannel('WECHAT')}
                        className={`p-3 rounded-xl border text-sm transition-all ${
                          paymentChannel === 'WECHAT'
                            ? 'border-green-500/50 bg-green-500/10 text-green-400'
                            : 'border-border/50 text-text-secondary hover:border-border'
                        }`}
                      >
                        {language === 'zh' ? '微信支付' : 'WeChat Pay'}
                      </button>
                      <button
                        onClick={() => setPaymentChannel('ALIPAY')}
                        className={`p-3 rounded-xl border text-sm transition-all ${
                          paymentChannel === 'ALIPAY'
                            ? 'border-blue-500/50 bg-blue-500/10 text-blue-400'
                            : 'border-border/50 text-text-secondary hover:border-border'
                        }`}
                      >
                        {language === 'zh' ? '支付宝' : 'Alipay'}
                      </button>
                    </div>

                    {paymentError && (
                      <p className="text-xs text-status-error">{paymentError}</p>
                    )}

                    <Button
                      variant="primary"
                      className="w-full"
                      onClick={handleUpgrade}
                      isLoading={paymentLoading}
                      disabled={!paymentChannel}
                    >
                      {language === 'zh'
                        ? `支付 ¥${Number(selectedPlan.price).toFixed(2)}`
                        : `Pay ¥${Number(selectedPlan.price).toFixed(2)}`}
                    </Button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center space-y-4">
                <div className="p-6 rounded-xl bg-surface/50 border border-border/50">
                  {paymentChannel === 'WECHAT' && paymentResult.qrCodeUrl && (
                    <div className="space-y-3">
                      <p className="text-sm text-text-primary">
                        {language === 'zh' ? '请使用微信扫码支付' : 'Scan with WeChat to pay'}
                      </p>
                      <div className="w-48 h-48 mx-auto bg-white rounded-xl flex items-center justify-center">
                        <p className="text-xs text-gray-500">
                          {language === 'zh' ? '微信二维码' : 'WeChat QR Code'}
                        </p>
                      </div>
                    </div>
                  )}
                  {paymentChannel === 'ALIPAY' && paymentResult.paymentUrl && (
                    <div className="space-y-3">
                      <p className="text-sm text-text-primary">
                        {language === 'zh' ? '即将跳转到支付宝' : 'Redirecting to Alipay'}
                      </p>
                      <Button
                        variant="secondary"
                        onClick={() => window.open(paymentResult.paymentUrl, '_blank')}
                        leftIcon={<ExternalLink className="w-4 h-4" />}
                      >
                        {language === 'zh' ? '前往支付' : 'Go to Pay'}
                      </Button>
                    </div>
                  )}
                  {paymentChannel === 'MOCK' && (
                    <div className="space-y-3">
                      <p className="text-sm text-text-primary">
                        {language === 'zh' ? '模拟支付模式' : 'Mock Payment Mode'}
                      </p>
                      <Button variant="success" onClick={handleMockPay}>
                        {language === 'zh' ? '模拟支付成功' : 'Mock Pay Success'}
                      </Button>
                    </div>
                  )}
                </div>

                {polling && (
                  <p className="text-xs text-text-muted">
                    {language === 'zh' ? '等待支付确认...' : 'Waiting for payment confirmation...'}
                  </p>
                )}

                {paymentError && (
                  <p className="text-xs text-status-error">{paymentError}</p>
                )}

                <Button
                  variant="ghost"
                  onClick={() => {
                    setPaymentResult(null)
                    setPaymentError('')
                    setPolling(false)
                  }}
                >
                  {language === 'zh' ? '返回' : 'Back'}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
