/**
 * 错帧挂载 Hook
 *
 * 用于把「重资源的首次挂载」推后两帧，与同一次状态更新引发的布局重排、首帧绘制错开。
 *
 * 适用场景：<webview> 这类一挂载就要新建渲染进程、新建合成 surface 的元素。
 * 打开预览的那一刻，React 往往同时在做的还有：编辑器区域从无到有、聊天栏宽度重分配、
 * 懒加载 chunk 编译执行。全部压在同一帧里，主线程一帧做不完，表现为主窗口短暂卡顿
 * 并伴随一次明显的画面跳动。
 *
 * 选择双 rAF 而不是 requestIdleCallback：后者在持续渲染（如 AI 流式输出）时可能长时间
 * 不触发，页面会迟迟不出来；双 rAF 的延迟是确定的两帧，用户无感，行为可预期。
 *
 * @module composables/useDeferredMount
 */

import { useEffect, useState } from 'react'

/**
 * @param enabled 为 false 时不排期、也不挂载（调用方据此短路渲染）
 * @returns 是否可以挂载
 */
export function useDeferredMount(enabled = true): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!enabled) return

    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setReady(true))
    })

    return () => {
      cancelAnimationFrame(outer)
      if (inner) cancelAnimationFrame(inner)
    }
  }, [enabled])

  return enabled && ready
}
