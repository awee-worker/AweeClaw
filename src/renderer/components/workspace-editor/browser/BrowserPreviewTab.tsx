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
import { useCallback } from 'react'
import type { OpenFile } from '@store'
import { api } from '@renderer/adapters/electronBridge'
import { previewSessionService } from '@renderer/preview/previewSessionManager'
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
  // 取出稳定引用：重新检测的 useCallback 依赖它，不依赖每次渲染重建的 controller 对象
  const { reportHealth } = controller

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

  /**
   * 重新检测页面健康
   *
   * 快照推送有节拍，展开面板时直接取一次主进程的实时数据：
   * 之前没赶上绑定、或页面已变化但推送还在路上的情况都能补齐。
   */
  const handleRecheckHealth = useCallback(async () => {
    const sessionId = session?.id
    if (!sessionId) return

    try {
      const response = await api.preview.healthGet(sessionId)
      if (response.success && response.data) {
        previewSessionService.applyHealth(response.data)
        return
      }
    } catch {
      // 取不到就继续往下重新绑定
    }

    // 主进程没有这个会话的记录：说明绑定没赶上（webview 早于事件注册就 dom-ready，
    // 或采集被中途解绑）。重新上报 guest，attach 会把初始快照推回来。
    if (!reportHealth()) {
      console.warn('[PreviewHealth] Recheck skipped: webview not ready')
    }
  }, [session?.id, reportHealth])

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
        onRecheckHealth={handleRecheckHealth}
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
              {/*
                key 用重建序号：刷新令牌推进时 React 重建 webview 元素，页面按 src
                重新加载。刷新刻意不走 webview.reload()/loadURL()——那两个命令在本
                环境实测不产生重载（同地址 loadURL 被当作同文档导航短路，reload 静默失效）。
              */}
              <BrowserWebView
                key={controller.reloadNonce}
                session={session}
                controller={controller}
              />
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
