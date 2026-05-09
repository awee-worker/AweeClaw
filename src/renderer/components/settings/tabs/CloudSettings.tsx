import { useCallback, useEffect } from 'react'
import { LogOut, CheckCircle2 } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { Button } from '@components/ui'
import { type Language } from '@renderer/i18n'

export function CloudSettings({ language }: { language: Language }) {
  const {
    isAuthenticated,
    cloudUser,
    serverUrl,
    quota,
    logout,
    fetchQuota,
  } = useStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      cloudUser: s.cloudUser,
      serverUrl: s.serverUrl,
      quota: s.quota,
      logout: s.logout,
      fetchQuota: s.fetchQuota,
    })),
  )

  useEffect(() => {
    if (isAuthenticated && !quota) {
      fetchQuota().catch(() => {})
    }
  }, [isAuthenticated])

  const handleLogout = useCallback(() => {
    logout()
  }, [logout])

  const handleRefreshQuota = useCallback(async () => {
    try {
      await fetchQuota()
    } catch {}
  }, [fetchQuota])

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
            <p className="text-sm text-text-primary font-medium mt-0.5">{cloudUser.subscriptionPlan}</p>
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
            <div className="h-2 rounded-full bg-surface/80 overflow-hidden">
              <div
                className="h-full rounded-full bg-accent transition-all duration-500"
                style={{
                  width:
                    quota.limit === Infinity || quota.remaining === -1
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

      <div className="pt-2">
        <Button variant="danger" onClick={handleLogout} className="w-full">
          <LogOut className="w-4 h-4" />
          {language === 'zh' ? '退出登录' : 'Sign Out'}
        </Button>
      </div>
    </div>
  )
}
