/**
 * AutoFitSlideCanvas - 自适应宽度的 SlideCanvas 包装组件
 *
 * 核心解决：大图预览宽度无法正确撑满父容器的问题。
 *
 * 原方案的问题：父组件用 useElementWidth 测量容器宽度，再传给 SlideCanvas。
 * 但 flex 布局下，父容器宽度会被内部 SlideCanvas 子元素反向影响，形成循环依赖，
 * 导致测量值卡在初始值（如 200px），大图永远只有容器一半不到。
 *
 * 本方案：
 * - 外层 div 用 `width: 100%` 撑满父容器（纯 CSS，不依赖 JS 测量父容器）
 * - 内部用 ResizeObserver 测量外层 div 的真实宽度（此时外层已被 CSS 撑开）
 * - 测量到宽度后传给 SlideCanvas 渲染
 *
 * 关键区别：测量的是「自己撑开后的宽度」，而非「父容器分配的宽度」。
 * 因为 `width: 100%` 是 CSS 引擎计算的，不受子元素影响，测量值稳定可靠。
 *
 * 用 aspect-ratio 保持幻灯片宽高比，避免高度塌缩。
 */

import { useEffect, useRef, useState, memo } from 'react'
import { SlideCanvas } from './SlideCanvas'
import type { PptSlideData } from '@shared/protocols/pptPreviewProtocol'

interface AutoFitSlideCanvasProps {
  slide: PptSlideData
  /** 幻灯片实际尺寸（英寸），用于计算宽高比和缩放 */
  slideSize?: { width: number; height: number }
}

/** 默认 16:9 尺寸（英寸） */
const DEFAULT_SLIDE_W = 10
const DEFAULT_SLIDE_H = 5.625

function AutoFitSlideCanvasImpl({ slide, slideSize }: AutoFitSlideCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    // 测量函数：读取自身被 CSS width:100% 撑开后的实际宽度
    const measure = () => {
      const w = el.clientWidth
      if (w > 0) setWidth(w)
    }

    measure()

    // 监听容器尺寸变化（窗口缩放、flex 重新分配等）
    const observer = new ResizeObserver(() => measure())
    observer.observe(el)

    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const slideW = slideSize?.width || DEFAULT_SLIDE_W
  const slideH = slideSize?.height || DEFAULT_SLIDE_H
  // 宽高比，用于 CSS aspect-ratio 保持幻灯片比例
  const aspectRatio = `${slideW} / ${slideH}`

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        // 用 aspect-ratio 让高度随宽度等比变化，容器自然保持幻灯片比例
        aspectRatio,
        maxWidth: '100%',
        maxHeight: '100%',
        // 居中显示（当容器比幻灯片比例宽时，宽度不会撑满，居中即可）
        margin: '0 auto',
      }}
    >
      {width > 0 && <SlideCanvas slide={slide} width={width} slideSize={slideSize} />}
    </div>
  )
}

export const AutoFitSlideCanvas = memo(AutoFitSlideCanvasImpl)
