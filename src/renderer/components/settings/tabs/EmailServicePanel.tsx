/**
 * 邮件服务设置面板
 *
 * 只维护「邮箱账户」：一个账户同时承载收信（IMAP）与发信（SMTP）能力，
 * 登录账号与密码/授权码只需填写一次；发件服务器默认按服务商规则从收件
 * 服务器推导，若发件地址/端口与收件不同，可在账户的「外发设置」中单独覆盖。
 *
 * 因此这里不再提供独立的 SMTP 账号/密码表单，避免同一套凭据填写两遍。
 */

import { useCallback } from 'react'
import { Mail, Send } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import type { EmailConfig } from '@shared/configuration/configTypes'
import { t, type Language } from '@renderer/i18n'

import MailAccountsPanel from './MailAccountsPanel'

interface EmailServicePanelProps {
  language: 'en' | 'zh'
  emailConfig: EmailConfig
  setEmailConfig: (config: EmailConfig) => void
}

export default function EmailServicePanel({
  language,
  emailConfig,
  setEmailConfig,
}: EmailServicePanelProps) {
  const zh = language === 'zh'

  const updateConfig = useCallback(
    (updates: Partial<EmailConfig>) => {
      setEmailConfig({ ...emailConfig, ...updates })
    },
    [emailConfig, setEmailConfig],
  )

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
            {emailConfig.enabled
              ? t('app.enabled', language as Language)
              : t('app.disabled', language as Language)}
          </span>
          <ToggleSwitch
            checked={emailConfig.enabled}
            onChange={() => updateConfig({ enabled: !emailConfig.enabled })}
          />
        </div>
      </div>

      <p className="text-xs text-text-muted leading-relaxed">
        {zh
          ? '每个邮箱只需填写一次账号与密码（授权码）：收件走 IMAP，发件服务器默认按服务商规则自动推导（如 imap.qq.com → smtp.qq.com）。若发件服务器地址或端口与收件不同，可在账户的「外发设置」中单独指定。'
          : 'Set up each mailbox once — receiving uses IMAP, and the outgoing server is derived from your provider (e.g. imap.qq.com → smtp.qq.com). Override the outgoing server only when it differs.'}
      </p>

      {emailConfig.enabled && (
        <div className="space-y-5">
          {/* 邮箱账户：同一账户同时承载收信与发信能力 */}
          <MailAccountsPanel
            language={language}
            emailConfig={emailConfig}
            setEmailConfig={setEmailConfig}
          />

          {/* 发件人显示信息（发送邮件时的 From 头，可选） */}
          <div className="pt-5 border-t border-border/30 space-y-3">
            <label className="text-xs font-medium text-text-secondary flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" />
              {t('app.senderinfo', language as Language)}
            </label>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <span className="text-xs text-text-muted">
                  {t('app.sendername', language as Language)}
                </span>
                <input
                  type="text"
                  value={emailConfig.fromName ?? ''}
                  onChange={(e) => updateConfig({ fromName: e.target.value })}
                  placeholder={t('app.aiassistant', language as Language)}
                  className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
              <div className="flex-1 space-y-1">
                <span className="text-xs text-text-muted">
                  {t('app.senderaddress', language as Language)}
                </span>
                <input
                  type="email"
                  value={emailConfig.fromAddress ?? ''}
                  onChange={(e) => updateConfig({ fromAddress: e.target.value })}
                  placeholder={t('app.leaveemptytouse', language as Language)}
                  className="w-full px-3 py-2 rounded-lg bg-background/50 border border-border text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 transition-colors"
                />
              </div>
            </div>
            <p className="text-xs text-text-muted leading-relaxed">
              {zh
                ? '留空时以实际发件账户的邮箱地址作为发件人。'
                : 'Leave empty to use the sending account address as the sender.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
