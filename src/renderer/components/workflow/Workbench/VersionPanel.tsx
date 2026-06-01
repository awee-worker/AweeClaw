import { useState, useEffect, useCallback } from 'react'
import { GitBranch, GitCompare, RotateCcw, X, Clock, ArrowRight, Check, AlertTriangle } from 'lucide-react'
import { workflowClientAPI } from '@shared/configuration/workflows/workflowClientAPI'
import { t, type Language } from '@renderer/i18n'

interface VersionInfo {
  id: string
  version: string
  note: string
  createdBy: string
  createdAt: string
}

interface VersionDetail extends VersionInfo {
  nodes: unknown[]
  edges: unknown[]
}

interface VersionPanelProps {
  workflowId: string
  visible: boolean
  onClose: () => void
  onRestored: () => void
  language?: 'en' | 'zh'
}

export default function VersionPanel({
  workflowId,
  visible,
  onClose,
  onRestored,
  language = 'zh',
}: VersionPanelProps) {
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedVersion, setSelectedVersion] = useState<VersionDetail | null>(null)
  const [diffMode, setDiffMode] = useState(false)
  const [diffData, setDiffData] = useState<Record<string, unknown> | null>(null)
  const [restoring, setRestoring] = useState(false)
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)

  const loadVersions = useCallback(async () => {
    if (!workflowId) return
    setLoading(true)
    setError(null)
    try {
      const data = await workflowClientAPI.getVersions(workflowId) as VersionInfo[]
      setVersions(data || [])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  useEffect(() => {
    if (visible && workflowId) {
      loadVersions()
      setSelectedVersion(null)
      setDiffMode(false)
      setDiffData(null)
      setRestoreMessage(null)
    }
  }, [visible, workflowId, loadVersions])

  const handleSelectVersion = useCallback(
    async (version: VersionInfo) => {
      try {
        const detail = (await workflowClientAPI.getVersion(
          workflowId,
          version.id,
        )) as VersionDetail
        setSelectedVersion(detail)
        setDiffMode(false)
        setDiffData(null)
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [workflowId],
  )

  const handleCompare = useCallback(async () => {
    if (!selectedVersion) return
    setDiffMode(true)
    try {
      const diff = (await workflowClientAPI.getVersionDiff?.(
        workflowId,
        selectedVersion.id,
      )) as Record<string, unknown>
      setDiffData(diff || null)
    } catch (err) {
      setDiffData(null)
    }
  }, [workflowId, selectedVersion])

  const handleRestore = useCallback(async () => {
    if (!selectedVersion) return
    setRestoring(true)
    setRestoreMessage(null)
    try {
      await workflowClientAPI.restoreVersion(workflowId, selectedVersion.id)
      setRestoreMessage(
        t('wf.restoredtoversion', language as Language, { version: selectedVersion.version }),
      )
      onRestored()
    } catch (err) {
      setRestoreMessage(
        t('wf.restorefailed', language as Language, { p0: (err as Error).message }),
      )
    } finally {
      setRestoring(false)
    }
  }, [workflowId, selectedVersion, onRestored, language])

  if (!visible) return null

  return (
    <div className="w-80 border-l border-[var(--border)] bg-[var(--background)] flex flex-col flex-shrink-0 h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]/60">
        <div className="flex items-center gap-1.5">
          <GitBranch className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span className="text-xs font-medium text-[var(--text-primary)]">
            {t('wf.versions', language as Language)}
          </span>
        </div>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-[var(--border)]/50 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8 text-xs text-[var(--text-muted)]">
            <div className="w-4 h-4 border-2 border-[var(--accent)]/30 border-t-[var(--accent)] rounded-full animate-spin mr-2" />
            {t('wf.loading', language as Language)}
          </div>
        )}

        {error && (
          <div className="mx-3 mt-3 p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400">
            {error}
          </div>
        )}

        {!loading && !error && versions.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 px-4">
            <Clock className="w-8 h-8 text-[var(--text-muted)]/30 mb-2" />
            <span className="text-xs text-[var(--text-muted)]">
              {t('wf.noversionsyet', language as Language)}
            </span>
          </div>
        )}

        {!loading && !error && (
          <div className="p-2 space-y-1">
            {versions.map((v) => (
              <button
                key={v.id}
                onClick={() => handleSelectVersion(v)}
                className={`w-full text-left p-2 rounded-lg text-xs transition-colors ${
                  selectedVersion?.id === v.id
                    ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/20'
                    : 'hover:bg-[var(--border)]/30 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-medium text-[var(--text-primary)]">
                    v{v.version}
                  </span>
                  <span className="text-[var(--text-muted)] text-[11px]">
                    {new Date(v.createdAt).toLocaleDateString(
                      t('wf.enus', language as Language),
                      { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' },
                    )}
                  </span>
                </div>
                {v.note && (
                  <p className="mt-0.5 text-[var(--text-muted)] text-[11px] truncate">
                    {v.note}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {selectedVersion && (
        <div className="border-t border-[var(--border)]/60 p-3 space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-[var(--text-primary)]">
                {t('wf.versiondetail', language as Language)}
              </span>
              <span className="font-mono text-xs text-[var(--accent)]">
                v{selectedVersion.version}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="p-1.5 rounded bg-[var(--border)]/20">
                <span className="text-[var(--text-muted)]">
                  {t('wf.nodes', language as Language)}
                </span>
                <span className="ml-1 text-[var(--text-primary)] font-medium">
                  {(selectedVersion.nodes as unknown[])?.length || 0}
                </span>
              </div>
              <div className="p-1.5 rounded bg-[var(--border)]/20">
                <span className="text-[var(--text-muted)]">
                  {t('wf.edges', language as Language)}
                </span>
                <span className="ml-1 text-[var(--text-primary)] font-medium">
                  {(selectedVersion.edges as unknown[])?.length || 0}
                </span>
              </div>
            </div>

            {selectedVersion.note && (
              <p className="text-[11px] text-[var(--text-muted)]">
                <span className="text-[var(--text-muted)]/60">
                  {t('wf.note', language as Language)}
                </span>
                {selectedVersion.note}
              </p>
            )}
          </div>

          <div className="flex gap-1.5">
            <button
              onClick={handleCompare}
              disabled={diffMode}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--border)]/30 transition-colors disabled:opacity-50"
            >
              <GitCompare className="w-3 h-3" />
              {t('wf.compare', language as Language)}
            </button>
            <button
              onClick={handleRestore}
              disabled={restoring}
              className="flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-xs rounded-lg bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 border border-[var(--accent)]/20 transition-colors disabled:opacity-50"
            >
              <RotateCcw className={`w-3 h-3 ${restoring ? 'animate-spin' : ''}`} />
              {t('wf.restore', language as Language)}
            </button>
          </div>

          {diffMode && diffData && (
            <DiffView diff={diffData} language={language} />
          )}

          {restoreMessage && (
            <div
              className={`flex items-center gap-1.5 p-2 rounded-lg text-xs ${
                restoreMessage.includes('失败') || restoreMessage.includes('failed')
                  ? 'bg-red-500/10 text-red-400'
                  : 'bg-green-500/10 text-green-400'
              }`}
            >
              {restoreMessage.includes('失败') || restoreMessage.includes('failed') ? (
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
              ) : (
                <Check className="w-3 h-3 flex-shrink-0" />
              )}
              {restoreMessage}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DiffView({
  diff,
  language,
}: {
  diff: Record<string, unknown>
  language: 'en' | 'zh'
}) {
  const currentNodes = (diff.current as Record<string, unknown>)?.nodes as unknown[] | undefined
  const versionNodes = (diff.version as Record<string, unknown>)?.nodes as unknown[] | undefined
  const currentEdges = (diff.current as Record<string, unknown>)?.edges as unknown[] | undefined
  const versionEdges = (diff.version as Record<string, unknown>)?.edges as unknown[] | undefined

  const nodeDiff = (currentNodes?.length || 0) - (versionNodes?.length || 0)
  const edgeDiff = (currentEdges?.length || 0) - (versionEdges?.length || 0)

  return (
    <div className="p-2 rounded-lg bg-[var(--border)]/20 space-y-1.5 text-[11px]">
      <div className="flex items-center justify-between">
        <span className="text-[var(--text-muted)]">
          {t('wf.nodechanges', language as Language)}
        </span>
        <span
          className={`font-mono ${nodeDiff > 0 ? 'text-green-400' : nodeDiff < 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}`}
        >
          {nodeDiff > 0 ? '+' : ''}
          {nodeDiff}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-[var(--text-muted)]">
          {t('wf.edgechanges', language as Language)}
        </span>
        <span
          className={`font-mono ${edgeDiff > 0 ? 'text-green-400' : edgeDiff < 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}`}
        >
          {edgeDiff > 0 ? '+' : ''}
          {edgeDiff}
        </span>
      </div>
      <div className="flex items-center gap-1 text-[var(--text-muted)]/60">
        <span>v{String((diff.version as Record<string, unknown>)?.['version']) || '?'}</span>
        <ArrowRight className="w-2.5 h-2.5" />
        <span>{t('wf.current', language as Language)}</span>
      </div>
    </div>
  )
}