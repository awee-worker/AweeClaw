/**
 * 内置浏览器工具栏（三段式布局）
 *
 * [后退][前进][刷新/停止] │ [地址栏] │ [检查元素][缩小][放大][外部打开][新建标签页]
 *
 * - 导航组：后退/前进按 canGoBack/canGoForward 禁用；刷新与停止按 isLoading 切换
 * - 地址栏：BrowserAddressBar（flex-1）
 * - 功能组：元素检查（DevTools toggle）、缩放（50%–300%，点击百分比重置）、
 *           外部打开（系统浏览器）、新建标签页（强制创建新会话）
 */
import { ArrowLeft, ArrowRight, RefreshCw, X, SquareDashedMousePointer, ZoomIn, ZoomOut, ExternalLink, Plus } from 'lucide-react'
import { ActionButton } from '@components/ui'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import type { WebviewController } from './hooks/useWebviewController'
import BrowserAddressBar from './BrowserAddressBar'

interface BrowserToolbarProps {
  controller: WebviewController
  addressInput: string
  onAddressChange: (value: string) => void
  onNavigate: (url: string) => void
  onResetAddress: () => void
  /** 在系统浏览器打开当前 URL */
  onOpenExternal: () => void
  /** 新建标签页（创建新会话） */
  onNewTab: () => void
}

export default function BrowserToolbar({
  controller,
  addressInput,
  onAddressChange,
  onNavigate,
  onResetAddress,
  onOpenExternal,
  onNewTab,
}: BrowserToolbarProps) {
  const language = useStore((state) => state.language) as Language
  const { canGoBack, canGoForward, isLoading, devtoolsOpen, zoomFactor } = controller

  const zoomPercent = Math.round(zoomFactor * 100)

  return (
    <div className="h-11 border-b border-border/50 px-3 flex items-center gap-2">
      {/* 导航组 */}
      <div className="flex items-center gap-0.5 shrink-0">
        <ActionButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={controller.goBack}
          disabled={!canGoBack}
          title={t('editor.browser.back', language)}
          aria-label={t('editor.browser.back', language)}
        >
          <ArrowLeft className="w-4 h-4" />
        </ActionButton>

        <ActionButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={controller.goForward}
          disabled={!canGoForward}
          title={t('editor.browser.forward', language)}
          aria-label={t('editor.browser.forward', language)}
        >
          <ArrowRight className="w-4 h-4" />
        </ActionButton>

        <ActionButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={isLoading ? controller.stop : controller.reload}
          title={isLoading ? t('editor.browser.stop', language) : t('editor.browser.reload', language)}
          aria-label={isLoading ? t('editor.browser.stop', language) : t('editor.browser.reload', language)}
        >
          {isLoading ? <X className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}
        </ActionButton>
      </div>

      {/* 地址栏 */}
      <BrowserAddressBar
        value={addressInput}
        onChange={onAddressChange}
        onNavigate={onNavigate}
        onReset={onResetAddress}
        isLoading={isLoading}
      />

      {/* 功能组 */}
      <div className="flex items-center gap-0.5 shrink-0">
        {/* 元素检查（DevTools toggle） */}
        <ActionButton
          variant="ghost"
          size="icon"
          className={`h-8 w-8 ${devtoolsOpen ? 'text-accent ring-2 ring-accent/30' : ''}`}
          onClick={controller.toggleDevtools}
          title={devtoolsOpen ? t('editor.browser.inspectActive', language) : t('editor.browser.inspect', language)}
          aria-label={t('editor.browser.inspect', language)}
          aria-pressed={devtoolsOpen}
        >
          <SquareDashedMousePointer className="w-4 h-4" />
        </ActionButton>

        {/* 缩放：缩小 + 百分比(点击重置) + 放大 */}
        <ActionButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={controller.zoomOut}
          title={t('editor.browser.zoomOut', language)}
          aria-label={t('editor.browser.zoomOut', language)}
        >
          <ZoomOut className="w-4 h-4" />
        </ActionButton>

        <button
          type="button"
          onClick={controller.resetZoom}
          className="h-8 min-w-[3rem] px-1.5 text-xs tabular-nums text-text-secondary hover:text-text-primary rounded-lg hover:bg-text-primary/[0.05] transition-colors"
          title={t('editor.browser.zoomReset', language)}
        >
          {t('editor.browser.zoomLabel', language, { percent: zoomPercent })}
        </button>

        <ActionButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={controller.zoomIn}
          title={t('editor.browser.zoomIn', language)}
          aria-label={t('editor.browser.zoomIn', language)}
        >
          <ZoomIn className="w-4 h-4" />
        </ActionButton>

        {/* 外部打开 */}
        <ActionButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onOpenExternal}
          title={t('editor.browser.openExternal', language)}
          aria-label={t('editor.browser.openExternal', language)}
        >
          <ExternalLink className="w-4 h-4" />
        </ActionButton>

        {/* 新建标签页 */}
        <ActionButton
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onNewTab}
          title={t('editor.browser.newTab', language)}
          aria-label={t('editor.browser.newTab', language)}
        >
          <Plus className="w-4 h-4" />
        </ActionButton>
      </div>
    </div>
  )
}
