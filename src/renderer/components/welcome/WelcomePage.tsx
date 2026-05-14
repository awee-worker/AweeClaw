import { useEffect, useState } from 'react'
import { Folder, FolderOpen, History, Plus, Settings } from 'lucide-react'
import { api } from '@/renderer/services/electronAPI'
import { BRAND } from '@shared/brand'
import { workspaceManager, WorkspaceOpenError } from '@/renderer/services/WorkspaceManager'
import { useStore } from '@/renderer/store'
import { logger } from '@utils/Logger'
import { toast } from '@components/common/ToastProvider'
import { getFileName } from '@shared/utils/pathUtils'
import { t } from '@renderer/i18n'

interface RecentWorkspace {
  path: string
  name: string
}

export default function WelcomePage() {
  const [recentWorkspaces, setRecentWorkspaces] = useState<RecentWorkspace[]>([])
  const setShowSettings = useStore(s => s.setShowSettings)
  const language = useStore(s => s.language)

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

  const p = BRAND.cssPrefix

  return (
    <div className={`${p}-welcome-page h-full w-full overflow-hidden bg-background text-text-primary`}>
      <WelcomeStyles rootClass={`${p}-welcome-page`} />

      <main className="h-full overflow-y-auto custom-scrollbar">
        <section className={`${p}-welcome-shell`}>
          <div className={`${p}-welcome-hero`}>
            <h1 className={`${p}-welcome-title`}>{t('welcome.title', language)}</h1>
            <p className={`${p}-welcome-subtitle`}>{t('welcome.subtitle', language)}</p>

            <div className={`${p}-welcome-actions`}>
              <button className={`${p}-welcome-primary-button`} onClick={handleOpenFolder}>
                <FolderOpen className="h-4 w-4" />
                <span>{t('welcome.openFolder', language)}</span>
              </button>
              <button className={`${p}-welcome-outline-button`} onClick={handleOpenWorkspace}>
                <Folder className="h-4 w-4" />
                <span>{t('welcome.openWorkspace', language)}</span>
              </button>
            </div>
          </div>

          <section className={`${p}-welcome-recent`}>
            <div className={`${p}-welcome-recent-header`}>
              <h3>
                <History className="h-4 w-4" />
                {t('welcome.recent', language)}
              </h3>
              <div className={`${p}-welcome-footer-actions`}>
                <button className={`${p}-welcome-ghost-button`} onClick={() => api.window.new()}>
                  <Plus className="h-3.5 w-3.5" />
                  <span>{t('welcome.newWindow', language)}</span>
                </button>
                <button className={`${p}-welcome-ghost-button`} onClick={() => setShowSettings(true)}>
                  <Settings className="h-3.5 w-3.5" />
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
                    <span className={`${p}-welcome-recent-icon`}>
                      <Folder className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{workspace.name}</span>
                      <span className="block truncate font-mono text-[11px] text-text-muted/85">{workspace.path}</span>
                    </span>
                  </button>
                ))
              ) : (
                <div className={`${p}-welcome-empty-recent`}>{t('welcome.noRecentItems', language)}</div>
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
        max-width: 720px;
        margin: 0 auto;
        padding: 60px 48px 40px;
        display: flex;
        flex-direction: column;
        min-height: 100%;
      }

      .${rootClass} .${p}-welcome-hero {
        text-align: center;
        padding-bottom: 48px;
        padding-top: 20vh;
      }

      .${rootClass} .${p}-welcome-title {
        font-size: 28px;
        font-weight: 700;
        color: rgb(var(--text-primary));
        letter-spacing: -0.01em;
        margin: 0;
      }

      .${rootClass} .${p}-welcome-subtitle {
        margin-top: 10px;
        font-size: 14px;
        line-height: 1.6;
        color: rgb(var(--text-muted));
      }

      .${rootClass} .${p}-welcome-actions {
        display: flex;
        justify-content: center;
        gap: 12px;
        margin-top: 28px;
      }

      .${rootClass} .${p}-welcome-primary-button,
      .${rootClass} .${p}-welcome-outline-button {
        display: inline-flex;
        height: 40px;
        align-items: center;
        justify-content: center;
        gap: 8px;
        border-radius: 10px;
        padding: 0 20px;
        font-size: 13px;
        font-weight: 600;
        white-space: nowrap;
        transition: all 0.15s ease;
        cursor: pointer;
      }

      .${rootClass} .${p}-welcome-primary-button {
        color: white;
        background: rgb(var(--accent));
        border: none;
      }

      .${rootClass} .${p}-welcome-primary-button:hover {
        filter: brightness(1.1);
      }

      .${rootClass} .${p}-welcome-outline-button {
        border: 1px solid rgb(var(--border));
        color: rgb(var(--text-primary));
        background: transparent;
      }

      .${rootClass} .${p}-welcome-outline-button:hover {
        background: rgba(var(--surface-hover), 0.6);
        border-color: rgba(var(--accent), 0.4);
      }

      .${rootClass} .${p}-welcome-ghost-button {
        display: inline-flex;
        height: 30px;
        align-items: center;
        gap: 5px;
        border-radius: 8px;
        padding: 0 10px;
        font-size: 12px;
        font-weight: 500;
        color: rgb(var(--text-muted));
        background: transparent;
        border: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .${rootClass} .${p}-welcome-ghost-button:hover {
        color: rgb(var(--text-primary));
        background: rgba(var(--surface-hover), 0.5);
      }

      .${rootClass} .${p}-welcome-recent {
        margin-top: auto;
        padding-top: 32px;
        border-top: 1px solid rgb(var(--border) / 0.5);
      }

      .${rootClass} .${p}-welcome-recent-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }

      .${rootClass} .${p}-welcome-recent-header h3 {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 13px;
        font-weight: 600;
        color: rgb(var(--text-secondary));
      }

      .${rootClass} .${p}-welcome-footer-actions {
        display: flex;
        gap: 4px;
      }

      .${rootClass} .${p}-welcome-recent-list {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 8px;
        max-height: 260px;
        overflow-y: auto;
      }

      .${rootClass} .${p}-welcome-recent-item {
        display: flex;
        align-items: center;
        gap: 12px;
        border-radius: 10px;
        padding: 10px 12px;
        text-align: left;
        color: rgb(var(--text-secondary));
        background: rgba(var(--surface), 0.3);
        border: 1px solid rgba(var(--border), 0.3);
        transition: all 0.15s ease;
        cursor: pointer;
      }

      .${rootClass} .${p}-welcome-recent-item:hover {
        color: rgb(var(--text-primary));
        background: rgba(var(--surface-hover), 0.6);
        border-color: rgba(var(--accent), 0.25);
      }

      .${rootClass} .${p}-welcome-recent-icon {
        display: flex;
        width: 32px;
        height: 32px;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        color: rgb(var(--text-muted));
        background: rgba(var(--text-primary), 0.05);
        transition: color 0.15s ease;
      }

      .${rootClass} .${p}-welcome-recent-item:hover .${p}-welcome-recent-icon {
        color: rgb(var(--accent));
        background: rgba(var(--accent), 0.1);
      }

      .${rootClass} .${p}-welcome-empty-recent {
        grid-column: 1 / -1;
        display: flex;
        min-height: 80px;
        align-items: center;
        justify-content: center;
        border: 1px dashed rgba(var(--border), 0.6);
        border-radius: 10px;
        font-size: 13px;
        color: rgb(var(--text-muted));
      }

      @container (max-width: 520px) {
        .${rootClass} .${p}-welcome-shell {
          padding: 40px 24px 32px;
        }

        .${rootClass} .${p}-welcome-title {
          font-size: 22px;
        }

        .${rootClass} .${p}-welcome-actions {
          flex-direction: column;
        }

        .${rootClass} .${p}-welcome-primary-button,
        .${rootClass} .${p}-welcome-outline-button {
          width: 100%;
        }

        .${rootClass} .${p}-welcome-recent-list {
          grid-template-columns: 1fr;
        }
      }
    `}</style>
  )
}
