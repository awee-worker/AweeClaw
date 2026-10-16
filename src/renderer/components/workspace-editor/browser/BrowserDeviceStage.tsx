/**
 * 预览内容舞台
 *
 * 桌面档：webview 直接铺满可用空间。
 * 设备档：webview 按设备逻辑视口定尺寸，居中放在一块设备画布上。
 *   - fit（默认）：设备尺寸超出可用空间时按比例整体缩放（transform scale），保证设备框完整可见。
 *   - actual：不缩放，始终按设备真实像素展示，超出可用空间时通过滚动查看。
 *
 * 关键：缩放只作用于最外层容器，内层 webview 仍以设备的真实 viewport 宽度布局，
 * 因此响应式断点、媒体查询都按设备宽度生效，不会被缩放「骗」过去。
 */
import { useEffect, useRef, useState } from 'react'
import { resolveDevice, type PreviewSession } from '@shared/protocols/previewProtocol'
import type { WebviewController } from './hooks/useWebviewController'
import BrowserWebView from './BrowserWebView'

/** 设备档适配方式：fit=缩放适配窗口，actual=实际大小（1:1，可滚动） */
export type DeviceFitMode = 'fit' | 'actual'

interface BrowserDeviceStageProps {
  session: PreviewSession
  controller: WebviewController
  /** 设备档适配方式，默认 fit */
  fitMode?: DeviceFitMode
}

/** 设备画布四周留白：设备框不贴边，缩放到适配时也留出呼吸空间 */
const STAGE_PADDING_PX = 24

export default function BrowserDeviceStage({
  session,
  controller,
  fitMode = 'fit',
}: BrowserDeviceStageProps) {
  const device = resolveDevice(session)
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })

  // 观察舞台可用尺寸：设备框是否要缩到适配由它决定
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setStageSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // key 由「会话 id + 重建序号」组成：刷新令牌推进时重建 webview，页面按 src 重载
  const webviewKey = `${session.id}#${controller.reloadNonce}`

  if (device.isDesktop) {
    return (
      <div ref={stageRef} className="absolute inset-0">
        <BrowserWebView key={webviewKey} session={session} controller={controller} />
      </div>
    )
  }

  // 实际大小：设备框保持 1:1 像素尺寸，容器可滚动；设备小于可用空间时居中，
  // 超出时由 m-auto 归零、父级 overflow-auto 接管滚动（不需要 transform，像素不糊）
  if (fitMode === 'actual') {
    return (
      <div
        ref={stageRef}
        className="absolute inset-0 flex overflow-auto bg-background-editor p-6"
      >
        <div
          style={{ width: device.width, height: device.height }}
          className="m-auto shrink-0 overflow-hidden rounded-xl bg-white shadow-2xl shadow-black/30 ring-1 ring-black/20"
        >
          <BrowserWebView key={webviewKey} session={session} controller={controller} />
        </div>
      </div>
    )
  }

  const availWidth = Math.max(0, stageSize.width - STAGE_PADDING_PX * 2)
  const availHeight = Math.max(0, stageSize.height - STAGE_PADDING_PX * 2)
  // 未测到尺寸前先按 1 处理，避免首帧闪一下极小尺寸
  const scale =
    availWidth > 0 && availHeight > 0
      ? Math.min(1, availWidth / device.width, availHeight / device.height)
      : 1

  return (
    <div
      ref={stageRef}
      className="absolute inset-0 flex items-center justify-center overflow-hidden bg-background-editor"
    >
      {/* 占位层按缩放后的尺寸撑开，让设备框在舞台上居中 */}
      <div style={{ width: device.width * scale, height: device.height * scale }}>
        <div
          style={{
            width: device.width,
            height: device.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
          }}
          className="overflow-hidden rounded-xl bg-white shadow-2xl shadow-black/30 ring-1 ring-black/20"
        >
          <BrowserWebView key={webviewKey} session={session} controller={controller} />
        </div>
      </div>
    </div>
  )
}
