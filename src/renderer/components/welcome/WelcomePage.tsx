import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import { Boxes, Folder, FolderOpen, History, Network, Plus, Settings, Workflow } from 'lucide-react'
import { api } from '@/renderer/services/electronAPI'
import { workspaceManager, WorkspaceOpenError } from '@/renderer/services/WorkspaceManager'
import { useStore } from '@/renderer/store'
import { logger } from '@utils/Logger'
import { toast } from '@components/common/ToastProvider'
import { getFileName } from '@shared/utils/pathUtils'
import { t, type Language } from '@renderer/i18n'
import { publicAsset } from '@utils/publicAsset'

interface RecentWorkspace {
  path: string
  name: string
}

export default function WelcomePage() {
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const setShowSettings = useStore(s => s.setShowSettings)
  const language = useStore(s => s.language)
  const currentTheme = useStore(s => s.currentTheme)
  const welcomeArtwork = publicAsset(currentTheme === 'dawn' ? 'brand/welcome/light.webp' : 'brand/welcome/dark.webp')

  useEffect(() => {
    loadRecentWorkspaces()
  }, [])

  const loadRecentWorkspaces = async () => {
    try {
      const recent = await api.workspace.getRecent()
      setRecentWorkspaces(
        recent.slice(0, 8).map((path: string) => ({
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

  return (
    <div className="aweeclaw-welcome-page h-full w-full overflow-hidden bg-background text-text-primary">
      <WelcomeStyles rootClass="aweeclaw-welcome-page" />

      <main className="h-full overflow-y-auto custom-scrollbar">
        <section className="aweeclaw-welcome-shell">
          <div className="aweeclaw-welcome-card">
            <div className="aweeclaw-welcome-main">
              <div className="aweeclaw-welcome-copy">
                <p className="aweeclaw-welcome-eyebrow">{t('welcome.eyebrow', language)}</p>
                <h2 className="aweeclaw-welcome-title">{t('welcome.title', language)}</h2>
                <p className="aweeclaw-welcome-subtitle">{t('welcome.subtitle', language)}</p>

                <div className="aweeclaw-welcome-actions">
                  <InteractiveIPButton 
                    className="aweeclaw-welcome-primary-button" 
                    onClick={handleOpenFolder}
                    icon={<FolderOpen className="h-4 w-4" />}
                    label={t('welcome.openFolder', language)}
                    ipSrc={publicAsset('brand/ip/4.png')}
                  />
                  <InteractiveIPButton 
                    className="aweeclaw-welcome-outline-button" 
                    onClick={handleOpenWorkspace}
                    icon={<Folder className="h-4 w-4" />}
                    label={t('welcome.openWorkspace', language)}
                  />
                </div>
              </div>

              <WelcomeArtwork src={welcomeArtwork} />
            </div>

            <FeatureGrid language={language} />
          </div>

          <section className="aweeclaw-welcome-recent">
            <div className="aweeclaw-welcome-recent-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h3>
                  <History className="h-4 w-4" />
                  {t('welcome.recent', language)}
                </h3>
                <span>{recentWorkspaces.length}/8</span>
              </div>
              <div className="aweeclaw-welcome-footer-actions">
                <InteractiveIPButton 
                  onClick={() => api.window.new()} 
                  className="aweeclaw-welcome-secondary-button"
                  icon={<Plus className="h-4 w-4" />} 
                  label={t('welcome.newWindow', language)} 
                  ipSrc={publicAsset('brand/ip/5.png')}
                />
                <InteractiveIPButton 
                  onClick={() => setShowSettings(true)} 
                  className="aweeclaw-welcome-secondary-button"
                  icon={<Settings className="h-4 w-4" />} 
                  label={t('settings', language)} 
                  ipSrc={publicAsset('brand/ip/6.png')}
                />
              </div>
            </div>

            <div className="aweeclaw-welcome-recent-list custom-scrollbar">
              {recentWorkspaces.length > 0 ? (
                recentWorkspaces.map((workspace) => (
                  <button
                    key={workspace.path}
                    onClick={() => handleOpenRecent(workspace.path)}
                    className="aweeclaw-welcome-recent-item group"
                  >
                    <span className="aweeclaw-welcome-recent-icon">
                      <Folder className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{workspace.name}</span>
                      <span className="block truncate font-mono text-[11px] text-text-muted/85">{workspace.path}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className="aweeclaw-welcome-empty-recent">{t('welcome.noRecentItems', language)}</div>
              )}
            </div>
          </section>
        </section>
      </main>
    </div>
  )
}

function WelcomeArtwork({ src }: { src: string }) {
  return (
    <div className="aweeclaw-welcome-visual" aria-hidden="true">
      <div className="aweeclaw-welcome-visual-glow" />
      <img src={src} alt="" draggable={false} />
      <div className="aweeclaw-welcome-visual-fade" />
    </div>
  )
}

function InteractiveIPButton({
  icon,
  label,
  onClick,
  ipSrc,
  className
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  ipSrc?: string;
  className: string;
}) {
  return (
    <button className={`${className} group`} onClick={onClick}>
      <div className="relative z-10 flex items-center gap-2 pointer-events-none">
        {icon}
        <span>{label}</span>
      </div>
      {ipSrc && (
        <div className="aweeclaw-welcome-button-mascot">
          <img src={ipSrc} alt="" draggable={false} />
        </div>
      )}
    </button>
  )
}

function FeatureGrid({ language }: { language: Language }) {
  return (
    <div className="aweeclaw-welcome-feature-grid">
      <FeatureCard
        icon={<Workflow className="h-5 w-5" />}
        title={t('welcome.feature.visual.title', language)}
        subtitle={t('welcome.feature.visual.subtitle', language)}
        imageSrc={publicAsset('brand/ip/1.png')}
      />
      <FeatureCard
        icon={<Network className="h-5 w-5" />}
        title={t('welcome.feature.connect.title', language)}
        subtitle={t('welcome.feature.connect.subtitle', language)}
        imageSrc={publicAsset('brand/ip/2.png')}
      />
      <FeatureCard
        icon={<Boxes className="h-5 w-5" />}
        title={t('welcome.feature.modular.title', language)}
        subtitle={t('welcome.feature.modular.subtitle', language)}
        imageSrc={publicAsset('brand/ip/3.png')}
      />
    </div>
  )
}

function FeatureCard({ icon, title, subtitle, imageSrc }: { icon: ReactNode; title: string; subtitle: string; imageSrc?: string }) {
  return (
    <div className="aweeclaw-welcome-feature-card group">
      {imageSrc && (
        <div className="aweeclaw-welcome-feature-illustration">
          <img src={imageSrc} alt="" draggable={false} />
        </div>
      )}
      <div className="relative z-10 flex flex-col gap-3 h-full">
        <div className="aweeclaw-welcome-feature-icon">{icon}</div>
        <div className="aweeclaw-welcome-feature-text mt-auto">
          <h4 className="aweeclaw-welcome-feature-title">{title}</h4>
          <p className="aweeclaw-welcome-feature-desc">{subtitle}</p>
        </div>
      </div>
    </div>
  )
}

function WelcomeStyles({ rootClass }: { rootClass: string }) {
  return (
    <style>{`
      .${rootClass} {
        container-type: inline-size;
      }

      .${rootClass} .aweeclaw-welcome-shell {
        width: 100%;
        max-width: 1200px;
        margin: 0 auto;
        padding: clamp(16px, 3cqw, 32px) clamp(24px, 5cqw, 48px);
        display: flex;
        flex-direction: column;
        min-height: 100%;
      }

      .${rootClass} .aweeclaw-welcome-card {
        position: relative;
      }

      .${rootClass} .aweeclaw-welcome-main {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 32px;
        min-height: clamp(380px, 40cqw, 520px);
      }

      .${rootClass} .aweeclaw-welcome-copy {
        flex: 1;
        max-width: 540px;
        position: relative;
        z-index: 2;
      }

      .${rootClass} .aweeclaw-welcome-eyebrow {
        display: inline-block;
        font-size: 13px;
        font-weight: 700;
        color: rgb(var(--accent));
        margin-bottom: 12px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
      }

      .${rootClass} .aweeclaw-welcome-title {
        font-size: clamp(36px, 5cqw, 52px);
        font-weight: 800;
        line-height: 1.15;
        color: rgb(var(--text-primary));
        letter-spacing: -0.02em;
      }

      .${rootClass} .aweeclaw-welcome-subtitle {
        margin-top: 18px;
        font-size: 16px;
        line-height: 1.6;
        color: rgb(var(--text-secondary));
        max-width: 480px;
      }

      .${rootClass} .aweeclaw-welcome-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        margin-top: 36px;
      }

      .${rootClass} .aweeclaw-welcome-primary-button,
      .${rootClass} .aweeclaw-welcome-outline-button,
      .${rootClass} .aweeclaw-welcome-secondary-button {
        display: inline-flex;
        position: relative;
        min-width: 140px;
        height: 46px;
        align-items: center;
        justify-content: center;
        gap: 10px;
        border-radius: 12px;
        padding: 0 24px;
        font-size: 14px;
        font-weight: 600;
        white-space: nowrap;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
        overflow: visible;
      }

      .${rootClass} .aweeclaw-welcome-primary-button {
        color: white;
        background: linear-gradient(135deg, rgb(var(--accent)), #8b5cf6);
        box-shadow: 0 8px 24px -8px rgba(var(--accent), 0.6);
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      
      .${rootClass} .aweeclaw-welcome-primary-button:hover {
        transform: translateY(-2px);
        box-shadow: 0 12px 32px -8px rgba(var(--accent), 0.8);
        filter: brightness(1.05);
      }

      .${rootClass} .aweeclaw-welcome-outline-button {
        border: 1px solid rgba(var(--border), 0.8);
        color: rgb(var(--text-primary));
        background: rgba(var(--surface), 0.5);
        backdrop-filter: blur(12px);
      }

      .${rootClass} .aweeclaw-welcome-outline-button:hover {
        border-color: rgba(var(--accent), 0.5);
        background: rgba(var(--surface-hover), 0.8);
        transform: translateY(-2px);
      }

      .${rootClass} .aweeclaw-welcome-secondary-button {
        height: 38px;
        min-width: auto;
        padding: 0 16px;
        border-radius: 10px;
        font-size: 13px;
        border: 1px solid transparent;
        color: rgb(var(--text-secondary));
        background: rgba(var(--surface), 0.3);
      }

      .${rootClass} .aweeclaw-welcome-secondary-button:hover {
        color: rgb(var(--text-primary));
        background: rgba(var(--surface-hover), 0.6);
      }

      /* IP Button Mascot Animations */
      .${rootClass} .aweeclaw-welcome-primary-button:has(.aweeclaw-welcome-button-mascot) {
        padding: 0 44px 0 20px;
      }
      .${rootClass} .aweeclaw-welcome-secondary-button:has(.aweeclaw-welcome-button-mascot) {
        padding: 0 40px 0 16px;
      }

      .${rootClass} .aweeclaw-welcome-button-mascot {
        position: absolute;
        right: -8px;
        top: -16px;
        width: 48px;
        height: 48px;
        pointer-events: none;
        z-index: 20;
        opacity: 0.85;
        transform-origin: bottom center;
        transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .${rootClass} .aweeclaw-welcome-primary-button .aweeclaw-welcome-button-mascot {
        width: 64px;
        height: 64px;
        top: -24px;
        right: -12px;
      }

      .${rootClass} .aweeclaw-welcome-button-mascot img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        /* Feather out the edges to remove solid backgrounds */
        -webkit-mask-image: radial-gradient(circle at 50% 60%, black 30%, transparent 70%);
        mask-image: radial-gradient(circle at 50% 60%, black 30%, transparent 70%);
        transition: all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .${rootClass} .group:hover .aweeclaw-welcome-button-mascot {
        transform: scale(1.3) translateY(-8px) rotate(-8deg);
        opacity: 1;
        filter: drop-shadow(0 8px 16px rgba(var(--accent) / 0.5));
      }

      .${rootClass} .group:hover .aweeclaw-welcome-button-mascot img {
        -webkit-mask-image: radial-gradient(circle at 50% 50%, black 45%, transparent 80%);
        mask-image: radial-gradient(circle at 50% 50%, black 45%, transparent 80%);
        filter: saturate(1.2) brightness(1.1);
      }

      .${rootClass} .aweeclaw-welcome-visual {
        flex: 1;
        position: relative;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        max-width: 600px;
        margin-right: -20px;
      }

      .${rootClass} .aweeclaw-welcome-visual-glow {
        position: absolute;
        top: 50%;
        left: 50%;
        width: 80%;
        padding-bottom: 80%;
        transform: translate(-50%, -50%);
        border-radius: 50%;
        background: radial-gradient(circle, rgba(var(--accent), 0.12) 0%, transparent 70%);
        filter: blur(40px);
        z-index: 0;
      }

      .${rootClass} .aweeclaw-welcome-visual img {
        position: relative;
        z-index: 1;
        width: 115%;
        max-width: 700px;
        height: auto;
        object-fit: contain;
        /* Magic mask to blend the solid background image into the app background */
        -webkit-mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, black 60%, transparent 100%);
        mask-image: radial-gradient(ellipse 50% 50% at 50% 50%, black 60%, transparent 100%);
        animation: float 8s ease-in-out infinite;
        opacity: 0.95;
      }

      @keyframes float {
        0% { transform: translateY(0px) scale(1); }
        50% { transform: translateY(-12px) scale(1.02); }
        100% { transform: translateY(0px) scale(1); }
      }

      .${rootClass} .aweeclaw-welcome-visual-fade {
        display: none;
      }

      .${rootClass} .aweeclaw-welcome-feature-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 20px;
        margin-top: 40px;
        position: relative;
        z-index: 1;
      }

      .${rootClass} .aweeclaw-welcome-feature-grid::before {
        content: '';
        position: absolute;
        top: 50%;
        left: 50%;
        width: 100%;
        height: 140%;
        background: radial-gradient(ellipse at center, rgb(var(--accent) / 0.35) 0%, transparent 70%);
        filter: blur(50px);
        transform: translate(-50%, -50%);
        z-index: -1;
        pointer-events: none;
      }

      .${rootClass} .aweeclaw-welcome-feature-card {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 12px;
        padding: 20px;
        border-radius: 16px;
        background: linear-gradient(135deg, rgb(var(--text-primary) / 0.08) 0%, rgb(var(--text-primary) / 0.02) 100%);
        backdrop-filter: blur(32px) saturate(180%);
        -webkit-backdrop-filter: blur(32px) saturate(180%);
        border: 1px solid rgb(var(--text-primary) / 0.08);
        box-shadow: 0 16px 40px rgba(0,0,0,0.15), inset 0 1px 1px rgb(var(--text-primary) / 0.12);
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        position: relative;
        overflow: hidden;
        min-height: 150px;
      }

      .${rootClass} .aweeclaw-welcome-feature-card::before {
        content: '';
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(var(--accent), 0.5), transparent);
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .${rootClass} .aweeclaw-welcome-feature-card:hover {
        transform: translateY(-4px);
        background: linear-gradient(135deg, rgb(var(--text-primary) / 0.12) 0%, rgb(var(--text-primary) / 0.04) 100%);
        border-color: rgb(var(--accent) / 0.5);
        box-shadow: 0 20px 48px rgba(0,0,0,0.2), inset 0 1px 1px rgb(var(--text-primary) / 0.2), 0 0 0 1px rgb(var(--accent) / 0.15);
      }

      .${rootClass} .aweeclaw-welcome-feature-card:hover::before {
        opacity: 1;
      }

      .${rootClass} .aweeclaw-welcome-feature-icon {
        display: flex;
        width: 42px;
        height: 42px;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        color: rgb(var(--accent));
        background: linear-gradient(135deg, rgb(var(--accent) / 0.15) 0%, rgb(var(--accent) / 0.05) 100%);
        border: 1px solid rgb(var(--accent) / 0.2);
        transition: transform 0.3s ease, background 0.3s ease;
      }

      .${rootClass} .aweeclaw-welcome-feature-card:hover .aweeclaw-welcome-feature-icon {
        transform: scale(1.05);
        background: linear-gradient(135deg, rgb(var(--accent) / 0.25) 0%, rgb(var(--accent) / 0.1) 100%);
      }

      .${rootClass} .aweeclaw-welcome-feature-illustration {
        position: absolute;
        bottom: -30px;
        right: -30px;
        width: 160px;
        height: 160px;
        z-index: 0;
        opacity: 0.25;
        transform: scale(0.9) rotate(-5deg);
        transition: all 0.6s cubic-bezier(0.16, 1, 0.3, 1);
        pointer-events: none;
        /* Feather the entire container to guarantee no hard edges */
        -webkit-mask-image: radial-gradient(circle at 60% 60%, black 20%, transparent 70%);
        mask-image: radial-gradient(circle at 60% 60%, black 20%, transparent 70%);
      }

      .${rootClass} .aweeclaw-welcome-feature-card:hover .aweeclaw-welcome-feature-illustration {
        opacity: 0.8;
        transform: scale(1.05) rotate(0deg) translate(-10px, -10px);
        filter: saturate(1.2) brightness(1.1);
        -webkit-mask-image: radial-gradient(circle at 50% 50%, black 40%, transparent 80%);
        mask-image: radial-gradient(circle at 50% 50%, black 40%, transparent 80%);
      }

      .${rootClass} .aweeclaw-welcome-feature-illustration img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .${rootClass} .aweeclaw-welcome-feature-text {
        min-width: 0;
        flex: 1;
      }

      .${rootClass} .aweeclaw-welcome-feature-title {
        font-size: 15px;
        font-weight: 600;
        color: rgb(var(--text-primary));
        margin: 0 0 6px 0;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        transition: color 0.3s ease;
      }

      .${rootClass} .aweeclaw-welcome-feature-card:hover .aweeclaw-welcome-feature-title {
        color: rgb(var(--accent));
      }

      .${rootClass} .aweeclaw-welcome-feature-desc {
        font-size: 13px;
        color: rgb(var(--text-muted));
        line-height: 1.6;
        margin: 0;
        white-space: normal;
      }

      .${rootClass} .aweeclaw-welcome-footer-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
      }

      .${rootClass} .aweeclaw-welcome-shortcuts {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 12px;
        margin-top: 24px;
        font-size: 12px;
        color: rgba(var(--text-muted), 0.8);
      }
      
      .${rootClass} .aweeclaw-welcome-recent {
        margin-top: auto;
        padding-top: 48px;
        max-width: 800px;
      }

      .${rootClass} .aweeclaw-welcome-recent-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 24px;
        padding-bottom: 12px;
        border-bottom: 1px solid rgb(var(--border) / 0.5);
      }

      .${rootClass} .aweeclaw-welcome-recent-header h3 {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 14px;
        font-weight: 600;
        color: rgb(var(--text-primary));
      }

      .${rootClass} .aweeclaw-welcome-recent-header span {
        font-size: 12px;
        color: rgba(var(--text-muted), 0.8);
      }

      .${rootClass} .aweeclaw-welcome-recent-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
        gap: 12px;
        max-height: 280px;
        overflow-y: auto;
      }

      .${rootClass} .aweeclaw-welcome-recent-item {
        display: flex;
        align-items: center;
        gap: 14px;
        border-radius: 12px;
        padding: 12px;
        text-align: left;
        color: rgb(var(--text-secondary));
        background: rgba(var(--surface), 0.3);
        border: 1px solid rgba(var(--border), 0.4);
        transition: all 0.2s ease;
      }

      .${rootClass} .aweeclaw-welcome-recent-item:hover {
        color: rgb(var(--text-primary));
        background: rgba(var(--surface-hover), 0.8);
        border-color: rgba(var(--accent), 0.3);
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.05);
      }

      .${rootClass} .aweeclaw-welcome-recent-icon {
        display: flex;
        width: 36px;
        height: 36px;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        border-radius: 10px;
        color: rgb(var(--text-muted));
        background: rgba(var(--text-primary), 0.05);
        transition: color 0.2s ease;
      }

      .${rootClass} .aweeclaw-welcome-recent-item:hover .aweeclaw-welcome-recent-icon {
        color: rgb(var(--accent));
        background: rgba(var(--accent), 0.1);
      }
      
      .${rootClass} .aweeclaw-welcome-empty-recent {
        grid-column: 1 / -1;
        display: flex;
        min-height: 120px;
        align-items: center;
        justify-content: center;
        border: 1px dashed rgba(var(--border), 0.8);
        border-radius: 12px;
        font-size: 13px;
        color: rgb(var(--text-muted));
        background: rgba(var(--surface), 0.2);
      }

      @container (max-width: 440px) {
        .${rootClass} .aweeclaw-welcome-feature-grid {
          grid-template-columns: 1fr;
          max-width: 320px;
          margin-left: auto;
          margin-right: auto;
        }
      }

      @container (min-width: 441px) and (max-width: 900px) {
        .${rootClass} .aweeclaw-welcome-feature-grid {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }

      @container (max-width: 900px) {
        .${rootClass} .aweeclaw-welcome-title {
          font-size: clamp(26px, 4.5cqw, 36px);
        }

        .${rootClass} .aweeclaw-welcome-subtitle {
          font-size: 14px;
        }

        .${rootClass} .aweeclaw-welcome-actions {
          gap: 12px;
          margin-top: 24px;
        }

        .${rootClass} .aweeclaw-welcome-primary-button,
        .${rootClass} .aweeclaw-welcome-outline-button {
          min-width: 120px;
          padding: 0 16px;
          font-size: 13px;
        }
        
        .${rootClass} .aweeclaw-welcome-feature-card {
          text-align: left;
        }
      }
    `}</style>
  )
}
