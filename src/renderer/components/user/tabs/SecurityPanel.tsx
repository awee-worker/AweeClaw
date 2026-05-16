import { useState, useCallback, useEffect } from 'react'
import {
  Mail,
  Lock,
  Smartphone,
  ShieldCheck,
  AlertCircle,
  Loader2,
  Check,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton, TextField } from '@components/ui'
import { type Language } from '@renderer/i18n'
import { backendApi } from '@services/backendApi'

interface SecurityPanelProps {
  language: Language
  initialSection: 'email' | 'phone' | null
  onSectionConsumed: () => void
}

export function SecurityPanel({ language, initialSection, onSectionConsumed }: SecurityPanelProps) {
  const { cloudUser, fetchProfile } = useStore(useShallow(s => ({
    cloudUser: s.cloudUser,
    fetchProfile: s.fetchProfile,
  })))

  const [activeSection, setActiveSection] = useState<'password' | 'email' | 'phone' | null>(null)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordSaved, setPasswordSaved] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailCodeCooldown, setEmailCodeCooldown] = useState(0)
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailSaved, setEmailSaved] = useState(false)

  const [newPhone, setNewPhone] = useState('')
  const [phoneCode, setPhoneCode] = useState('')
  const [phoneCodeCooldown, setPhoneCodeCooldown] = useState(0)
  const [phoneSaving, setPhoneSaving] = useState(false)
  const [phoneSaved, setPhoneSaved] = useState(false)

  const [error, setError] = useState('')

  useEffect(() => {
    if (initialSection) {
      setActiveSection(initialSection)
      onSectionConsumed()
    }
  }, [initialSection, onSectionConsumed])

  const handlePasswordSave = useCallback(async () => {
    if (!currentPassword || !newPassword || newPassword !== confirmPassword) {
      setError(language === 'zh' ? '请正确填写密码信息' : 'Please fill in password correctly')
      return
    }
    if (newPassword.length < 6) {
      setError(language === 'zh' ? '新密码至少6位' : 'Password must be at least 6 characters')
      return
    }
    setPasswordSaving(true)
    setError('')
    try {
      await backendApi.put('/api/v1/user/password', { currentPassword, newPassword })
      setPasswordSaved(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => { setPasswordSaved(false); setActiveSection(null) }, 2000)
    } catch (e: any) {
      setError(e?.message || (language === 'zh' ? '修改密码失败' : 'Failed to update password'))
    } finally {
      setPasswordSaving(false)
    }
  }, [currentPassword, newPassword, confirmPassword, language])

  const handleSendEmailCode = useCallback(async () => {
    if (emailCodeCooldown > 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) return
    try {
      await backendApi.post('/api/v1/email/send-code', { email: newEmail, purpose: 'bindEmail' })
      setEmailCodeCooldown(60)
      const timer = setInterval(() => {
        setEmailCodeCooldown(prev => {
          if (prev <= 1) { clearInterval(timer); return 0 }
          return prev - 1
        })
      }, 1000)
    } catch {
      setError(language === 'zh' ? '验证码发送失败' : 'Failed to send code')
    }
  }, [emailCodeCooldown, newEmail, language])

  const handleEmailSave = useCallback(async () => {
    if (!newEmail || !emailCode) {
      setError(language === 'zh' ? '请填写邮箱和验证码' : 'Please enter email and code')
      return
    }
    setEmailSaving(true)
    setError('')
    try {
      await backendApi.put('/api/v1/user/email', { email: newEmail, code: emailCode })
      await fetchProfile()
      setEmailSaved(true)
      setNewEmail('')
      setEmailCode('')
      setTimeout(() => { setEmailSaved(false); setActiveSection(null) }, 2000)
    } catch (e: any) {
      setError(e?.message || (language === 'zh' ? '修改邮箱失败' : 'Failed to update email'))
    } finally {
      setEmailSaving(false)
    }
  }, [newEmail, emailCode, language, fetchProfile])

  const handleSendPhoneCode = useCallback(async () => {
    if (phoneCodeCooldown > 0 || !/^1[3-9]\d{9}$/.test(newPhone)) return
    try {
      await backendApi.post('/api/v1/sms/send-code', { phone: newPhone, purpose: 'bindPhone' })
      setPhoneCodeCooldown(60)
      const timer = setInterval(() => {
        setPhoneCodeCooldown(prev => {
          if (prev <= 1) { clearInterval(timer); return 0 }
          return prev - 1
        })
      }, 1000)
    } catch {
      setError(language === 'zh' ? '验证码发送失败' : 'Failed to send code')
    }
  }, [phoneCodeCooldown, newPhone, language])

  const handlePhoneSave = useCallback(async () => {
    if (!newPhone || !phoneCode) {
      setError(language === 'zh' ? '请填写手机号和验证码' : 'Please enter phone and code')
      return
    }
    setPhoneSaving(true)
    setError('')
    try {
      await backendApi.put('/api/v1/user/phone', { phone: newPhone, code: phoneCode })
      await fetchProfile()
      setPhoneSaved(true)
      setNewPhone('')
      setPhoneCode('')
      setTimeout(() => { setPhoneSaved(false); setActiveSection(null) }, 2000)
    } catch (e: any) {
      setError(e?.message || (language === 'zh' ? '修改手机号失败' : 'Failed to update phone'))
    } finally {
      setPhoneSaving(false)
    }
  }, [newPhone, phoneCode, language, fetchProfile])

  const renderSection = () => {
    switch (activeSection) {
      case 'password':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setActiveSection(null)} className="text-xs text-text-muted hover:text-text-primary transition-colors">
                {language === 'zh' ? '← 返回' : '← Back'}
              </button>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '当前密码' : 'Current Password'}</label>
              <TextField
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder={language === 'zh' ? '输入当前密码' : 'Enter current password'}
                leftIcon={<Lock className="w-4 h-4" />}
                rightIcon={<button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)} className="hover:text-text-primary transition-colors">{showCurrentPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '新密码' : 'New Password'}</label>
              <TextField
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder={language === 'zh' ? '输入新密码（至少6位）' : 'Enter new password (min 6 chars)'}
                leftIcon={<Lock className="w-4 h-4" />}
                rightIcon={<button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="hover:text-text-primary transition-colors">{showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '确认新密码' : 'Confirm New Password'}</label>
              <TextField
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder={language === 'zh' ? '再次输入新密码' : 'Re-enter new password'}
                leftIcon={<Lock className="w-4 h-4" />}
              />
            </div>
            {error && <div className="flex items-center gap-2 p-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs"><AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span></div>}
            <div className="flex justify-end">
              <ActionButton variant={passwordSaved ? 'success' : 'primary'} onClick={handlePasswordSave} disabled={passwordSaving} className="min-w-[120px]">
                {passwordSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : passwordSaved ? <><Check className="w-4 h-4" />{language === 'zh' ? '已修改' : 'Updated'}</> : language === 'zh' ? '修改密码' : 'Update Password'}
              </ActionButton>
            </div>
          </div>
        )
      case 'email':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setActiveSection(null)} className="text-xs text-text-muted hover:text-text-primary transition-colors">
                {language === 'zh' ? '← 返回' : '← Back'}
              </button>
            </div>
            <div className="p-3 rounded-lg bg-surface/50 border border-border/30 text-xs text-text-muted">
              {language === 'zh' ? '当前邮箱：' : 'Current email: '}{cloudUser?.email || (language === 'zh' ? '未设置' : 'Not set')}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '新邮箱' : 'New Email'}</label>
              <TextField
                type="email"
                value={newEmail}
                onChange={e => setNewEmail(e.target.value)}
                placeholder={language === 'zh' ? '输入新邮箱地址' : 'Enter new email address'}
                leftIcon={<Mail className="w-4 h-4" />}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '验证码' : 'Verification Code'}</label>
              <div className="flex gap-2">
                <TextField
                  type="text"
                  value={emailCode}
                  onChange={e => setEmailCode(e.target.value)}
                  placeholder={language === 'zh' ? '输入验证码' : 'Enter verification code'}
                  leftIcon={<ShieldCheck className="w-4 h-4" />}
                />
                <button
                  type="button"
                  onClick={handleSendEmailCode}
                  disabled={emailCodeCooldown > 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)}
                  className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    emailCodeCooldown > 0 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)
                      ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                      : 'bg-accent/10 text-accent hover:bg-accent/20'
                  }`}
                >
                  {emailCodeCooldown > 0 ? `${emailCodeCooldown}s` : language === 'zh' ? '获取验证码' : 'Send Code'}
                </button>
              </div>
            </div>
            {error && <div className="flex items-center gap-2 p-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs"><AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span></div>}
            <div className="flex justify-end">
              <ActionButton variant={emailSaved ? 'success' : 'primary'} onClick={handleEmailSave} disabled={emailSaving} className="min-w-[120px]">
                {emailSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : emailSaved ? <><Check className="w-4 h-4" />{language === 'zh' ? '已修改' : 'Updated'}</> : language === 'zh' ? '修改邮箱' : 'Update Email'}
              </ActionButton>
            </div>
          </div>
        )
      case 'phone':
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-2 mb-2">
              <button onClick={() => setActiveSection(null)} className="text-xs text-text-muted hover:text-text-primary transition-colors">
                {language === 'zh' ? '← 返回' : '← Back'}
              </button>
            </div>
            <div className="p-3 rounded-lg bg-surface/50 border border-border/30 text-xs text-text-muted">
              {language === 'zh' ? '当前手机号：' : 'Current phone: '}{cloudUser?.phone || (language === 'zh' ? '未绑定' : 'Not bound')}
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '新手机号' : 'New Phone Number'}</label>
              <TextField
                type="tel"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                placeholder={language === 'zh' ? '输入新手机号' : 'Enter new phone number'}
                leftIcon={<Smartphone className="w-4 h-4" />}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '验证码' : 'Verification Code'}</label>
              <div className="flex gap-2">
                <TextField
                  type="text"
                  value={phoneCode}
                  onChange={e => setPhoneCode(e.target.value)}
                  placeholder={language === 'zh' ? '输入验证码' : 'Enter code'}
                  leftIcon={<ShieldCheck className="w-4 h-4" />}
                />
                <button
                  type="button"
                  onClick={handleSendPhoneCode}
                  disabled={phoneCodeCooldown > 0 || !/^1[3-9]\d{9}$/.test(newPhone)}
                  className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    phoneCodeCooldown > 0 || !/^1[3-9]\d{9}$/.test(newPhone)
                      ? 'bg-bg-tertiary text-text-muted cursor-not-allowed'
                      : 'bg-accent/10 text-accent hover:bg-accent/20'
                  }`}
                >
                  {phoneCodeCooldown > 0 ? `${phoneCodeCooldown}s` : language === 'zh' ? '获取验证码' : 'Send Code'}
                </button>
              </div>
            </div>
            {error && <div className="flex items-center gap-2 p-3 rounded-lg bg-status-error/5 border border-status-error/20 text-status-error text-xs"><AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span></div>}
            <div className="flex justify-end">
              <ActionButton variant={phoneSaved ? 'success' : 'primary'} onClick={handlePhoneSave} disabled={phoneSaving} className="min-w-[120px]">
                {phoneSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : phoneSaved ? <><Check className="w-4 h-4" />{language === 'zh' ? '已修改' : 'Updated'}</> : language === 'zh' ? '修改手机号' : 'Update Phone'}
              </ActionButton>
            </div>
          </div>
        )
      default:
        return null
    }
  }

  if (activeSection) return renderSection()

  return (
    <div className="space-y-3">
      <button
        onClick={() => setActiveSection('password')}
        className="w-full flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-surface/30 hover:bg-surface/50 transition-colors text-left"
      >
        <div className="p-2 rounded-lg bg-accent/10"><Lock className="w-4 h-4 text-accent" /></div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary">{language === 'zh' ? '修改密码' : 'Change Password'}</p>
          <p className="text-xs text-text-muted mt-0.5">{language === 'zh' ? '更新您的登录密码' : 'Update your login password'}</p>
        </div>
      </button>

      <button
        onClick={() => setActiveSection('email')}
        className="w-full flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-surface/30 hover:bg-surface/50 transition-colors text-left"
      >
        <div className="p-2 rounded-lg bg-accent/10"><Mail className="w-4 h-4 text-accent" /></div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary">{language === 'zh' ? '修改邮箱' : 'Change Email'}</p>
          <p className="text-xs text-text-muted mt-0.5">{cloudUser?.email || (language === 'zh' ? '未设置' : 'Not set')}</p>
        </div>
      </button>

      <button
        onClick={() => setActiveSection('phone')}
        className="w-full flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-surface/30 hover:bg-surface/50 transition-colors text-left"
      >
        <div className="p-2 rounded-lg bg-accent/10"><Smartphone className="w-4 h-4 text-accent" /></div>
        <div className="flex-1">
          <p className="text-sm font-medium text-text-primary">{language === 'zh' ? '修改手机号' : 'Change Phone'}</p>
          <p className="text-xs text-text-muted mt-0.5">{cloudUser?.phone || (language === 'zh' ? '未绑定' : 'Not bound')}</p>
        </div>
      </button>
    </div>
  )
}
