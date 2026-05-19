import { useState } from 'react'
import { Shield, AlertTriangle, X, FolderOpen, Globe, Terminal, Clipboard, Bell, Monitor, Database, HardDrive } from 'lucide-react'
import { useStore } from '@store'
import type { ScenarioPermission } from '@shared/protocols/scenario-arch'

const PERMISSION_META: Record<string, { icon: React.ReactNode; labelZh: string; labelEn: string; riskLevel: 'low' | 'medium' | 'high' }> = {
  'filesystem:read': {
    icon: <FolderOpen className="w-4 h-4" />,
    labelZh: '读取文件系统',
    labelEn: 'Read Filesystem',
    riskLevel: 'medium',
  },
  'filesystem:write': {
    icon: <HardDrive className="w-4 h-4" />,
    labelZh: '写入文件系统',
    labelEn: 'Write Filesystem',
    riskLevel: 'high',
  },
  'database:connect': {
    icon: <Database className="w-4 h-4" />,
    labelZh: '连接数据库',
    labelEn: 'Connect Database',
    riskLevel: 'high',
  },
  'database:query': {
    icon: <Database className="w-4 h-4" />,
    labelZh: '查询数据库',
    labelEn: 'Query Database',
    riskLevel: 'medium',
  },
  'network:request': {
    icon: <Globe className="w-4 h-4" />,
    labelZh: '网络请求',
    labelEn: 'Network Requests',
    riskLevel: 'medium',
  },
  'terminal:execute': {
    icon: <Terminal className="w-4 h-4" />,
    labelZh: '执行终端命令',
    labelEn: 'Execute Terminal Commands',
    riskLevel: 'high',
  },
  'clipboard:read': {
    icon: <Clipboard className="w-4 h-4" />,
    labelZh: '读取剪贴板',
    labelEn: 'Read Clipboard',
    riskLevel: 'medium',
  },
  'clipboard:write': {
    icon: <Clipboard className="w-4 h-4" />,
    labelZh: '写入剪贴板',
    labelEn: 'Write Clipboard',
    riskLevel: 'low',
  },
  'notification:send': {
    icon: <Bell className="w-4 h-4" />,
    labelZh: '发送通知',
    labelEn: 'Send Notifications',
    riskLevel: 'low',
  },
  'system:info': {
    icon: <Monitor className="w-4 h-4" />,
    labelZh: '获取系统信息',
    labelEn: 'Access System Info',
    riskLevel: 'low',
  },
}

const RISK_STYLE: Record<string, { bg: string; text: string; labelZh: string; labelEn: string }> = {
  low: { bg: 'bg-green-500/10', text: 'text-green-400', labelZh: '低风险', labelEn: 'Low' },
  medium: { bg: 'bg-amber-500/10', text: 'text-amber-400', labelZh: '中风险', labelEn: 'Medium' },
  high: { bg: 'bg-red-500/10', text: 'text-red-400', labelZh: '高风险', labelEn: 'High' },
}

interface PermissionConfirmDialogProps {
  scenarioName: string
  scenarioNameZh: string
  permissions: string[]
  onConfirm: () => void
  onCancel: () => void
}

export function PermissionConfirmDialog({
  scenarioName,
  scenarioNameZh,
  permissions,
  onConfirm,
  onCancel,
}: PermissionConfirmDialogProps) {
  const language = useStore(s => s.language)
  const [agreed, setAgreed] = useState(false)

  const t = (zh: string, en: string) => (language === 'zh' ? zh : en)

  const displayName = language === 'zh' ? scenarioNameZh : scenarioName

  const hasHighRisk = permissions.some(p => PERMISSION_META[p]?.riskLevel === 'high')

  const grouped = {
    high: permissions.filter(p => PERMISSION_META[p]?.riskLevel === 'high'),
    medium: permissions.filter(p => PERMISSION_META[p]?.riskLevel === 'medium'),
    low: permissions.filter(p => PERMISSION_META[p]?.riskLevel === 'low'),
  }

  const unknownPerms = permissions.filter(p => !PERMISSION_META[p])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-[var(--color-bg-card)] border border-[var(--color-border)] rounded-2xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-violet-400" />
            <h3 className="text-sm font-semibold text-[var(--color-text-bright)]">
              {t('权限确认', 'Permission Confirmation')}
            </h3>
          </div>
          <button
            onClick={onCancel}
            className="p-1 rounded-lg hover:bg-[var(--color-bg-hover)] transition-colors"
          >
            <X className="w-4 h-4 text-[var(--color-text)]" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
          <p className="text-sm text-[var(--color-text)]">
            {t(
              `"${scenarioNameZh}" 需要以下权限才能正常运行：`,
              `"${scenarioName}" requires the following permissions to function properly:`
            )}
          </p>

          {hasHighRisk && (
            <div className="flex items-start gap-2 p-3 bg-red-500/5 border border-red-500/20 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-400">
                {t(
                  '此场景包含高风险权限，请仔细审查后再确认安装。',
                  'This scenario contains high-risk permissions. Please review carefully before confirming.'
                )}
              </p>
            </div>
          )}

          {(['high', 'medium', 'low'] as const).map(riskLevel => {
            const perms = grouped[riskLevel]
            if (perms.length === 0) return null
            const risk = RISK_STYLE[riskLevel]
            return (
              <div key={riskLevel} className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${risk.bg} ${risk.text}`}>
                    {language === 'zh' ? risk.labelZh : risk.labelEn}
                  </span>
                  <span className="text-xs text-[var(--color-text)] opacity-60">
                    ({perms.length})
                  </span>
                </div>
                <div className="space-y-1.5">
                  {perms.map(perm => {
                    const meta = PERMISSION_META[perm]
                    return (
                      <div
                        key={perm}
                        className="flex items-center gap-2.5 px-3 py-2 bg-[var(--color-bg)] rounded-lg"
                      >
                        <span className="text-[var(--color-text)] opacity-60">{meta.icon}</span>
                        <span className="text-sm text-[var(--color-text-bright)]">
                          {language === 'zh' ? meta.labelZh : meta.labelEn}
                        </span>
                        <span className="ml-auto text-[10px] font-mono text-[var(--color-text)] opacity-40">
                          {perm}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {unknownPerms.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-gray-500/10 text-gray-400">
                  {t('其他', 'Other')}
                </span>
              </div>
              {unknownPerms.map(perm => (
                <div
                  key={perm}
                  className="flex items-center gap-2.5 px-3 py-2 bg-[var(--color-bg)] rounded-lg"
                >
                  <Shield className="w-4 h-4 text-gray-400" />
                  <span className="text-sm text-[var(--color-text-bright)]">{perm}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[var(--color-border)] space-y-3">
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={agreed}
              onChange={e => setAgreed(e.target.checked)}
              className="mt-0.5 rounded border-[var(--color-border)] bg-[var(--color-bg)] text-violet-500 focus:ring-violet-500/30"
            />
            <span className="text-xs text-[var(--color-text)] leading-relaxed">
              {t(
                '我已了解此场景所需的权限及其风险，同意授予以上权限并继续安装。',
                'I understand the permissions required by this scenario and their risks. I agree to grant the above permissions and proceed with installation.'
              )}
            </span>
          </label>

          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 rounded-lg text-sm bg-[var(--color-bg)] border border-[var(--color-border)] text-[var(--color-text)] hover:text-[var(--color-text-bright)] transition-colors"
            >
              {t('取消', 'Cancel')}
            </button>
            <button
              onClick={onConfirm}
              disabled={!agreed}
              className="flex-1 px-4 py-2 rounded-lg text-sm bg-violet-500 text-white font-medium hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {t('确认安装', 'Confirm Install')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
