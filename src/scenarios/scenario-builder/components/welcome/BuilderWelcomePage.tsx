/**
 * 场景开发助手欢迎页
 *
 * 围绕"场景开发全流程"设计的引导式欢迎界面：
 * - Hero 区：场景标识 + 价值主张
 * - 工作流区：脚手架 → 开发 → 构建 → 安装 → 发布，5 阶段卡片
 * - 快捷操作区：搜索文件、命令面板、设置、终端
 * - 文档区：向 AI 提问场景开发问题
 *
 * 设计目标：
 * 1. 让用户一眼看出这是"场景开发"专属工作台，与通用编辑器欢迎页区分
 * 2. 引导用户按开发流程使用 AI 协作
 * 3. 提供场景化快捷键提示
 */
import type React from 'react'
import { useState } from 'react'
import { useI18n } from '@renderer/i18n'
import { useStore } from '@store'
import {
  Search, Command, Settings, Terminal as TerminalIcon,
  Rocket, Code2, Hammer, Package, Cloud,
  ArrowRight, BookOpen, Sparkles, ChevronRight,
} from 'lucide-react'

/** 工作流阶段配置 */
interface FlowStage {
  id: string
  icon: React.ComponentType<{ className?: string }>
  titleKey: string
  descKey: string
  prompt: string
  color: string
  iconBg: string
}

const FLOW_STAGES: FlowStage[] = [
  {
    id: 'scaffold',
    icon: Rocket,
    titleKey: 'builder.welcome.flow.scaffold.title',
    descKey: 'builder.welcome.flow.scaffold.desc',
    prompt: '帮我创建一个新的场景项目，声明式类型，包含完整骨架',
    color: 'hover:border-accent/40 hover:bg-accent/5',
    iconBg: 'bg-accent/10 text-accent',
  },
  {
    id: 'develop',
    icon: Code2,
    titleKey: 'builder.welcome.flow.develop.title',
    descKey: 'builder.welcome.flow.develop.desc',
    prompt: '帮我编写场景配置 scenario.json，包含提示词、工具定义和 UI 布局',
    color: 'hover:border-sky-500/40 hover:bg-sky-500/5',
    iconBg: 'bg-sky-500/10 text-sky-500',
  },
  {
    id: 'build',
    icon: Hammer,
    titleKey: 'builder.welcome.flow.build.title',
    descKey: 'builder.welcome.flow.build.desc',
    prompt: '帮我校验并构建当前场景项目，检查配置是否正确',
    color: 'hover:border-emerald-500/40 hover:bg-emerald-500/5',
    iconBg: 'bg-emerald-500/10 text-emerald-500',
  },
  {
    id: 'install',
    icon: Package,
    titleKey: 'builder.welcome.flow.install.title',
    descKey: 'builder.welcome.flow.install.desc',
    prompt: '帮我将构建好的场景安装到本地客户端进行测试',
    color: 'hover:border-orange-500/40 hover:bg-orange-500/5',
    iconBg: 'bg-orange-500/10 text-orange-500',
  },
  {
    id: 'publish',
    icon: Cloud,
    titleKey: 'builder.welcome.flow.publish.title',
    descKey: 'builder.welcome.flow.publish.desc',
    prompt: '帮我将完成的场景发布到开发者中心市场',
    color: 'hover:border-pink-500/40 hover:bg-pink-500/5',
    iconBg: 'bg-pink-500/10 text-pink-500',
  },
]

/** 快捷键配置（与 useGlobalShortcuts 对齐） */
interface QuickAction {
  id: string
  icon: React.ComponentType<{ className?: string }>
  labelKey: string
  keys: string[]
  action: () => void
}

const BuilderWelcomePage: React.FC = () => {
  const { t, language } = useI18n()
  const isZh = language === 'zh'
  const [hoveredStage, setHoveredStage] = useState<string | null>(null)

  // 全局状态访问
  const setShowQuickOpen = useStore((s) => s.setShowQuickOpen)
  const setShowCommandPalette = useStore((s) => s.setShowCommandPalette)
  const setShowSettingsPage = useStore((s) => s.setShowSettingsPage)
  const setTerminalVisible = useStore((s) => s.setTerminalVisible)

  /** 通过自定义事件通知聊天面板发送消息 */
  const handleSuggestionClick = (prompt: string) => {
    window.dispatchEvent(
      new CustomEvent('scenario:welcome-suggestion', {
        detail: { scenarioId: 'scenario-builder', prompt },
      }),
    )
  }

  const quickActions: QuickAction[] = [
    {
      id: 'search',
      icon: Search,
      labelKey: 'builder.welcome.shortcuts.searchFiles',
      keys: ['Ctrl', 'P'],
      action: () => setShowQuickOpen(true),
    },
    {
      id: 'commands',
      icon: Command,
      labelKey: 'builder.welcome.shortcuts.commandPalette',
      keys: ['Ctrl', 'Shift', 'P'],
      action: () => setShowCommandPalette(true),
    },
    {
      id: 'settings',
      icon: Settings,
      labelKey: 'builder.welcome.shortcuts.settings',
      keys: ['Ctrl', ','],
      action: () => setShowSettingsPage(true),
    },
    {
      id: 'terminal',
      icon: TerminalIcon,
      labelKey: 'builder.welcome.shortcuts.terminal',
      keys: ['Ctrl', '`'],
      action: () => setTerminalVisible(true),
    },
  ]

  return (
    <div className="h-full overflow-y-auto bg-background-editor">
      <div className="min-h-full flex flex-col items-center justify-center px-8 py-10">
        <div className="w-full max-w-5xl">
          {/* ====== Hero 区 ====== */}
          <div className="mb-10 text-center">
            <div className="mb-4 flex justify-center">
              <div className="relative">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-accent/20 to-accent/5 border border-accent/20">
                  <Sparkles className="w-8 h-8 text-accent" strokeWidth={1.5} />
                </div>
                <div className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-emerald-500 border-2 border-background-editor animate-pulse" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-text-primary">
              {t('builder.welcome.heroTitle')}
            </h1>
            <p className="mt-2 text-sm text-text-muted max-w-xl mx-auto leading-relaxed">
              {t('builder.welcome.heroSubtitle')}
            </p>
          </div>

          {/* ====== 工作流区 ====== */}
          <div className="mb-8">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-text-primary">
                  {t('builder.welcome.flow.title')}
                </h2>
                <p className="text-xs text-text-muted mt-0.5">
                  {t('builder.welcome.flow.subtitle')}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {FLOW_STAGES.map((stage, index) => {
                const Icon = stage.icon
                const isHovered = hoveredStage === stage.id
                const isLast = index === FLOW_STAGES.length - 1
                return (
                  <div key={stage.id} className="relative">
                    <button
                      onClick={() => handleSuggestionClick(stage.prompt)}
                      onMouseEnter={() => setHoveredStage(stage.id)}
                      onMouseLeave={() => setHoveredStage(null)}
                      className={`w-full h-full flex flex-col gap-3 rounded-xl border border-border bg-surface/30 p-4 text-left transition-all hover:scale-[1.02] ${stage.color}`}
                    >
                      <div className="flex items-center justify-between">
                        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${stage.iconBg}`}>
                          <Icon className="w-4 h-4" />
                        </div>
                        <span className="text-[10px] font-mono text-text-muted/60">
                          {String(index + 1).padStart(2, '0')}
                        </span>
                      </div>
                      <div>
                        <div className="text-sm font-medium text-text-primary">
                          {t(stage.titleKey)}
                        </div>
                        <div className="mt-1 text-xs text-text-muted leading-relaxed">
                          {t(stage.descKey)}
                        </div>
                      </div>
                      <div className={`mt-auto flex items-center gap-1 text-[11px] font-medium text-accent transition-opacity ${isHovered ? 'opacity-100' : 'opacity-0'}`}>
                        {isZh ? '开始' : 'Start'}
                        <ArrowRight className="w-3 h-3" />
                      </div>
                    </button>
                    {/* 流程连接箭头（最后一个不显示） */}
                    {!isLast && (
                      <div className="hidden lg:flex absolute top-1/2 -right-2 -translate-y-1/2 z-10 items-center justify-center w-4 h-4 rounded-full bg-background-editor border border-border">
                        <ChevronRight className="w-3 h-3 text-text-muted" />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* ====== 底部双栏：快捷操作 + 文档 ====== */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {/* 快捷操作 */}
            <div className="lg:col-span-2 rounded-xl border border-border bg-surface/30 p-4">
              <h3 className="text-sm font-semibold text-text-primary mb-3">
                {t('builder.welcome.shortcuts.title')}
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {quickActions.map((action) => {
                  const Icon = action.icon
                  return (
                    <button
                      key={action.id}
                      onClick={action.action}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg text-left text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors group"
                    >
                      <Icon className="w-4 h-4 text-text-muted group-hover:text-accent transition-colors" />
                      <span className="flex-1">{t(action.labelKey)}</span>
                      <span className="flex items-center gap-1">
                        {action.keys.map((key) => (
                          <kbd
                            key={key}
                            className="rounded border border-border bg-surface/60 px-1.5 py-0.5 font-mono text-[10px] text-text-muted"
                          >
                            {key}
                          </kbd>
                        ))}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 文档区 */}
            <div className="rounded-xl border border-border bg-gradient-to-br from-accent/5 to-transparent p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <BookOpen className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-semibold text-text-primary">
                  {t('builder.welcome.docs.title')}
                </h3>
              </div>
              <p className="text-xs text-text-muted mb-3 leading-relaxed">
                {t('builder.welcome.docs.subtitle')}
              </p>
              <button
                onClick={() => handleSuggestionClick(isZh
                  ? '请告诉我场景开发的基本流程、scenario.json 的字段含义，以及如何编写提示词'
                  : 'Tell me about the scenario development workflow, scenario.json fields, and how to write prompts'
                )}
                className="mt-auto flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-accent/10 hover:bg-accent/20 text-accent text-xs font-medium transition-colors"
              >
                <span className="flex items-center gap-2">
                  <Sparkles className="w-3.5 h-3.5" />
                  {t('builder.welcome.docs.suggestion')}
                </span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* ====== 空状态提示 ====== */}
          <div className="mt-6 text-center">
            <p className="text-xs text-text-muted/70">
              {t('builder.welcome.emptyHint')}
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default BuilderWelcomePage
