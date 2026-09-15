/**
 * 首次使用引导向导
 * 核心步骤：欢迎 → 登录/注册 → 语言 → 主题 → 工作区 → AI模型 → 完成
 * AI 模型配置为独立步骤，支持云端/自定义两种模式
 *
 * 注意：此组件为应用级通用组件，由 GlobalOverlays 直接懒加载导入，
 * 不依赖任何具体场景，避免场景被删除时引导功能失效。
 */

import { api } from '@renderer/adapters/electronBridge'
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import {
  ChevronRight, ChevronLeft, Check, Sparkles, Palette,
  Globe, Cpu, FolderOpen, Rocket, Eye, EyeOff, Settings,
  Monitor, Lock as LockIcon, Smartphone, ShieldCheck,
  AlertCircle, Loader2, Sun, Moon, RefreshCw, CloudOff, Search,
  ExternalLink, Key, ChevronDown
} from 'lucide-react'
import { useStore, LLMConfig } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { Language } from '@renderer/i18n'
import { themeManager } from '@renderer/config/themeDefinition'
import { THEME_COLOR_OPTIONS } from '@renderer/config/themeDefinition'
import type { ThemeColor } from '@/renderer/state/slices/themeSlice'
import { PROVIDERS } from '@configuration/aiProviders'
import { LLM_DEFAULTS } from '@shared/configuration/defaultProfile'
import { DEFAULT_SCENARIO_PREFERENCES, defaultWebSearchConfig } from '@shared/configuration/preferenceSchema'
import { BUILTIN_SEARCH_ENGINES } from '@shared/configuration/searchProviders'
import type { WebSearchConfig } from '@shared/configuration/configTypes'
import { Logo } from '@components/foundation/BrandMark'
import { workspaceManager } from '@services/WorkspaceAdapter'
import { ActionButton, TextField, DropdownSelector } from '@components/ui'
import { ProviderIcon } from '@components/ui/ProviderIcon'
import { fetchModelsCall } from '@services/providerHealthAdapter'
import { getTokens } from '@services/backendApi'
import type { CloudProviderModel } from '@store/slices/authSlice'
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
 * 6. model      — AI 模型配置（云端 / 自定义，支持跳过）
 * 7. search     — 搜索引擎选择（可跳过，默认 Bing，国内可直接访问）
 * 8. complete   — 完成确认
 */
type Step = 'welcome' | 'auth' | 'language' | 'theme' | 'workspace' | 'model' | 'search' | 'complete'

const STEPS: Step[] = ['welcome', 'auth', 'language', 'theme', 'workspace', 'model', 'search', 'complete']

/** AI 模型配置模式：cloud=云端代理，custom=自定义直连 */
type ModelMode = 'cloud' | 'custom'

const LANGUAGES: { id: Language; name: string; native: string }[] = [
  { id: 'en', name: 'English', native: 'English' },
  { id: 'zh', name: 'Chinese', native: '中文' },
]

export default function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const {
    set,
    language,
    workspacePath,
    isAuthenticated,
    cloudModels,
    serverUrl,
    setCloudMode,
    fetchCloudModels,
    selectCloudModel,
  } = useStore(useShallow(s => ({
    set: s.set,
    language: s.language,
    workspacePath: s.workspacePath,
    isAuthenticated: s.isAuthenticated,
    cloudModels: s.cloudModels,
    serverUrl: s.serverUrl,
    setCloudMode: s.setCloudMode,
    fetchCloudModels: s.fetchCloudModels,
    selectCloudModel: s.selectCloudModel,
  })))

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
    model: '',
    apiKey: '',
    temperature: LLM_DEFAULTS.temperature,
    topP: LLM_DEFAULTS.topP,
    maxTokens: LLM_DEFAULTS.maxTokens,
  })
  const [showApiKey, setShowApiKey] = useState(false)
  // AI 模型配置步骤：模式（云端 / 自定义）、动态拉取的模型列表、是否正在拉取、模型搜索词
  const [modelMode, setModelMode] = useState<ModelMode>('cloud')
  const [fetchedModels, setFetchedModels] = useState<string[]>([])
  const [fetchingModels, setFetchingModels] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [modelSearchQuery, setModelSearchQuery] = useState('')
  // 是否已应用过云端模式（防止重复触发 selectCloudModel）
  const [cloudModeApplied, setCloudModeApplied] = useState(false)
  const [direction, setDirection] = useState(0)
  const [isExiting, setIsExiting] = useState(false)
  const [defaultWorkspacePath, setDefaultWorkspacePath] = useState<string | null>(null)
  // 搜索引擎配置（search 步骤）：默认使用 preferenceSchema 的 defaultWebSearchConfig
  const [webSearchConfig, setWebSearchConfig] = useState<WebSearchConfig>(() => ({
    ...defaultWebSearchConfig,
    searchEngines: { ...defaultWebSearchConfig.searchEngines },
  }))

  const currentStepIndex = STEPS.indexOf(currentStep)
  const isZh = selectedLanguage === 'zh'

  // 步骤校验：
  // - workspace 步骤必选目录
  // - model 步骤：
  //   - 云端模式：必须已登录且已选择 provider + model
  //   - 自定义模式：必须选择 provider + model + apiKey（ollama 例外，无需 apiKey）
  const isOllamaProvider = providerConfig.provider === 'ollama'
  const isCustomModeReady = !!providerConfig.provider && !!providerConfig.model && (!!providerConfig.apiKey || isOllamaProvider)
  const isCloudModeReady = isAuthenticated && !!providerConfig.provider && !!providerConfig.model
  const canProceed = currentStep === 'workspace'
    ? !!workspacePath
    : currentStep === 'model'
      ? (modelMode === 'cloud' ? isCloudModeReady : isCustomModeReady)
      : true

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

  // 云端模式：进入 model 步骤时，若已登录则拉取云端模型列表并自动选择默认模型
  useEffect(() => {
    if (currentStep !== 'model' || modelMode !== 'cloud') return
    if (!isAuthenticated) return
    if (cloudModels.length === 0) {
      fetchCloudModels().then((models) => {
        // 拉取成功后自动选择第一个 provider 的第一个模型
        if (models.length > 0 && !cloudModeApplied) {
          const first = models[0]
          if (first.models.length > 0) {
            setProviderConfig((c) => ({
              ...c,
              provider: first.provider.toLowerCase(),
              model: first.models[0],
              baseUrl: first.baseUrl,
            }))
            setCloudModeApplied(true)
          }
        }
      }).catch(() => {})
    } else if (!cloudModeApplied) {
      // 已有缓存：直接用第一项做兜底（用户未选时）
      const first = cloudModels[0]
      if (first && first.models.length > 0 && !providerConfig.provider) {
        setProviderConfig((c) => ({
          ...c,
          provider: first.provider.toLowerCase(),
          model: first.models[0],
          baseUrl: first.baseUrl,
        }))
        setCloudModeApplied(true)
      }
    }
  }, [currentStep, modelMode, isAuthenticated, cloudModels, fetchCloudModels, cloudModeApplied, providerConfig.provider])

  // 切换到云端模式：同步 providerConfig 的云端字段
  const applyCloudMode = useCallback(() => {
    const tokens = getTokens()
    setProviderConfig((c) => ({
      ...c,
      cloudMode: true as any,
      serverUrl,
      accessToken: tokens?.accessToken,
      refreshToken: tokens?.refreshToken,
    }))
    setCloudMode('cloud')
  }, [serverUrl, setCloudMode])

  // 切换到自定义模式：清除云端字段
  const applyCustomMode = useCallback(() => {
    setProviderConfig((c) => ({
      ...c,
      cloudMode: false as any,
      serverUrl: undefined,
      accessToken: undefined,
      refreshToken: undefined,
    }))
    setCloudMode('local')
  }, [setCloudMode])

  // 模式切换
  const handleModelModeChange = useCallback((mode: ModelMode) => {
    if (mode === modelMode) return
    setModelMode(mode)
    setFetchedModels([])
    setModelSearchQuery('')
    if (mode === 'cloud') {
      applyCloudMode()
    } else {
      applyCustomMode()
    }
  }, [modelMode, applyCloudMode, applyCustomMode])

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
    const { defaultAgentConfig, defaultAutoApprove, defaultEditorConfig, defaultSecuritySettings, defaultMcpConfig } = await import('@shared/configuration/preferenceSchema')
    const { settingsService } = await import('@renderer/settings/preferencesService')

    // 构建 providerConfigs：
    // 自定义模式下，需将选中的服务商、API Key、拉取到的模型列表和 modelConfigs（含 enabled 标记）
    // 一并写入 providerConfigs，确保聊天界面模型选择器和设置页模型列表能正确读取。
    // 云端模式不需要 providerConfigs（由 cloudModels + selectCloudModel 路由）
    const builtProviderConfigs: Record<string, any> = {}
    if (modelMode === 'custom' && providerConfig.provider && providerConfig.model) {
      const providerId = providerConfig.provider
      const providerDef = PROVIDERS[providerId]

      // 模型列表：优先使用动态拉取的完整列表，兜底使用当前选中模型
      const modelsToSave = fetchedModels.length > 0
        ? (fetchedModels.includes(providerConfig.model)
            ? fetchedModels
            : [...fetchedModels, providerConfig.model])
        : [providerConfig.model]

      // modelConfigs：为每个模型设置 enabled: true，使其在模型选择器中可见
      const modelConfigs: Record<string, { capabilities: string[]; enabled: boolean }> = {}
      for (const m of modelsToSave) {
        modelConfigs[m] = { capabilities: ['llm'], enabled: true }
      }

      builtProviderConfigs[providerId] = {
        apiKey: providerConfig.apiKey || '',
        baseUrl: providerConfig.baseUrl || providerDef?.baseUrl || '',
        model: providerConfig.model,
        customModels: modelsToSave,
        modelConfigs,
        enabled: true,
        protocol: providerDef?.protocol || 'openai',
        displayName: providerDef?.displayName || providerId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
    }

    // 立即应用到全局 store（包含语言、LLM 配置、providerConfigs）
    set('language', selectedLanguage)
    set('llmConfig', providerConfig)
    set('providerConfigs', builtProviderConfigs)
    // 搜索引擎配置：用户在 search 步骤选择的引擎
    set('webSearchConfig', webSearchConfig)
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

    // 同步云端模式状态到 authSlice 的持久化（已由 setCloudMode 完成）
    // 进入完成步骤时再校验一次：若为云端模式且尚未调用 setCloudMode，则补一次
    if (modelMode === 'cloud' && isAuthenticated) {
      try {
        await selectCloudModel()
      } catch (e) {
        logger.settings.warn('OnboardingWizard: selectCloudModel failed:', e)
      }
    }

    // 无论是否配置 API Key，首次引导都应标记完成，避免重复弹出
    useStore.getState().set('onboardingCompleted', true)

    try {
      await settingsService.save({
        llmConfig: providerConfig,
        language: selectedLanguage,
        autoApprove: defaultAutoApprove,
        agentConfig: defaultAgentConfig,
        providerConfigs: builtProviderConfigs,
        aiInstructions: '',
        onboardingCompleted: true,
        editorConfig: defaultEditorConfig,
        securitySettings: defaultSecuritySettings,
        webSearchConfig: webSearchConfig,
        mcpConfig: defaultMcpConfig,
        promptTemplateId: 'default',
        // 默认激活场景为 general-assistant（通用助手）
        activeScenarioId: 'general-assistant',
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
          <div className="flex items-center gap-1.5 bg-background-secondary/50 backdrop-blur-md px-4 py-2 rounded-full border border-border shadow-sm">
            {STEPS.map((step, index) => (
              <React.Fragment key={step}>
                <motion.div
                  initial={false}
                  animate={{
                    // 已激活/当前步：accent 色；未激活：明确的灰色（rgb(107 114 128) ≈ #6b7280）
                    backgroundColor: index <= currentStepIndex ? 'rgb(var(--accent))' : 'rgb(107 114 128)',
                    scale: index === currentStepIndex ? 1.2 : 1,
                  }}
                  className={`w-2 h-2 rounded-full`}
                />
                {index < STEPS.length - 1 && (
                  <motion.div
                    initial={false}
                    animate={{
                      // 已完成连接线：accent 半透明；未完成：浅灰色
                      backgroundColor: index < currentStepIndex ? 'rgba(var(--accent), 0.5)' : 'rgba(107, 114, 128, 0.4)',
                    }}
                    className="w-3 h-0.5"
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
                  {currentStep === 'model' && (
                    <ModelStep
                      isZh={isZh}
                      mode={modelMode}
                      onModeChange={handleModelModeChange}
                      providerConfig={providerConfig}
                      setProviderConfig={setProviderConfig}
                      showApiKey={showApiKey}
                      setShowApiKey={setShowApiKey}
                      isAuthenticated={isAuthenticated}
                      cloudModels={cloudModels}
                      fetchedModels={fetchedModels}
                      setFetchedModels={setFetchedModels}
                      fetchingModels={fetchingModels}
                      setFetchingModels={setFetchingModels}
                      fetchError={fetchError}
                      setFetchError={setFetchError}
                      modelSearchQuery={modelSearchQuery}
                      setModelSearchQuery={setModelSearchQuery}
                      onBackToAuth={() => {
                        setDirection(-1)
                        setCurrentStep('auth')
                      }}
                    />
                  )}
                  {currentStep === 'search' && (
                    <SearchEngineStep
                      isZh={isZh}
                      webSearchConfig={webSearchConfig}
                      setWebSearchConfig={setWebSearchConfig}
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
                      modelMode={modelMode}
                      webSearchConfig={webSearchConfig}
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
              <div className="px-2 py-0.5 rounded text-[12px] font-bold" style={{ backgroundColor: `rgb(${previewTheme.colors.accent})`, color: `rgb(${previewTheme.colors.accentForeground})` }}>
                {isZh ? '按钮' : 'Button'}
              </div>
              <div className="px-2 py-0.5 rounded text-[12px] border" style={{ borderColor: `rgb(${previewTheme.colors.border})`, color: `rgb(${previewTheme.colors.textMuted})` }}>
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


/**
 * AI 模型配置步骤
 *
 * 设计要点：
 * - 云端模式：用户需先登录，登录后从后端拉取云端可用模型列表，选择即可
 *   云端模式使用 server-side 代理 + accessToken，无需用户输入 apiKey
 * - 自定义模式：用户选择服务商后输入 API Key，点击「获取模型」按钮动态拉取可用模型列表
 *   不使用内置模型列表（部分已过时），仅作为兜底显示，优先使用动态拉取的实时模型
 * - 支持 Ollama 等本地无鉴权服务商（无需 apiKey 即可获取模型列表）
 */
function ModelStep({
  isZh,
  mode,
  onModeChange,
  providerConfig,
  setProviderConfig,
  showApiKey,
  setShowApiKey,
  isAuthenticated,
  cloudModels,
  fetchedModels,
  setFetchedModels,
  fetchingModels,
  setFetchingModels,
  fetchError,
  setFetchError,
  modelSearchQuery,
  setModelSearchQuery,
  onBackToAuth,
}: {
  isZh: boolean
  mode: ModelMode
  onModeChange: (mode: ModelMode) => void
  providerConfig: LLMConfig
  setProviderConfig: (c: LLMConfig) => void
  showApiKey: boolean
  setShowApiKey: (v: boolean) => void
  isAuthenticated: boolean
  cloudModels: CloudProviderModel[]
  fetchedModels: string[]
  setFetchedModels: (m: string[]) => void
  fetchingModels: boolean
  setFetchingModels: (v: boolean) => void
  fetchError: string | null
  setFetchError: (e: string | null) => void
  modelSearchQuery: string
  setModelSearchQuery: (q: string) => void
  onBackToAuth: () => void
}) {
  // 当前选中的内置服务商定义（用于自定义模式）
  const selectedProviderDef = providerConfig.provider ? PROVIDERS[providerConfig.provider] : undefined
  const isOllamaProvider = providerConfig.provider === 'ollama'

  // 云端模式：从 cloudModels 映射为可渲染的选项列表
  const cloudProviderOptions = useMemo(() => {
    if (!cloudModels || cloudModels.length === 0) return []
    return cloudModels.map((cp) => ({
      id: cp.provider.toLowerCase(),
      name: cp.displayName || cp.provider,
      models: cp.models,
      baseUrl: cp.baseUrl,
      logo: cp.logo,
    }))
  }, [cloudModels])

  // 云端模式：当前 provider 对应的模型列表
  const cloudModelOptions = useMemo(() => {
    if (!cloudModels || cloudModels.length === 0) return []
    const currentProvider = providerConfig.provider || ''
    const found = cloudModels.find((cp) =>
      cp.provider.toLowerCase() === currentProvider.toLowerCase()
    )
    return found?.models || []
  }, [cloudModels, providerConfig.provider])

  // 自定义模式：拉取模型
  const handleFetchModels = useCallback(async () => {
    if (!providerConfig.provider) {
      setFetchError(isZh ? '请先选择服务商' : 'Please select a provider first')
      return
    }
    // Ollama 等本地服务无需 apiKey；其他服务商必须填写 apiKey
    if (!isOllamaProvider && !providerConfig.apiKey) {
      setFetchError(isZh ? '请先填写 API Key' : 'Please enter API Key first')
      return
    }
    setFetchingModels(true)
    setFetchError(null)
    setModelSearchQuery('')
    try {
      const result = await fetchModelsCall(
        providerConfig.provider,
        providerConfig.apiKey,
        providerConfig.baseUrl,
        selectedProviderDef?.protocol
      )
      if (result.success && result.models && result.models.length > 0) {
        setFetchedModels(result.models)
        // 若当前 model 不在拉取列表中，自动选中第一个
        if (!result.models.includes(providerConfig.model)) {
          setProviderConfig({ ...providerConfig, model: result.models[0] })
        }
      } else if (result.success && (!result.models || result.models.length === 0)) {
        setFetchError(isZh ? '该服务商未返回任何模型，请检查 API Key 或网络后重试' : 'No models returned')
      } else {
        setFetchError(result.error || (isZh ? '获取模型失败，请检查 API Key 和网络' : 'Fetch failed'))
      }
    } catch (err: any) {
      setFetchError(err?.message || (isZh ? '获取模型失败，请检查 API Key 和网络' : 'Fetch failed'))
    } finally {
      setFetchingModels(false)
    }
  }, [
    providerConfig, isOllamaProvider, setFetchingModels, setFetchError, setModelSearchQuery,
    setFetchedModels, setProviderConfig, selectedProviderDef, isZh,
  ])

  // 自定义模式：选择服务商时，重置 apiKey/model/baseUrl，并使用 provider 默认 baseUrl
  const handleSelectProvider = useCallback((providerId: string) => {
    const def = PROVIDERS[providerId]
    if (!def) return
    setProviderConfig({
      ...providerConfig,
      provider: providerId,
      apiKey: providerId === 'ollama' ? '' : providerConfig.apiKey,
      model: '', // 清空，等用户拉取后选择
      baseUrl: def.baseUrl,
    })
    setFetchedModels([])
    setFetchError(null)
    setModelSearchQuery('')
  }, [providerConfig, setProviderConfig, setFetchedModels, setFetchError, setModelSearchQuery])

  // 云端模式：选择服务商
  const handleSelectCloudProvider = useCallback((cp: { id: string; models: string[]; baseUrl?: string }) => {
    const firstModel = cp.models[0] || ''
    setProviderConfig({
      ...providerConfig,
      provider: cp.id,
      model: firstModel,
      baseUrl: cp.baseUrl || providerConfig.baseUrl,
    })
  }, [providerConfig, setProviderConfig])

  // 自定义模式：过滤后的模型列表（用于搜索框）
  const filteredFetchedModels = useMemo(() => {
    if (!modelSearchQuery) return fetchedModels
    const q = modelSearchQuery.toLowerCase()
    return fetchedModels.filter(m => m.toLowerCase().includes(q))
  }, [fetchedModels, modelSearchQuery])

  // 自定义模式：不再内置候选模型，动态拉取失败时直接提示用户手动输入/重试。
  const fallbackBuiltinModels = useMemo(() => [], [])

  return (
    <div className="px-10 py-10 h-full flex flex-col">
      {/* 头部 */}
      <div className="flex items-center gap-4 mb-6">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center">
          <Cpu className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-text-primary">
            {isZh ? 'AI 模型配置' : 'AI Model Configuration'}
          </h2>
          <p className="text-text-muted mt-1">
            {isZh ? '选择 AI 模型来源，可稍后在设置中修改' : 'Choose AI model source, changeable later'}
          </p>
        </div>
      </div>

      {/* 模式切换 Tab */}
      <div className="flex gap-2 p-1 bg-white/5 rounded-xl border border-border mb-6">
        <button
          type="button"
          onClick={() => onModeChange('cloud')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
            mode === 'cloud'
              ? 'bg-accent text-white shadow'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          {isZh ? '云端' : 'Cloud'}
        </button>
        <button
          type="button"
          onClick={() => onModeChange('custom')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-2 ${
            mode === 'custom'
              ? 'bg-accent text-white shadow'
              : 'text-text-muted hover:text-text-primary'
          }`}
        >
          <Settings className="w-4 h-4" />
          {isZh ? '自定义' : 'Custom'}
        </button>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto pr-1">
        {mode === 'cloud' ? (
          <CloudModelContent
            isZh={isZh}
            isAuthenticated={isAuthenticated}
            cloudProviderOptions={cloudProviderOptions}
            cloudModelOptions={cloudModelOptions}
            currentProviderId={providerConfig.provider}
            currentModelId={providerConfig.model}
            onSelectProvider={handleSelectCloudProvider}
            onSelectModel={(m) => setProviderConfig({ ...providerConfig, model: m })}
            onBackToAuth={onBackToAuth}
          />
        ) : (
          <CustomModelContent
            isZh={isZh}
            providerConfig={providerConfig}
            setProviderConfig={setProviderConfig}
            showApiKey={showApiKey}
            setShowApiKey={setShowApiKey}
            selectedProviderDef={selectedProviderDef}
            isOllamaProvider={isOllamaProvider}
            onFetchModels={handleFetchModels}
            fetchingModels={fetchingModels}
            fetchedModels={fetchedModels}
            filteredFetchedModels={filteredFetchedModels}
            fallbackBuiltinModels={fallbackBuiltinModels}
            fetchError={fetchError}
            modelSearchQuery={modelSearchQuery}
            setModelSearchQuery={setModelSearchQuery}
            onSelectProvider={handleSelectProvider}
          />
        )}
      </div>
    </div>
  )
}


/**
 * 云端模式内容：要求登录后展示云端可用服务商与模型
 */
function CloudModelContent({
  isZh,
  isAuthenticated,
  cloudProviderOptions,
  cloudModelOptions,
  currentProviderId,
  currentModelId,
  onSelectProvider,
  onSelectModel,
  onBackToAuth,
}: {
  isZh: boolean
  isAuthenticated: boolean
  cloudProviderOptions: Array<{ id: string; name: string; models: string[]; baseUrl?: string; logo?: string }>
  cloudModelOptions: string[]
  currentProviderId: string
  currentModelId: string
  onSelectProvider: (cp: { id: string; models: string[]; baseUrl?: string }) => void
  onSelectModel: (model: string) => void
  onBackToAuth: () => void
}) {
  // 未登录：引导用户回到登录步骤
  if (!isAuthenticated) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center text-center py-10"
      >
        <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4">
          <CloudOff className="w-8 h-8 text-amber-500" />
        </div>
        <h3 className="text-lg font-bold text-text-primary mb-2">
          {isZh ? '需要先登录' : 'Sign in required'}
        </h3>
        <p className="text-sm text-text-muted max-w-sm mb-6">
          {isZh
            ? '云端模式需要先登录账号，登录后可使用平台提供的模型服务。'
            : 'Cloud mode requires sign-in. After signing in, you can use platform-provided models.'}
        </p>
        <ActionButton
          onClick={onBackToAuth}
          className="flex items-center gap-2 px-6 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-bold shadow-lg shadow-accent/20 transition-all"
        >
          <ChevronLeft className="w-4 h-4" />
          {isZh ? '返回登录' : 'Back to Sign In'}
        </ActionButton>
      </motion.div>
    )
  }

  // 已登录但 cloudModels 为空（后端未配置或网络异常）
  if (cloudProviderOptions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10">
        <div className="w-16 h-16 rounded-2xl bg-white/5 border border-border flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-text-muted" />
        </div>
        <h3 className="text-base font-bold text-text-primary mb-2">
          {isZh ? '暂无可用云端模型' : 'No cloud models available'}
        </h3>
        <p className="text-sm text-text-muted max-w-sm">
          {isZh ? '可能后端尚未配置模型或网络异常，请稍后重试或切换为自定义模式。' : 'Backend may not have configured models or network is unstable. Please retry or switch to custom mode.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* 云端服务商选择 */}
      <div>
        <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
          {isZh ? '云端服务商' : 'Cloud Providers'}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {cloudProviderOptions.map((cp) => {
            const active = currentProviderId.toLowerCase() === cp.id.toLowerCase()
            return (
              <motion.button
                key={cp.id}
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onSelectProvider({ id: cp.id, models: cp.models, baseUrl: cp.baseUrl })}
                className={`relative p-3 rounded-2xl border-2 transition-all duration-200 flex items-center gap-3 ${
                  active
                    ? 'border-accent bg-accent/5 shadow-lg shadow-accent/10'
                    : 'border-border hover:border-accent/30 bg-white/5'
                }`}
              >
                <div className="w-10 h-10 rounded-xl bg-white/5 border border-border flex items-center justify-center overflow-hidden shrink-0">
                  {cp.logo ? (
                    <img
                      src={cp.logo}
                      alt={cp.name}
                      className="w-7 h-7"
                      style={{ objectFit: 'contain' }}
                      onError={(e) => {
                        // logo 加载失败时回退为首字母
                        const target = e.currentTarget as HTMLImageElement
                        target.style.display = 'none'
                        const fallback = target.nextElementSibling as HTMLElement | null
                        if (fallback) fallback.style.display = 'flex'
                      }}
                    />
                  ) : null}
                  {/* 首字母兜底：logo 缺失或加载失败时显示 */}
                  <span
                    className={`text-base font-bold ${
                      active ? 'text-accent' : 'text-text-primary'
                    }`}
                    style={{ display: cp.logo ? 'none' : 'flex' }}
                  >
                    {(cp.name || cp.id || '?').charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <div className={`text-sm font-bold truncate ${active ? 'text-accent' : 'text-text-primary'}`}>
                    {cp.name}
                  </div>
                  <div className="text-xs text-text-muted">
                    {isZh ? `${cp.models.length} 个模型` : `${cp.models.length} models`}
                  </div>
                </div>
                {active && (
                  <motion.div
                    layoutId="cloud-provider-check"
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

      {/* 模型选择 */}
      {cloudModelOptions.length > 0 && (
        <div>
          <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
            {isZh ? '选择模型' : 'Select Model'}
          </div>
          <div className="grid grid-cols-2 gap-2 max-h-[260px] overflow-y-auto pr-1">
            {cloudModelOptions.map((m) => {
              const active = currentModelId === m
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => onSelectModel(m)}
                  className={`px-3 py-2.5 rounded-xl border text-left transition-all flex items-center justify-between gap-2 ${
                    active
                      ? 'border-accent bg-accent/10 text-accent ring-1 ring-accent/50'
                      : 'border-border bg-white/5 text-text-secondary hover:border-accent/30 hover:text-text-primary'
                  }`}
                >
                  <span className="truncate text-sm font-mono">{m}</span>
                  {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 说明 */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-accent/5 border border-accent/15">
        <Sparkles className="w-4 h-4 text-accent shrink-0 mt-0.5" />
        <p className="text-xs text-text-muted leading-relaxed">
          {isZh
            ? '云端模式通过后端代理调用，使用平台账号额度计费，无需单独填写 API Key。'
            : 'Cloud mode routes through backend proxy, billed via platform quota. No API Key needed.'}
        </p>
      </div>
    </div>
  )
}


/**
 * 自定义模式内容：选择服务商 → 输入 API Key → 动态获取模型 → 选择模型
 */
function CustomModelContent({
  isZh,
  providerConfig,
  setProviderConfig,
  showApiKey,
  setShowApiKey,
  selectedProviderDef,
  isOllamaProvider,
  onFetchModels,
  fetchingModels,
  fetchedModels,
  filteredFetchedModels,
  fallbackBuiltinModels,
  fetchError,
  modelSearchQuery,
  setModelSearchQuery,
  onSelectProvider,
}: {
  isZh: boolean
  providerConfig: LLMConfig
  setProviderConfig: (c: LLMConfig) => void
  showApiKey: boolean
  setShowApiKey: (v: boolean) => void
  selectedProviderDef: typeof PROVIDERS[string] | undefined
  isOllamaProvider: boolean
  onFetchModels: () => void
  fetchingModels: boolean
  fetchedModels: string[]
  filteredFetchedModels: string[]
  fallbackBuiltinModels: string[]
  fetchError: string | null
  modelSearchQuery: string
  setModelSearchQuery: (q: string) => void
  onSelectProvider: (providerId: string) => void
}) {
  const builtinProviders = Object.values(PROVIDERS)

  return (
    <div className="space-y-5">
      {/* 服务商选择 */}
      <div>
        <div className="text-xs font-bold text-text-muted uppercase tracking-wider mb-3">
          {isZh ? '选择服务商' : 'Select Provider'}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {builtinProviders.map((p) => {
            const active = providerConfig.provider === p.id
            return (
              <motion.button
                key={p.id}
                type="button"
                whileHover={{ y: -1 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onSelectProvider(p.id)}
                className={`px-2 py-2.5 rounded-lg border text-xs font-medium transition-all flex flex-col items-center gap-1.5 ${
                  active
                    ? 'border-accent bg-accent/10 text-accent ring-1 ring-accent/50'
                    : 'border-border hover:border-white/20 text-text-muted bg-white/5'
                }`}
              >
                <ProviderIcon providerId={p.id} size={20} />
                <span className="truncate w-full text-center">{p.displayName}</span>
              </motion.button>
            )
          })}
        </div>
      </div>

      {/* API Key 输入（Ollama 跳过） */}
      {!isOllamaProvider && (
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-text-muted uppercase tracking-wider ml-1">
            API Key
          </label>
          <div className="relative">
            <TextField
              type={showApiKey ? 'text' : 'password'}
              value={providerConfig.apiKey}
              onChange={(e) => setProviderConfig({ ...providerConfig, apiKey: e.target.value })}
              placeholder={selectedProviderDef?.auth.placeholder || 'sk-...'}
              className="w-full pr-10 bg-white/5 border-border focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all py-2.5 text-sm"
            />
            <button
              type="button"
              onClick={() => setShowApiKey(!showApiKey)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-primary transition-colors p-1"
            >
              {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {selectedProviderDef?.auth.helpUrl && (
            <div className="flex justify-end">
              <a
                href={selectedProviderDef.auth.helpUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[12px] text-accent hover:text-accent-hover hover:underline inline-flex items-center gap-1 transition-colors"
                onClick={(e) => {
                  e.preventDefault()
                  api.file.openExternalUrl(selectedProviderDef.auth.helpUrl!)
                }}
              >
                <span>{isZh ? '获取 API Key' : 'Get API Key'}</span>
                <ChevronRight className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}

      {/* Base URL 输入（可选，默认填充服务商内置地址，可自定义代理地址） */}
      {selectedProviderDef && (
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-text-muted uppercase tracking-wider ml-1">
            {isZh ? 'API 地址' : 'API Endpoint'}
            <span className="ml-1 text-text-muted/60 normal-case font-normal">
              ({isZh ? '可选，默认使用服务商地址' : 'optional, default to provider URL'})
            </span>
          </label>
          <TextField
            type="text"
            value={providerConfig.baseUrl || ''}
            onChange={(e) => setProviderConfig({ ...providerConfig, baseUrl: e.target.value })}
            placeholder={selectedProviderDef.baseUrl}
            className="w-full bg-white/5 border-border focus:border-accent focus:ring-1 focus:ring-accent/50 transition-all py-2.5 text-sm font-mono"
          />
        </div>
      )}

      {/* 获取模型按钮 */}
      <div className="flex items-center gap-3">
        <ActionButton
          type="button"
          onClick={onFetchModels}
          disabled={fetchingModels || (!isOllamaProvider && !providerConfig.apiKey)}
          className="flex items-center gap-2 px-4 py-2.5 bg-accent hover:bg-accent-hover text-white rounded-xl text-sm font-bold shadow-lg shadow-accent/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <RefreshCw className={`w-4 h-4 ${fetchingModels ? 'animate-spin' : ''}`} />
          {fetchingModels
            ? (isZh ? '正在获取...' : 'Fetching...')
            : (isZh ? '获取模型列表' : 'Fetch Models')}
        </ActionButton>
        {fetchedModels.length > 0 && (
          <span className="text-xs text-text-muted">
            {isZh ? `已获取 ${fetchedModels.length} 个` : `${fetchedModels.length} fetched`}
          </span>
        )}
      </div>

      {/* 获取错误：在按钮下方直接展示，便于用户看到具体原因 */}
      {fetchError && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          className="flex items-start gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/30"
        >
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-red-400 mb-0.5">
              {isZh ? '获取失败' : 'Fetch Failed'}
            </div>
            <div className="text-xs text-red-300/90 break-words">{fetchError}</div>
          </div>
        </motion.div>
      )}

      {/* 模型选择：动态拉取的模型列表（优先） */}
      {fetchedModels.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-bold text-text-muted uppercase tracking-wider ml-1">
            {isZh ? '选择模型' : 'Select Model'}
          </label>
          {/* 搜索框 */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
            <input
              type="text"
              value={modelSearchQuery}
              onChange={(e) => setModelSearchQuery(e.target.value)}
              placeholder={isZh ? '搜索模型...' : 'Search models...'}
              className="w-full pl-9 pr-3 py-2 bg-white/5 border border-border rounded-xl text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/50 transition-colors"
            />
          </div>
          {/* 模型列表 */}
          <div className="max-h-[200px] overflow-y-auto rounded-xl border border-border bg-white/5">
            {filteredFetchedModels.length === 0 ? (
              <div className="p-3 text-xs text-text-muted text-center">
                {isZh ? '无匹配模型' : 'No matching models'}
              </div>
            ) : (
              filteredFetchedModels.map((m) => {
                const active = providerConfig.model === m
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setProviderConfig({ ...providerConfig, model: m })}
                    className={`w-full px-3 py-2 text-left text-sm font-mono transition-colors flex items-center justify-between gap-2 ${
                      active
                        ? 'bg-accent/10 text-accent border-l-2 border-accent'
                        : 'text-text-secondary hover:bg-white/5 hover:text-text-primary border-l-2 border-transparent'
                    }`}
                  >
                    <span className="truncate">{m}</span>
                    {active && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}

      {/* 兜底：内置模型列表（仅当未拉取到模型时显示，作为选择入口） */}
      {fetchedModels.length === 0 && fallbackBuiltinModels.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <label className="text-xs font-bold text-text-muted uppercase tracking-wider ml-1">
              {isZh ? '选择模型' : 'Select Model'}
            </label>
          </div>
          <DropdownSelector
            value={providerConfig.model}
            onChange={(value) => setProviderConfig({ ...providerConfig, model: value })}
            options={fallbackBuiltinModels.map(m => ({ value: m, label: m }))}
            className="w-full bg-white/5 border-border hover:border-accent/50 transition-colors py-2.5 text-sm"
          />
          <p className="text-[12px] text-text-muted/70 ml-1">
            {isZh
              ? '显示内置参考模型，建议点击上方「获取模型列表」获取最新可用模型。'
              : 'Showing built-in reference models. Recommend clicking "Fetch Models" above to get up-to-date models.'}
          </p>
        </div>
      )}

      {/* 说明 */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-white/5 border border-border">
        <CloudOff className="w-4 h-4 text-text-muted shrink-0 mt-0.5" />
        <p className="text-xs text-text-muted leading-relaxed">
          {isZh
            ? '自定义模式直连服务商 API，使用您自己的 API Key 计费。API Key 仅保存在本地，不会上传服务器。'
            : 'Custom mode connects directly to provider API, billed via your own API Key. Key is stored locally and never uploaded.'}
        </p>
      </div>
    </div>
  )
}


/**
 * 搜索引擎选择步骤
 *
 * 与设置页 SearchEnginePanel 保持一致的引擎列表（全部 12 个内置引擎）：
 * - 卡片式展示所有搜索引擎，点击选中作为主引擎
 * - 免费引擎（Bing/搜狗/SearXNG/DuckDuckGo）可直接使用，无需 API Key
 * - 国内可用引擎优先排列（Bing/搜狗/SearXNG），DuckDuckGo 标注为「国际网络」
 * - 付费/需鉴权引擎选中后，下方展开 API Key 输入区域，支持立即配置
 * - API Key 输入区域提供「申请方法」外链，引导用户获取 Key
 * - 支持跳过（使用默认 Bing，国内可直接访问）
 */
function SearchEngineStep({
  isZh,
  webSearchConfig,
  setWebSearchConfig,
}: {
  isZh: boolean
  webSearchConfig: WebSearchConfig
  setWebSearchConfig: (config: WebSearchConfig) => void
}) {
  const activeEngineId = webSearchConfig.activeSearchEngine || 'aweeclaw-searxng'
  const searchEngines = webSearchConfig.searchEngines || {}
  // 控制付费引擎 API Key 输入区域的展开/收起（默认选中的付费引擎自动展开）
  const [showApiKeyInput, setShowApiKeyInput] = useState(true)

  /** 切换激活的搜索引擎 */
  const handleSelect = (engineId: string) => {
    const currentConfig = searchEngines[engineId] || { enabled: false }
    const updatedEngines = {
      ...searchEngines,
      [engineId]: { ...currentConfig, enabled: true },
    }
    setWebSearchConfig({
      ...webSearchConfig,
      searchEngines: updatedEngines,
      activeSearchEngine: engineId,
    })
    // 切换引擎时自动展开 API Key 输入区域
    setShowApiKeyInput(true)
  }

  /** 更新引擎的 API Key */
  const handleApiKeyChange = (engineId: string, apiKey: string) => {
    const currentConfig = searchEngines[engineId] || { enabled: true }
    const updatedEngines = {
      ...searchEngines,
      [engineId]: { ...currentConfig, apiKey, enabled: true },
    }
    setWebSearchConfig({
      ...webSearchConfig,
      searchEngines: updatedEngines,
    })
  }

  /** 更新引擎的额外字段值（如 Google 的 CX、SearXNG 的 baseUrl） */
  const handleExtraFieldChange = (engineId: string, fieldKey: string, value: string) => {
    const currentConfig = searchEngines[engineId] || { enabled: true }
    const extraValues = { ...(currentConfig.extraValues || {}), [fieldKey]: value }
    const updatedEngines = {
      ...searchEngines,
      [engineId]: { ...currentConfig, extraValues, enabled: true },
    }
    setWebSearchConfig({
      ...webSearchConfig,
      searchEngines: updatedEngines,
    })
  }

  // 全部内置搜索引擎（按推荐顺序排列，AweeClaw 官方引擎优先）
  const engineOrder = [
    'aweeclaw-searxng', 'bing', 'sogou', 'searxng', 'duckduckgo',
    'google', 'brave', 'tavily', 'serper',
    'jina', 'exa', 'bocha', 'yandex',
  ]
  const allEngines = engineOrder
    .map(id => ({ id, def: BUILTIN_SEARCH_ENGINES[id] }))
    .filter(e => e.def)

  const selectedDef = BUILTIN_SEARCH_ENGINES[activeEngineId]
  const needsApiKey = selectedDef && selectedDef.auth.type !== 'none'
  const hasApiKey = !!(searchEngines[activeEngineId]?.apiKey)
  const selectedExtraFields = selectedDef?.extraFields || []

  // 区域提示文案
  const regionText = (hint?: string) => {
    if (!hint) return ''
    if (hint === 'china') return isZh ? '国内可访问' : 'China Accessible'
    if (hint === 'both') return isZh ? '国内外均可访问' : 'Global & China'
    return isZh ? '国际网络（国内无法访问）' : 'Global (No China Access)'
  }

  return (
    <div className="px-10 py-10 min-h-full flex flex-col">
      {/* 标题 */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Search className="w-5 h-5 text-accent" />
          </div>
          <h2 className="text-2xl font-bold text-text-primary">
            {isZh ? '选择搜索引擎' : 'Choose Search Engine'}
          </h2>
        </div>
        <p className="text-text-muted text-sm ml-13">
          {isZh
            ? 'AI 助手在需要联网搜索时会使用此引擎，可随时在设置中修改'
            : 'AI assistant uses this engine for web searches. You can change it anytime in Settings'}
        </p>
      </div>

      {/* 搜索引擎卡片列表（3 列网格，展示全部引擎） */}
      <div className="grid grid-cols-3 gap-2.5 mb-4">
        {allEngines.map(({ id, def }) => {
          const isActive = id === activeEngineId
          const isFree = def.free
          const engineConfig = searchEngines[id]
          const hasKey = !!(engineConfig?.apiKey)
          const needsKey = def.auth.type !== 'none'
          return (
            <button
              key={id}
              onClick={() => handleSelect(id)}
              className={`relative p-3 rounded-xl border-2 text-left transition-all duration-200 ${
                isActive
                  ? 'border-accent bg-accent/5 shadow-md'
                  : 'border-border hover:border-accent/40 hover:bg-surface-hover'
              }`}
            >
              {/* 选中标记 */}
              {isActive && (
                <div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-accent flex items-center justify-center">
                  <Check className="w-3 h-3 text-white" />
                </div>
              )}
              {/* 引擎名称 + 免费/付费标签 */}
              <div className="flex items-center gap-1.5 mb-1 pr-6">
                <span className="font-semibold text-text-primary text-sm truncate">
                  {isZh ? def.displayNameZh : def.displayName}
                </span>
              </div>
              <div className="flex items-center gap-1 mb-1">
                {isFree ? (
                  <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-status-success/15 text-status-success">
                    {isZh ? '免费' : 'Free'}
                  </span>
                ) : (
                  <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-accent/15 text-accent">
                    {isZh ? '付费' : 'Paid'}
                  </span>
                )}
                {needsKey && (
                  <span className={`px-1.5 py-0.5 text-xs font-medium rounded ${
                    hasKey
                      ? 'bg-status-success/15 text-status-success'
                      : 'bg-status-warning/15 text-status-warning'
                  }`}>
                    {hasKey ? (isZh ? '已配置' : 'Ready') : (isZh ? '需 Key' : 'Need Key')}
                  </span>
                )}
              </div>
              {/* 引擎描述 */}
              <p className="text-xs text-text-muted leading-relaxed line-clamp-2">
                {isZh ? def.descriptionZh : def.description}
              </p>
              {/* 区域提示标签 */}
              {def.regionHint && (
                <span className={`mt-1.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 text-xs font-medium rounded border ${
                  def.regionHint === 'global'
                    ? 'bg-status-warning/10 text-status-warning border-status-warning/20'
                    : def.regionHint === 'china'
                      ? 'bg-status-success/10 text-status-success border-status-success/20'
                      : 'bg-text-muted/10 text-text-muted border-text-muted/20'
                }`}>
                  {regionText(def.regionHint)}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* 选中引擎的配置区域 */}
      {selectedDef && needsApiKey && (
        <div className="mb-4 rounded-lg border border-border bg-surface/30 overflow-hidden">
          {/* 配置区域标题栏（可折叠） */}
          <button
            onClick={() => setShowApiKeyInput(!showApiKeyInput)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-hover transition-colors"
          >
            <div className="flex items-center gap-2">
              <Key className="w-4 h-4 text-accent" />
              <span className="text-sm font-medium text-text-primary">
                {isZh ? `配置 ${selectedDef.displayNameZh}` : `Configure ${selectedDef.displayName}`}
              </span>
              {!hasApiKey && (
                <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-status-warning/15 text-status-warning">
                  {isZh ? '未配置' : 'Not configured'}
                </span>
              )}
              {hasApiKey && (
                <span className="px-1.5 py-0.5 text-xs font-medium rounded bg-status-success/15 text-status-success">
                  {isZh ? '已配置' : 'Configured'}
                </span>
              )}
            </div>
            <ChevronDown className={`w-4 h-4 text-text-muted transition-transform ${showApiKeyInput ? 'rotate-180' : ''}`} />
          </button>

          {/* 展开内容 */}
          {showApiKeyInput && (
            <div className="px-4 pb-4 space-y-3">
              {/* API Key 输入框 */}
              <div>
                <label className="flex items-center gap-1 text-sm font-medium text-text-primary mb-1.5">
                  <span>API Key</span>
                  <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={searchEngines[activeEngineId]?.apiKey || ''}
                  onChange={(e) => handleApiKeyChange(activeEngineId, e.target.value)}
                  placeholder={selectedDef.auth.placeholder || (isZh ? '输入 API Key' : 'Enter API Key')}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
                />
                {/* 申请方法外链 */}
                <a
                  href={selectedDef.auth.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs text-accent hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-3 h-3" />
                  {isZh ? '如何获取 API Key？点击查看申请方法' : 'How to get API Key? Click for instructions'}
                </a>
              </div>

              {/* 额外字段（如 Google 的 CX、SearXNG 的 baseUrl） */}
              {selectedExtraFields.map(field => (
                <div key={field.key}>
                  <label className="flex items-center gap-1 text-sm font-medium text-text-primary mb-1.5">
                    <span>{isZh ? field.labelZh : field.label}</span>
                    {field.required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type={field.secret ? 'password' : 'text'}
                    value={searchEngines[activeEngineId]?.extraValues?.[field.key] || ''}
                    onChange={(e) => handleExtraFieldChange(activeEngineId, field.key, e.target.value)}
                    placeholder={isZh ? field.placeholderZh : field.placeholder}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
                  />
                </div>
              ))}

              {/* 未配置提示 */}
              {!hasApiKey && (
                <div className="flex items-start gap-2 p-2.5 rounded-md bg-status-warning/10 border border-status-warning/20">
                  <AlertCircle className="w-3.5 h-3.5 text-status-warning flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-text-secondary">
                    {isZh
                      ? '可先跳过此步骤，后续在 设置 → 搜索引擎 中配置。未配置 API Key 的引擎将无法使用。'
                      : 'You can skip for now and configure later in Settings → Search Engine. Engines without API Key will not work.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 选中免费引擎的提示 */}
      {selectedDef && !needsApiKey && (
        <div className="mb-4 flex items-start gap-2 p-2.5 rounded-md bg-status-success/10 border border-status-success/20">
          <Check className="w-4 h-4 text-status-success flex-shrink-0 mt-0.5" />
          <p className="text-xs text-text-secondary">
            {isZh
              ? `${selectedDef.displayNameZh} 无需 API Key，可直接使用。`
              : `${selectedDef.displayName} does not require an API Key. Ready to use.`}
          </p>
        </div>
      )}

      {/* 跳过提示 */}
      <div className="mt-auto pt-4 border-t border-border">
        <p className="text-xs text-text-muted flex items-center gap-1.5">
          <Settings className="w-3.5 h-3.5" />
          {isZh
            ? '可跳过此步骤，默认使用 AweeClaw 搜索（官方引擎，无需配置，国内可直接访问）。后续可在 设置 → 搜索引擎 中修改'
            : 'You can skip this step. Default: AweeClaw Search (official engine, no configuration needed, accessible in China). Change later in Settings → Search Engine'}
        </p>
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
  modelMode,
  webSearchConfig,
}: {
  isZh: boolean
  selectedLanguage: Language
  themeMode: 'light' | 'dark' | 'system'
  themeColor: ThemeColor
  workspacePath: string | null
  providerConfig: LLMConfig
  modelMode: ModelMode
  webSearchConfig: WebSearchConfig
}) {
  // 主题摘要：模式 + 颜色
  const modeLabelZh = themeMode === 'light' ? '亮色' : themeMode === 'dark' ? '暗色' : '跟随系统'
  const modeLabelEn = themeMode === 'light' ? 'Light' : themeMode === 'dark' ? 'Dark' : 'System'
  const colorOpt = THEME_COLOR_OPTIONS.find(o => o.value === themeColor)
  const themeSummary = `${isZh ? modeLabelZh : modeLabelEn} / ${isZh ? colorOpt?.labelZh : colorOpt?.labelEn}`
  const langName = LANGUAGES.find(l => l.id === selectedLanguage)?.native || selectedLanguage

  // AI 模型摘要：
  // - 云端模式：显示 provider + model + 「云端」标记
  // - 自定义模式：显示 provider + model + apiKey 状态
  const isCloud = modelMode === 'cloud'
  const isModelConfigured = isCloud
    ? (!!providerConfig.provider && !!providerConfig.model)
    : (!!providerConfig.provider && !!providerConfig.model && (!!providerConfig.apiKey || providerConfig.provider === 'ollama'))
  const modelSummary = isModelConfigured
    ? `${providerConfig.provider} / ${providerConfig.model}${isCloud ? ` · ${isZh ? '云端' : 'Cloud'}` : ''}`
    : (isZh ? '未配置' : 'Not configured')

  // 搜索引擎摘要：显示当前激活的搜索引擎名称
  const activeEngineId = webSearchConfig.activeSearchEngine || 'aweeclaw-searxng'
  const activeEngineDef = BUILTIN_SEARCH_ENGINES[activeEngineId]
  const searchSummary = activeEngineDef
    ? (isZh ? activeEngineDef.displayNameZh : activeEngineDef.displayName)
    : activeEngineId

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
            accent={!workspacePath}
          />
          <SummaryRow
            icon={<Cpu className="w-4 h-4" />}
            label={isZh ? 'AI 模型' : 'AI Model'}
            value={modelSummary}
            accent={!isModelConfigured}
          />
          <SummaryRow
            icon={<Search className="w-4 h-4" />}
            label={isZh ? '搜索引擎' : 'Search Engine'}
            value={searchSummary}
          />
        </div>
      </div>

      {/* 提示 */}
      <div className="mt-auto pt-4 border-t border-border flex items-center justify-between text-xs text-text-muted">
        <span>{isZh ? '其他设置可在设置中探索' : 'Explore more in Settings'}</span>
        <div className="flex items-center gap-1">
          <kbd className="px-1.5 py-0.5 bg-black/20 rounded border border-border font-mono text-text-muted text-[12px]">Ctrl</kbd>
          <span>+</span>
          <kbd className="px-1.5 py-0.5 bg-black/20 rounded border border-border font-mono text-text-muted text-[12px]">,</kbd>
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
