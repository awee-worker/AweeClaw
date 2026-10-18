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
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { resolveDevice, type PreviewSession } from '@shared/protocols/previewProtocol'
import { useDeferredMount } from '@renderer/composables/useDeferredMount'
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
  /**
   * 舞台可用尺寸
   *
   * null 表示尚未测到。不能用 {0,0} 兜底：那会让下面的 scale 退化成 1，先按设备
   * 真实尺寸（393×852 这类）把设备框画出来，等测量结果回来再缩到适配比例——用户
   * 看到的就是「页面猛地缩一下」，同时 webview 的合成层要按新尺寸重新栅格化，那
   * 一下就是明显的卡顿。
   */
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null)

  /**
   * 首帧同步测量
   *
   * ResizeObserver 的首个回调是异步的（下一帧），拿它当唯一来源就必然先画错一次。
   * useLayoutEffect 在浏览器绘制前执行，此处同步读一次边界框，React 会在同一帧内
   * 带着正确尺寸重渲染，中间态不会落到屏幕上。
   *
   * 依赖设备档与适配方式：切换档位会换掉 DOM 结构，需要按新舞台重新量。
   */
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    setStageSize({ width: rect.width, height: rect.height })
  }, [device.id, fitMode])

  // 观察舞台可用尺寸：窗口缩放、聊天栏开合、标签页切换后重新适配
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect) setStageSize({ width: rect.width, height: rect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [device.id, fitMode])

  // key 由「会话 id + 重建序号」组成：刷新令牌推进时重建 webview，页面按 src 重载
  const webviewKey = `${session.id}#${controller.reloadNonce}`

  /**
   * webview 挂载推迟两帧
   *
   * 挂载即创建 guest 渲染进程并新建合成 surface。打开标签页的那一帧同时还在做
   * 编辑器区域首次布局与懒加载 chunk 执行，三者叠加会让主线程一帧做不完，
   * 表现为主窗口卡顿并伴随一次画面跳动。错开两帧后，先让布局与首帧绘制落地，
   * 再创建 guest。
   */
  const canMount = useDeferredMount()

  if (device.isDesktop) {
    return (
      <div ref={stageRef} className="absolute inset-0">
        {canMount && <BrowserWebView key={webviewKey} session={session} controller={controller} />}
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
          {canMount && <BrowserWebView key={webviewKey} session={session} controller={controller} />}
        </div>
      </div>
    )
  }

  // 尺寸未测到：只铺一块底色占位，不画设备框
  //
  // 同步测量在 useLayoutEffect 里完成，这里最多存在一次提交期间的中间态，不会真正
  // 绘制到屏幕上；即便时序意外延后，空白也比「先放大再缩回」更不刺眼。
  if (!stageSize) {
    return <div ref={stageRef} className="absolute inset-0 bg-background-editor" />
  }

  const availWidth = Math.max(0, stageSize.width - STAGE_PADDING_PX * 2)
  const availHeight = Math.max(0, stageSize.height - STAGE_PADDING_PX * 2)
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
            // 缩放比例变化时提前提升为合成层，避免每次都整块重新栅格化
            willChange: 'transform',
          }}
          className="overflow-hidden rounded-xl bg-white shadow-2xl shadow-black/30 ring-1 ring-black/20"
        >
          {canMount && <BrowserWebView key={webviewKey} session={session} controller={controller} />}
        </div>
      </div>
    </div>
  )
}
