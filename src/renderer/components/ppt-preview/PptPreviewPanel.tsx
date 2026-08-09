/**
 * PPT 预览面板（主窗口内嵌 Tab 模式）v2.3.1
 *
 * 修复：简化 store 选择器，确保幻灯片数据更新时正确触发重渲染。
 * 不再使用 useShallow（会吞掉 Map 引用变化），改为直接选择 Map 引用。
 * Zustand 默认用 Object.is 比较，新 Map 引用必然触发重渲染。
 */

import { useState, useCallback, useMemo } from 'react'
import { useStore } from '@store'
import {
  CheckCircle2,
  Loader2,
  Download,
  ChevronLeft,
  ChevronRight,
  Presentation,
} from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import { SlideCanvas } from './SlideCanvas'
import { AutoFitSlideCanvas } from './AutoFitSlideCanvas'
import type { PptSlideData, PptPresentationMeta } from '@shared/protocols/pptPreviewProtocol'

/** 空的 Map 常量，避免每次选择都创建新引用 */
const EMPTY_MAP: Map<number, PptSlideData> = new Map()

interface PptPreviewPanelProps {
  /** PPT 预览会话 ID（从 Tab 路径提取） */
  sessionId: string
}

export default function PptPreviewPanel({ sessionId }: PptPreviewPanelProps) {
  const [selectedIdx, setSelectedIdx] = useState(0)

  // 直接选择 slides Map 引用（不使用 useShallow）
  // 当 pushPptPreviewSlide 创建新 Map 时，引用变化 → Object.is 失败 → 重渲染
  const slidesMap = useStore((state) => {
    const file = state.openFiles.find(
      (f) => f.kind === 'ppt-preview' && f.pptPreview?.meta.sessionId === sessionId,
    )
    return file?.pptPreview?.slides || EMPTY_MAP
  })

  // 单独选择 meta（基本不变，仅在 open/complete 时变化）
  const meta: PptPresentationMeta | null = useStore((state) => {
    const file = state.openFiles.find(
      (f) => f.kind === 'ppt-preview' && f.pptPreview?.meta.sessionId === sessionId,
    )
    return file?.pptPreview?.meta || null
  })

  const completed = meta?.completed || false
  const filePath = meta?.filePath || null

  // 幻灯片实际尺寸（来自 create_presentation 时的 slideSize，未指定时默认 16:9）
  const slideSize = meta?.slideSize

  // --------------------------------------------
  // 导出
  // --------------------------------------------
  const handleExport = useCallback(() => {
    if (filePath) {
      void api.pptPreview.export(filePath)
    }
  }, [filePath])

  // --------------------------------------------
  // 幻灯片导航
  // --------------------------------------------
  const slideArr = useMemo(
    () => Array.from(slidesMap.values()).sort((a, b) => a.slideIndex - b.slideIndex),
    [slidesMap],
  )

  // 当新幻灯片到达且用户停在最后一张时自动跟随
  const currentSlide = slidesMap.get(selectedIdx)

  const goPrev = useCallback(() => {
    setSelectedIdx((i) => Math.max(0, i - 1))
  }, [])

  const goNext = useCallback(() => {
    setSelectedIdx((i) => Math.min(slideArr.length - 1, i + 1))
  }, [slideArr.length])

  // 自动跟随最新幻灯片（仅当当前选中的是最后一张时）
  const lastSlideIdx = slideArr.length > 0 ? slideArr[slideArr.length - 1].slideIndex : -1
  if (slideArr.length > 0 && selectedIdx === lastSlideIdx && !slidesMap.has(selectedIdx + 1) === false) {
    // 新幻灯片到达，自动选中
    if (slidesMap.has(lastSlideIdx) && selectedIdx < lastSlideIdx) {
      setSelectedIdx(lastSlideIdx)
    }
  }

  // --------------------------------------------
  // 渲染
  // --------------------------------------------
  const statusText = completed
    ? `已保存 · ${slideArr.length} 张幻灯片`
    : `生成中 · ${slideArr.length} 张幻灯片`

  return (
    <div
      className="flex flex-col w-full h-full overflow-hidden"
      style={{ background: 'rgb(var(--background))' }}
    >
      {/* ============ 顶栏 ============ */}
      <div className="flex items-center gap-3 px-4 h-12 flex-shrink-0 border-b border-border/40 bg-surface/50">
        <Presentation className="w-4 h-4 text-accent" />
        <span className="text-[14px] font-semibold text-text-primary truncate">
          {meta?.title || 'PPT 预览'}
        </span>
        <div className="flex-1" />
        {completed && filePath && (
          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 h-7 rounded-lg bg-accent/10 text-accent text-[12px] font-medium hover:bg-accent/20 transition-colors border border-accent/20"
          >
            <Download className="w-3.5 h-3.5" />
            在文件夹中显示
          </button>
        )}
      </div>

      {/* ============ 主体 ============ */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧缩略图列表 */}
        <div className="w-[160px] flex-shrink-0 border-r border-border/40 overflow-y-auto custom-scrollbar p-2 space-y-2">
          {slideArr.length === 0 && (
            <div className="flex items-center justify-center h-full text-text-muted/50 text-[12px]">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>等待生成...</span>
              </div>
            </div>
          )}
          {slideArr.map((slide) => (
            <button
              key={slide.slideIndex}
              onClick={() => setSelectedIdx(slide.slideIndex)}
              className={`w-full rounded-lg overflow-hidden border-2 transition-all ${
                selectedIdx === slide.slideIndex
                  ? 'border-accent shadow-lg'
                  : 'border-border/40 hover:border-border/80 opacity-70 hover:opacity-100'
              }`}
            >
              <div className="relative">
                <SlideCanvas slide={slide} width={140} slideSize={slideSize} />
                <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded text-[12px] font-mono bg-black/50 text-white">
                  {slide.slideIndex + 1}
                </span>
              </div>
            </button>
          ))}
        </div>

        {/* 右侧大图画布：flex-1 提供确定高度，AutoFitSlideCanvas 内部 contain 模式自测宽高 */}
        <div className="flex-1 min-w-0 overflow-hidden bg-black/20 p-2">
          {currentSlide ? (
            <AutoFitSlideCanvas slide={currentSlide} slideSize={slideSize} />
          ) : (
            <div className="h-full flex items-center justify-center text-text-muted/40 text-[13px]">
              选择左侧幻灯片查看预览
            </div>
          )}
        </div>
      </div>

      {/* ============ 底部状态栏 ============ */}
      <div className="flex items-center gap-3 px-4 h-9 flex-shrink-0 border-t border-border/40 bg-surface/50">
        <button
          onClick={goPrev}
          disabled={selectedIdx <= 0}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="text-[12px] text-text-muted font-mono min-w-[40px] text-center">
          {slideArr.length > 0 ? `${selectedIdx + 1} / ${slideArr.length}` : '—'}
        </span>
        <button
          onClick={goNext}
          disabled={selectedIdx >= slideArr.length - 1}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface/60 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <div className="flex-1" />

        <div className="flex items-center gap-1.5">
          {completed ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />
          ) : (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
          )}
          <span className="text-[12px] text-text-muted">{statusText}</span>
        </div>
      </div>
    </div>
  )
}
