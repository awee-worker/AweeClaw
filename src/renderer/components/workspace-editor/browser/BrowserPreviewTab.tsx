/**
 * 内置浏览器主组件（编排器）
 *
 * 组合：
 * - usePreviewSessionSync：会话订阅 + 地址栏输入态 + 自动发现
 * - useWebviewController：webview 命令 + 派生状态 + 事件桥接
 * - BrowserToolbar：三段式工具栏（含设备模拟切换）
 * - BrowserDeviceStage：内容区（桌面铺满 / 设备档位按设备视口居中缩放）
 * - BrowserEmptyState：空状态
 * - BrowserStatusOverlay：loading / error 叠层
 *
 * 入口 WebPreviewTab.tsx 懒加载本组件，保持 WorkspaceEditor 引用路径不变。
 */
import { useCallback, useState } from 'react'
import type { OpenFile } from '@store'
import { resolveDevice } from '@shared/protocols/previewProtocol'
import { api } from '@renderer/adapters/electronBridge'
import { previewSessionService } from '@renderer/preview/previewSessionManager'
import { usePreviewSessionSync } from './hooks/usePreviewSessionSync'
import { useWebviewController } from './hooks/useWebviewController'
import { useElementPicker } from './hooks/useElementPicker'
import AIEditPanel from './AIEditPanel'
import { BROWSER_AI_EDIT_EVENT, buildAIEditPrompt } from './aiEditPrompt'
import BrowserToolbar from './BrowserToolbar'
import BrowserDeviceStage, { type DeviceFitMode } from './BrowserDeviceStage'
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
  // 取出稳定引用：重新检测的 useCallback 依赖它，不依赖每次渲染重建 controller 对象
  const { reportHealth } = controller

  /**
   * AI 修改：元素拾取
   *
   * 绑定当前标签页的 guest id——切换标签页时 hook 会自动结束上一次拾取，
   * 不会出现「对着 A 页选、结果落到 B 页」。
   */
  const { phase: pickPhase, picked, togglePick, clearPick, undoEdits } = useElementPicker(
    controller.guestId,
  )

  /**
   * 提交修改指令
   *
   * 交给 PluginHostBridge 转发到当前会话，与插件发消息走同一条链路：
   * 内置浏览器拿不到聊天面板的发送函数，事件是这里唯一的出口。
   */
  const handleSubmitEdit = useCallback(
    (instruction: string) => {
      if (!picked) return
      const prompt = buildAIEditPrompt(picked, instruction, session?.url)
      window.dispatchEvent(new CustomEvent(BROWSER_AI_EDIT_EVENT, { detail: { text: prompt } }))
      clearPick()
    },
    [picked, clearPick, session?.url],
  )

  // 设备档适配方式：纯视图偏好，只存活于当前标签页，不进会话协议
  const [deviceFitMode, setDeviceFitMode] = useState<DeviceFitMode>('fit')
  const toggleDeviceFit = useCallback(
    () => setDeviceFitMode((mode) => (mode === 'fit' ? 'actual' : 'fit')),
    [],
  )

  /** 切换当前标签页的设备模拟档位（走 service，UI 与 AI 工具共用同一状态源） */
  const handleDeviceChange = useCallback(
    (deviceId: string, width?: number, height?: number) => {
      if (!session?.id) return
      previewSessionService.setDevice(session.id, { deviceId, width, height })
    },
    [session?.id],
  )
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
        device={session}
        onDeviceChange={handleDeviceChange}
        deviceFitMode={deviceFitMode}
        onToggleDeviceFit={toggleDeviceFit}
        onToggleAIPick={togglePick}
        aiPickActive={pickPhase === 'picking'}
      />

      <div className="flex-1 min-h-0 min-w-0 flex overflow-hidden">
        {/* overflow-hidden：AI 修改浮层是绝对定位，拖到边缘时不能把内容区撑出额外的滚动区域 */}
        <div className="flex-1 min-w-0 relative overflow-hidden">
          {!session ? (
            <BrowserEmptyState />
          ) : (
            <>
              {/*
                webview 的 key 在 BrowserDeviceStage 内部按「会话 id + 重建序号」生成：
                - 刷新令牌推进时序号变化，React 重建 webview 元素，页面按 src 重新加载。
                  刷新刻意不走 webview.reload()/loadURL()——那两个命令在本环境实测不
                  产生重载（同地址 loadURL 被当作同文档导航短路，reload 静默失效）。
                - 编辑器主体在同一位置复用本组件，切换到另一个预览标签页时只有会话变了，
                  webview 元素的 src 却是冻结的（避免与 loadURL 双重导航），不重建就会
                  停在旧页面上——表现为地址栏换了地址、内容还是上一个页面。
              */}
              <BrowserDeviceStage
                session={session}
                controller={controller}
                fitMode={deviceFitMode}
              />
              <BrowserStatusOverlay session={session} />

              {/* AI 修改浮层：跟随选中元素定位，浮在页面之上 */}
              {picked && (
                <AIEditPanel
                  picked={picked}
                  onClose={clearPick}
                  onSubmit={handleSubmitEdit}
                  onUndo={() => void undoEdits('all')}
                  pinToCorner={session ? !resolveDevice(session).isDesktop : false}
                />
              )}
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

