/**
 * PPT 预览主组件
 *
 * 布局：顶栏 + 左侧缩略图列表 + 右侧大图画布 + 底部状态栏
 *
 * IPC 事件监听：
 * - ppt-preview:open → 初始化会话
 * - ppt-preview:push-slide → 新增/更新幻灯片
 * - ppt-preview:mark-complete → 标记完成
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Presentation,
  CheckCircle2,
  Loader2,
  Download,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import type { PptSlideData, PptPresentationMeta } from '@shared/protocols/pptPreviewProtocol'
import { SlideCanvas } from './SlideCanvas'
import { AutoFitSlideCanvas } from './AutoFitSlideCanvas'

export function PptPreviewApp() {
  const [meta, setMeta] = useState<PptPresentationMeta | null>(null)
  const [slides, setSlides] = useState<Map<number, PptSlideData>>(new Map())
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [completed, setCompleted] = useState(false)
  const [filePath, setFilePath] = useState<string | null>(null)

  // selectedIdx 的 ref，避免 useEffect 重订阅；声明在使用之前防止 TDZ
  const selectedIdxRef = useRef(0)
  selectedIdxRef.current = selectedIdx

  // --------------------------------------------
  // IPC 事件监听
  // --------------------------------------------
  useEffect(() => {
    const unsubs: (() => void)[] = []

    unsubs.push(
      api.pptPreview.onOpen((m: PptPresentationMeta) => {
        setMeta(m)
        setSlides(new Map())
        setSelectedIdx(0)
        setCompleted(false)
        setFilePath(null)
      }),
    )

    unsubs.push(
      api.pptPreview.onPushSlide((slide: PptSlideData) => {
        setSlides((prev) => {
          const next = new Map(prev)
          next.set(slide.slideIndex, slide)
          // 自动选中最新幻灯片（仅当用户当前停在最后一张时跟随，避免覆盖用户手动选择）
          if (slide.slideIndex >= selectedIdxRef.current) {
            setSelectedIdx(slide.slideIndex)
          }
          return next
        })
      }),
    )

    unsubs.push(
      api.pptPreview.onMarkComplete((data: { sessionId: string; filePath: string }) => {
        setCompleted(true)
        setFilePath(data.filePath)
      }),
    )

    return () => unsubs.forEach((u) => u())
  }, [])

  // --------------------------------------------
  // 导出
  // --------------------------------------------
  const handleExport = useCallback(() => {
    if (filePath) {
      void api.pptPreview.export(filePath)
    }
  }, [filePath])

  const handleClose = useCallback(() => {
    void api.pptPreview.close()
  }, [])

  // --------------------------------------------
  // 幻灯片导航
  // --------------------------------------------
  const slideArr = Array.from(slides.values()).sort((a, b) => a.slideIndex - b.slideIndex)
  const currentSlide = slides.get(selectedIdx)

  // 幻灯片实际尺寸（来自 create_presentation 时的 slideSize）
  const slideSize = meta?.slideSize

  const goPrev = useCallback(() => {
    setSelectedIdx((i) => Math.max(0, i - 1))
  }, [])

  const goNext = useCallback(() => {
    setSelectedIdx((i) => Math.min(slideArr.length - 1, i + 1))
  }, [slideArr.length])

  // --------------------------------------------
  // 渲染
  // --------------------------------------------
  const isZh = true // 预览窗口固定中文
  const statusText = completed
    ? `${isZh ? '已保存' : 'Saved'} · ${slideArr.length} ${isZh ? '张幻灯片' : 'slides'}`
    : `${isZh ? '生成中' : 'Generating'} · ${slideArr.length} ${isZh ? '张幻灯片' : 'slides'}`

  return (
    <div className="flex flex-col w-full h-full overflow-hidden" style={{ background: 'rgb(var(--background))' }}>
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
            {isZh ? '在文件夹中显示' : 'Show in Folder'}
          </button>
        )}
        <button
          onClick={handleClose}
          className="flex items-center justify-center w-7 h-7 rounded-lg text-text-muted hover:text-text-primary hover:bg-surface/60 transition-colors text-[14px]"
          title={isZh ? '关闭' : 'Close'}
        >
          ✕
        </button>
      </div>

      {/* ============ 主体 ============ */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧缩略图列表 */}
        <div className="w-[160px] flex-shrink-0 border-r border-border/40 overflow-y-auto custom-scrollbar p-2 space-y-2">
          {slideArr.length === 0 && (
            <div className="flex items-center justify-center h-full text-text-muted/50 text-[12px]">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>{isZh ? '等待生成...' : 'Waiting...'}</span>
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
              {isZh ? '选择左侧幻灯片查看预览' : 'Select a slide to preview'}
            </div>
          )}
        </div>
      </div>

      {/* ============ 底部状态栏 ============ */}
      <div className="flex items-center gap-3 px-4 h-9 flex-shrink-0 border-t border-border/40 bg-surface/50">
        {/* 上一张/下一张 */}
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

        {/* 状态指示 */}
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
