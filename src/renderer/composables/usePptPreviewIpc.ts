/**
 * PPT 预览 IPC 监听器（主窗口内嵌模式）v2.3
 *
 * 职责：
 * - 监听主进程推送的 ppt-preview:* IPC 事件
 * - 将事件转换为 store actions（openPptPreview / pushPptPreviewSlide / markPptPreviewComplete）
 * - 主窗口挂载此 hook 即可激活内嵌 PPT 预览功能
 *
 * 数据流：
 * 插件 → PptPreviewBridge → PptPreviewManager（主进程）
 *      → IPC → 主窗口 webContents → 本 hook → store actions
 *      → PptPreviewPanel 从 store 读取数据渲染
 *
 * 挂载位置：AweeApp.tsx 根组件（确保主窗口生命周期内始终监听）
 */

import { useEffect, useRef } from 'react'
import { useStore } from '@store'
import { api } from '@renderer/adapters/electronBridge'
import type { PptPresentationMeta, PptSlideData } from '@shared/protocols/pptPreviewProtocol'

export function usePptPreviewIpc(): void {
  const openPptPreview = useStore((state) => state.openPptPreview)
  const pushPptPreviewSlide = useStore((state) => state.pushPptPreviewSlide)
  const markPptPreviewComplete = useStore((state) => state.markPptPreviewComplete)

  // 用 ref 保存最新的 actions，避免 effect 重订阅
  const actionsRef = useRef({ openPptPreview, pushPptPreviewSlide, markPptPreviewComplete })
  actionsRef.current = { openPptPreview, pushPptPreviewSlide, markPptPreviewComplete }

  useEffect(() => {
    const unsubs: (() => void)[] = []

    // 会话打开：在主窗口创建 PPT 预览 Tab
    unsubs.push(
      api.pptPreview.onOpen((meta: PptPresentationMeta) => {
        actionsRef.current.openPptPreview(meta, { activate: true })
      }),
    )

    // 幻灯片推送：更新对应 Tab 的幻灯片数据
    unsubs.push(
      api.pptPreview.onPushSlide((slide: PptSlideData) => {
        actionsRef.current.pushPptPreviewSlide(slide.sessionId, slide)
      }),
    )

    // 生成完成：标记 Tab 完成，显示导出按钮
    unsubs.push(
      api.pptPreview.onMarkComplete((data: { sessionId: string; filePath: string }) => {
        actionsRef.current.markPptPreviewComplete(data.sessionId, data.filePath)
      }),
    )

    return () => unsubs.forEach((u) => u())
  }, [])
}
