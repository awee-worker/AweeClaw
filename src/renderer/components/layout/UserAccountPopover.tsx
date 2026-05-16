import { useState, useCallback, useEffect } from 'react'
import { LogIn, UserPlus, Eye, EyeOff, Server, AlertCircle, Loader2, Cloud, User, Mail, Lock, Smartphone, ShieldCheck } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton, TextField } from '@components/ui'
import { HintOverlay } from '../ui/HintOverlay'
import { OverlayDialog } from '../ui/OverlayDialog'
import { type Language } from '@renderer/i18n'
import { BackendApiError } from '@services/backendApi'
import { backendApi } from '@services/backendApi'

export function UserAccountPopover({ language, forceLoginOpen, onLoginClose, hideButton }: { language: Language; forceLoginOpen?: boolean; onLoginClose?: () => void; hideButton?: boolean }) {
  const {
    isAuthenticated,
    cloudUser,
    quota,
    login,
    phoneLogin,
    register,
    fetchQuota,
  } = useStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      cloudUser: s.cloudUser,
      quota: s.quota,
      login: s.login,
      phoneLogin: s.phoneLogin,
      register: s.register,
      fetchQuota: s.fetchQuota,
    })),
  )

  const [showLoginModal, setShowLoginModal] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isRegister, setIsRegister] = useState(false)
  const [loginMode, setLoginMode] = useState<'email' | 'phone'>('email')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [codeCooldown, setCodeCooldown] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [serverUrl, setServerUrl] = useState(
    useStore.getState().serverUrl || 'http://localhost:3000',
  )

  useEffect(() => {
    if (isAuthenticated && !quota) {
      fetchQuota().catch(() => {})
    }
  }, [isAuthenticated])

  useEffect(() => {
    if (forceLoginOpen && !isAuthenticated) {
      setShowLoginModal(true)
    }
    if (!forceLoginOpen && onLoginClose) {
      setShowLoginModal(false)
    }
  }, [forceLoginOpen, isAuthenticated, onLoginClose])

  const handleClick = useCallback(() => {
    if (isAuthenticated) {
      useStore.getState().setShowUserProfilePage(true)
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
        } else if (loginMode === 'phone') {
          await phoneLogin(serverUrl, phone, smsCode)
        } else {
          await login(serverUrl, email, password)
        }
        setShowLoginModal(false)
        setEmail('')
        setPassword('')
        setUsername('')
        setPhone('')
        setSmsCode('')
        setError('')
        onLoginClose?.()
      } catch (err) {
        if (err instanceof BackendApiError) {
          if (err.status === 401) {
            setError(language === 'zh' ? '登录信息错误' : 'Invalid credentials')
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
    [isRegister, loginMode, serverUrl, email, password, username, phone, smsCode, login, phoneLogin, register, language],
  )

  const handleSendCode = useCallback(async () => {
    if (codeCooldown > 0 || !/^1[3-9]\d{9}$/.test(phone)) return
    try {
      await backendApi.post('/api/v1/sms/send-code', { phone, purpose: 'login' })
      setCodeCooldown(60)
      const timer = setInterval(() => {
        setCodeCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch {
      setError(language === 'zh' ? '验证码发送失败' : 'Failed to send code')
    }
  }, [codeCooldown, phone, language])

  const initial = cloudUser?.username?.[0]?.toUpperCase() || cloudUser?.email?.[0]?.toUpperCase() || '?'

  const displayName = cloudUser?.username || cloudUser?.email || ''

  const tooltipText = isAuthenticated
    ? displayName
    : language === 'zh'
      ? '您还未登录'
      : 'Not signed in'

  return (
    <>
      {!hideButton && (
      <HintOverlay content={tooltipText} side="right">
        <button
          onClick={handleClick}
          className={`
            w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-300 group
            ${showLoginModal ? 'bg-accent/10' : 'hover:bg-accent/5 active:scale-95'}
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
      </HintOverlay>
      )}

      <OverlayDialog
        isOpen={showLoginModal}
        onClose={() => {
          setShowLoginModal(false)
          setError('')
          onLoginClose?.()
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
              <TextField
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                placeholder="http://localhost:3000"
                leftIcon={<Server className="w-4 h-4" />}
              />
            </div>

            {!isRegister && (
              <div className="flex bg-bg-secondary rounded-lg p-0.5">
                <button
                  type="button"
                  onClick={() => { setLoginMode('email'); setError('') }}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                    loginMode === 'email'
                      ? 'bg-bg-primary text-text-primary shadow-sm'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {language === 'zh' ? '邮箱登录' : 'Email'}
                </button>
                <button
                  type="button"
                  onClick={() => { setLoginMode('phone'); setError('') }}
                  className={`flex-1 py-1.5 text-xs font-medium rounded-md transition-all ${
                    loginMode === 'phone'
                      ? 'bg-bg-primary text-text-primary shadow-sm'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                >
                  {language === 'zh' ? '手机号登录' : 'Phone'}
                </button>
              </div>
            )}

            {isRegister && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  {language === 'zh' ? '用户名' : 'Username'}
                </label>
                <TextField
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={language === 'zh' ? '输入用户名（可选）' : 'Username (optional)'}
                  leftIcon={<User className="w-4 h-4" />}
                />
              </div>
            )}

            {loginMode === 'email' || isRegister ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-secondary">
                    {language === 'zh' ? '邮箱' : 'Email'}
                  </label>
                  <TextField
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={language === 'zh' ? '输入邮箱地址' : 'Enter email address'}
                    leftIcon={<Mail className="w-4 h-4" />}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-secondary">
                    {language === 'zh' ? '密码' : 'Password'}
                  </label>
                  <TextField
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={language === 'zh' ? '输入密码' : 'Enter password'}
                    leftIcon={<Lock className="w-4 h-4" />}
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
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-secondary">
                    {language === 'zh' ? '手机号' : 'Phone Number'}
                  </label>
                  <TextField
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={language === 'zh' ? '输入手机号' : 'Enter phone number'}
                    leftIcon={<Smartphone className="w-4 h-4" />}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-secondary">
                    {language === 'zh' ? '验证码' : 'Verification Code'}
                  </label>
                  <div className="flex gap-2">
                    <TextField
                      type="text"
                      value={smsCode}
                      onChange={(e) => setSmsCode(e.target.value)}
                      placeholder={language === 'zh' ? '输入验证码' : 'Enter code'}
                      leftIcon={<ShieldCheck className="w-4 h-4" />}
                      required
                    />
                    <button
                      type="button"
                      onClick={handleSendCode}
                      disabled={codeCooldown > 0 || !/^1[3-9]\d{9}$/.test(phone)}
                      className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                        codeCooldown > 0 || !/^1[3-9]\d{9}$/.test(phone)
                          ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                          : 'bg-accent/10 text-accent hover:bg-accent/20'
                      }`}
                    >
                      {codeCooldown > 0
                        ? `${codeCooldown}s`
                        : language === 'zh'
                          ? '获取验证码'
                          : 'Send Code'}
                    </button>
                  </div>
                </div>
              </>
            )}

            {error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <ActionButton type="submit" variant="primary" className="w-full" disabled={loading}>
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
            </ActionButton>

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
      </OverlayDialog>
    </>
  )
}
