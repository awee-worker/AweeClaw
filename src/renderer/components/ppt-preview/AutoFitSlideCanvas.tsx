/**
 * AutoFitSlideCanvas - 自适应宽高的 SlideCanvas 包装组件
 *
 * 核心解决：大图预览在容器内按比例完整显示（contain 模式），不溢出、不裁剪、不塌陷。
 *
 * 测量策略（关键）：
 *  外层用 `position: relative` 占位并撑满父容器（width/height: 100%）；
 *  内层测量层用 `position: absolute; inset: 0` 撑满外层。
 *  absolute 元素的 clientWidth/clientHeight 直接等于外层 content box 尺寸，
 *  绕开了「父级高度链路不明确 → height:100% 塌成 0」的循环依赖问题。
 *  这样无论父级是 flex-1、还是有冗余包裹层，都能稳定测得真实可用宽高。
 *
 * 缩放算法（contain）：
 *  按幻灯片宽高比，分别计算按宽度撑满 / 按高度撑满两个候选宽度，取较小者，
 *  保证等比缩放后完全落在容器内。
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
  // 外层 relative 占位，撑满父容器
  const containerRef = useRef<HTMLDivElement>(null)
  // 内层 absolute 测量层，其尺寸即容器可用宽高
  const measureRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })

  useEffect(() => {
    const el = measureRef.current
    if (!el) return

    // 测量 absolute 层的真实宽高（= 外层 content box 尺寸，不受子元素反向影响）
    const measure = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      if (w > 0 && h > 0) setSize({ w, h })
    }

    measure()

    const observer = new ResizeObserver(() => measure())
    // 观察外层容器尺寸变化（窗口缩放、flex 重分配、最大化/还原等）
    if (containerRef.current) observer.observe(containerRef.current)

    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  const slideW = slideSize?.width || DEFAULT_SLIDE_W
  const slideH = slideSize?.height || DEFAULT_SLIDE_H

  // contain 模式：取宽/高两个方向能容纳的较小缩放，保证幻灯片完整显示
  const canvasWidth = (() => {
    if (size.w <= 0 || size.h <= 0) return 0
    const widthBasedScale = size.w / slideW
    const heightByWidth = slideH * widthBasedScale
    if (heightByWidth <= size.h) {
      return size.w
    }
    const heightBasedScale = size.h / slideH
    return slideW * heightBasedScale
  })()

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        minHeight: 0,
      }}
    >
      {/* 测量层：absolute 撑满外层，其 clientWidth/clientHeight 即可用尺寸 */}
      <div ref={measureRef} style={{ position: 'absolute', inset: 0 }} />

      {/* 渲染层：居中显示幻灯片画布 */}
      {canvasWidth > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SlideCanvas slide={slide} width={canvasWidth} slideSize={slideSize} />
        </div>
      )}
    </div>
  )
}

export const AutoFitSlideCanvas = memo(AutoFitSlideCanvasImpl)
