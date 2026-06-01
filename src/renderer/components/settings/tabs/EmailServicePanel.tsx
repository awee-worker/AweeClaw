import { useState, useCallback } from 'react'
import { Mail, Server, Shield, Eye, EyeOff, Send, TestTube, CheckCircle, XCircle, Loader2 } from 'lucide-react'
import { ActionButton, ToggleSwitch } from '@components/ui'
import { toast } from '@components/foundation/NotificationProvider'
import { api } from '../../../adapters/electronBridge'
import type { EmailConfig, EmailSmtpConfig } from '@shared/configuration/configTypes'
import { t, type Language } from '@renderer/i18n'

interface EmailServicePanelProps {
  language: 'en' | 'zh'
  emailConfig: EmailConfig
  setEmailConfig: (config: EmailConfig) => void
}

const SMTP_PRESETS: Array<{ label: string; labelZh: string; host: string; port: number; secure: boolean }> = [
  { label: 'Gmail', labelZh: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true },
  { label: 'Outlook', labelZh: 'Outlook', host: 'smtp.office365.com', port: 587, secure: false },
  { label: 'QQ Mail', labelZh: 'QQ邮箱', host: 'smtp.qq.com', port: 465, secure: true },
  { label: '163 Mail', labelZh: '163邮箱', host: 'smtp.163.com', port: 465, secure: true },
  { label: 'Aliyun', labelZh: '阿里邮箱', host: 'smtp.aliyun.com', port: 465, secure: true },
  { label: 'Custom', labelZh: '自定义', host: '', port: 465, secure: true },
]

export default function EmailServicePanel({ language, emailConfig, setEmailConfig }: EmailServicePanelProps) {
  const [showPassword, setShowPassword] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null)

  const smtp = emailConfig.smtp ?? { host: '', port: 465, secure: true, user: '', pass: '' }

  const updateSmtp = useCallback(
    (updates: Partial<EmailSmtpConfig>) => {
      setEmailConfig({
        ...emailConfig,
        smtp: { ...smtp, ...updates },
      })
    },
    [emailConfig, smtp, setEmailConfig],
  )

  const updateConfig = useCallback(
    (updates: Partial<EmailConfig>) => {
      setEmailConfig({ ...emailConfig, ...updates })
    },
    [emailConfig, setEmailConfig],
  )

  const handlePresetSelect = useCallback(
    (preset: (typeof SMTP_PRESETS)[number]) => {
      updateSmtp({
        host: preset.host,
        port: preset.port,
        secure: preset.secure,
      })
    },
    [updateSmtp],
  )

  const handleTestConnection = useCallback(async () => {
    if (!smtp.host || !smtp.user || !smtp.pass) {
      toast.error(t('app.pleasefillinsmtp', language as Language))
      return
    }

    setTesting(true)
    setTestResult(null)

    try {
      const result = await api.email.testConnection({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.secure,
        user: smtp.user,
        pass: smtp.pass,
      })

      if (result.success) {
        setTestResult({ success: true, message: t('app.connectionsuccessful', language as Language) })
        toast.success(t('app.emailserviceconnectiontest', language as Language))
      } else {
        setTestResult({
          success: false,
          message: result.error ?? t('app.connectionfailed', language as Language),
        })
        toast.error(t('app.emailserviceconnectiontest2', language as Language))
      }
    } catch (err) {
      setTestResult({
        success: false,
        message: err instanceof Error ? err.message : String(err),
      })
      toast.error(t('app.emailserviceconnectiontest3', language as Language))
    } finally {
      setTesting(false)
    }
  }, [smtp, t])

  const matchedPreset = SMTP_PRESETS.find((p) => p.host && p.host === smtp.host)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-semibold text-text-primary">
            {t('app.emailservice', language as Language)}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">
            {emailConfig.enabled ? t('app.enabled', language as Language) : t('app.disabled', language as Language)}
          </span>
          <ToggleSwitch
            checked={emailConfig.enabled}
            onChange={() => updateConfig({ enabled: !emailConfig.enabled })}
          />
        </div>
      </div>

      <p className="text-xs text-text-muted leading-relaxed">
        {t('email.smtpdesc', language as Language)}
      </p>

      {emailConfig.enabled && (
        <div className="space-y-5">
          <div className="space-y-3">
            <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5" />
              {t('app.smtppresets', language as Language)}
            </label>
            <div className="flex flex-wrap gap-2">
              {SMTP_PRESETS.map((preset) => {
                const isActive = matchedPreset === preset
                return (
                  <button
                    key={preset.host || 'custom'}
                    onClick={() => handlePresetSelect(preset)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-200 border ${
                      isActive
                        ? 'bg-accent/15 text-accent border-accent/40'
                        : 'bg-surface/60 text-text-secondary border-border/40 hover:border-accent/30 hover:text-text-primary'
                    }`}
                  >
                    {language === 'zh' ? preset.labelZh : preset.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-medium text-text-secondary">
              {t('app.smtpserver', language as Language)}
            </label>
            <div className="flex gap-3">
              <input
                type="text"
                value={smtp.host}
                onChange={(e) => updateSmtp({ host: e.target.value })}
                placeholder={t('app.egsmtpgmailcom', language as Language)}
                className="flex-1 px-3 py-2 rounded-lg bg-background/50 border border-border text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
              />
              <input
                type="number"
                value={smtp.port || ''}
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10)
                  if (!isNaN(val) && val > 0 && val <= 65535) {
                    updateSmtp({ port: val })
                  }
                }}
                placeholder="465"
                className="w-20 px-3 py-2 rounded-lg bg-background/50 border border-border text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" />
              {t('email.ssltls', language as Language)}
            </label>
            <ToggleSwitch
              checked={smtp.secure}
              onChange={() => updateSmtp({ secure: !smtp.secure })}
            />
            <span className="text-[10px] text-text-muted">
              {smtp.secure
                ? t('app.sslencryptedportusually', language as Language)
                : t('app.starttlsportusually587', language as Language)}
            </span>
          </div>

          <div className="space-y-3">
            <label className="text-xs font-medium text-text-secondary">
              {t('app.authusername', language as Language)}
            </label>
            <input
              type="text"
              value={smtp.user}
              onChange={(e) => updateSmtp({ user: e.target.value })}
              placeholder={t('app.emailaddressorusername', language as Language)}
              className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>

          <div className="space-y-3">
            <label className="text-xs font-medium text-text-secondary">
              {t('app.authpassword', language as Language)}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={smtp.pass}
                onChange={(e) => updateSmtp({ pass: e.target.value })}
                placeholder={t('app.emailpasswordorappspecific', language as Language)}
                className="w-full px-3 py-2 pr-9 rounded-lg bg-background/50 border border-border text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
              >
                {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[10px] text-text-muted leading-relaxed">
              {t('email.apppasswordhint', language as Language)}
            </p>
          </div>

          <div className="pt-4 border-t border-border/30 space-y-3">
            <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" />
              {t('app.senderinfo', language as Language)}
            </label>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <span className="text-[10px] text-text-muted">{t('app.sendername', language as Language)}</span>
                <input
                  type="text"
                  value={emailConfig.fromName ?? ''}
                  onChange={(e) => updateConfig({ fromName: e.target.value })}
                  placeholder={t('app.aiassistant', language as Language)}
                  className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
              <div className="flex-1 space-y-1">
                <span className="text-[10px] text-text-muted">{t('app.senderaddress', language as Language)}</span>
                <input
                  type="email"
                  value={emailConfig.fromAddress ?? ''}
                  onChange={(e) => updateConfig({ fromAddress: e.target.value })}
                  placeholder={t('app.leaveemptytouse', language as Language)}
                  className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-border/30">
            <div className="flex items-center gap-3">
              <ActionButton
                variant="secondary"
                size="sm"
                onClick={handleTestConnection}
                disabled={testing || !smtp.host || !smtp.user || !smtp.pass}
                className="flex items-center gap-1.5"
              >
                {testing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <TestTube className="w-3.5 h-3.5" />
                )}
                {testing ? t('app.testing', language as Language) : t('app.testconnection', language as Language)}
              </ActionButton>

              {testResult && (
                <div className={`flex items-center gap-1.5 text-xs ${testResult.success ? 'text-green-400' : 'text-red-400'}`}>
                  {testResult.success ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                  <span>{testResult.message}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
