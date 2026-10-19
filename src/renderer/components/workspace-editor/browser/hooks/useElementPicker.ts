/**
 * 元素拾取 hook
 *
 * 把「进入拾取模式 → 用户在页面上点一个元素 → 拿到元素快照」这条交互
 * 收敛成一个状态机，供内置浏览器的 AI 修改面板使用。
 *
 * 关键设计：
 * - 拾取请求用自增序号标记。切换标签页、重复点击、组件卸载都会推进序号，
 *   先前那条挂起的请求返回时序号已经对不上，直接丢弃——否则用户切到 B 页
 *   之后会被 A 页迟到的选择结果覆盖。
 * - 所有退出路径（Esc、超时、切标签、卸载）都要回到 idle，不能让工具栏
 *   按钮停在「拾取中」，那会让整个页面看起来点不动。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@renderer/adapters/electronBridge'
import type { PickedElement } from '../../../../../main/modules/preview/previewDomProbe'

/** 拾取阶段：idle 空闲 / picking 等待用户点击 / picked 已选中元素 */
export type PickerPhase = 'idle' | 'picking' | 'picked'

export interface ElementPickerState {
  phase: PickerPhase
  /** 选中的元素快照（phase=picked 时有值） */
  picked: PickedElement | null
  /** 拾取过程中的错误信息，正常取消不会置为错误 */
  error: string | null
  /** 开始拾取；拾取进行中再调用则视为取消 */
  togglePick: () => void
  /** 取消拾取并回到空闲 */
  cancelPick: () => void
  /** 清空已选元素（关闭 AI 修改面板时调用） */
  clearPick: () => void
  /** 回滚页面上的运行时修改 */
  undoEdits: (mode: 'last' | 'all') => Promise<void>
}

/**
 * @param guestId 当前预览页的 webContents id；null 表示 webview 尚未就绪
 */
export function useElementPicker(guestId: number | null): ElementPickerState {
  const [phase, setPhase] = useState<PickerPhase>('idle')
  const [picked, setPicked] = useState<PickedElement | null>(null)
  const [error, setError] = useState<string | null>(null)

  /** 请求序号：推进即作废先前挂起的拾取请求 */
  const requestRef = useRef(0)
  /** 上一次生效的 guestId，用于识别「切了标签页」 */
  const guestRef = useRef<number | null>(guestId)

  const reset = useCallback(() => {
    requestRef.current += 1
    setPhase('idle')
    setPicked(null)
    setError(null)
  }, [])

  /** 通知页面结束拾取（页面可能已导航或销毁，失败不抛） */
  const cancelInPage = useCallback(async (target: number | null) => {
    if (target === null) return
    try {
      await api.preview.pickCancel(target)
    } catch {
      // 页面已销毁 / guest 已重建：本次拾取的 Promise 也随之作废，无需额外处理
    }
  }, [])

  const cancelPick = useCallback(() => {
    const activeGuest = guestRef.current
    reset()
    void cancelInPage(activeGuest)
  }, [cancelInPage, reset])

  const clearPick = useCallback(() => {
    requestRef.current += 1
    setPhase('idle')
    setPicked(null)
  }, [])

  const togglePick = useCallback(() => {
    if (phase === 'picking') {
      cancelPick()
      return
    }
    if (guestId === null) return

    const requestId = ++requestRef.current
    guestRef.current = guestId
    setError(null)
    setPicked(null)
    setPhase('picking')

    void (async () => {
      try {
        const response = await api.preview.pickStart(guestId)
        if (requestRef.current !== requestId) return

        if (!response.success) {
          setError(response.error || 'Element picking failed')
          setPhase('idle')
          return
        }

        const data = response.data
        // ok=false 是用户取消或超时，属于正常结束，不当作错误提示
        if (!data || data.ok === false) {
          setPhase('idle')
          return
        }

        setPicked(data)
        setPhase('picked')
      } catch (err) {
        if (requestRef.current !== requestId) return
        setError(err instanceof Error ? err.message : String(err))
        setPhase('idle')
      }
    })()
  }, [cancelPick, guestId, phase])

  const undoEdits = useCallback(
    async (mode: 'last' | 'all') => {
      if (guestId === null) return
      try {
        await api.preview.undoEdits(guestId, mode)
      } catch {
        // 页面已销毁时回滚无处落地，忽略
      }
    },
    [guestId],
  )

  // 切换预览标签页：旧页面上的拾取必须结束，否则会对着 A 页选、改到 B 页
  useEffect(() => {
    if (guestRef.current === guestId) return
    const previous = guestRef.current
    guestRef.current = guestId
    reset()
    void cancelInPage(previous)
  }, [guestId, cancelInPage, reset])

  // 卸载（标签页关闭）：把页面里挂着的拾取器一并结束，避免留下覆盖层
  useEffect(() => {
    return () => {
      requestRef.current += 1
      const activeGuest = guestRef.current
      if (activeGuest !== null) void cancelInPage(activeGuest)
    }
  }, [cancelInPage])

  return { phase, picked, error, togglePick, cancelPick, clearPick, undoEdits }
}
