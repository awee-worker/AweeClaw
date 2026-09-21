/**
 * 内置浏览器主组件（编排器）
 *
 * 组合：
 * - usePreviewSessionSync：会话订阅 + 地址栏输入态 + 自动发现
 * - useWebviewController：webview 命令 + 派生状态 + 事件桥接
 * - BrowserToolbar：三段式工具栏
 * - BrowserWebView / BrowserEmptyState：内容区
 * - BrowserStatusOverlay：loading / error 叠层
 *
 * 入口 WebPreviewTab.tsx 懒加载本组件，保持 WorkspaceEditor 引用路径不变。
 */
import type { OpenFile } from '@store'
import { api } from '@renderer/adapters/electronBridge'
import { usePreviewSessionSync } from './hooks/usePreviewSessionSync'
import { useWebviewController } from './hooks/useWebviewController'
import BrowserToolbar from './BrowserToolbar'
import BrowserWebView from './BrowserWebView'
import BrowserEmptyState from './BrowserEmptyState'
import BrowserStatusOverlay from './BrowserStatusOverlay'
import DockedDevToolsPanel from './DockedDevToolsPanel'

interface BrowserPreviewTabProps {
  file: OpenFile
}

export default function BrowserPreviewTab({ file }: BrowserPreviewTabProps) {
  const { session, addressInput, setAddressInput, commitNavigation, resetAddress, openNewTab } =
    usePreviewSessionSync(file)

  const controller = useWebviewController(session)

  const handleOpenExternal = () => {
    if (session?.url) {
      api.file.openExternalUrl(session.url)
    }
  }

  /**
   * 内嵌 DevTools 的 guest id
   *
   * 取自 controller（webview dom-ready 时上报），不读会话上的副本：
   * 会话要经 service → state → 订阅几跳，中间任何一环缺失都会让面板默默不渲染，
   * 表现成「点了检查元素没反应」。
   */
  const dockedGuestId =
    session && controller.devtoolsOpen && controller.dockUsable ? controller.guestId : null

  /** 内嵌不可用：DevTools 改在独立窗口打开，占位面板收起 */
  const handleUndockDevTools = () => {
    controller.openDetachedDevTools()
    controller.collapseDock()
  }

  return (
    <div className="h-full flex flex-col bg-background-editor">
      <BrowserToolbar
        controller={controller}
        health={session?.health}
        addressInput={addressInput}
        onAddressChange={setAddressInput}
        onNavigate={commitNavigation}
        onResetAddress={resetAddress}
        onOpenExternal={handleOpenExternal}
        onNewTab={openNewTab}
      />

      <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden">
        <div className="flex-1 min-w-0 relative">
          {!session ? (
            <BrowserEmptyState />
          ) : (
            <>
              <BrowserWebView session={session} controller={controller} />
              <BrowserStatusOverlay session={session} />
            </>
          )}
        </div>

        {/* 内嵌 DevTools 占位：DevTools 由主进程画在这块区域上方的原生图层里 */}
        {dockedGuestId !== null && (
          <DockedDevToolsPanel guestId={dockedGuestId} onUndock={handleUndockDevTools} />
        )}
      </div>
    </div>
  )
}
