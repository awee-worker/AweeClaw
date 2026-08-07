/**
 * 工作区 .pptx 文件预览组件
 *
 * 复用 PptPreviewPanel 的 SlideCanvas 渲染（缩略图 + 大图 + 导航），
 * 数据来源为本地 .pptx 文件（通过 OOXML 解析器提取）。
 *
 * 与 mcp-pptx 生成预览的区别：
 * - 生成预览：数据来自插件 IPC 推送（实时）
 * - 工作区预览：数据来自 .pptx 文件解析（一次性）
 *
 * 设计要点：
 * - 使用 getFileName 提取文件名作为顶栏标题
 * - 解析失败时降级显示错误提示
 * - 复用 SlideCanvas 渲染，保证视觉一致性
 */

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Presentation,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
} from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import { getFileName } from '@shared/toolkit/pathHelper'
import { SlideCanvas } from './SlideCanvas'
import { parsePptxFromBase64, type ParsedPresentation } from './pptxParser'
import { AutoFitSlideCanvas } from './AutoFitSlideCanvas'
import type { PptSlideData } from '@shared/protocols/pptPreviewProtocol'

interface WorkspacePptxPreviewProps {
  /** .pptx 文件绝对路径 */
  path: string
}

/** 空的解析结果常量（避免每次渲染创建新引用） */
const EMPTY_RESULT: ParsedPresentation = {
  slides: [],
  slideSize: { width: 10, height: 5.625 },
  title: '',
}

export default function WorkspacePptxPreview({ path }: WorkspacePptxPreviewProps) {
  const [parsed, setParsed] = useState<ParsedPresentation>(EMPTY_RESULT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedIdx, setSelectedIdx] = useState(0)

  // --------------------------------------------
  // 文件加载与解析
  // --------------------------------------------
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setSelectedIdx(0)

    const loadAndParse = async () => {
      try {
        // 通过 IPC 读取 .pptx 文件为 base64
        const base64 = await api.file.readBinary(path)
        if (cancelled || !base64) {
          if (!cancelled) setError('无法读取文件内容')
          return
        }

        // 解析 OOXML
        const result = await parsePptxFromBase64(base64)
        if (cancelled) return

        if (result.slides.length === 0) {
          setError('未在文件中找到幻灯片')
          return
        }

        setParsed(result)
        setLoading(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : '解析 .pptx 文件失败')
        setLoading(false)
      }
    }

    loadAndParse()
    return () => { cancelled = true }
  }, [path])

  // --------------------------------------------
  // 幻灯片数据派生
  // --------------------------------------------
  const slideArr = useMemo(
    () => parsed.slides.slice().sort((a, b) => a.slideIndex - b.slideIndex),
    [parsed.slides],
  )

  const currentSlide: PptSlideData | undefined = slideArr[selectedIdx]
  const fileName = getFileName(path)

  // 实际幻灯片尺寸（来自 pptxParser 解析 presentation.xml 的 sldSz）
  const slideSize = parsed.slideSize

  // --------------------------------------------
  // 导航
  // --------------------------------------------
  const goPrev = useCallback(() => {
    setSelectedIdx((i) => Math.max(0, i - 1))
  }, [])

  const goNext = useCallback(() => {
    setSelectedIdx((i) => Math.min(slideArr.length - 1, i + 1))
  }, [slideArr.length])

  // --------------------------------------------
  // 渲染
  // --------------------------------------------
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
          <span className="text-[13px] text-text-muted">正在解析 .pptx 文件...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center p-8">
          <AlertCircle className="w-10 h-10 text-status-error/60" />
          <div className="text-[14px] text-text-primary font-medium">{error}</div>
          <div className="text-[12px] text-text-muted max-w-md">
            该文件可能使用了不支持的格式或已损坏。可尝试用 Office 打开。
          </div>
        </div>
      </div>
    )
  }

  if (slideArr.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-[13px] text-text-muted">无幻灯片内容</div>
      </div>
    )
  }

  return (
    <div className="flex flex-col w-full h-full overflow-hidden bg-background">
      {/* ============ 顶栏 ============ */}
      <div className="flex items-center gap-3 px-4 h-12 flex-shrink-0 border-b border-border/40 bg-surface/50">
        <Presentation className="w-4 h-4 text-accent" />
        <span className="text-[14px] font-semibold text-text-primary truncate">
          {parsed.title || fileName}
        </span>
        <span className="text-[12px] text-text-muted px-2 py-0.5 rounded bg-surface">
          {slideArr.length} 张
        </span>
      </div>

      {/* ============ 主体 ============ */}
      <div className="flex flex-1 min-h-0">
        {/* 左侧缩略图列表 */}
        <div className="w-[160px] flex-shrink-0 border-r border-border/40 overflow-y-auto custom-scrollbar p-2 space-y-2">
          {slideArr.map((slide) => (
            <button
              key={slide.slideIndex}
              onClick={() => setSelectedIdx(slideArr.indexOf(slide))}
              className={`w-full rounded-lg overflow-hidden border-2 transition-all ${
                selectedIdx === slideArr.indexOf(slide)
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

        {/* 右侧大图画布：用 w-full 撑满 flex-1 容器，AutoFitSlideCanvas 内部自测宽度 */}
        <div className="flex-1 min-w-0 flex items-center justify-center overflow-hidden bg-black/20 p-2">
          {currentSlide ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="w-full" style={{ maxWidth: '100%', maxHeight: '100%' }}>
                <AutoFitSlideCanvas slide={currentSlide} slideSize={slideSize} />
              </div>
            </div>
          ) : (
            <div className="text-text-muted/40 text-[13px]">
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

        <span className="text-[12px] text-text-muted">
          {fileName}
        </span>
      </div>
    </div>
  )
}
