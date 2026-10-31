/**
 * 场景工具抽屉容器
 *
 * 场景内置工具（番茄钟、记账本、闪卡复习…）统一从右侧抽屉打开：
 * 仪表盘工具卡片、AI 调用、场景内的工具入口都汇聚到这里。
 *
 * 抽屉只负责容器、遮罩与关闭交互，工具组件与数据由 SceneToolsPanel 提供；
 * 打开哪个工具由 sceneToolDrawerStore 的 target.toolId 决定（null 为宫格首页）。
 */

import { useCallback, useEffect } from 'react'
import { useStore } from '@store'
import { SceneToolsPanel } from './SceneToolsPanel'
import { closeSceneToolDrawer, useSceneToolDrawerTarget } from './sceneToolDrawerStore'

export default function SceneToolDrawerHost() {
  const target = useSceneToolDrawerTarget()
  const language = useStore((s) => s.language)
  const isZh = language === 'zh'
  const open = target !== null

  // ESC 关闭：抽屉是临时浮层，键盘要能退出
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSceneToolDrawer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open])

  const handleClose = useCallback(() => closeSceneToolDrawer(), [])

  if (!target) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* 遮罩：点击空白处关闭 */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[1px] animate-[fadeIn_120ms_ease-out]"
        onClick={handleClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={isZh ? '场景工具' : 'Scene tools'}
        className="relative h-full w-[480px] max-w-[92vw] bg-background border-l border-border/60 shadow-2xl flex flex-col animate-[slideInRight_180ms_ease-out]"
      >
        <SceneToolsPanel initialToolId={target.toolId} onClose={handleClose} />
      </aside>
    </div>
  )
}
