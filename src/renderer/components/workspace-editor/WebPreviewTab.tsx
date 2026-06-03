import { useEffect, useMemo, useState } from 'react'
import { RefreshCw, Search, Globe, ArrowUpRight } from 'lucide-react'
import { useStore } from '@store'
import type { OpenFile } from '@store'
import { ActionButton } from '../ui'
import { previewSessionService } from '@/renderer/preview/previewSessionManager'
import { devServerDiscoveryService } from '@/renderer/preview/devServerLocator'
import { t, type Language } from '@renderer/i18n'

interface BrowserPreviewTabProps {
  file: OpenFile
}

function sanitizeUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) {
    return ''
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  return `http://${trimmed}`
}

export default function BrowserPreviewTab({ file }: BrowserPreviewTabProps) {
  const workspace = useStore((state) => state.workspace)
  const language = useStore((state) => state.language)
  const preview = file.preview
  const initialSession = preview ? previewSessionService.getSession(preview.sessionId) : null

  const [session, setSession] = useState(initialSession)
  const [discoveryState, setDiscoveryState] = useState(() => devServerDiscoveryService.getState())
  const [addressInput, setAddressInput] = useState(initialSession?.url || preview?.url || '')

  useEffect(() => {
    if (preview) {
      previewSessionService.restoreSession(preview)
      setSession(previewSessionService.getSession(preview.sessionId))
      setAddressInput(preview.url)
    }
  }, [preview])

  useEffect(() => previewSessionService.subscribe((state) => {
    if (!preview?.sessionId) {
      return
    }
    const nextSession = state.sessions.find((item) => item.id === preview.sessionId) || null
    setSession(nextSession)
    if (nextSession) {
      setAddressInput(nextSession.url)
    }
  }), [preview?.sessionId])

  useEffect(() => devServerDiscoveryService.subscribe(setDiscoveryState), [])

  useEffect(() => {
    if (workspace?.roots?.length) {
      void devServerDiscoveryService.refresh(workspace.roots)
    }
  }, [workspace?.roots])

  const workspaceRoot = preview?.workspaceRoot || workspace?.roots?.[0]
  const scopedCandidates = useMemo(
    () => devServerDiscoveryService.getCandidatesForWorkspace(workspaceRoot).slice(0, 4),
    [discoveryState, workspaceRoot],
  )

  const activeSession = session || initialSession
  const iframeKey = activeSession ? `${activeSession.id}:${activeSession.reloadToken}` : 'preview-empty'

  const handleNavigate = () => {
    if (!preview?.sessionId) {
      return
    }

    const nextUrl = sanitizeUrl(addressInput)
    if (!nextUrl) {
      return
    }

    previewSessionService.navigate(preview.sessionId, nextUrl)
  }

  const handleOpenPreferred = async () => {
    if (!workspace?.roots?.length) {
      return
    }

    const nextSession = await previewSessionService.openPreferredPreview(workspace.roots)
    if (nextSession) {
      setSession(nextSession)
    }
  }

  const openCandidate = (candidateUrl: string) => {
    if (!preview?.sessionId) {
      return
    }
    previewSessionService.navigate(preview.sessionId, candidateUrl)
  }

  return (
    <div className="h-full flex flex-col bg-background-editor">
      <div className="h-11 border-b border-border/50 px-3 flex items-center gap-2">
        <ActionButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => preview?.sessionId && previewSessionService.reload(preview.sessionId)}
          title={t('editor.reloadpreview', language as Language)}
          disabled={!preview?.sessionId}
        >
          <RefreshCw className={`w-4 h-4 ${activeSession?.status === 'loading' ? 'animate-spin' : ''}`} />
        </ActionButton>

        <div className="flex-1 h-8 rounded-lg border border-border/50 bg-surface/40 flex items-center gap-2 px-2.5">
          <Globe className="w-3.5 h-3.5 text-text-muted" />
          <input
            value={addressInput}
            onChange={(event) => setAddressInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                handleNavigate()
              }
            }}
            className="flex-1 bg-transparent text-sm outline-none text-text-primary placeholder:text-text-muted"
            placeholder="http://127.0.0.1:5173"
          />
        </div>

        <ActionButton variant="secondary" size="sm" onClick={handleNavigate}>
          {t('editor.open', language as Language)}
        </ActionButton>

        <ActionButton variant="ghost" size="icon" className="h-8 w-8" onClick={handleOpenPreferred} title={t('editor.discoverlocaldevserver', language as Language)}>
          <Search className="w-4 h-4" />
        </ActionButton>
      </div>

      {scopedCandidates.length > 0 && (
        <div className="px-3 py-2 border-b border-border/40 flex items-center gap-2 overflow-x-auto scrollbar-none">
          {scopedCandidates.map((candidate) => (
            <button
              key={candidate.id}
              onClick={() => openCandidate(candidate.url)}
              className={`px-2.5 py-1.5 rounded-full text-xs whitespace-nowrap border transition-colors ${
                activeSession?.url === candidate.url
                  ? 'border-accent/40 bg-accent/10 text-accent'
                  : 'border-border/40 bg-surface/30 text-text-secondary hover:text-text-primary hover:bg-surface/50'
              }`}
            >
              {candidate.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 relative">
        {!activeSession ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-6 text-text-muted">
            <Globe className="w-10 h-10 mb-4 opacity-60" />
            <p className="text-sm font-medium text-text-primary">
              {t('editor.nopreviewsessionyet', language as Language)}
            </p>
            <p className="text-xs mt-2 max-w-md leading-relaxed">
              {t('editor.startyourlocaldevserver', language as Language)}
            </p>
          </div>
        ) : (
          <>
            <iframe
              key={iframeKey}
              src={activeSession.url}
              title={activeSession.title}
              className="w-full h-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              onLoad={() => {
                previewSessionService.markStatus(activeSession.id, 'ready')
              }}
              onError={() => {
                previewSessionService.markStatus(activeSession.id, 'error', 'Failed to load preview')
              }}
            />

            {activeSession.status === 'loading' && (
              <div className="absolute inset-0 pointer-events-none bg-background-editor/35 backdrop-blur-[1px] flex items-center justify-center">
                <div className="px-3 py-2 rounded-lg bg-background-editor/90 border border-border/50 text-xs text-text-secondary flex items-center gap-2 shadow-lg">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  {t('editor.progressindicatorpreview', language as Language)}
                </div>
              </div>
            )}

            {activeSession.status === 'error' && (
              <div className="absolute inset-x-4 bottom-4 rounded-xl border border-status-error/30 bg-background-editor/90 px-4 py-3 shadow-xl">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-status-error/10 text-status-error flex items-center justify-center shrink-0">
                    <ArrowUpRight className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-text-primary">
                      {t('editor.previewfailedtoload', language as Language)}
                    </p>
                    <p className="text-xs text-text-secondary mt-1">
                      {activeSession.lastError || activeSession.url}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

