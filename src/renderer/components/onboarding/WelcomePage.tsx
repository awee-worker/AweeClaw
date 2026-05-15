import { useEffect, useState, useCallback,  useRef } from 'react'
import {
  FolderOpen,
  Folder,
  Plus,
  Settings,
  Sparkles,
  Scale,
  GraduationCap,
  Stethoscope,
  Code2,
  ChevronRight,
  Clock,
  Zap,
} from 'lucide-react'
import { api } from '../../adapters/electronBridge'
import { BRAND } from '@shared/brand'
import { workspaceManager, WorkspaceOpenError } from '@services/WorkspaceAdapter'
import { useStore } from '@/renderer/state'
import { logger } from '@toolkit/LogEngine'
import { toast } from '@components/foundation/NotificationProvider'
import { getFileName } from '@shared/toolkit/pathHelper'
import { t } from '@renderer/i18n'


interface RecentWorkspace {
  path: string
  name: string
}

const SCENARIO_SHORTCUTS = [
  { id: 'coding', icon: Code2, labelEn: 'Code', labelZh: '编程', color: 'from-blue-500/20 to-cyan-500/10', accent: 'text-blue-400' },
  { id: 'legal', icon: Scale, labelEn: 'Legal', labelZh: '法律', color: 'from-amber-500/20 to-orange-500/10', accent: 'text-amber-400' },
  { id: 'education', icon: GraduationCap, labelEn: 'Education', labelZh: '教育', color: 'from-emerald-500/20 to-green-500/10', accent: 'text-emerald-400' },
  { id: 'medical', icon: Stethoscope, labelEn: 'Medical', labelZh: '医疗', color: 'from-rose-500/20 to-pink-500/10', accent: 'text-rose-400' },
]

function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const animRef = useRef<number>(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const resize = () => {
      canvas.width = canvas.offsetWidth * devicePixelRatio
      canvas.height = canvas.offsetHeight * devicePixelRatio
      ctx.scale(devicePixelRatio, devicePixelRatio)
    }
    resize()
    window.addEventListener('resize', resize)

    const particles: Array<{ x: number; y: number; vx: number; vy: number; r: number; a: number }> = []
    const count = 40
    for (let i = 0; i < count; i++) {
      particles.push({
        x: Math.random() * canvas.offsetWidth,
        y: Math.random() * canvas.offsetHeight,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        r: Math.random() * 2 + 0.5,
        a: Math.random() * 0.3 + 0.05,
      })
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.offsetWidth, canvas.offsetHeight)
      const w = canvas.offsetWidth
      const h = canvas.offsetHeight

      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0) p.x = w
        if (p.x > w) p.x = 0
        if (p.y < 0) p.y = h
        if (p.y > h) p.y = 0

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(var(--accent-rgb), ${p.a})`
        ctx.fill()
      }

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 120) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `rgba(var(--accent-rgb), ${0.06 * (1 - dist / 120)})`
            ctx.lineWidth = 0.5
            ctx.stroke()
          }
        }
      }

      animRef.current = requestAnimationFrame(draw)
    }
    draw()

    return () => {
      window.removeEventListener('resize', resize)
      cancelAnimationFrame(animRef.current)
    }
  }, [])

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full pointer-events-none" />
}

export default function WelcomePage() {
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const [hoveredScenario, setHoveredScenario] = useState<string | null>(null)
  const setShowSettings = useStore(s => s.setShowSettings)
  const language = useStore(s => s.language)
  const setSetting = useStore(s => s.set)

  useEffect(() => {
    loadRecentWorkspaces()
  }, [])

  const loadRecentWorkspaces = async () => {
    try {
      const recent = await api.workspace.getRecent()
      setRecentWorkspaces(
        recent.slice(0, 6).map((path: string) => ({
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

  const handleOpenWorkspace = async () => {
    try {
      const result = await api.workspace.open()
      if (result && !('redirected' in result)) {
        await workspaceManager.switchTo(result)
      }
    } catch (e) {
      logger.ui.error('[WelcomePage] Failed to open workspace:', e)
      toast.error(t('workspace.openWorkspaceFailed', language))
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
  }, [setSetting])

  const p = BRAND.cssPrefix

  return (
    <div className={`${p}-welcome-page h-full w-full overflow-hidden bg-background text-text-primary relative`}>
      <ParticleField />
      <WelcomeStyles rootClass={`${p}-welcome-page`} />

      <main className="h-full overflow-y-auto custom-scrollbar relative z-10">
        <section className={`${p}-welcome-shell`}>
          <div className={`${p}-welcome-hero`}>
            <div className={`${p}-welcome-badge`}>
              <Sparkles className="w-3.5 h-3.5" />
              <span>{language === 'zh' ? '智能工作空间' : 'Intelligent Workspace'}</span>
            </div>
            <h1 className={`${p}-welcome-title`}>
              {t('welcome.title', language)}
            </h1>
            <p className={`${p}-welcome-subtitle`}>
              {language === 'zh'
                ? '选择一个场景开始，或打开项目文件夹'
                : 'Pick a scenario to start, or open a project folder'}
            </p>

            <div className={`${p}-welcome-actions`}>
              <button className={`${p}-welcome-primary-btn`} onClick={handleOpenFolder}>
                <FolderOpen className="w-4 h-4" />
                <span>{t('welcome.openFolder', language)}</span>
                <ChevronRight className="w-3.5 h-3.5 opacity-50" />
              </button>
              <button className={`${p}-welcome-ghost-btn`} onClick={handleOpenWorkspace}>
                <Folder className="w-4 h-4" />
                <span>{t('welcome.openWorkspace', language)}</span>
              </button>
            </div>
          </div>

          <div className={`${p}-welcome-scenarios`}>
            <h3 className={`${p}-welcome-section-label`}>
              <Zap className="w-3.5 h-3.5" />
              {language === 'zh' ? '快速场景' : 'Quick Scenarios'}
            </h3>
            <div className={`${p}-welcome-scenario-grid`}>
              {SCENARIO_SHORTCUTS.map((sc) => {
                const Icon = sc.icon
                const isActive = hoveredScenario === sc.id
                return (
                  <button
                    key={sc.id}
                    className={`${p}-welcome-scenario-card ${isActive ? 'ring-1 ring-accent/40' : ''}`}
                    onMouseEnter={() => setHoveredScenario(sc.id)}
                    onMouseLeave={() => setHoveredScenario(null)}
                    onClick={() => handleScenarioSelect(sc.id)}
                  >
                    <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${sc.color} flex items-center justify-center mb-2.5 transition-transform duration-200 ${isActive ? 'scale-110' : ''}`}>
                      <Icon className={`w-5 h-5 ${sc.accent}`} />
                    </div>
                    <span className="text-xs font-semibold text-text-primary">
                      {language === 'zh' ? sc.labelZh : sc.labelEn}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <section className={`${p}-welcome-recent`}>
            <div className={`${p}-welcome-recent-header`}>
              <h3 className={`${p}-welcome-section-label`}>
                <Clock className="w-3.5 h-3.5" />
                {t('welcome.recent', language)}
              </h3>
              <div className={`${p}-welcome-footer-actions`}>
                <button className={`${p}-welcome-footer-btn`} onClick={() => api.window.new()}>
                  <Plus className="w-3 h-3" />
                  <span>{t('welcome.newWindow', language)}</span>
                </button>
                <button className={`${p}-welcome-footer-btn`} onClick={() => setShowSettings(true)}>
                  <Settings className="w-3 h-3" />
                  <span>{t('settings', language)}</span>
                </button>
              </div>
            </div>

            <div className={`${p}-welcome-recent-list custom-scrollbar`}>
              {recentWorkspaces.length > 0 ? (
                recentWorkspaces.map((workspace) => (
                  <button
                    key={workspace.path}
                    onClick={() => handleOpenRecent(workspace.path)}
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
                  {t('welcome.noRecentItems', language)}
                </div>
              )}
            </div>
          </section>
        </section>
      </main>
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
        max-width: 640px;
        margin: 0 auto;
        padding: 48px 40px 32px;
        display: flex;
        flex-direction: column;
        min-height: 100%;
        gap: 36px;
      }

      .${rootClass} .${p}-welcome-hero {
        text-align: center;
        padding-top: 12vh;
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
        margin-top: 28px;
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
        padding: 0 8px;
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
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 16px 8px;
        border-radius: 12px;
        background: rgba(var(--surface), 0.4);
        border: 1px solid rgba(var(--border), 0.25);
        cursor: pointer;
        transition: all 0.2s ease;
      }

      .${rootClass} .${p}-welcome-scenario-card:hover {
        background: rgba(var(--surface-hover), 0.6);
        border-color: rgba(var(--accent), 0.3);
        transform: translateY(-2px);
      }

      .${rootClass} .${p}-welcome-recent {
        padding: 0 8px;
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
        max-height: 240px;
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

      @container (max-width: 520px) {
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
