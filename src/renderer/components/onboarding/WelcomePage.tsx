import { useEffect, useState, useCallback } from 'react'
import {
  FolderOpen,
  Plus,
  Sparkles,
  ChevronRight,
  Clock,
  Zap,
  MessageSquare,
  ArrowRight,
  FolderSearch,
} from 'lucide-react'
import { api } from '../../adapters/electronBridge'
import { BRAND } from '@shared/brand'
import { workspaceManager, WorkspaceOpenError } from '@services/WorkspaceAdapter'
import { useStore } from '@/renderer/state'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { getLucideIcon } from '../foundation/IconMap'
import { logger } from '@toolkit/LogEngine'
import { toast } from '@components/foundation/NotificationProvider'
import { getFileName } from '@shared/toolkit/pathHelper'
import { t, type Language } from '@renderer/i18n'
import type { ScenarioPlugin } from '@shared/protocols/scenario'

interface RecentWorkspace {
  path: string
  name: string
}

const CATEGORY_COLORS: Record<string, { bg: string; accent: string; border: string }> = {
  productivity: { bg: 'from-violet-500/15 to-purple-500/8', accent: 'text-violet-400', border: 'hover:border-violet-400/40' },
  development: { bg: 'from-blue-500/15 to-cyan-500/8', accent: 'text-blue-400', border: 'hover:border-blue-400/40' },
  data: { bg: 'from-emerald-500/15 to-teal-500/8', accent: 'text-emerald-400', border: 'hover:border-emerald-400/40' },
  creative: { bg: 'from-pink-500/15 to-rose-500/8', accent: 'text-pink-400', border: 'hover:border-pink-400/40' },
  legal: { bg: 'from-amber-500/15 to-orange-500/8', accent: 'text-amber-400', border: 'hover:border-amber-400/40' },
  health: { bg: 'from-rose-500/15 to-red-500/8', accent: 'text-rose-400', border: 'hover:border-rose-400/40' },
  education: { bg: 'from-sky-500/15 to-indigo-500/8', accent: 'text-sky-400', border: 'hover:border-sky-400/40' },
  business: { bg: 'from-orange-500/15 to-yellow-500/8', accent: 'text-orange-400', border: 'hover:border-orange-400/40' },
}

export default function WelcomePage() {
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const [scenarios, setScenarios] = useState<ScenarioPlugin[]>([])
  const setShowWelcomePage = useStore(s => s.setShowWelcomePage)
  const setChatVisible = useStore(s => s.setChatVisible)
  const language = useStore(s => s.language) as Language
  const setSetting = useStore(s => s.set)
  const activeScenarioId = useStore(s => s.activeScenarioId)
  const workspace = useStore(s => s.workspace)

  const hasWorkspace = !!workspace

  useEffect(() => {
    const all = scenarioRegistry.getAll()
    const sorted = [...all].sort((a, b) => {
      if (a.id === 'general-assistant') return -1
      if (b.id === 'general-assistant') return 1
      return 0
    })
    setScenarios(sorted)
    loadRecentWorkspaces()
  }, [])

  const loadRecentWorkspaces = async () => {
    try {
      const recent = await api.workspace.getRecent()
      setRecentWorkspaces(
        recent.slice(0, 5).map((path: string) => ({
          path,
          name: getFileName(path),
        }))
      )
    } catch (e) {
      logger.ui.error('[WelcomePage] Failed to load recent workspaces:', e)
    }
  }

  const handleOpenFolder = async () => {
    try {
      const result = await api.file.openFolder()
      if (result && typeof result === 'string') {
        await workspaceManager.openFolder(result)
      }
    } catch (e) {
      logger.ui.error('[WelcomePage] Failed to open folder:', e)
      toast.error(t('workspace.openFolderFailed', language))
    }
  }

  const handleOpenRecent = async (path: string) => {
    try {
      await workspaceManager.openFolder(path)
    } catch (e) {
      if (e instanceof WorkspaceOpenError && e.code === 'missing-workspace') {
        toast.error(t('workspace.folderNotExist', language), getFileName(path))
        loadRecentWorkspaces()
        return
      }
      logger.ui.error('[WelcomePage] Failed to open recent workspace:', e)
      toast.error(t('workspace.openFolderFailed', language), getFileName(path))
    }
  }

  const handleScenarioSelect = useCallback((scenarioId: string) => {
    setSetting('activeScenarioId', scenarioId)
    scenarioRegistry.setActive(scenarioId)
    setChatVisible(true)
    setShowWelcomePage(false)
  }, [setSetting, setChatVisible, setShowWelcomePage])

  const handleNewChat = useCallback(() => {
    setChatVisible(true)
    setShowWelcomePage(false)
  }, [setChatVisible, setShowWelcomePage])

  const isZh = language === 'zh'
  const p = BRAND.cssPrefix

  return (
    <div className={`${p}-welcome-page h-full w-full overflow-hidden bg-background text-text-primary relative`}>
      <WelcomeStyles rootClass={`${p}-welcome-page`} />

      <main className="h-full overflow-y-auto custom-scrollbar relative z-10">
        <section className={`${p}-welcome-shell`}>
          {hasWorkspace ? (
            <WorkspaceWelcome
              p={p}
              isZh={isZh}
              scenarios={scenarios}
              activeScenarioId={activeScenarioId}
              recentWorkspaces={recentWorkspaces}
              onNewChat={handleNewChat}
              onOpenFolder={handleOpenFolder}
              onScenarioSelect={handleScenarioSelect}
              onOpenRecent={handleOpenRecent}
              language={language}
            />
          ) : (
            <NoWorkspaceWelcome
              p={p}
              isZh={isZh}
              recentWorkspaces={recentWorkspaces}
              onOpenFolder={handleOpenFolder}
              onOpenRecent={handleOpenRecent}
              language={language}
            />
          )}
        </section>
      </main>
    </div>
  )
}

interface WorkspaceWelcomeProps {
  p: string
  isZh: boolean
  scenarios: ScenarioPlugin[]
  activeScenarioId: string | null
  recentWorkspaces: RecentWorkspace[]
  onNewChat: () => void
  onOpenFolder: () => void
  onScenarioSelect: (id: string) => void
  onOpenRecent: (path: string) => void
  language: Language
}

function WorkspaceWelcome({
  p, isZh, scenarios, activeScenarioId, recentWorkspaces,
  onNewChat, onOpenFolder, onScenarioSelect, onOpenRecent, language,
}: WorkspaceWelcomeProps) {
  return (
    <>
      <div className={`${p}-welcome-hero`}>
        <div className={`${p}-welcome-badge`}>
          <Sparkles className="w-3.5 h-3.5" />
          <span>{isZh ? '智能工作空间' : 'Intelligent Workspace'}</span>
        </div>
        <h1 className={`${p}-welcome-title`}>
          {t('welcome.title', language)}
        </h1>
        <p className={`${p}-welcome-subtitle`}>
          {isZh
            ? '选择一个场景开始你的旅程'
            : 'Choose a scenario to start your journey'}
        </p>

        <div className={`${p}-welcome-actions`}>
          <button className={`${p}-welcome-primary-btn`} onClick={onNewChat}>
            <MessageSquare className="w-4 h-4" />
            <span>{isZh ? '开始对话' : 'Start Chat'}</span>
            <ArrowRight className="w-3.5 h-3.5 opacity-50" />
          </button>
          <button className={`${p}-welcome-ghost-btn`} onClick={onOpenFolder}>
            <FolderOpen className="w-4 h-4" />
            <span>{t('welcome.openFolder', language)}</span>
          </button>
        </div>
      </div>

      <div className={`${p}-welcome-scenarios`}>
        <h3 className={`${p}-welcome-section-label`}>
          <Zap className="w-3.5 h-3.5" />
          {isZh ? '选择场景' : 'Choose Scenario'}
        </h3>
        <div className={`${p}-welcome-scenario-grid`}>
          {scenarios.map((scenario) => {
            const IconComponent = getLucideIcon(scenario.icon)
            const colors = CATEGORY_COLORS[scenario.category] || CATEGORY_COLORS.productivity
            const isActive = activeScenarioId === scenario.id
            return (
              <button
                key={scenario.id}
                className={`${p}-welcome-scenario-card ${colors.border} ${isActive ? 'ring-1 ring-accent/50 bg-accent/5' : ''}`}
                onClick={() => onScenarioSelect(scenario.id)}
              >
                <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${colors.bg} flex items-center justify-center mb-2.5 transition-transform duration-200`}>
                  {IconComponent ? (
                    <IconComponent className={`w-5 h-5 ${colors.accent}`} />
                  ) : (
                    <Sparkles className={`w-5 h-5 ${colors.accent}`} />
                  )}
                </div>
                <span className="text-[13px] font-semibold text-text-primary block">
                  {isZh ? scenario.nameZh : scenario.name}
                </span>
                <span className="text-[10px] text-text-muted mt-0.5 block leading-tight line-clamp-2">
                  {isZh ? scenario.descriptionZh : scenario.description}
                </span>
                {isActive && (
                  <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-accent shadow-[0_0_6px_rgba(var(--accent-rgb),0.5)]" />
                )}
              </button>
            )
          })}
        </div>
      </div>

      <section className={`${p}-welcome-recent`}>
        <div className={`${p}-welcome-recent-header`}>
          <h3 className={`${p}-welcome-section-label`}>
            <Clock className="w-3.5 h-3.5" />
            {isZh ? '最近工作' : 'Recent Work'}
          </h3>
          <div className={`${p}-welcome-footer-actions`}>
            <button className={`${p}-welcome-footer-btn`} onClick={() => api.window.new()}>
              <Plus className="w-3 h-3" />
              <span>{isZh ? '新建工作区' : 'New Workspace'}</span>
            </button>
          </div>
        </div>

        <RecentList
          p={p}
          items={recentWorkspaces}
          onOpenRecent={onOpenRecent}
          language={language}
        />
      </section>
    </>
  )
}

interface NoWorkspaceWelcomeProps {
  p: string
  isZh: boolean
  recentWorkspaces: RecentWorkspace[]
  onOpenFolder: () => void
  onOpenRecent: (path: string) => void
  language: Language
}

function NoWorkspaceWelcome({
  p, isZh, recentWorkspaces, onOpenFolder, onOpenRecent, language,
}: NoWorkspaceWelcomeProps) {
  return (
    <>
      <div className={`${p}-welcome-hero`}>
        <div className={`${p}-welcome-badge`}>
          <Sparkles className="w-3.5 h-3.5" />
          <span>{isZh ? '智能工作空间' : 'Intelligent Workspace'}</span>
        </div>
        <h1 className={`${p}-welcome-title`}>
          {t('welcome.title', language)}
        </h1>
        <p className={`${p}-welcome-subtitle`}>
          {isZh
            ? '选择一个工作区目录开始使用'
            : 'Select a workspace directory to get started'}
        </p>

        <div className={`${p}-welcome-actions`}>
          <button className={`${p}-welcome-primary-btn`} onClick={onOpenFolder}>
            <FolderSearch className="w-4 h-4" />
            <span>{isZh ? '选择工作区目录' : 'Select Workspace Directory'}</span>
            <ArrowRight className="w-3.5 h-3.5 opacity-50" />
          </button>
        </div>
      </div>

      {recentWorkspaces.length > 0 && (
        <section className={`${p}-welcome-recent`}>
          <h3 className={`${p}-welcome-section-label`}>
            <Clock className="w-3.5 h-3.5" />
            {isZh ? '最近工作' : 'Recent Work'}
          </h3>

          <RecentList
            p={p}
            items={recentWorkspaces}
            onOpenRecent={onOpenRecent}
            language={language}
          />
        </section>
      )}
    </>
  )
}

interface RecentListProps {
  p: string
  items: RecentWorkspace[]
  onOpenRecent: (path: string) => void
  language: Language
}

function RecentList({ p, items, onOpenRecent, language }: RecentListProps) {
  const isZh = language === 'zh'
  return (
    <div className={`${p}-welcome-recent-list custom-scrollbar`}>
      {items.length > 0 ? (
        items.map((workspace) => (
          <button
            key={workspace.path}
            onClick={() => onOpenRecent(workspace.path)}
            className={`${p}-welcome-recent-item group`}
          >
            <div className={`${p}-welcome-recent-dot`} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-medium text-text-primary group-hover:text-accent transition-colors">{workspace.name}</span>
              <span className="block truncate font-mono text-[10px] text-text-muted/70 mt-0.5">{workspace.path}</span>
            </span>
            <ChevronRight className="w-3 h-3 text-text-muted/30 group-hover:text-accent/60 transition-colors flex-shrink-0" />
          </button>
        ))
      ) : (
        <div className={`${p}-welcome-empty-recent`}>
          {isZh ? '没有最近的工作' : 'No recent work'}
        </div>
      )}
    </div>
  )
}

function WelcomeStyles({ rootClass }: { rootClass: string }) {
  const p = BRAND.cssPrefix
  return (
    <style>{`
      .${rootClass} {
        container-type: inline-size;
      }

      .${rootClass} .${p}-welcome-shell {
        width: 100%;
        max-width: 720px;
        margin: 0 auto;
        padding: 40px 40px 32px;
        display: flex;
        flex-direction: column;
        min-height: 100%;
        gap: 32px;
      }

      .${rootClass} .${p}-welcome-hero {
        text-align: center;
        padding-top: 8vh;
      }

      .${rootClass} .${p}-welcome-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 14px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 600;
        color: rgb(var(--accent));
        background: rgba(var(--accent), 0.08);
        border: 1px solid rgba(var(--accent), 0.15);
        margin-bottom: 20px;
        letter-spacing: 0.3px;
      }

      .${rootClass} .${p}-welcome-title {
        font-size: 32px;
        font-weight: 800;
        color: rgb(var(--text-primary));
        letter-spacing: -0.025em;
        margin: 0;
        line-height: 1.2;
      }

      .${rootClass} .${p}-welcome-subtitle {
        margin-top: 12px;
        font-size: 14px;
        line-height: 1.6;
        color: rgb(var(--text-secondary));
      }

      .${rootClass} .${p}-welcome-actions {
        display: flex;
        justify-content: center;
        gap: 10px;
        margin-top: 24px;
      }

      .${rootClass} .${p}-welcome-primary-btn {
        display: inline-flex;
        height: 38px;
        align-items: center;
        gap: 8px;
        border-radius: 8px;
        padding: 0 18px;
        font-size: 13px;
        font-weight: 600;
        color: white;
        background: rgb(var(--accent));
        border: none;
        cursor: pointer;
        transition: all 0.2s ease;
        box-shadow: 0 2px 8px rgba(var(--accent-rgb), 0.25);
      }

      .${rootClass} .${p}-welcome-primary-btn:hover {
        filter: brightness(1.1);
        box-shadow: 0 4px 16px rgba(var(--accent-rgb), 0.35);
        transform: translateY(-1px);
      }

      .${rootClass} .${p}-welcome-ghost-btn {
        display: inline-flex;
        height: 38px;
        align-items: center;
        gap: 8px;
        border-radius: 8px;
        padding: 0 18px;
        font-size: 13px;
        font-weight: 600;
        color: rgb(var(--text-secondary));
        background: transparent;
        border: 1px solid rgba(var(--border), 0.6);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .${rootClass} .${p}-welcome-ghost-btn:hover {
        color: rgb(var(--text-primary));
        border-color: rgba(var(--accent), 0.4);
        background: rgba(var(--surface-hover), 0.5);
      }

      .${rootClass} .${p}-welcome-scenarios {
        padding: 0 4px;
      }

      .${rootClass} .${p}-welcome-section-label {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 11px;
        font-weight: 600;
        color: rgb(var(--text-muted));
        text-transform: uppercase;
        letter-spacing: 0.8px;
        margin-bottom: 12px;
      }

      .${rootClass} .${p}-welcome-scenario-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 10px;
      }

      .${rootClass} .${p}-welcome-scenario-card {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 16px 8px 12px;
        border-radius: 12px;
        background: rgba(var(--surface), 0.4);
        border: 1px solid rgba(var(--border), 0.25);
        cursor: pointer;
        transition: all 0.2s ease;
        text-align: center;
      }

      .${rootClass} .${p}-welcome-scenario-card:hover {
        background: rgba(var(--surface-hover), 0.6);
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
      }

      .${rootClass} .${p}-welcome-recent {
        padding: 0 4px;
        border-top: 1px solid rgba(var(--border), 0.3);
        padding-top: 24px;
      }

      .${rootClass} .${p}-welcome-recent-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 12px;
      }

      .${rootClass} .${p}-welcome-footer-actions {
        display: flex;
        gap: 4px;
      }

      .${rootClass} .${p}-welcome-footer-btn {
        display: inline-flex;
        height: 26px;
        align-items: center;
        gap: 4px;
        border-radius: 6px;
        padding: 0 8px;
        font-size: 11px;
        font-weight: 500;
        color: rgb(var(--text-muted));
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .${rootClass} .${p}-welcome-footer-btn:hover {
        color: rgb(var(--text-primary));
        background: rgba(var(--surface-hover), 0.5);
      }

      .${rootClass} .${p}-welcome-recent-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-height: 200px;
        overflow-y: auto;
      }

      .${rootClass} .${p}-welcome-recent-item {
        display: flex;
        align-items: center;
        gap: 10px;
        border-radius: 8px;
        padding: 8px 10px;
        text-align: left;
        color: rgb(var(--text-secondary));
        background: transparent;
        border: 1px solid transparent;
        transition: all 0.15s ease;
        cursor: pointer;
        width: 100%;
      }

      .${rootClass} .${p}-welcome-recent-item:hover {
        background: rgba(var(--surface-hover), 0.5);
        border-color: rgba(var(--border), 0.3);
      }

      .${rootClass} .${p}-welcome-recent-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: rgb(var(--text-muted));
        opacity: 0.4;
        flex-shrink: 0;
        transition: all 0.15s ease;
      }

      .${rootClass} .${p}-welcome-recent-item:hover .${p}-welcome-recent-dot {
        background: rgb(var(--accent));
        opacity: 1;
        box-shadow: 0 0 8px rgba(var(--accent-rgb), 0.4);
      }

      .${rootClass} .${p}-welcome-empty-recent {
        display: flex;
        min-height: 60px;
        align-items: center;
        justify-content: center;
        border: 1px dashed rgba(var(--border), 0.5);
        border-radius: 8px;
        font-size: 12px;
        color: rgb(var(--text-muted));
      }

      @container (max-width: 560px) {
        .${rootClass} .${p}-welcome-shell {
          padding: 32px 20px 24px;
        }

        .${rootClass} .${p}-welcome-title {
          font-size: 24px;
        }

        .${rootClass} .${p}-welcome-actions {
          flex-direction: column;
        }

        .${rootClass} .${p}-welcome-primary-btn,
        .${rootClass} .${p}-welcome-ghost-btn {
          width: 100%;
          justify-content: center;
        }

        .${rootClass} .${p}-welcome-scenario-grid {
          grid-template-columns: repeat(2, 1fr);
        }
      }
    `}</style>
  )
}
