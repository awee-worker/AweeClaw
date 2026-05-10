import { useState, useCallback, useEffect } from 'react'
import { LogIn, UserPlus, LogOut, Eye, EyeOff, Server, AlertCircle, Loader2, Cloud, User, Crown, Zap, Feather, Rocket, ArrowUpCircle, CreditCard } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { Button, Input } from '@components/ui'
import { Tooltip } from '../ui/Tooltip'
import { Modal } from '../ui/Modal'
import { type Language } from '@renderer/i18n'
import { BackendApiError } from '@renderer/services/backendApi'
import { backendApi } from '@renderer/services/backendApi'

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
  FREE: <Feather className="w-5 h-5 text-text-muted" />,
  PRO: <Crown className="w-5 h-5 text-violet-400" />,
  ENTERPRISE: <Rocket className="w-5 h-5 text-amber-400" />,
}

const planColors: Record<string, string> = {
  FREE: 'border-text-muted/30 bg-text-muted/5',
  PRO: 'border-violet-500/30 bg-violet-500/5',
  ENTERPRISE: 'border-amber-500/30 bg-amber-500/5',
}

function UpgradePlanModal({
  isOpen,
  onClose,
  language,
  currentPlanId,
  onUpgradeSuccess,
}: {
  isOpen: boolean
  onClose: () => void
  language: Language
  currentPlanId: string
  onUpgradeSuccess: () => void
}) {
  const [plans, setPlans] = useState<PlanItem[]>([])
  const [selectedPlan, setSelectedPlan] = useState<PlanItem | null>(null)
  const [paymentChannel, setPaymentChannel] = useState<string>('')
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentResult, setPaymentResult] = useState<PaymentResult | null>(null)
  const [paymentError, setPaymentError] = useState('')
  const [polling, setPolling] = useState(false)
  const [loadingPlans, setLoadingPlans] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setLoadingPlans(true)
    backendApi
      .get<PlanItem[]>('/api/v1/payment/plans')
      .then((data) => {
        setPlans((data || []).filter((p) => p.isActive && Number(p.price) > 0 && p.name !== currentPlanId))
      })
      .catch(() => setPlans([]))
      .finally(() => setLoadingPlans(false))
  }, [isOpen, currentPlanId])

  useEffect(() => {
    if (!isOpen) {
      setSelectedPlan(null)
      setPaymentChannel('')
      setPaymentResult(null)
      setPaymentError('')
      setPolling(false)
    }
  }, [isOpen])

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
          onUpgradeSuccess()
          onClose()
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
  }, [language, onUpgradeSuccess, onClose])

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="p-2 space-y-5">
        <div className="flex items-center gap-2.5 pt-2">
          <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
            <ArrowUpCircle className="w-4 h-4 text-accent" />
          </div>
          <h3 className="text-base font-bold text-text-primary">
            {language === 'zh' ? '升级套餐' : 'Upgrade Plan'}
          </h3>
        </div>

        {loadingPlans ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-accent" />
          </div>
        ) : plans.length === 0 ? (
          <div className="text-center py-6 text-sm text-text-muted">
            {language === 'zh' ? '暂无可升级套餐' : 'No upgrade plans available'}
          </div>
        ) : !paymentResult ? (
          <>
            <div className="space-y-2">
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
                    className={`p-3 rounded-xl border text-center transition-all ${
                      paymentChannel === 'WECHAT'
                        ? 'border-green-500/50 bg-green-500/10 ring-1 ring-green-500/30'
                        : 'border-border/50 bg-surface/30 hover:border-border'
                    }`}
                  >
                    <span className="text-sm font-medium text-text-primary">
                      {language === 'zh' ? '微信支付' : 'WeChat Pay'}
                    </span>
                  </button>
                  <button
                    onClick={() => setPaymentChannel('ALIPAY')}
                    className={`p-3 rounded-xl border text-center transition-all ${
                      paymentChannel === 'ALIPAY'
                        ? 'border-blue-500/50 bg-blue-500/10 ring-1 ring-blue-500/30'
                        : 'border-border/50 bg-surface/30 hover:border-border'
                    }`}
                  >
                    <span className="text-sm font-medium text-text-primary">
                      {language === 'zh' ? '支付宝' : 'Alipay'}
                    </span>
                  </button>
                </div>

                {paymentError && (
                  <div className="flex items-center gap-2 p-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{paymentError}</span>
                  </div>
                )}

                <Button
                  variant="primary"
                  className="w-full"
                  onClick={handleUpgrade}
                  disabled={!paymentChannel || paymentLoading}
                >
                  {paymentLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    language === 'zh'
                      ? `支付 ¥${Number(selectedPlan.price).toFixed(2)}`
                      : `Pay ¥${Number(selectedPlan.price).toFixed(2)}`
                  )}
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
                </div>
              )}
            </div>

            {polling && (
              <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
                <Loader2 className="w-3 h-3 animate-spin" />
                {language === 'zh' ? '等待支付确认...' : 'Waiting for payment confirmation...'}
              </div>
            )}

            {paymentError && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{paymentError}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

export function UserAccountPopover({ language }: { language: Language }) {
  const {
    isAuthenticated,
    cloudUser,
    quota,
    login,
    register,
    logout,
    fetchQuota,
    fetchProfile,
  } = useStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      cloudUser: s.cloudUser,
      quota: s.quota,
      login: s.login,
      register: s.register,
      logout: s.logout,
      fetchQuota: s.fetchQuota,
      fetchProfile: s.fetchProfile,
    })),
  )

  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showUserModal, setShowUserModal] = useState(false)
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isRegister, setIsRegister] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [serverUrl, setServerUrl] = useState(
    useStore.getState().serverUrl || 'http://localhost:3000',
  )

  useEffect(() => {
    if (showUserModal && isAuthenticated && !quota) {
      fetchQuota().catch(() => {})
    }
  }, [showUserModal, isAuthenticated])

  const handleClick = useCallback(() => {
    if (isAuthenticated) {
      setShowUserModal(true)
    } else {
      setShowLoginModal(true)
    }
  }, [isAuthenticated])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError('')
      setLoading(true)

      try {
        if (isRegister) {
          await register(serverUrl, email, password, username || undefined)
        } else {
          await login(serverUrl, email, password)
        }
        setShowLoginModal(false)
        setEmail('')
        setPassword('')
        setUsername('')
        setError('')
      } catch (err) {
        if (err instanceof BackendApiError) {
          if (err.status === 401) {
            setError(language === 'zh' ? '邮箱或密码错误' : 'Invalid email or password')
          } else if (err.status === 409) {
            setError(language === 'zh' ? '该邮箱已被注册' : 'Email already registered')
          } else {
            setError(err.message || (language === 'zh' ? '请求失败' : 'Request failed'))
          }
        } else {
          setError(language === 'zh' ? '无法连接到服务器' : 'Cannot connect to server')
        }
      } finally {
        setLoading(false)
      }
    },
    [isRegister, serverUrl, email, password, username, login, register, language],
  )

  const handleLogout = useCallback(() => {
    logout()
    setShowUserModal(false)
    setEmail('')
    setPassword('')
    setUsername('')
    setError('')
  }, [logout])

  const handleUpgradeSuccess = useCallback(async () => {
    await fetchQuota()
    await fetchProfile()
  }, [fetchQuota, fetchProfile])

  const initial = cloudUser?.username?.[0]?.toUpperCase() || cloudUser?.email?.[0]?.toUpperCase() || '?'

  const displayName = cloudUser?.username || cloudUser?.email || ''

  const tooltipText = isAuthenticated
    ? displayName
    : language === 'zh'
      ? '您还未登录'
      : 'Not signed in'

  const quotaPercent =
    quota && quota.limit !== -1 && quota.remaining !== -1
      ? Math.min(100, (quota.used / quota.limit) * 100)
      : 0

  return (
    <>
      <Tooltip content={tooltipText} side="right">
        <button
          onClick={handleClick}
          className={`
            w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group
            ${showUserModal || showLoginModal ? 'bg-accent/10' : 'hover:bg-accent/5 active:scale-95'}
          `}
        >
          {isAuthenticated ? (
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-accent/80 to-accent/40 flex items-center justify-center text-white text-xs font-bold shadow-lg shadow-accent/20 group-hover:shadow-accent/40 transition-shadow">
              {initial}
            </div>
          ) : (
            <div className="w-7 h-7 rounded-full border-2 border-dashed border-text-muted/40 flex items-center justify-center group-hover:border-accent/50 transition-colors">
              <User className="w-3.5 h-3.5 text-text-muted/60 group-hover:text-accent/70 transition-colors" />
            </div>
          )}
        </button>
      </Tooltip>

      <Modal
        isOpen={showUserModal}
        onClose={() => setShowUserModal(false)}
        size="sm"
      >
        {cloudUser && (
          <div className="p-2 space-y-5">
            <div className="flex flex-col items-center pt-2">
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent to-accent/60 flex items-center justify-center text-white text-2xl font-bold shadow-xl shadow-accent/20">
                {initial}
              </div>
              <p className="mt-3 text-base font-bold text-text-primary">
                {cloudUser.username || cloudUser.email}
              </p>
              <p className="text-xs text-text-muted mt-0.5">{cloudUser.email}</p>
            </div>

            <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent/5 border border-accent/10">
              {cloudUser.planId === 'ENTERPRISE' ? (
                <Rocket className="w-4 h-4 text-amber-400" />
              ) : cloudUser.planId === 'PRO' || cloudUser.planId === 'PROFESSIONAL' ? (
                <Crown className="w-4 h-4 text-violet-400" />
              ) : (
                <Feather className="w-4 h-4 text-text-muted" />
              )}
              <span className={`text-xs font-medium ${cloudUser.planId === 'ENTERPRISE' ? 'text-amber-400' : cloudUser.planId === 'PRO' || cloudUser.planId === 'PROFESSIONAL' ? 'text-violet-400' : 'text-text-muted'}`}>
                {quota?.displayName || (cloudUser.planId === 'FREE'
                  ? language === 'zh'
                    ? '免费版'
                    : 'Free Plan'
                  : cloudUser.planId === 'PRO' || cloudUser.planId === 'PROFESSIONAL'
                    ? language === 'zh'
                      ? '专业版'
                      : 'Pro Plan'
                    : cloudUser.planId === 'ENTERPRISE'
                      ? language === 'zh'
                        ? '企业版'
                        : 'Enterprise Plan'
                      : cloudUser.planId)}
              </span>
              <span className="text-xs text-text-muted ml-auto">
                {cloudUser.role}
              </span>
            </div>

            {cloudUser.planId !== 'ENTERPRISE' && (
              <button
                onClick={() => {
                  setShowUserModal(false)
                  setShowUpgradeModal(true)
                }}
                className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-gradient-to-r from-accent/10 to-violet-500/10 border border-accent/20 text-xs font-medium text-accent hover:from-accent/20 hover:to-violet-500/20 transition-all"
              >
                <ArrowUpCircle className="w-3.5 h-3.5" />
                {language === 'zh' ? '升级套餐' : 'Upgrade Plan'}
              </button>
            )}

            {quota && (
              <div className="space-y-2 px-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1 text-text-muted">
                    <Zap className="w-3 h-3" />
                    {language === 'zh' ? 'Token 用量' : 'Token Usage'}
                  </span>
                  <span className="text-text-muted">
                    {quota.used.toLocaleString()} /{' '}
                    {quota.remaining === -1
                      ? language === 'zh'
                        ? '无限'
                        : '∞'
                      : quota.limit.toLocaleString()}
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-black/10 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-accent to-accent/60 transition-all duration-500"
                    style={{ width: `${Math.max(quotaPercent, quotaPercent > 0 ? 3 : 0)}%` }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowUserModal(false)
                  useStore.getState().setShowSettings(true, 'cloud')
                }}
                className="flex-1 text-xs"
              >
                {language === 'zh' ? '云端服务' : 'Cloud'}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleLogout}
                className="flex-1 text-xs"
              >
                <LogOut className="w-3 h-3" />
                {language === 'zh' ? '退出登录' : 'Sign Out'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <UpgradePlanModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        language={language}
        currentPlanId={cloudUser?.planId || 'FREE'}
        onUpgradeSuccess={handleUpgradeSuccess}
      />

      <Modal
        isOpen={showLoginModal}
        onClose={() => {
          setShowLoginModal(false)
          setError('')
        }}
        size="sm"
      >
        <div className="p-2">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
                <Cloud className="w-4 h-4 text-accent" />
              </div>
              <h3 className="text-base font-bold text-text-primary">
                {isRegister
                  ? language === 'zh'
                    ? '注册账号'
                    : 'Create Account'
                  : language === 'zh'
                    ? '登录 AweeClaw'
                    : 'Sign In to AweeClaw'}
              </h3>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                {language === 'zh' ? '服务器地址' : 'Server URL'}
              </label>
              <Input
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://localhost:3000"
                leftIcon={<Server className="w-4 h-4" />}
              />
            </div>

            {isRegister && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  {language === 'zh' ? '用户名' : 'Username'}
                </label>
                <Input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={language === 'zh' ? '输入用户名（可选）' : 'Username (optional)'}
                  leftIcon={<User className="w-4 h-4" />}
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                {language === 'zh' ? '邮箱' : 'Email'}
              </label>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={language === 'zh' ? '输入邮箱地址' : 'Enter email address'}
                leftIcon={<Cloud className="w-4 h-4" />}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">
                {language === 'zh' ? '密码' : 'Password'}
              </label>
              <Input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={language === 'zh' ? '输入密码' : 'Enter password'}
                leftIcon={<Cloud className="w-4 h-4" />}
                rightIcon={
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="hover:text-text-primary transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                }
                required
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <Button type="submit" variant="primary" className="w-full" disabled={loading}>
              {loading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : isRegister ? (
                <UserPlus className="w-4 h-4" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {isRegister
                ? language === 'zh'
                  ? '注册'
                  : 'Sign Up'
                : language === 'zh'
                  ? '登录'
                  : 'Sign In'}
            </Button>

            <p className="text-center text-xs text-text-muted">
              {isRegister
                ? language === 'zh'
                  ? '已有账号？'
                  : 'Already have an account? '
                : language === 'zh'
                  ? '没有账号？'
                  : "Don't have an account? "}
              <button
                type="button"
                onClick={() => {
                  setIsRegister(!isRegister)
                  setError('')
                }}
                className="text-accent hover:text-accent-hover transition-colors font-medium"
              >
                {isRegister
                  ? language === 'zh'
                    ? '登录'
                    : 'Sign In'
                  : language === 'zh'
                    ? '注册'
                    : 'Sign Up'}
              </button>
            </p>
          </form>
        </div>
      </Modal>
    </>
  )
}
