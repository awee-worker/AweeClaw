/**
 * 内置浏览器工具栏（三段式布局）
 *
 * [后退][前进][刷新/停止] │ [地址栏] │ [AI 修改][检查元素][缩小][放大][设备模拟][外部打开][新建标签页]
 *
 * - 导航组：后退/前进按 canGoBack/canGoForward 禁用；刷新与停止按 isLoading 切换
 * - 地址栏：BrowserAddressBar（flex-1）
 * - 功能组：AI 修改（元素拾取，渐变底色突出）、检查元素（DevTools toggle）、
 *           缩放（50%–300%，点击百分比重置）、设备模拟（移动 / 桌面档位切换）、
 *           外部打开（系统浏览器）、新建标签页
 */
import { ArrowLeft, ArrowRight, RefreshCw, Sparkles, SquareDashedMousePointer, ZoomIn, ZoomOut, ExternalLink, Plus, Expand, Shrink } from 'lucide-react'
import type { PreviewHealthSnapshot, PreviewSession } from '@shared/protocols/previewProtocol'
import { resolveDevice } from '@shared/protocols/previewProtocol'
import { ActionButton, HintOverlay } from '@components/ui'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import type { WebviewController } from './hooks/useWebviewController'
import type { DeviceFitMode } from './BrowserDeviceStage'
import BrowserAddressBar from './BrowserAddressBar'
import BrowserHealthIndicator from './BrowserHealthIndicator'
import BrowserDeviceSelector from './BrowserDeviceSelector'

interface BrowserToolbarProps {
  controller: WebviewController
  /** 当前页面健康快照（运行时态，未采集到时为空） */
  health?: PreviewHealthSnapshot
  /** 主动重新拉取一次健康快照 */
  onRecheckHealth?: () => Promise<void> | void
  addressInput: string
  onAddressChange: (value: string) => void
  onNavigate: (url: string) => void
  onResetAddress: () => void
  /** 在系统浏览器打开当前 URL */
  onOpenExternal: () => void
  /** 新建标签页（创建新会话） */
  onNewTab: () => void
  /** 当前预览会话（提供设备模拟档位） */
  device?: PreviewSession | null
  /** 切换设备模拟档位 */
  onDeviceChange?: (deviceId: string, width?: number, height?: number) => void
  /** 设备档适配方式（仅设备档生效） */
  deviceFitMode?: DeviceFitMode
  /** 切换设备档适配方式：缩放适配 ↔ 实际大小 */
  onToggleDeviceFit?: () => void
  /** AI 修改：开始 / 结束元素拾取 */
  onToggleAIPick?: () => void
  /** 拾取进行中（按钮高亮，再次点击即取消） */
  aiPickActive?: boolean
}


export default function BrowserToolbar({
  controller,
  health,
  onRecheckHealth,
  addressInput,
  onAddressChange,
  onNavigate,
  onResetAddress,
  onOpenExternal,
  onNewTab,
  device,
  onDeviceChange,
  deviceFitMode = 'fit',
  onToggleDeviceFit,
  onToggleAIPick,
  aiPickActive = false,
}: BrowserToolbarProps) {
  const language = useStore((state) => state.language) as Language
  const { canGoBack, canGoForward, isLoading, devtoolsOpen, zoomFactor } = controller

  // 适配开关只对设备档有意义：桌面档本就是铺满可用空间
  const inDeviceMode = device ? !resolveDevice(device).isDesktop : false


  const zoomPercent = Math.round(zoomFactor * 100)

  return (
    <div className="h-11 border-b border-border/50 px-3 flex items-center gap-2">
      {/* 导航组 */}
      <div className="flex items-center gap-0.5 shrink-0">
        <HintOverlay content={t('editor.browser.back', language)}>
          <ActionButton
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={controller.goBack}
            disabled={!canGoBack}
            aria-label={t('editor.browser.back', language)}
          >
            <ArrowLeft className="w-4 h-4" />
          </ActionButton>
        </HintOverlay>

        <HintOverlay content={t('editor.browser.forward', language)}>
          <ActionButton
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={controller.goForward}
            disabled={!canGoForward}
            aria-label={t('editor.browser.forward', language)}
          >
            <ArrowRight className="w-4 h-4" />
          </ActionButton>
        </HintOverlay>

        {/* 固定为刷新：加载态会随页面请求反复切换，若在这里切成「停止」，
            页面持续请求时按钮会长期停在停止态，用户点到的就不是刷新 */}
        <HintOverlay content={t('editor.browser.reload', language)}>
          <ActionButton
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={controller.reload}
            aria-label={t('editor.browser.reload', language)}
          >
            <RefreshCw className="w-4 h-4" />
          </ActionButton>
        </HintOverlay>
      </div>

      {/* 页面健康指示灯（控制台错误 / 加载失败 / 白屏） */}
      <BrowserHealthIndicator health={health} onRecheck={onRecheckHealth} />

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
        {/* AI 修改：点一次进入拾取，再点一次退出
            只让图标高亮，底色与工具栏其他图标按钮保持一致：靠颜色识别入口，
            不靠色块抢占视觉重心 */}
        {onToggleAIPick && (
          <HintOverlay
            content={
              aiPickActive
                ? t('editor.browser.aiEditPicking', language)
                : t('editor.browser.aiEdit', language)
            }
          >
            <button
              type="button"
              onClick={onToggleAIPick}
              disabled={!controller.webviewReady}
              aria-label={t('editor.browser.aiEdit', language)}
              aria-pressed={aiPickActive}
              className={`group inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-400/50 disabled:pointer-events-none disabled:opacity-40 enabled:hover:bg-text-primary/[0.05] ${
                aiPickActive ? 'bg-fuchsia-500/10 ring-1 ring-fuchsia-400/50' : ''
              }`}
            >
              <Sparkles className="h-4 w-4 text-fuchsia-500 drop-shadow-[0_0_6px_rgba(217,70,239,0.45)] transition-transform duration-200 group-hover:scale-110" />
            </button>
          </HintOverlay>
        )}

        {/* 检查元素（DevTools） */}
        <HintOverlay
          content={
            devtoolsOpen
              ? t('editor.browser.inspectActive', language)
              : t('editor.browser.inspect', language)
          }
        >
          <ActionButton
            variant="ghost"
            size="icon"
            className={`h-8 w-8 ${devtoolsOpen ? 'text-accent ring-2 ring-accent/30' : ''}`}
            onClick={controller.toggleDevtools}
            disabled={!controller.webviewReady}
            aria-label={t('editor.browser.inspect', language)}
            aria-pressed={devtoolsOpen}
          >
            <SquareDashedMousePointer className="w-4 h-4" />
          </ActionButton>
        </HintOverlay>

        {/* 缩放：缩小 + 百分比(点击重置) + 放大 */}
        <HintOverlay content={t('editor.browser.zoomOut', language)}>
          <ActionButton
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={controller.zoomOut}
            aria-label={t('editor.browser.zoomOut', language)}
          >
            <ZoomOut className="w-4 h-4" />
          </ActionButton>
        </HintOverlay>

        <HintOverlay content={t('editor.browser.zoomReset', language)}>
          <button
            type="button"
            onClick={controller.resetZoom}
            className="h-8 min-w-[3rem] px-1.5 text-xs tabular-nums text-text-secondary hover:text-text-primary rounded-lg hover:bg-text-primary/[0.05] transition-colors"
            aria-label={t('editor.browser.zoomReset', language)}
          >
            {t('editor.browser.zoomLabel', language, { percent: zoomPercent })}
          </button>
        </HintOverlay>

        <HintOverlay content={t('editor.browser.zoomIn', language)}>
          <ActionButton
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={controller.zoomIn}
            aria-label={t('editor.browser.zoomIn', language)}
          >
            <ZoomIn className="w-4 h-4" />
          </ActionButton>
        </HintOverlay>

        {/* 设备模拟：切换移动 / 桌面档位（手动入口，与 AI 工具共用同一状态源） */}
        {onDeviceChange && (
          <BrowserDeviceSelector session={device} onChange={onDeviceChange} />
        )}

        {/* 适配开关：设备档下在「缩放适配」与「实际大小（可滚动）」间切换 */}
        {inDeviceMode && onToggleDeviceFit && (
          <HintOverlay
            content={
              deviceFitMode === 'actual'
                ? t('editor.browser.fitWindowSwitch', language)
                : t('editor.browser.actualSizeSwitch', language)
            }
          >
            <ActionButton
              variant="ghost"
              size="icon"
              className={`h-8 w-8 ${deviceFitMode === 'actual' ? 'text-accent ring-2 ring-accent/30' : ''}`}
              onClick={onToggleDeviceFit}
              aria-label={t('editor.browser.deviceFit', language)}
              aria-pressed={deviceFitMode === 'actual'}
            >
              {deviceFitMode === 'actual' ? <Expand className="w-4 h-4" /> : <Shrink className="w-4 h-4" />}
            </ActionButton>
          </HintOverlay>
        )}


        {/* 外部打开 */}
        <HintOverlay content={t('editor.browser.openExternal', language)}>
          <ActionButton
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onOpenExternal}
            aria-label={t('editor.browser.openExternal', language)}
          >
            <ExternalLink className="w-4 h-4" />
          </ActionButton>
        </HintOverlay>

        {/* 新建标签页 */}
        <HintOverlay content={t('editor.browser.newTab', language)}>
          <ActionButton
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onNewTab}
            aria-label={t('editor.browser.newTab', language)}
          >
            <Plus className="w-4 h-4" />
          </ActionButton>
        </HintOverlay>
      </div>
    </div>
  )
}
