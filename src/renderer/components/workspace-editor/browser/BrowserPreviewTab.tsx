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

  return (
    <div className="h-full flex flex-col bg-background-editor">
      <BrowserToolbar
        controller={controller}
        addressInput={addressInput}
        onAddressChange={setAddressInput}
        onNavigate={commitNavigation}
        onResetAddress={resetAddress}
        onOpenExternal={handleOpenExternal}
        onNewTab={openNewTab}
      />

      <div className="flex-1 min-h-0 min-w-0 overflow-hidden relative">
        {!session ? (
          <BrowserEmptyState />
        ) : (
          <>
            <BrowserWebView session={session} controller={controller} />
            <BrowserStatusOverlay session={session} />
          </>
        )}
      </div>
    </div>
  )
}
