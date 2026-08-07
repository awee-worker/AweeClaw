/**
 * useElementWidth - 基于 ResizeObserver 的元素宽度响应式 hook
 *
 * 测量挂载元素的 border-box 宽度（getBoundingClientRect().width）。
 *
 * 关键设计：用 getBoundingClientRect 而非 contentRect，
 * 并且测量时排除自身 padding（用 clientWidth 即 padding-box 内宽）。
 *
 * 重要：此 hook 的 ref 必须挂在一个**宽度不依赖子元素**的容器上。
 * 推荐结构：
 *   <div className="flex-1 min-w-0">           ← flex 撑开
 *     <div ref={ref} className="w-full h-full"> ← 独立测量层，w-full 撑满父
 *       <Child width={measuredWidth} />        ← 子元素用测量值
 *     </div>
 *   </div>
 * 切勿将 ref 直接挂在 flex-1 容器上（其宽度可能被子元素反向撑大）。
 *
 * @returns [ref, width] ref 挂载到目标元素，width 为元素 clientWidth（px）
 */

import { useEffect, useRef, useState } from 'react'

export function useElementWidth<T extends HTMLElement = HTMLDivElement>(): [
  React.RefObject<T>,
  number,
] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // 测量函数：用 clientWidth（padding-box 内宽，不含 border/外滚动条）
    const measure = () => {
      const w = el.clientWidth
      if (w > 0) setWidth(w)
    }

    // 初次同步测量
    measure()

    // 监听后续变化（窗口缩放、flex 重新分配等）
    const observer = new ResizeObserver(() => {
      measure()
    })
    observer.observe(el)

    // 兜底：监听窗口 resize（某些布局变化不触发 ResizeObserver）
    window.addEventListener('resize', measure)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  return [ref, width]
}

/**
 * 计算适合容器的画布宽度，留出极小边距，尽量填满容器（≥98%）
 *
 * 设计：
 * - 默认仅留 8px 总边距（两侧各 4px），画布宽度 ≈ 容器 98%+
 * - 不限制最大宽度，大图根据容器自适应放大
 * - 容器内视觉留白通过外层 padding/居中控制，不在画布宽度里扣除
 *
 * @param containerWidth 容器宽度（px）
 * @param padding 容器内边距（两侧总和，默认 8px，仅保留极小安全边距）
 * @param minWidth 最小画布宽度（默认 200px，避免容器过窄时画布消失）
 * @returns 画布宽度（px）
 */
export function fitCanvasWidth(
  containerWidth: number,
  padding = 8,
  minWidth = 200,
): number {
  const available = Math.max(0, containerWidth - padding)
  return Math.max(minWidth, available)
}

/** 默认导出便于复用 */
export default useElementWidth
