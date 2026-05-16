import { useState, useCallback, useEffect, useRef } from 'react'
import {
  User,
  Mail,
  Smartphone,
  Loader2,
  Camera,
  Check,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { ActionButton, TextField } from '@components/ui'
import { type Language } from '@renderer/i18n'
import { backendApi } from '@services/backendApi'
import { toast } from '@components/foundation/NotificationProvider'

interface ProfilePanelProps {
  language: Language
  onSwitchToSecurity: (section: 'email' | 'phone') => void
}

export function ProfilePanel({ language, onSwitchToSecurity }: ProfilePanelProps) {
  const { cloudUser, fetchProfile } = useStore(useShallow(s => ({
    cloudUser: s.cloudUser,
    fetchProfile: s.fetchProfile,
  })))

  const [realName, setRealName] = useState(cloudUser?.realName || '')
  const [gender, setGender] = useState(cloudUser?.gender || '')
  const [birthday, setBirthday] = useState(cloudUser?.birthday ? cloudUser.birthday.split('T')[0] : '')
  const [occupation, setOccupation] = useState(cloudUser?.occupation || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setRealName(cloudUser?.realName || '')
    setGender(cloudUser?.gender || '')
    setBirthday(cloudUser?.birthday ? cloudUser.birthday.split('T')[0] : '')
    setOccupation(cloudUser?.occupation || '')
  }, [cloudUser?.realName, cloudUser?.gender, cloudUser?.birthday, cloudUser?.occupation])

  const handleAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      toast.error(language === 'zh' ? '文件过大' : 'File too large', language === 'zh' ? '头像文件不能超过2MB' : 'Avatar must be under 2MB')
      return
    }
    const formData = new FormData()
    formData.append('file', file)
    try {
      const result = await backendApi.post<{ url: string }>('/api/v1/upload/avatar', formData)
      await backendApi.put('/api/v1/user/profile', { avatar: result.url })
      await fetchProfile()
      toast.success(language === 'zh' ? '头像已更新' : 'Avatar updated', '')
    } catch {
      toast.error(language === 'zh' ? '上传失败' : 'Upload failed', language === 'zh' ? '头像上传失败，请重试' : 'Failed to upload avatar')
    }
    e.target.value = ''
  }, [language, fetchProfile])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      await backendApi.put('/api/v1/user/profile', {
        realName: realName.trim() || undefined,
        gender: gender || undefined,
        birthday: birthday || undefined,
        occupation: occupation.trim() || undefined,
      })
      await fetchProfile()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      toast.error(language === 'zh' ? '保存失败' : 'Save failed', '')
    } finally {
      setSaving(false)
    }
  }, [realName, gender, birthday, occupation, language, fetchProfile])

  const initial = cloudUser?.username?.[0]?.toUpperCase() || cloudUser?.email?.[0]?.toUpperCase() || '?'

  const genderOptions = [
    { value: '', labelZh: '未设置', labelEn: 'Not set' },
    { value: 'male', labelZh: '男', labelEn: 'Male' },
    { value: 'female', labelZh: '女', labelEn: 'Female' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="relative group">
          {cloudUser?.avatarUrl ? (
            <img src={cloudUser.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover border-2 border-border/40" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-accent to-accent/60 flex items-center justify-center text-white text-2xl font-bold shadow-xl shadow-accent/20">
              {initial}
            </div>
          )}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
          >
            <Camera className="w-5 h-5 text-white" />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
        </div>
        <div className="flex-1">
          <p className="text-base font-semibold text-text-primary">{cloudUser?.username || cloudUser?.email}</p>
          <p className="text-xs text-text-muted">{cloudUser?.email}</p>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '用户名' : 'Username'}</label>
          <div className="flex items-center h-9 px-3 rounded-lg bg-surface/30 border border-border/30 text-sm text-text-muted">
            <User className="w-4 h-4 mr-2 opacity-50" />
            <span>{cloudUser?.username || '-'}</span>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '邮箱' : 'Email'}</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center h-9 px-3 rounded-lg bg-surface/30 border border-border/30 text-sm text-text-muted">
              <Mail className="w-4 h-4 mr-2 opacity-50" />
              <span>{cloudUser?.email || '-'}</span>
            </div>
            <button
              onClick={() => onSwitchToSecurity('email')}
              className="shrink-0 h-9 px-3 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              {language === 'zh' ? '修改' : 'Edit'}
            </button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '手机号' : 'Phone'}</label>
          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center h-9 px-3 rounded-lg bg-surface/30 border border-border/30 text-sm text-text-muted">
              <Smartphone className="w-4 h-4 mr-2 opacity-50" />
              <span>{cloudUser?.phone || (language === 'zh' ? '未绑定' : 'Not bound')}</span>
            </div>
            <button
              onClick={() => onSwitchToSecurity('phone')}
              className="shrink-0 h-9 px-3 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              {language === 'zh' ? '修改' : 'Edit'}
            </button>
          </div>
        </div>

        <div className="h-px bg-border/30" />

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '姓名' : 'Real Name'}</label>
          <TextField
            value={realName}
            onChange={e => setRealName(e.target.value)}
            placeholder={language === 'zh' ? '输入姓名' : 'Enter real name'}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '性别' : 'Gender'}</label>
          <div className="flex gap-2">
            {genderOptions.filter(o => o.value).map(opt => (
              <button
                key={opt.value}
                onClick={() => setGender(gender === opt.value ? '' : opt.value)}
                className={`flex-1 h-9 rounded-lg text-xs font-medium border transition-colors ${
                  gender === opt.value
                    ? 'bg-accent/10 border-accent/30 text-accent'
                    : 'bg-surface/30 border-border/30 text-text-secondary hover:bg-surface/50'
                }`}
              >
                {language === 'zh' ? opt.labelZh : opt.labelEn}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '生日' : 'Birthday'}</label>
          <input
            type="date"
            value={birthday}
            onChange={e => setBirthday(e.target.value)}
            className="w-full h-9 px-3 rounded-lg bg-surface/30 border border-border/30 text-sm text-text-primary focus:outline-none focus:border-accent/50 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-text-secondary">{language === 'zh' ? '职业' : 'Occupation'}</label>
          <TextField
            value={occupation}
            onChange={e => setOccupation(e.target.value)}
            placeholder={language === 'zh' ? '输入职业' : 'Enter occupation'}
          />
        </div>

        <div className="flex justify-end">
          <ActionButton
            variant={saved ? 'success' : 'primary'}
            onClick={handleSave}
            disabled={saving}
            className="min-w-[120px]"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <><Check className="w-4 h-4" />{language === 'zh' ? '已保存' : 'Saved'}</> : language === 'zh' ? '保存' : 'Save'}
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
