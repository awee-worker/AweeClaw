/**
 * PreviewPanel - 预览面板（主容器）
 *
 * 集成 DeviceFrame 和 PreviewToolbar，提供完整的预览体验。
 */
import type React from 'react'
import { useState, useCallback } from 'react'
import { Monitor, Tablet, Smartphone, ExternalLink, RefreshCw } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import { previewService } from '../../services/PreviewService'
import type { PreviewDevice, PreviewServerState } from '../../services/PreviewService'

interface PreviewPanelProps {
  projectId?: string
}

const DEVICE_KEYS: PreviewDevice[] = ['desktop', 'tablet', 'mobile']

const DEVICE_ICONS: Record<PreviewDevice, React.ComponentType<{ className?: string }>> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
}

const PreviewPanel: React.FC<PreviewPanelProps> = ({
  projectId,
}) => {
  const { t } = useI18n()
  const [device, setDevice] = useState<PreviewDevice>('desktop')
  const [serverState, setServerState] = useState<PreviewServerState>(previewService.getServerState())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dimensions = previewService.getDeviceDimensions(device)
  const previewUrl = serverState.running
    ? previewService.getPreviewUrl(projectId ?? '')
    : null

  const handleStart = useCallback(async () => {
    if (!projectId) return
    setLoading(true)
    setError(null)
    try {
      const state = await previewService.startDevServer(projectId)
      setServerState(state)
    } catch (err) {
      setError(t('studio.preview.serverFailed'))
    } finally {
      setLoading(false)
    }
  }, [projectId])

  const handleStop = useCallback(async () => {
    setLoading(true)
    try {
      const state = await previewService.stopDevServer()
      setServerState(state)
    } catch (err) {
      setError(t('studio.preview.stopFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  const handleRefresh = useCallback(() => {
    setServerState(prev => ({ ...prev }))
  }, [])

  if (!projectId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-2 p-4">
        <Monitor className="w-8 h-8 opacity-30" />
        <p className="text-xs">{t('studio.preview.selectProject')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* 工具栏 */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-muted/20">
        <div className="flex items-center gap-1">
          {DEVICE_KEYS.map(d => {
            const Icon = DEVICE_ICONS[d]
            return (
              <button
                key={d}
                onClick={() => setDevice(d)}
                className={`p-1 rounded transition-colors ${
                  device === d
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                }`}
                title={t(`studio.preview.${d}`)}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-1">
          {serverState.running ? (
            <>
              <span className="flex items-center gap-1 text-[10px] text-emerald-500">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                :{serverState.port}
              </span>
              <button
                onClick={handleRefresh}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
                title={t('studio.preview.refresh')}
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleStop}
                className="px-2 py-0.5 rounded text-[10px] bg-red-500/10 text-red-500 hover:bg-red-500/20"
              >
                {t('studio.preview.stop')}
              </button>
            </>
          ) : (
            <button
              onClick={handleStart}
              disabled={loading}
              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
              {loading ? t('studio.preview.starting') : t('studio.preview.startPreview')}
            </button>
          )}
          {previewUrl && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="p-1 rounded hover:bg-muted text-muted-foreground"
              title={t('studio.preview.openInBrowser')}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* 预览区 */}
      <div className="flex-1 flex items-center justify-center bg-muted/30 p-4 overflow-auto">
        {error ? (
          <div className="text-center">
            <p className="text-xs text-red-500">{error}</p>
            <button
              onClick={handleStart}
              className="mt-2 text-[10px] text-primary hover:underline"
            >
              {t('studio.preview.retry')}
            </button>
          </div>
        ) : serverState.running && previewUrl ? (
          <div
            className="border border-border rounded-lg shadow-lg overflow-hidden bg-white transition-all duration-300"
            style={{ width: dimensions.width, height: dimensions.height, maxWidth: '100%', maxHeight: '100%' }}
          >
            {/* 设备框架 */}
            <div className="flex items-center h-7 px-3 bg-muted/30 border-b border-border gap-1.5">
              <div className="flex gap-1">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <div className="w-2 h-2 rounded-full bg-orange-400" />
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
              </div>
              <div className="flex-1 text-center">
                <span className="text-[9px] text-muted-foreground truncate block">
                  {previewUrl}
                </span>
              </div>
            </div>
            <iframe
              src={previewUrl}
              className="w-full border-0"
              style={{ height: 'calc(100% - 28px)' }}
              title="Preview"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground">
            <Monitor className="w-12 h-12 opacity-20" />
            <p className="text-xs">{t('studio.preview.startServerHint')}</p>
            <button
              onClick={handleStart}
              disabled={loading}
              className="px-3 py-1 rounded text-[10px] bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? t('studio.preview.starting') : t('studio.preview.startServer')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default PreviewPanel