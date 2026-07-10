import { useState, useCallback, useEffect } from 'react'
import { LogIn, UserPlus, Eye, EyeOff, AlertCircle, Loader2, Cloud, User, Mail, Lock, Smartphone, ShieldCheck, ArrowLeft, KeyRound } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton, TextField } from '@components/ui'
import { HintOverlay } from '../ui/HintOverlay'
import { OverlayDialog } from '../ui/OverlayDialog'
import { t, type Language } from '@renderer/i18n'
import { BackendApiError } from '@services/backendApi'
import { backendApi } from '@services/backendApi'
import { formatUserDisplayName } from '@shared/toolkit/formatHelper'

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
    if (forceLoginOpen && !(isAuthenticated && cloudUser)) {
      setShowLoginModal(true)
    }
    if (!forceLoginOpen && onLoginClose) {
      setShowLoginModal(false)
    }
  }, [forceLoginOpen, isAuthenticated, cloudUser, onLoginClose])

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
    if (isAuthenticated && cloudUser) {
      useStore.getState().setShowUserProfilePage(true)
    } else {
      setShowLoginModal(true)
    }
  }, [isAuthenticated, cloudUser])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError('')
      setLoading(true)

      try {
        const url = useStore.getState().serverUrl
        if (isRegister) {
          await register(url, email, password, username || undefined)
        } else if (loginMode === 'phone') {
          await phoneLogin(url, phone, smsCode)
        } else {
          await login(url, email, password)
        }
        setShowLoginModal(false)
        resetAuthForm()
        onLoginClose?.()
      } catch (err) {
        if (err instanceof BackendApiError) {
          if (err.status === 401) {
            setError(t('layout.invalidcredentials', language as Language))
          } else if (err.status === 409) {
            setError(t('layout.emailalreadyregistered', language as Language))
          } else {
            setError(err.message || (t('layout.requestfailed', language as Language)))
          }
        } else {
          setError(t('layout.cannotconnecttoserver', language as Language))
        }
      } finally {
        setLoading(false)
      }
    },
    [isRegister, loginMode, email, password, username, phone, smsCode, login, phoneLogin, register, language, resetAuthForm],
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
      setError(t('layout.failedtosendcode', language as Language))
    }
  }, [codeCooldown, phone, language])

  const handleForgotPassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError('')
      setLoading(true)

      try {
        await forgotPassword(useStore.getState().serverUrl, forgotEmail)
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
          setError(err.message || (t('layout.failedtosend', language as Language)))
        } else {
          setError(t('layout.cannotconnecttoserver2', language as Language))
        }
      } finally {
        setLoading(false)
      }
    },
    [forgotEmail, forgotPassword, language],
  )

  const handleResetPassword = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setError('')

      if (newPassword !== confirmPassword) {
        setError(t('layout.passwordsdonotmatch', language as Language))
        return
      }
      if (newPassword.length < 6) {
        setError(t('layout.passwordmustbeatleast', language as Language))
        return
      }

      setLoading(true)
      try {
        await resetPassword(useStore.getState().serverUrl, forgotEmail, resetCode, newPassword)
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
            setError(t('layout.invalidorexpiredverificationcode', language as Language))
          } else {
            setError(err.message || (t('layout.resetfailed', language as Language)))
          }
        } else {
          setError(t('layout.cannotconnecttoserver3', language as Language))
        }
      } finally {
        setLoading(false)
      }
    },
    [forgotEmail, resetCode, newPassword, confirmPassword, resetPassword, language],
  )

  const handleResendForgotCode = useCallback(async () => {
    if (forgotCodeCooldown > 0) return
    setError('')
    try {
      await forgotPassword(useStore.getState().serverUrl, forgotEmail)
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
        setError(err.message || (t('layout.failedtosend2', language as Language)))
      } else {
        setError(t('layout.cannotconnecttoserver4', language as Language))
      }
    }
  }, [forgotCodeCooldown, forgotEmail, forgotPassword, language])

  const initial = cloudUser?.username?.[0]?.toUpperCase() || cloudUser?.email?.[0]?.toUpperCase() || '?'

  const displayName = formatUserDisplayName(cloudUser?.username || cloudUser?.email || cloudUser?.phone || '')

  const tooltipText = (isAuthenticated && cloudUser)
    ? displayName
    : t('layout.notsignedin', language as Language)

  const stepTitle = authStep === 'forgot'
    ? t('layout.forgotpassword', language as Language)
    : authStep === 'reset'
      ? t('layout.resetpassword', language as Language)
      : isRegister
        ? t('layout.createaccount', language as Language)
        : t('layout.signintoaweeclaw', language as Language)

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
                  {t('layout.email', language as Language)}
                </label>
                <TextField
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder={t('layout.enteryourregisteredemail', language as Language)}
                  leftIcon={<Mail className="w-4 h-4" />}
                  required
                />
              </div>

              {forgotSuccess && (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-status-success/5 border border-status-success/20 text-status-success text-xs">
                  <ShieldCheck className="w-4 h-4 shrink-0" />
                  <span>{t('layout.verificationcodesenttoyour', language as Language)}</span>
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
                {t('layout.sendverificationcode', language as Language)}
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
                      ? t('layout.resends', language as Language, { forgotCodeCooldown: forgotCodeCooldown })
                      : t('layout.resendcode', language as Language)}
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
                  {t('layout.ihavethecodereset', language as Language)}
                </ActionButton>
              )}
            </form>
          )}

          {authStep === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="p-3 rounded-lg bg-accent/5 border border-accent/10 text-xs text-text-secondary">
                {t('layout.codesentto', language as Language, { forgotEmail: forgotEmail })}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  {t('layout.verificationcode', language as Language)}
                </label>
                <div className="flex gap-2">
                  <TextField
                    type="text"
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value)}
                    placeholder={t('layout.enter6digitcode', language as Language)}
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
                      : t('layout.resend', language as Language)}
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  {t('layout.newpassword', language as Language)}
                </label>
                <TextField
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('layout.newpasswordmin6chars', language as Language)}
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
                  {t('layout.confirmpassword', language as Language)}
                </label>
                <TextField
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder={t('layout.reenternewpassword', language as Language)}
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
                {t('layout.resetpassword2', language as Language)}
              </ActionButton>
            </form>
          )}

          {authStep === 'login' && (
          <form onSubmit={handleSubmit} className="space-y-4">
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
                  {t('layout.email2', language as Language)}
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
                  {t('layout.phone', language as Language)}
                </button>
              </div>
            )}

            {isRegister && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-text-secondary">
                  {t('layout.username', language as Language)}
                </label>
                <TextField
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('layout.usernameoptional', language as Language)}
                  leftIcon={<User className="w-4 h-4" />}
                />
              </div>
            )}

            {loginMode === 'email' || isRegister ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-secondary">
                    {t('layout.email3', language as Language)}
                  </label>
                  <TextField
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t('layout.enteremailaddress', language as Language)}
                    leftIcon={<Mail className="w-4 h-4" />}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-secondary">
                    {t('layout.password', language as Language)}
                  </label>
                  <TextField
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={t('layout.enterpassword', language as Language)}
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
                    {t('layout.phonenumber', language as Language)}
                  </label>
                  <TextField
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder={t('layout.enterphonenumber', language as Language)}
                    leftIcon={<Smartphone className="w-4 h-4" />}
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-secondary">
                    {t('layout.verificationcode2', language as Language)}
                  </label>
                  <div className="flex gap-2">
                    <TextField
                      type="text"
                      value={smsCode}
                      onChange={(e) => setSmsCode(e.target.value)}
                      placeholder={t('layout.entercode', language as Language)}
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
                        : t('layout.sendcode', language as Language)}
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
                ? t('layout.signup', language as Language)
                : t('layout.signin', language as Language)}
            </ActionButton>

            <div className="flex items-center justify-between text-xs text-text-muted">
              <p>
                {isRegister
                  ? t('layout.alreadyhaveanaccount', language as Language)
                  : t('layout.donthaveanaccount', language as Language)}
                <button
                  type="button"
                  onClick={() => {
                    setIsRegister(!isRegister)
                    setError('')
                  }}
                  className="text-accent hover:text-accent-hover transition-colors font-medium"
                >
                  {isRegister
                    ? t('layout.signin2', language as Language)
                    : t('layout.signup2', language as Language)}
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
                  {t('layout.forgotpassword2', language as Language)}
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
