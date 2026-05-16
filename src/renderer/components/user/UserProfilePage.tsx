import { useState, useCallback } from 'react'
import {
  User,
  Crown,
  ShieldCheck,
  X,
  UserCircle,
} from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { type ProfileTab, type Language } from './tabs'
import { PlanPanel } from './tabs/PlanPanel'
import { ProfilePanel } from './tabs/ProfilePanel'
import { SecurityPanel } from './tabs/SecurityPanel'

const tabs: { id: ProfileTab; icon: React.ReactNode; labelZh: string; labelEn: string }[] = [
  { id: 'plan', icon: <Crown className="w-4 h-4" />, labelZh: '套餐管理', labelEn: 'Plan' },
  { id: 'profile', icon: <User className="w-4 h-4" />, labelZh: '个人信息', labelEn: 'Profile' },
  { id: 'security', icon: <ShieldCheck className="w-4 h-4" />, labelZh: '账号安全', labelEn: 'Security' },
]

export default function UserProfilePage() {
  const { language, setShowUserProfilePage } = useStore(useShallow(s => ({
    language: s.language,
    setShowUserProfilePage: s.setShowUserProfilePage,
  })))

  const [activeTab, setActiveTab] = useState<ProfileTab>('plan')
  const [securityInitialSection, setSecurityInitialSection] = useState<'email' | 'phone' | null>(null)

  const handleClose = useCallback(() => {
    setShowUserProfilePage(false)
  }, [setShowUserProfilePage])

  return (
    <div className="flex h-full">
      <div className="bg-surface/30 backdrop-blur-xl flex flex-col pt-8 pb-6 w-56">
        <div className="px-6 mb-6">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20">
              <UserCircle className="w-5 h-5 text-accent" />
            </div>
            {language === 'zh' ? '用户中心' : 'Account'}
          </h2>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 group ${
                activeTab === tab.id
                  ? 'bg-accent/10 text-text-primary border border-accent/20'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'
              }`}
            >
              <span className={`transition-colors duration-200 ${activeTab === tab.id ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}>
                {tab.icon}
              </span>
              <span>{language === 'zh' ? tab.labelZh : tab.labelEn}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="flex-1 flex justify-center overflow-hidden">
        <div className="w-full max-w-[1000px] flex flex-col min-w-0 bg-transparent relative">
          <div className="shrink-0 px-8 pt-6 pb-4 border-b border-border/40 flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
                {tabs.find(t => t.id === activeTab)?.[language === 'zh' ? 'labelZh' : 'labelEn']}
              </h3>
              <p className="text-sm text-text-muted mt-1.5 opacity-80">
                {language === 'zh' ? '管理您的账号信息' : 'Manage your account'}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="p-2 rounded-xl hover:bg-text-primary/[0.05] text-text-muted hover:text-text-primary transition-all duration-200 group"
              title={language === 'zh' ? '关闭' : 'Close'}
            >
              <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar pb-28">
            <div className="space-y-6">
              {activeTab === 'plan' && <PlanPanel key="plan" language={language as Language} />}
              {activeTab === 'profile' && <ProfilePanel key="profile" language={language as Language} onSwitchToSecurity={(section) => { setActiveTab('security'); setSecurityInitialSection(section) }} />}
              {activeTab === 'security' && <SecurityPanel key="security" language={language as Language} initialSection={securityInitialSection} onSectionConsumed={() => setSecurityInitialSection(null)} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
