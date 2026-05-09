import { useState, useCallback, useEffect } from 'react'
import { LogIn, UserPlus, LogOut, Eye, EyeOff, Server, AlertCircle, Loader2, Cloud, User, Crown, Zap } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { Button, Input } from '@components/ui'
import { Tooltip } from '../ui/Tooltip'
import { Modal } from '../ui/Modal'
import { type Language } from '@renderer/i18n'
import { BackendApiError } from '@renderer/services/backendApi'

export function UserAccountPopover({ language }: { language: Language }) {
  const {
    isAuthenticated,
    cloudUser,
    quota,
    login,
    register,
    logout,
    fetchQuota,
  } = useStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      cloudUser: s.cloudUser,
      quota: s.quota,
      login: s.login,
      register: s.register,
      logout: s.logout,
      fetchQuota: s.fetchQuota,
    })),
  )

  const [showLoginModal, setShowLoginModal] = useState(false)
  const [showUserModal, setShowUserModal] = useState(false)

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

  const initial = cloudUser?.username?.[0]?.toUpperCase() || cloudUser?.email?.[0]?.toUpperCase() || '?'

  const displayName = cloudUser?.username || cloudUser?.email || ''

  const tooltipText = isAuthenticated
    ? displayName
    : language === 'zh'
      ? '您还未登录'
      : 'Not signed in'

  const quotaPercent =
    quota && quota.limit !== Infinity && quota.remaining !== -1
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
              <Crown className="w-4 h-4 text-accent" />
              <span className="text-xs font-medium text-accent">
                {cloudUser.subscriptionPlan === 'FREE'
                  ? language === 'zh'
                    ? '免费版'
                    : 'Free Plan'
                  : cloudUser.subscriptionPlan}
              </span>
              <span className="text-xs text-text-muted ml-auto">
                {cloudUser.role}
              </span>
            </div>

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
                <div className="h-1.5 rounded-full bg-surface/80 overflow-hidden">
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
                  useStore.getState().setShowSettings(true)
                }}
                className="flex-1 text-xs"
              >
                {language === 'zh' ? '账户设置' : 'Settings'}
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
