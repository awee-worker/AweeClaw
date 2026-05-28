import { useState, useCallback, useEffect } from 'react'
import { LogIn, UserPlus, Eye, EyeOff, Server, AlertCircle, Loader2, Cloud, User, Mail, Lock, Smartphone, ShieldCheck, ArrowLeft, KeyRound } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton, TextField } from '@components/ui'
import { HintOverlay } from '../ui/HintOverlay'
import { OverlayDialog } from '../ui/OverlayDialog'
import { type Language } from '@renderer/i18n'
import { BackendApiError } from '@services/backendApi'
import { backendApi } from '@services/backendApi'

type AuthStep = 'login' | 'forgot' | 'reset'

export function UserAccountPopover({ language, forceLoginOpen, onLoginClose, hideButton }: { language: Language; forceLoginOpen?: boolean; onLoginClose?: () => void; hideButton?: boolean }) {
  const {
    isAuthenticated,
    cloudUser,
    quota,
    login,
    phoneLogin,
    register,
    forgotPassword,
    resetPassword,
    fetchQuota,
  } = useStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      cloudUser: s.cloudUser,
      quota: s.quota,
      login: s.login,
      phoneLogin: s.phoneLogin,
      register: s.register,
      forgotPassword: s.forgotPassword,
      resetPassword: s.resetPassword,
      fetchQuota: s.fetchQuota,
    })),
  )

  const [showLoginModal, setShowLoginModal] = useState(false)

  const [authStep, setAuthStep] = useState<AuthStep>('login')
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

  const [forgotEmail, setForgotEmail] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [forgotCodeCooldown, setForgotCodeCooldown] = useState(0)
  const [forgotSuccess, setForgotSuccess] = useState(false)

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

  const resetAuthForm = useCallback(() => {
    setAuthStep('login')
    setIsRegister(false)
    setEmail('')
    setPassword('')
    setUsername('')
    setPhone('')
    setSmsCode('')
    setForgotEmail('')
    setResetCode('')
    setNewPassword('')
    setConfirmPassword('')
    setError('')
    setForgotSuccess(false)
  }, [])

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
        resetAuthForm()
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
    [isRegister, loginMode, serverUrl, email, password, username, phone, smsCode, login, phoneLogin, register, language, resetAuthForm],
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

  const handleForgotPassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError('')
      setLoading(true)

      try {
        await forgotPassword(serverUrl, forgotEmail)
        setForgotSuccess(true)
        setForgotCodeCooldown(60)
        const timer = setInterval(() => {
          setForgotCodeCooldown((prev) => {
            if (prev <= 1) {
              clearInterval(timer)
              return 0
            }
            return prev - 1
          })
        }, 1000)
      } catch (err) {
        if (err instanceof BackendApiError) {
          setError(err.message || (language === 'zh' ? '发送失败' : 'Failed to send'))
        } else {
          setError(language === 'zh' ? '无法连接到服务器' : 'Cannot connect to server')
        }
      } finally {
        setLoading(false)
      }
    },
    [serverUrl, forgotEmail, forgotPassword, language],
  )

  const handleResetPassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError('')

      if (newPassword !== confirmPassword) {
        setError(language === 'zh' ? '两次输入的密码不一致' : 'Passwords do not match')
        return
      }
      if (newPassword.length < 6) {
        setError(language === 'zh' ? '密码至少6位' : 'Password must be at least 6 characters')
        return
      }

      setLoading(true)
      try {
        await resetPassword(serverUrl, forgotEmail, resetCode, newPassword)
        setAuthStep('login')
        setIsRegister(false)
        setEmail(forgotEmail)
        setPassword('')
        setForgotEmail('')
        setResetCode('')
        setNewPassword('')
        setConfirmPassword('')
        setForgotSuccess(false)
        setError('')
      } catch (err) {
        if (err instanceof BackendApiError) {
          if (err.status === 400) {
            setError(language === 'zh' ? '验证码无效或已过期' : 'Invalid or expired verification code')
          } else {
            setError(err.message || (language === 'zh' ? '重置失败' : 'Reset failed'))
          }
        } else {
          setError(language === 'zh' ? '无法连接到服务器' : 'Cannot connect to server')
        }
      } finally {
        setLoading(false)
      }
    },
    [serverUrl, forgotEmail, resetCode, newPassword, confirmPassword, resetPassword, language],
  )

  const handleResendForgotCode = useCallback(async () => {
    if (forgotCodeCooldown > 0) return
    setError('')
    try {
      await forgotPassword(serverUrl, forgotEmail)
      setForgotCodeCooldown(60)
      const timer = setInterval(() => {
        setForgotCodeCooldown((prev) => {
          if (prev <= 1) {
            clearInterval(timer)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    } catch (err) {
      if (err instanceof BackendApiError) {
        setError(err.message || (language === 'zh' ? '发送失败' : 'Failed to send'))
      } else {
        setError(language === 'zh' ? '无法连接到服务器' : 'Cannot connect to server')
      }
    }
  }, [forgotCodeCooldown, serverUrl, forgotEmail, forgotPassword, language])

  const initial = cloudUser?.username?.[0]?.toUpperCase() || cloudUser?.email?.[0]?.toUpperCase() || '?'

  const displayName = cloudUser?.username || cloudUser?.email || ''

  const tooltipText = isAuthenticated
    ? displayName
    : language === 'zh'
      ? '您还未登录'
      : 'Not signed in'

  const stepTitle = authStep === 'forgot'
    ? language === 'zh' ? '忘记密码' : 'Forgot Password'
    : authStep === 'reset'
      ? language === 'zh' ? '重置密码' : 'Reset Password'
      : isRegister
        ? language === 'zh' ? '注册账号' : 'Create Account'
        : language === 'zh' ? '登录 AweeClaw' : 'Sign In to AweeClaw'

  const stepIcon = authStep === 'forgot' || authStep === 'reset'
    ? <KeyRound className="w-4 h-4 text-accent" />
    : <Cloud className="w-4 h-4 text-accent" />

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
          resetAuthForm()
          onLoginClose?.()
        }}
        size="sm"
      >
        <div className="p-2">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2.5">
              {authStep !== 'login' && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthStep('login')
                    setError('')
                    setForgotSuccess(false)
                  }}
                  className="p-1 rounded-md hover:bg-bg-secondary transition-colors text-text-muted hover:text-text-primary"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
              )}
              <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
                {stepIcon}
              </div>
              <h3 className="text-base font-bold text-text-primary">
                {stepTitle}
              </h3>
            </div>
          </div>

          {authStep === 'forgot' && (
            <form onSubmit={handleForgotPassword} className="space-y-4">
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

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  {language === 'zh' ? '邮箱' : 'Email'}
                </label>
                <TextField
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder={language === 'zh' ? '输入注册时使用的邮箱' : 'Enter your registered email'}
                  leftIcon={<Mail className="w-4 h-4" />}
                  required
                />
              </div>

              {forgotSuccess && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-status-success/5 border border-status-success/20 text-status-success text-xs">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>{language === 'zh' ? '验证码已发送到您的邮箱，请查收' : 'Verification code sent to your email'}</span>
                </div>
              )}

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <ActionButton type="submit" variant="primary" className="w-full" disabled={loading || !forgotEmail}>
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Mail className="w-4 h-4" />
                )}
                {language === 'zh' ? '发送验证码' : 'Send Verification Code'}
              </ActionButton>

              {forgotSuccess && (
                <p className="text-center text-xs text-text-muted">
                  <button
                    type="button"
                    onClick={handleResendForgotCode}
                    disabled={forgotCodeCooldown > 0}
                    className={`transition-colors font-medium ${
                      forgotCodeCooldown > 0
                        ? 'text-text-muted cursor-not-allowed'
                        : 'text-accent hover:text-accent-hover'
                    }`}
                  >
                    {forgotCodeCooldown > 0
                      ? language === 'zh'
                        ? `重新发送 (${forgotCodeCooldown}s)`
                        : `Resend (${forgotCodeCooldown}s)`
                      : language === 'zh'
                        ? '重新发送验证码'
                        : 'Resend Code'}
                  </button>
                </p>
              )}

              {forgotSuccess && (
                <ActionButton
                  type="button"
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setAuthStep('reset')
                    setError('')
                  }}
                >
                  {language === 'zh' ? '我已收到验证码，去重置密码' : 'I have the code, reset password'}
                </ActionButton>
              )}
            </form>
          )}

          {authStep === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="p-3 rounded-lg bg-accent/5 border border-accent/10 text-xs text-text-secondary">
                {language === 'zh'
                  ? `验证码已发送至 ${forgotEmail}`
                  : `Code sent to ${forgotEmail}`}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  {language === 'zh' ? '验证码' : 'Verification Code'}
                </label>
                <div className="flex gap-2">
                  <TextField
                    type="text"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder={language === 'zh' ? '输入6位验证码' : 'Enter 6-digit code'}
                    leftIcon={<ShieldCheck className="w-4 h-4" />}
                    required
                  />
                  <button
                    type="button"
                    onClick={handleResendForgotCode}
                    disabled={forgotCodeCooldown > 0}
                    className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                      forgotCodeCooldown > 0
                        ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                        : 'bg-accent/10 text-accent hover:bg-accent/20'
                    }`}
                  >
                    {forgotCodeCooldown > 0
                      ? `${forgotCodeCooldown}s`
                      : language === 'zh'
                        ? '重新发送'
                        : 'Resend'}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  {language === 'zh' ? '新密码' : 'New Password'}
                </label>
                <TextField
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={language === 'zh' ? '输入新密码（至少6位）' : 'New password (min 6 chars)'}
                  leftIcon={<Lock className="w-4 h-4" />}
                  rightIcon={
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="hover:text-text-primary transition-colors"
                    >
                      {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  }
                  required
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  {language === 'zh' ? '确认密码' : 'Confirm Password'}
                </label>
                <TextField
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={language === 'zh' ? '再次输入新密码' : 'Re-enter new password'}
                  leftIcon={<Lock className="w-4 h-4" />}
                  required
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <ActionButton type="submit" variant="primary" className="w-full" disabled={loading || !resetCode || !newPassword || !confirmPassword}>
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <KeyRound className="w-4 h-4" />
                )}
                {language === 'zh' ? '重置密码' : 'Reset Password'}
              </ActionButton>
            </form>
          )}

          {authStep === 'login' && (
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

            <div className="flex items-center justify-between text-xs text-text-muted">
              <p>
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

              {!isRegister && loginMode === 'email' && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthStep('forgot')
                    setForgotEmail(email)
                    setError('')
                    setForgotSuccess(false)
                  }}
                  className="text-accent hover:text-accent-hover transition-colors font-medium"
                >
                  {language === 'zh' ? '忘记密码？' : 'Forgot Password?'}
                </button>
              )}
            </div>
          </form>
          )}
        </div>
      </OverlayDialog>
    </>
  )
}
