/**
 * 首次使用引导向导
 * 核心步骤：语言 → 主题 → 工作区 → 完成
 * AI 模型配置为可选项，可在完成页或稍后设置中配置
 */

import { api } from '@renderer/adapters/electronBridge'
import React, { useState, useEffect } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import {
  ChevronRight, ChevronLeft, Check, Sparkles, Palette,
  Globe, Cpu, FolderOpen, Rocket, Eye, EyeOff, Settings,
  Monitor, Lock as LockIcon, Smartphone, ShieldCheck,
  AlertCircle, Loader2, Sun, Moon
} from 'lucide-react'
import { useStore, LLMConfig } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { Language } from '@renderer/i18n'
import { themeManager } from '@renderer/config/themeDefinition'
import { THEME_COLOR_OPTIONS } from '@renderer/config/themeDefinition'
import type { ThemeColor } from '@/renderer/state/slices/themeSlice'
import { PROVIDERS } from '@configuration/aiProviders'
import { LLM_DEFAULTS } from '@shared/configuration/defaultProfile'
import { DEFAULT_SCENARIO_PREFERENCES } from '@shared/configuration/preferenceSchema'
import { Logo } from '@components/foundation/BrandMark'
import { workspaceManager } from '@services/WorkspaceAdapter'
import { ActionButton, TextField, DropdownSelector } from '@components/ui'
import { motion, AnimatePresence, Variants } from 'framer-motion'

interface OnboardingWizardProps {
  onComplete: () => void
}

/**
 * 引导步骤顺序：
 * 1. welcome    — 欢迎页（品牌展示）
 * 2. auth       — 登录/注册（可跳过，支持本地模式）
 * 3. language   — 选择界面语言
 * 4. theme      — 选择主题
 * 5. workspace  — 选择工作区目录（必选）
 * 6. complete   — 完成确认
 */
type Step = 'welcome' | 'auth' | 'language' | 'theme' | 'workspace' | 'complete'

const STEPS: Step[] = ['welcome', 'auth', 'language', 'theme', 'workspace', 'complete']

const LANGUAGES: { id: Language; name: string; native: string }[] = [
  { id: 'en', name: 'English', native: 'English' },
  { id: 'zh', name: 'Chinese', native: '中文' },
]

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const { set, language, workspacePath } = useStore(useShallow(s => ({ set: s.set, language: s.language, workspacePath: s.workspacePath })))

  const [currentStep, setCurrentStep] = useState<Step>('welcome')
  // 默认中文：首次安装时 language 可能为 undefined 或 'en'，引导界面强制默认中文
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language || 'zh')
  // 主题拆分为「模式」+「颜色」两个维度，更符合用户心智
  // 初始值从当前主题反解，确保进入引导时保持已有主题
  const [themeMode, setThemeMode] = useState<'light' | 'dark' | 'system'>(
    () => {
      const currentId = themeManager.getCurrentTheme().id
      if (currentId.endsWith('-light')) return 'light'
      if (currentId.endsWith('-dark')) {
        // 若系统当前偏好暗色，且主题为暗色，默认显示「跟随系统」更友好
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'system' : 'dark'
      }
      return 'light'
    }
  )
  const [themeColor, setThemeColor] = useState<ThemeColor>(
    () => themeManager.resolveColorFromThemeId(themeManager.getCurrentTheme().id)
  )
  const [providerConfig, setProviderConfig] = useState<LLMConfig>({
    provider: 'openai',
    model: 'gpt-4o',
    apiKey: '',
    temperature: LLM_DEFAULTS.temperature,
    topP: LLM_DEFAULTS.topP,
    maxTokens: LLM_DEFAULTS.maxTokens,
  })
  const [showApiKey, setShowApiKey] = useState(false)
  const [showProviderSetup, setShowProviderSetup] = useState(false)
  const [direction, setDirection] = useState(0)
  const [isExiting, setIsExiting] = useState(false)
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState<string | null>(null)

  const currentStepIndex = STEPS.indexOf(currentStep)
  const isZh = selectedLanguage === 'zh'

  // 工作区步骤必选：未选择目录时禁用「下一步」按钮
  const canProceed = currentStep !== 'workspace' || !!workspacePath

  // 预计算默认工作区路径
  useEffect(() => {
    api.settings.getUserDataPath().then((userDataPath: string) => {
      // 默认工作区在用户数据目录下的 projects 文件夹
      const path = require('path') as typeof import('path')
      setDefaultWorkspacePath(path.join(userDataPath, 'projects'))
    }).catch(() => {})
  }, [])

  // 主题模式或颜色变化时，解析为具体 themeId 并应用
  useEffect(() => {
    const resolved = themeManager.resolveThemeByModeAndColor(themeMode, themeColor)
    themeManager.setTheme(resolved.id)
  }, [themeMode, themeColor])

  const goNext = () => {
    if (currentStepIndex < STEPS.length - 1) {
      setDirection(1)
      setCurrentStep(STEPS[currentStepIndex + 1])
    }
  }

  const goPrev = () => {
    if (currentStepIndex > 0) {
      setDirection(-1)
      setCurrentStep(STEPS[currentStepIndex - 1])
    }
  }

  const handleComplete = async () => {
    const { defaultAgentConfig, defaultAutoApprove, defaultEditorConfig, defaultSecuritySettings, defaultWebSearchConfig, defaultMcpConfig } = await import('@shared/configuration/preferenceSchema')
    const { settingsService } = await import('@renderer/settings/preferencesService')

    // 立即应用到全局 store（包含语言、LLM 配置）
    set('language', selectedLanguage)
    set('llmConfig', providerConfig)
    // 主题：themeManager 已通过 useEffect 应用并持久化到 config
    // 此处同步 themeMode/themeColor 到 store，确保设置页显示与实际一致
    useStore.getState().setThemeMode(themeMode)
    useStore.getState().setThemeColor(themeColor)

    // 同步语言到主进程（影响菜单、系统对话框等原生 UI）
    try {
      window.electronAPI?.setLanguage?.(selectedLanguage)
    } catch (e) {
      logger.settings.error('OnboardingWizard: 同步语言到主进程失败:', e)
    }

    // 无论是否配置 API Key，首次引导都应标记完成，避免重复弹出
    useStore.getState().set('onboardingCompleted', true)

    try {
      await settingsService.save({
        llmConfig: providerConfig,
        language: selectedLanguage,
        autoApprove: defaultAutoApprove,
        agentConfig: defaultAgentConfig,
        providerConfigs: {},
        aiInstructions: '',
        onboardingCompleted: true,
        editorConfig: defaultEditorConfig,
        securitySettings: defaultSecuritySettings,
        webSearchConfig: defaultWebSearchConfig,
        mcpConfig: defaultMcpConfig,
        promptTemplateId: 'default',
        activeScenarioId: 'dev-assistant',
        enableFileLogging: false,
        scenarioPreferences: DEFAULT_SCENARIO_PREFERENCES,
        browserMode: 'normal',
      } as any)

      // 二次确认状态已写入
      useStore.getState().set('onboardingCompleted', true)

      setIsExiting(true)
      setTimeout(onComplete, 500)
    } catch (error) {
      logger.settings.error('Failed to save onboarding settings:', error)
      // 异常路径下仍标记完成，避免界面卡住
      useStore.getState().set('onboardingCompleted', true)
      onComplete()
    }
  }

  const handleOpenFolder = async () => {
    const result = await api.file.openFolder()
    if (result && typeof result === 'string') {
      await workspaceManager.openFolder(result)
    }
  }

  const variants: Variants = {
    enter: (direction: number) => ({
      x: direction > 0 ? 20 : -20,
      opacity: 0,
      scale: 0.98
    }),
    center: {
      zIndex: 1,
      x: 0,
      opacity: 1,
      scale: 1,
      transition: {
        type: "spring",
        stiffness: 350,
        damping: 30
      }
    },
    exit: (direction: number) => ({
      zIndex: 0,
      x: direction < 0 ? 20 : -20,
      opacity: 0,
      scale: 0.98,
      transition: {
        duration: 0.2
      }
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-[9999]"
    >
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{
            scale: [1, 1.2, 1],
            rotate: [0, 90, 0],
          }}
          transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
          className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-accent/5 rounded-full blur-[100px]"
        />
        <motion.div
          animate={{
            scale: [1, 1.1, 1],
            rotate: [0, -45, 0],
          }}
          transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
          className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-purple-500/5 rounded-full blur-[100px]"
        />
      </div>

      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{
          scale: isExiting ? 0.95 : 1,
          opacity: isExiting ? 0 : 1,
          y: 0
        }}
        transition={{ type: "spring", duration: 0.5 }}
        className="relative w-full max-w-2xl mx-4"
      >
        {/* 进度指示器 */}
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2 bg-background-secondary/50 backdrop-blur-md px-4 py-2 rounded-full border border-border shadow-sm">
            {STEPS.slice(0, -1).map((step, index) => (
              <React.Fragment key={step}>
                <motion.div
                  initial={false}
                  animate={{
                    // 已激活/当前步：accent 色；未激活：明确的灰色（rgb(107 114 128) ≈ #6b7280）
                    backgroundColor: index <= currentStepIndex ? 'rgb(var(--accent))' : 'rgb(107 114 128)',
                    scale: index === currentStepIndex ? 1.2 : 1,
                  }}
                  className={`w-2.5 h-2.5 rounded-full`}
                />
                {index < STEPS.length - 2 && (
                  <motion.div
                    initial={false}
                    animate={{
                      // 已完成连接线：accent 半透明；未完成：浅灰色
                      backgroundColor: index < currentStepIndex ? 'rgba(var(--accent), 0.5)' : 'rgba(107, 114, 128, 0.4)',
                    }}
                    className="w-4 h-0.5"
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* 内容卡片 */}
        <div className="bg-background-secondary/90 backdrop-blur-2xl border border-border rounded-3xl shadow-2xl overflow-hidden relative ring-1 ring-white/5 max-h-[85vh] flex flex-col">
          <div className="min-h-[460px] flex flex-col flex-1 overflow-hidden">
            <div className="flex-1 relative p-1 overflow-y-auto overflow-x-hidden">
              <AnimatePresence initial={false} custom={direction} mode="wait">
                <motion.div
                  key={currentStep}
                  custom={direction}
                  variants={variants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="w-full min-h-full"
                >
                  {currentStep === 'welcome' && <WelcomeStep isZh={isZh} />}
                  {currentStep === 'auth' && (
                    <AuthStep isZh={isZh} onComplete={goNext} onSkip={goNext} />
                  )}
                  {currentStep === 'language' && (
                    <LanguageStep isZh={isZh} selectedLanguage={selectedLanguage} onSelect={setSelectedLanguage} />
                  )}
                  {currentStep === 'theme' && (
                    <ThemeStep
                      isZh={isZh}
                      themeMode={themeMode}
                      themeColor={themeColor}
                      onModeChange={setThemeMode}
                      onColorChange={setThemeColor}
                    />
                  )}
                  {currentStep === 'workspace' && (
                    <WorkspaceStep
                      isZh={isZh}
                      workspacePath={workspacePath}
                      onOpenFolder={handleOpenFolder}
                      defaultWorkspacePath={defaultWorkspacePath}
                      onUseDefault={() => {
                        if (defaultWorkspacePath) {
                          workspaceManager.openFolder(defaultWorkspacePath)
                        }
                      }}
                    />
                  )}
                  {currentStep === 'complete' && (
                    <CompleteStep
                      isZh={isZh}
                      selectedLanguage={selectedLanguage}
                      themeMode={themeMode}
                      themeColor={themeColor}
                      workspacePath={workspacePath}
                      providerConfig={providerConfig}
                      showProviderSetup={showProviderSetup}
                      setShowProviderSetup={setShowProviderSetup}
                      setProviderConfig={setProviderConfig}
                      showApiKey={showApiKey}
                      setShowApiKey={setShowApiKey}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>

            {/* 底部导航 */}
            <div className="flex items-center justify-between px-8 py-6 border-t border-border bg-background/20 backdrop-blur-sm">
              <button
                onClick={goPrev}
                disabled={currentStepIndex === 0}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-all duration-200 ${currentStepIndex === 0
                  ? 'opacity-0 pointer-events-none'
                  : 'text-text-muted hover:text-text-primary hover:bg-white/5 active:scale-95'
                  }`}
              >
                <ChevronLeft className="w-4 h-4" />
                {isZh ? '上一步' : 'Back'}
              </button>

              {currentStep === 'complete' ? (
                <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                  <ActionButton
                    onClick={handleComplete}
                    className="flex items-center gap-2 px-8 py-3 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-bold shadow-lg shadow-accent/20 transition-all"
                  >
                    <Rocket className="w-4 h-4" />
                    {isZh ? '开始使用' : 'Get Started'}
                  </ActionButton>
                </motion.div>
              ) : (
                <motion.div
                  whileHover={canProceed ? { scale: 1.02 } : {}}
                  whileTap={canProceed ? { scale: 0.98 } : {}}
                >
                  <ActionButton
                    onClick={goNext}
                    disabled={!canProceed}
                    className={`flex items-center gap-2 px-8 py-3 rounded-xl text-sm font-bold shadow-lg transition-all ${
                      canProceed
                        ? 'bg-accent hover:bg-accent-hover text-white shadow-accent/20'
                        : 'bg-white/5 text-text-muted cursor-not-allowed shadow-none'
                    }`}
                  >
                    {isZh ? '下一步' : 'Next'}
                    <ChevronRight className="w-4 h-4" />
                  </ActionButton>
                </motion.div>
              )}
            </div>
          </div>
        </div>

        {/* 跳过按钮：工作区步骤不允许跳过（必选） */}
        {currentStep !== 'complete' && currentStep !== 'workspace' && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            onClick={handleComplete}
            className="absolute -bottom-14 left-1/2 -translate-x-1/2 text-sm text-text-muted/90 hover:text-text-muted transition-colors flex items-center gap-1.5 py-2 px-4 rounded-full hover:bg-white/5"
          >
            <span>{isZh ? '跳过引导' : 'Skip setup'}</span>
            <ChevronRight className="w-3 h-3" />
          </motion.button>
        )}
      </motion.div>
    </motion.div>
  )
}


// ---------- 各步骤子组件 ----------

function WelcomeStep({ isZh }: { isZh: boolean }) {
  return (
    <div className="px-8 py-12 text-center h-full flex flex-col justify-center">
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        className="mb-8 flex justify-center"
      >
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-accent to-purple-600 rounded-3xl blur opacity-20 group-hover:opacity-40 transition duration-500" />
          <div className="relative w-28 h-28 rounded-2xl bg-gradient-to-br from-surface to-surface-active border border-border flex items-center justify-center shadow-2xl">
            <Logo className="w-16 h-16" glow />
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        <h1 className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-br from-text-primary to-text-muted mb-4 tracking-tight">
          {isZh ? '欢迎使用 AweeClaw' : 'Welcome to AweeClaw'}
        </h1>
        <p className="text-text-muted max-w-lg mx-auto leading-relaxed text-lg mb-2">
          {isZh ? '场景驱动的 AI 应用构建平台' : 'Scenario-driven AI application platform'}
        </p>
        <p className="text-text-muted/85 max-w-sm mx-auto text-sm">
          {isZh
            ? '让我们快速完成几个基础设置，即可开始体验。'
            : 'Let\'s quickly set up the basics and start exploring.'}
        </p>
      </motion.div>

      <div className="mt-12 flex justify-center gap-8 flex-wrap">
        <FeatureItem
          icon={<Sparkles className="w-5 h-5 text-accent" />}
          label={isZh ? '多场景' : 'Multi-Scenario'}
          delay={0.2}
        />
        <FeatureItem
          icon={<Globe className="w-5 h-5 text-purple-400" />}
          label={isZh ? '多渠道' : 'Multi-Channel'}
          delay={0.3}
        />
        <FeatureItem
          icon={<Cpu className="w-5 h-5 text-blue-400" />}
          label={isZh ? '插件生态' : 'Plugin Ecosystem'}
          delay={0.4}
        />
        <FeatureItem
          icon={<Settings className="w-5 h-5 text-emerald-400" />}
          label={isZh ? '灵活定制' : 'Flexible'}
          delay={0.5}
        />
      </div>
    </div>
  )
}

function FeatureItem({ icon, label, delay }: { icon: React.ReactNode, label: string, delay: number }) {
  return (
    <motion.div
      initial={{ y: 10, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ delay }}
      className="flex flex-col items-center gap-3"
    >
      <div className="w-12 h-12 rounded-2xl bg-white/5 border border-border flex items-center justify-center shadow-lg">
        {icon}
      </div>
      <span className="text-sm font-medium text-text-secondary">{label}</span>
    </motion.div>
  )
}


/**
 * 登录/注册步骤
 * - 支持邮箱密码登录、邮箱注册、手机号验证码登录
 * - 支持「跳过，稍后登录」直接进入本地模式
 * - 登录成功或跳过后调用 onComplete/onSkip 进入下一步
 */
function AuthStep({
  isZh,
  onComplete,
  onSkip,
}: {
  isZh: boolean
  onComplete: () => void
  onSkip: () => void
}) {
  const {
    isAuthenticated,
    cloudUser,
    login,
    phoneLogin,
    register,
  } = useStore(useShallow((s) => ({
    isAuthenticated: s.isAuthenticated,
    cloudUser: s.cloudUser,
    login: s.login,
    phoneLogin: s.phoneLogin,
    register: s.register,
  })))

  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [loginMode, setLoginMode] = useState<'email' | 'phone'>('email')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [smsCode, setSmsCode] = useState('')
  const [codeCooldown, setCodeCooldown] = useState(0)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 登录成功后自动进入下一步
  useEffect(() => {
    if (isAuthenticated && cloudUser) {
      onComplete()
    }
  }, [isAuthenticated, cloudUser, onComplete])

  // 验证码倒计时
  useEffect(() => {
    if (codeCooldown <= 0) return
    const timer = setInterval(() => {
      setCodeCooldown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [codeCooldown])

  const handleSendCode = async () => {
    if (codeCooldown > 0 || !/^1[3-9]\d{9}$/.test(phone)) return
    try {
      const { backendApi } = await import('@services/backendApi')
      await backendApi.post('/api/v1/sms/send-code', { phone, purpose: 'login' })
      setCodeCooldown(60)
    } catch (e) {
      setError(isZh ? '验证码发送失败，请稍后重试' : 'Failed to send code, please try again')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const url = useStore.getState().serverUrl
      if (mode === 'register') {
        if (!email || !password) {
          setError(isZh ? '请填写邮箱和密码' : 'Please fill in email and password')
          return
        }
        await register(url, email, password, username || undefined)
      } else if (loginMode === 'phone') {
        if (!phone || !smsCode) {
          setError(isZh ? '请填写手机号和验证码' : 'Please fill in phone and code')
          return
        }
        await phoneLogin(url, phone, smsCode)
      } else {
        if (!email || !password) {
          setError(isZh ? '请填写邮箱和密码' : 'Please fill in email and password')
          return
        }
        await login(url, email, password)
      }
      // 登录成功后由 useEffect 监听 isAuthenticated 触发 onComplete
    } catch (err) {
      const errorObj = err as { status?: number; message?: string }
      if (errorObj?.status === 401) {
        setError(isZh ? '邮箱或密码错误' : 'Invalid email or password')
      } else if (errorObj?.status === 409) {
        setError(isZh ? '该邮箱已注册' : 'Email already registered')
      } else if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
        setError(isZh ? '无法连接到服务器，请检查网络或跳过稍后登录' : 'Cannot connect to server, check network or skip')
      } else {
        setError(errorObj?.message || (isZh ? '请求失败，请稍后重试' : 'Request failed, try again'))
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="px-10 py-10 h-full flex flex-col">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Sparkles className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-text-primary">
            {isZh ? '登录 / 注册' : 'Sign In / Register'}
          </h2>
          <p className="text-text-muted mt-1">
            {isZh ? '登录云端以同步配置和额度，或跳过使用本地模式' : 'Sign in to sync config and quota, or skip for local mode'}
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex-1 flex flex-col gap-4 max-w-md mx-auto w-full">
        {/* 模式切换：登录 / 注册 */}
        <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-border">
          <button
            type="button"
            onClick={() => { setMode('login'); setError('') }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'login' ? 'bg-accent text-white shadow' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {isZh ? '登录' : 'Sign In'}
          </button>
          <button
            type="button"
            onClick={() => { setMode('register'); setError('') }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              mode === 'register' ? 'bg-accent text-white shadow' : 'text-text-muted hover:text-text-primary'
            }`}
          >
            {isZh ? '注册' : 'Register'}
          </button>
        </div>

        {/* 注册时的用户名 */}
        {mode === 'register' && (
          <div className="relative">
            <Settings className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={isZh ? '用户名（可选）' : 'Username (optional)'}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        )}

        {/* 登录模式切换：邮箱 / 手机号 */}
        {mode === 'login' && (
          <div className="flex gap-2 text-xs">
            <button
              type="button"
              onClick={() => { setLoginMode('email'); setError('') }}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                loginMode === 'email' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {isZh ? '邮箱登录' : 'Email'}
            </button>
            <button
              type="button"
              onClick={() => { setLoginMode('phone'); setError('') }}
              className={`px-3 py-1.5 rounded-lg transition-colors ${
                loginMode === 'phone' ? 'bg-accent/10 text-accent' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              {isZh ? '手机号登录' : 'Phone'}
            </button>
          </div>
        )}

        {/* 邮箱输入 */}
        {(mode === 'register' || loginMode === 'email') && (
          <div className="relative">
            <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isZh ? '邮箱地址' : 'Email address'}
              className="w-full pl-10 pr-4 py-3 bg-white/5 border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
            />
          </div>
        )}

        {/* 密码输入 */}
        {(mode === 'register' || loginMode === 'email') && (
          <div className="relative">
            <LockIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isZh ? '密码' : 'Password'}
              className="w-full pl-10 pr-10 py-3 bg-white/5 border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        )}

        {/* 手机号 + 验证码 */}
        {mode === 'login' && loginMode === 'phone' && (
          <>
            <div className="relative">
              <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={isZh ? '手机号' : 'Phone number'}
                className="w-full pl-10 pr-4 py-3 bg-white/5 border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
              />
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  value={smsCode}
                  onChange={(e) => setSmsCode(e.target.value)}
                  placeholder={isZh ? '验证码' : 'Verification code'}
                  className="w-full pl-10 pr-4 py-3 bg-white/5 border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <button
                type="button"
                onClick={handleSendCode}
                disabled={codeCooldown > 0 || !/^1[3-9]\d{9}$/.test(phone)}
                className="px-4 py-3 bg-white/5 border border-border rounded-xl text-sm text-text-muted hover:text-text-primary hover:border-accent/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {codeCooldown > 0
                  ? `${codeCooldown}s`
                  : (isZh ? '获取验证码' : 'Send code')}
              </button>
            </div>
          </>
        )}

        {/* 错误提示 */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        {/* 提交按钮 */}
        <motion.button
          type="submit"
          whileHover={{ scale: 1.01 }}
          whileTap={{ scale: 0.99 }}
          disabled={loading}
          className="w-full py-3 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-bold shadow-lg shadow-accent/20 transition-all disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {mode === 'register'
            ? (isZh ? '注册并登录' : 'Register & Sign In')
            : (isZh ? '登录' : 'Sign In')}
        </motion.button>

        {/* 跳过：直接进入本地模式 */}
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-text-muted hover:text-text-primary transition-colors flex items-center justify-center gap-1.5 mt-2"
        >
          <span>{isZh ? '跳过，稍后登录（本地模式）' : 'Skip, sign in later (local mode)'}</span>
          <ChevronRight className="w-3 h-3" />
        </button>
      </form>
    </div>
  )
}


function LanguageStep({
  isZh,
  selectedLanguage,
  onSelect
}: {
  isZh: boolean
  selectedLanguage: Language
  onSelect: (lang: Language) => void
}) {
  return (
    <div className="px-12 py-10 h-full flex flex-col">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Globe className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-text-primary">
            {isZh ? '语言偏好' : 'Language Preference'}
          </h2>
          <p className="text-text-muted mt-1">
            {isZh ? '选择界面语言' : 'Choose your interface language'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mt-4 flex-1">
        {LANGUAGES.map((lang, index) => (
          <motion.button
            key={lang.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={() => onSelect(lang.id)}
            className={`relative p-8 rounded-3xl border-2 text-left transition-all duration-300 group flex flex-col justify-center gap-2 ${selectedLanguage === lang.id
              ? 'border-accent bg-accent/5 shadow-xl shadow-accent/5'
              : 'border-border hover:border-accent/30 bg-white/5 hover:bg-white/10'
              }`}
          >
            <div className="text-5xl mb-4 group-hover:scale-110 transition-transform duration-500 ease-out origin-left">
              {lang.id === 'zh' ? '🇨🇳' : '🇺🇸'}
            </div>
            <div className="font-bold text-text-primary text-xl">{lang.native}</div>
            <div className="text-text-muted font-medium">{lang.name}</div>
            {selectedLanguage === lang.id && (
              <motion.div
                layoutId="lang-check"
                className="absolute top-6 right-6 w-8 h-8 rounded-full bg-accent flex items-center justify-center shadow-lg shadow-accent/30"
              >
                <Check className="w-5 h-5 text-white" />
              </motion.div>
            )}
          </motion.button>
        ))}
      </div>
    </div>
  )
}


function ThemeStep({
  isZh,
  themeMode,
  themeColor,
  onModeChange,
  onColorChange,
}: {
  isZh: boolean
  themeMode: 'light' | 'dark' | 'system'
  themeColor: ThemeColor
  onModeChange: (mode: 'light' | 'dark' | 'system') => void
  onColorChange: (color: ThemeColor) => void
}) {
  const modes: { id: 'light' | 'dark' | 'system'; labelZh: string; labelEn: string; icon: React.ReactNode }[] = [
    { id: 'light', labelZh: '亮色', labelEn: 'Light', icon: <Sun className="w-5 h-5" /> },
    { id: 'dark', labelZh: '暗色', labelEn: 'Dark', icon: <Moon className="w-5 h-5" /> },
    { id: 'system', labelZh: '跟随系统', labelEn: 'System', icon: <Monitor className="w-5 h-5" /> },
  ]

  // 用当前选择解析出预览主题，确保预览与实际效果一致
  const previewTheme = themeManager.resolveThemeByModeAndColor(themeMode, themeColor)

  return (
    <div className="px-10 py-10 h-full flex flex-col">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Palette className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-text-primary">
            {isZh ? '选择主题' : 'Choose Theme'}
          </h2>
          <p className="text-text-muted mt-1">
            {isZh ? '选择外观模式与配色，可随时在设置中更改' : 'Pick a mode and color, changeable in settings'}
          </p>
        </div>
      </div>

      {/* 上半部分：模式选择（亮色 / 暗色 / 跟随系统） */}
      <div className="mb-6">
        <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
          {isZh ? '外观模式' : 'Appearance Mode'}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {modes.map((mode, index) => {
            const active = themeMode === mode.id
            return (
              <motion.button
                key={mode.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onModeChange(mode.id)}
                className={`relative p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col items-center gap-2 ${
                  active
                    ? 'border-accent bg-accent/5 shadow-lg shadow-accent/10'
                    : 'border-border hover:border-accent/30 bg-white/5'
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${active ? 'bg-accent/10 text-accent' : 'bg-white/5 text-text-muted'}`}>
                  {mode.icon}
                </div>
                <span className={`text-sm font-bold ${active ? 'text-accent' : 'text-text-primary'}`}>
                  {isZh ? mode.labelZh : mode.labelEn}
                </span>
                {active && (
                  <motion.div
                    layoutId="theme-mode-check"
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-accent flex items-center justify-center shadow-lg ring-4 ring-background"
                  >
                    <Check className="w-3.5 h-3.5 text-white" />
                  </motion.div>
                )}
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* 下半部分：颜色选择（蓝 / 紫 / 橙 / 绿） */}
      <div className="mb-2">
        <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
          {isZh ? '主题配色' : 'Accent Color'}
        </div>
        <div className="grid grid-cols-4 gap-3">
          {THEME_COLOR_OPTIONS.map((opt, index) => {
            const active = themeColor === opt.value
            // 通过 ColorTheme 拿到当前模式下的 accent 色，用于色块预览
            const colorTheme = themeManager.getColorThemeByColor(opt.value)
            const resolvedColors = themeMode === 'light' ? colorTheme?.lightColors : colorTheme?.darkColors
            const accentRgb = resolvedColors?.accent || '14 165 233'
            return (
              <motion.button
                key={opt.value}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onColorChange(opt.value)}
                className={`relative p-3 rounded-2xl border-2 transition-all duration-300 flex flex-col items-center gap-2 ${
                  active
                    ? 'border-accent bg-accent/5 shadow-lg shadow-accent/10'
                    : 'border-border hover:border-accent/30 bg-white/5'
                }`}
              >
                <div
                  className="w-10 h-10 rounded-full shadow-inner"
                  style={{ backgroundColor: `rgb(${accentRgb})` }}
                />
                <span className={`text-xs font-bold ${active ? 'text-accent' : 'text-text-primary'}`}>
                  {isZh ? opt.labelZh : opt.labelEn}
                </span>
                {active && (
                  <motion.div
                    layoutId="theme-color-check"
                    className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-accent flex items-center justify-center shadow-lg ring-4 ring-background"
                  >
                    <Check className="w-3.5 h-3.5 text-white" />
                  </motion.div>
                )}
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* 实时预览缩略图 */}
      <div className="mt-auto pt-4">
        <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
          {isZh ? '预览' : 'Preview'}
        </div>
        <div
          className="h-20 rounded-xl border border-border overflow-hidden shadow-sm flex"
          style={{ backgroundColor: `rgb(${previewTheme.colors.background})` }}
        >
          <div
            className="w-1/4 border-r border-border flex flex-col items-center justify-center gap-1.5"
            style={{ backgroundColor: `rgb(${previewTheme.colors.backgroundSecondary})` }}
          >
            <div className="w-6 h-1.5 rounded" style={{ backgroundColor: `rgb(${previewTheme.colors.textMuted})` }} />
            <div className="w-6 h-1.5 rounded" style={{ backgroundColor: `rgb(${previewTheme.colors.accent})` }} />
            <div className="w-6 h-1.5 rounded" style={{ backgroundColor: `rgb(${previewTheme.colors.textMuted})`, opacity: 0.5 }} />
          </div>
          <div className="flex-1 p-2.5 flex flex-col gap-1.5 justify-center">
            <div className="w-1/3 h-2 rounded" style={{ backgroundColor: `rgb(${previewTheme.colors.textPrimary})`, opacity: 0.9 }} />
            <div className="w-2/3 h-1.5 rounded" style={{ backgroundColor: `rgb(${previewTheme.colors.textMuted})`, opacity: 0.6 }} />
            <div className="w-1/2 h-1.5 rounded" style={{ backgroundColor: `rgb(${previewTheme.colors.textMuted})`, opacity: 0.4 }} />
            <div className="flex gap-1.5 mt-1">
              <div className="px-2 py-0.5 rounded text-[8px] font-bold" style={{ backgroundColor: `rgb(${previewTheme.colors.accent})`, color: `rgb(${previewTheme.colors.accentForeground})` }}>
                {isZh ? '按钮' : 'Button'}
              </div>
              <div className="px-2 py-0.5 rounded text-[8px] border" style={{ borderColor: `rgb(${previewTheme.colors.border})`, color: `rgb(${previewTheme.colors.textMuted})` }}>
                {isZh ? '取消' : 'Cancel'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


function WorkspaceStep({
  isZh,
  workspacePath,
  onOpenFolder,
  defaultWorkspacePath,
  onUseDefault,
}: {
  isZh: boolean
  workspacePath: string | null
  onOpenFolder: () => void
  defaultWorkspacePath: string | null
  onUseDefault: () => void
}) {
  return (
    <div className="px-10 py-10 h-full flex flex-col">
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <FolderOpen className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-text-primary">
            {isZh ? '工作区目录' : 'Workspace Directory'}
          </h2>
          <p className="text-text-muted mt-1">
            {isZh ? '选择项目文件的存放位置（必选）' : 'Choose where to store your project files (required)'}
          </p>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center gap-6">
        {workspacePath ? (
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="text-center w-full max-w-md"
          >
            <div className="w-24 h-24 rounded-[2rem] bg-gradient-to-br from-status-success/20 to-status-success/5 flex items-center justify-center mb-6 mx-auto shadow-xl shadow-status-success/10 border border-status-success/20 relative">
              <div className="absolute inset-0 rounded-[2rem] blur-xl bg-status-success/20 -z-10" />
              <Check className="w-12 h-12 text-status-success" />
            </div>
            <h3 className="text-text-primary font-bold text-xl mb-3">{isZh ? '工作区已就绪' : 'Workspace Ready'}</h3>
            <div className="text-sm text-text-muted font-mono bg-white/5 px-6 py-4 rounded-2xl border border-border break-all shadow-inner">
              {workspacePath}
            </div>
            <button
              onClick={onOpenFolder}
              className="mt-6 text-sm text-accent hover:text-accent-hover font-medium transition-colors flex items-center gap-1 mx-auto hover:underline"
            >
              <span>{isZh ? '更换目录' : 'Change directory'}</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </motion.div>
        ) : (
          <>
            {/* 默认目录选项 */}
            {defaultWorkspacePath && (
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                whileHover={{ scale: 1.01, borderColor: 'rgba(var(--accent), 0.4)' }}
                whileTap={{ scale: 0.99 }}
                onClick={onUseDefault}
                className="w-full max-w-md p-5 rounded-2xl border-2 border-border bg-white/5 hover:bg-white/8 transition-all text-left group"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 transition-colors">
                    <Monitor className="w-6 h-6 text-accent" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-text-primary text-sm mb-1">
                      {isZh ? '使用默认目录' : 'Use Default Directory'}
                    </div>
                    <div className="text-xs text-text-muted font-mono truncate">
                      {defaultWorkspacePath}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors shrink-0" />
                </div>
              </motion.button>
            )}

            {/* 自定义目录选项 */}
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              whileHover={{ scale: 1.01, backgroundColor: 'rgba(255,255,255,0.08)' }}
              whileTap={{ scale: 0.98 }}
              onClick={onOpenFolder}
              className="w-full max-w-md aspect-[5/2] rounded-2xl border-2 border-dashed border-border bg-white/5 hover:border-accent/50 transition-all duration-300 flex flex-col items-center justify-center gap-3 group"
            >
              <div className="w-14 h-14 rounded-xl bg-white/5 flex items-center justify-center group-hover:scale-110 transition-transform duration-300 group-hover:bg-accent/10">
                <FolderOpen className="w-7 h-7 text-text-muted group-hover:text-accent transition-colors" />
              </div>
              <span className="text-base font-bold text-text-muted group-hover:text-text-primary transition-colors">
                {isZh ? '选择自定义目录' : 'Choose Custom Directory'}
              </span>
            </motion.button>

            <p className="text-xs text-text-muted opacity-60">
              {isZh ? '请选择一个工作区目录以继续' : 'Please choose a workspace directory to continue'}
            </p>
          </>
        )}
      </div>
    </div>
  )
}


function CompleteStep({
  isZh,
  selectedLanguage,
  themeMode,
  themeColor,
  workspacePath,
  providerConfig,
  showProviderSetup,
  setShowProviderSetup,
  setProviderConfig,
  showApiKey,
  setShowApiKey,
}: {
  isZh: boolean
  selectedLanguage: Language
  themeMode: 'light' | 'dark' | 'system'
  themeColor: ThemeColor
  workspacePath: string | null
  providerConfig: LLMConfig
  showProviderSetup: boolean
  setShowProviderSetup: (v: boolean) => void
  setProviderConfig: (c: LLMConfig) => void
  showApiKey: boolean
  setShowApiKey: (v: boolean) => void
}) {
  // 主题摘要：模式 + 颜色
  const modeLabelZh = themeMode === 'light' ? '亮色' : themeMode === 'dark' ? '暗色' : '跟随系统'
  const modeLabelEn = themeMode === 'light' ? 'Light' : themeMode === 'dark' ? 'Dark' : 'System'
  const colorOpt = THEME_COLOR_OPTIONS.find(o => o.value === themeColor)
  const themeSummary = `${isZh ? modeLabelZh : modeLabelEn} / ${isZh ? colorOpt?.labelZh : colorOpt?.labelEn}`
  const langName = LANGUAGES.find(l => l.id === selectedLanguage)?.native || selectedLanguage

  return (
    <div className="px-10 py-10 min-h-full flex flex-col overflow-y-auto">
      {/* 成功标记 */}
      <div className="text-center mb-6">
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 200, damping: 15 }}
          className="mb-4 inline-block relative"
        >
          <div className="w-20 h-20 rounded-full bg-gradient-to-br from-status-success to-emerald-600 flex items-center justify-center shadow-2xl shadow-status-success/30">
            <Check className="w-10 h-10 text-white" />
          </div>
          <motion.div
            animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute inset-0 bg-status-success rounded-full -z-10"
          />
        </motion.div>
        <h2 className="text-2xl font-bold text-text-primary mb-2">
          {isZh ? '设置完成！' : 'Setup Complete!'}
        </h2>
        <p className="text-text-muted text-sm">
          {isZh ? '基础设置已完成，AweeClaw 已准备就绪。' : 'Basic setup is done. AweeClaw is ready for you.'}
        </p>
      </div>

      {/* 配置摘要 */}
      <div className="bg-white/5 rounded-2xl p-4 border border-border mb-4">
        <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
          {isZh ? '配置摘要' : 'Configuration Summary'}
        </div>
        <div className="space-y-2.5">
          <SummaryRow
            icon={<Globe className="w-4 h-4" />}
            label={isZh ? '界面语言' : 'Language'}
            value={langName}
          />
          <SummaryRow
            icon={<Palette className="w-4 h-4" />}
            label={isZh ? '主题' : 'Theme'}
            value={themeSummary}
          />
          <SummaryRow
            icon={<FolderOpen className="w-4 h-4" />}
            label={isZh ? '工作区' : 'Workspace'}
            value={workspacePath || (isZh ? '稍后选择' : 'Select later')}
          />
          <SummaryRow
            icon={<Cpu className="w-4 h-4" />}
            label={isZh ? 'AI 模型' : 'AI Model'}
            value={providerConfig.apiKey
              ? `${providerConfig.provider} / ${providerConfig.model}`
              : (isZh ? '未配置' : 'Not configured')}
            accent={!providerConfig.apiKey}
          />
        </div>
      </div>

      {/* 可选：AI 模型配置 */}
      {showProviderSetup && (
        <ProviderSetupPanel
          isZh={isZh}
          config={providerConfig}
          setConfig={setProviderConfig}
          showApiKey={showApiKey}
          setShowApiKey={setShowApiKey}
        />
      )}

      {!showProviderSetup && !providerConfig.apiKey && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          onClick={() => setShowProviderSetup(true)}
          className="w-full p-3 rounded-xl border border-dashed border-accent/30 bg-accent/5 hover:bg-accent/10 text-sm text-accent font-medium flex items-center justify-center gap-2 transition-colors mb-4"
        >
          <Cpu className="w-4 h-4" />
          {isZh ? '配置 AI 模型（可选）' : 'Configure AI Model (Optional)'}
        </motion.button>
      )}

      {/* 提示 */}
      <div className="mt-auto pt-4 border-t border-border flex items-center justify-between text-xs text-text-muted">
        <span>{isZh ? '其他设置可在设置中探索' : 'Explore more in Settings'}</span>
        <div className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-black/20 rounded border border-border font-mono text-text-muted text-[10px]">Ctrl</kbd>
          <span>+</span>
          <kbd className="px-1.5 py-0.5 bg-black/20 rounded border border-border font-mono text-text-muted text-[10px]">,</kbd>
        </div>
      </div>
    </div>
  )
}

function SummaryRow({ icon, label, value, accent }: {
  icon: React.ReactNode
  label: string
  value: string
  accent?: boolean
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <div className="text-text-muted shrink-0">{icon}</div>
      <span className="text-text-muted shrink-0 w-16">{label}</span>
      <span className={`truncate ${accent ? 'text-amber-400' : 'text-text-primary'}`}>{value}</span>
    </div>
  )
}

function ProviderSetupPanel({
  isZh,
  config,
  setConfig,
  showApiKey,
  setShowApiKey,
}: {
  isZh: boolean
  config: LLMConfig
  setConfig: (c: LLMConfig) => void
  showApiKey: boolean
  setShowApiKey: (v: boolean) => void
}) {
  const providers = Object.values(PROVIDERS).filter(p => p.id !== 'custom')
  const selectedProvider = PROVIDERS[config.provider]

  return (
    <div className="bg-white/5 rounded-2xl p-4 border border-border mb-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 text-accent" />
          <span className="text-xs font-bold text-text-muted uppercase tracking-wider">
            {isZh ? 'AI 模型配置' : 'AI Model Configuration'}
          </span>
        </div>
      </div>

      <div className="space-y-3">
        <div className="grid grid-cols-4 gap-2">
          {providers.map(p => (
            <button
              key={p.id}
              onClick={() => setConfig({
                ...config,
                provider: p.id,
                model: p.models[0],
                baseUrl: undefined,
              })}
              className={`px-2 py-2.5 rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1.5 ${config.provider === p.id
                ? 'border-accent bg-accent/10 text-accent ring-1 ring-accent/50'
                : 'border-border hover:border-white/20 text-text-muted bg-white/5'
              }`}
            >
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-sm font-bold ${config.provider === p.id ? 'bg-accent text-white' : 'bg-white/10'}`}>
                {p.displayName[0]}
              </div>
              <span className="truncate w-full text-center">{p.displayName}</span>
            </button>
          ))}
        </div>

        {selectedProvider && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider ml-1">
              {isZh ? '模型' : 'Model'}
            </label>
            <DropdownSelector
              value={config.model}
              onChange={(value) => setConfig({ ...config, model: value })}
              options={selectedProvider.models.map(m => ({ value: m, label: m }))}
              className="w-full bg-white/5 border-border hover:border-accent/50 transition-colors py-1.5 text-sm"
            />
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-text-muted uppercase tracking-wider ml-1">
            API Key
          </label>
          <div className="relative">
            <TextField
              type={showApiKey ? 'text' : 'password'}
              value={config.apiKey}
              onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
              placeholder={selectedProvider?.auth.placeholder || 'sk-...'}
              className="w-full pr-10 bg-white/5 border-border focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all py-2 text-sm"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors p-1"
            >
              {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          {selectedProvider?.auth.helpUrl && (
            <div className="flex justify-end">
              <a
                href={selectedProvider.auth.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[11px] text-accent hover:text-accent-hover hover:underline inline-flex items-center gap-1 transition-colors"
                onClick={(e) => { e.preventDefault(); api.file.openExternalUrl(selectedProvider.auth.helpUrl!) }}
              >
                <span>{isZh ? '获取 API Key' : 'Get API Key'}</span>
                <ChevronRight className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
