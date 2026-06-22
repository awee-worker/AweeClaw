/**
 * 屏幕截图面板
 * 支持全屏截图、区域截图、多屏截图
 * 截图后可预览、复制到剪贴板、保存到文件
 */

import { useState, useCallback } from 'react'
import { Camera, Crop, Monitor, Download, Clipboard, RefreshCw, X } from 'lucide-react'
import { type Language, t } from '@renderer/i18n'
import { ActionButton } from '@components/ui'
import { logger } from '@renderer/toolkit/LogEngine'

interface ScreenshotResult {
  success: boolean
  dataUrl: string
  region: { x: number; y: number; width: number; height: number }
  displayId: number
  timestamp: number
  error?: string
}

interface ScreenCapturePanelProps {
  language: Language
}

export function ScreenCapturePanel({ language }: ScreenCapturePanelProps) {
  const [capturing, setCapturing] = useState(false)
  const [screenshot, setScreenshot] = useState<ScreenshotResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 区域截图参数
  const [regionX, setRegionX] = useState(0)
  const [regionY, setRegionY] = useState(0)
  const [regionW, setRegionW] = useState(800)
  const [regionH, setRegionH] = useState(600)
  const [displayId, setDisplayId] = useState(0)

  const handleCaptureScreen = useCallback(async () => {
    setCapturing(true)
    setError(null)
    try {
      const result = await window.electronAPI.desktopCaptureScreen(displayId)
      if (result.success) {
        setScreenshot(result.data)
      } else {
        setError(t('desktop.captureFailed', language) || '截图失败')
      }
    } catch (err) {
      logger.desktop?.error?.('[ScreenCapturePanel] captureScreen error:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCapturing(false)
    }
  }, [displayId, language])

  const handleCaptureRegion = useCallback(async () => {
    if (regionW <= 0 || regionH <= 0) {
      setError(t('desktop.invalidRegion', language) || '区域参数无效')
      return
    }
    setCapturing(true)
    setError(null)
    try {
      const result = await window.electronAPI.desktopCaptureRegion(
        { x: regionX, y: regionY, width: regionW, height: regionH },
        displayId,
      )
      if (result.success) {
        setScreenshot(result.data)
      } else {
        setError(t('desktop.captureFailed', language) || '截图失败')
      }
    } catch (err) {
      logger.desktop?.error?.('[ScreenCapturePanel] captureRegion error:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCapturing(false)
    }
  }, [regionX, regionY, regionW, regionH, displayId, language])

  const handleCopyToClipboard = useCallback(async () => {
    if (!screenshot?.dataUrl) return
    try {
      const blob = await fetch(screenshot.dataUrl).then(r => r.blob())
      await navigator.clipboard.write([
        new ClipboardItem({ [blob.type]: blob }),
      ])
    } catch (err) {
      logger.desktop?.error?.('[ScreenCapturePanel] copy failed:', err)
      setError(t('desktop.copyFailed', language) || '复制失败')
    }
  }, [screenshot, language])

  const handleDownload = useCallback(() => {
    if (!screenshot?.dataUrl) return
    const link = document.createElement('a')
    link.href = screenshot.dataUrl
    link.download = `screenshot-${screenshot.timestamp}.png`
    link.click()
  }, [screenshot])

  return (
    <div className="space-y-4">
      {/* 截图模式选择 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* 全屏截图 */}
        <div className="p-4 rounded-xl border border-border/40 bg-surface/50">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-md bg-accent/10 text-accent">
              <Monitor className="w-4 h-4" />
            </div>
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
              {t('desktop.fullScreenCapture', language) || '全屏截图'}
            </span>
          </div>
          <div className="flex items-center gap-2 mb-3">
            <label className="text-xs text-text-muted">{t('desktop.display', language) || '显示器'}</label>
            <input
              type="number"
              min={0}
              value={displayId}
              onChange={e => setDisplayId(parseInt(e.target.value, 10) || 0)}
              className="w-16 px-2 py-1 rounded-md bg-surface border border-border/60 text-sm text-text-primary focus:outline-none focus:border-accent/50"
            />
          </div>
          <ActionButton
            onClick={() => void handleCaptureScreen()}
            variant="primary"
            size="sm"
            disabled={capturing}
            className="w-full"
          >
            <Camera className={`w-4 h-4 ${capturing ? 'animate-pulse' : ''}`} />
            <span className="ml-1.5">
              {capturing ? (t('desktop.capturing', language) || '截图中...') : (t('desktop.capture', language) || '截图')}
            </span>
          </ActionButton>
        </div>

        {/* 区域截图 */}
        <div className="p-4 rounded-xl border border-border/40 bg-surface/50">
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1.5 rounded-md bg-accent/10 text-accent">
              <Crop className="w-4 h-4" />
            </div>
            <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
              {t('desktop.regionCapture', language) || '区域截图'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <label className="text-xs text-text-muted">X</label>
              <input
                type="number"
                value={regionX}
                onChange={e => setRegionX(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2 py-1 rounded-md bg-surface border border-border/60 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted">Y</label>
              <input
                type="number"
                value={regionY}
                onChange={e => setRegionY(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2 py-1 rounded-md bg-surface border border-border/60 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted">{t('desktop.width', language) || '宽'}</label>
              <input
                type="number"
                min={1}
                value={regionW}
                onChange={e => setRegionW(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2 py-1 rounded-md bg-surface border border-border/60 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>
            <div>
              <label className="text-xs text-text-muted">{t('desktop.height', language) || '高'}</label>
              <input
                type="number"
                min={1}
                value={regionH}
                onChange={e => setRegionH(parseInt(e.target.value, 10) || 0)}
                className="w-full px-2 py-1 rounded-md bg-surface border border-border/60 text-sm text-text-primary focus:outline-none focus:border-accent/50"
              />
            </div>
          </div>
          <ActionButton
            onClick={() => void handleCaptureRegion()}
            variant="primary"
            size="sm"
            disabled={capturing}
            className="w-full"
          >
            <Crop className={`w-4 h-4 ${capturing ? 'animate-pulse' : ''}`} />
            <span className="ml-1.5">
              {capturing ? (t('desktop.capturing', language) || '截图中...') : (t('desktop.captureRegion', language) || '区域截图')}
            </span>
          </ActionButton>
        </div>
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
          <X className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="text-red-600 hover:text-red-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 截图预览 */}
      {screenshot ? (
        <div className="rounded-xl border border-border/40 bg-surface/50 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 border-b border-border/40 bg-surface-hover/30">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-muted uppercase tracking-wide">
                {t('desktop.preview', language) || '预览'}
              </span>
              <span className="text-xs text-text-muted">
                {screenshot.region.width}×{screenshot.region.height} ·{' '}
                {new Date(screenshot.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => void handleCopyToClipboard()}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-accent/10 text-accent hover:bg-accent/20 text-xs font-medium"
              >
                <Clipboard className="w-3 h-3" />
                <span>{t('desktop.copy', language) || '复制'}</span>
              </button>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 text-xs font-medium"
              >
                <Download className="w-3 h-3" />
                <span>{t('desktop.save', language) || '保存'}</span>
              </button>
              <button
                onClick={() => setScreenshot(null)}
                className="flex items-center gap-1 px-2 py-1 rounded-md bg-surface-hover text-text-secondary hover:bg-surface-hover/80 text-xs font-medium"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="p-4 max-h-[400px] overflow-auto bg-black/5">
            <img
              src={screenshot.dataUrl}
              alt={t('desktop.screenshotAlt', language) || '截图预览'}
              className="max-w-full h-auto rounded-lg shadow-md mx-auto"
            />
          </div>
        </div>
      ) : (
        <div className="text-center py-12 text-text-muted text-sm border border-dashed border-border/40 rounded-xl">
          <RefreshCw className="w-6 h-6 mx-auto mb-2 opacity-50" />
          {t('desktop.noScreenshot', language) || '暂无截图，点击上方按钮开始截图'}
        </div>
      )}
    </div>
  )
}

export default ScreenCapturePanel
