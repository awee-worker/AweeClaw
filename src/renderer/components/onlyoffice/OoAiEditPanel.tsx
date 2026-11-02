/**
 * 文档 AI 修改浮层
 *
 * 文档编辑区是 canvas，页面上没有可拾取的元素，所以这里的「选中」指的是
 * 编辑器里的文字选区，而不是 DOM 元素。面板做三件事：
 * - 显示选中的原文（AI 改写的事实依据）
 * - 提供一个可编辑的「替换为」文本框，用户可以直接改，也可以让 AI 给一稿
 * - 确认后把文本写回编辑器选区
 *
 * 位置可拖动，范围限制在内容区内部，与内置浏览器的 AI 修改浮层保持一致的手感。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Sparkles, RotateCcw, X } from 'lucide-react'

interface OoAiEditPanelProps {
  /** 编辑器里选中的原文 */
  sourceText: string
  /** 关闭面板 */
  onClose: () => void
  /** 把文本写回编辑器选区 */
  onApply: (text: string) => void
  /** 让 AI 改写（把原文与要求交给会话） */
  onAskAI: (instruction: string, draft: string) => void
}

/** 面板宽度：固定值，高度由内容自然撑开 */
const PANEL_WIDTH = 400
/** 面板高度估算值：真实尺寸测量完成之前用于边界约束 */
const PANEL_HEIGHT_FALLBACK = 300
/** 面板与容器边缘之间的最小留白（px） */
const EDGE_GAP = 12
/** 原文预览折叠时的字数上限 */
const SOURCE_PREVIEW_LIMIT = 160

interface PanelPosition {
  left: number
  top: number
}

interface PanelSize {
  width: number
  height: number
}

function clampToBounds(position: PanelPosition, size: PanelSize, bounds: PanelSize): PanelPosition {
  const maxLeft = Math.max(EDGE_GAP, bounds.width - size.width - EDGE_GAP)
  const maxTop = Math.max(EDGE_GAP, bounds.height - size.height - EDGE_GAP)
  return {
    left: Math.min(Math.max(EDGE_GAP, position.left), maxLeft),
    top: Math.min(Math.max(EDGE_GAP, position.top), maxTop),
  }
}

export default function OoAiEditPanel({ sourceText, onClose, onApply, onAskAI }: OoAiEditPanelProps) {
  const [draft, setDraft] = useState(sourceText)
  const [instruction, setInstruction] = useState('')
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const [dragging, setDragging] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const instructionRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)

  useEffect(() => {
    instructionRef.current?.focus()
  }, [])

  const measureBounds = useCallback((): PanelSize => {
    const host = panelRef.current?.offsetParent as HTMLElement | null
    if (host) return { width: host.clientWidth, height: host.clientHeight }
    return { width: window.innerWidth, height: window.innerHeight }
  }, [])

  /** 首帧落到右下角：选区在哪儿无法预知，固定角落比跟随更可预期 */
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel || position) return
    const size: PanelSize = {
      width: panel.offsetWidth || PANEL_WIDTH,
      height: panel.offsetHeight || PANEL_HEIGHT_FALLBACK,
    }
    const bounds = measureBounds()
    setPosition(
      clampToBounds(
        {
          left: bounds.width - size.width - EDGE_GAP,
          top: bounds.height - size.height - EDGE_GAP,
        },
        size,
        bounds,
      ),
    )
  }, [measureBounds, position])

  // 内容区尺寸变化后把面板收回可视范围
  useEffect(() => {
    const host = panelRef.current?.offsetParent as HTMLElement | null
    if (!host) return
    const observer = new ResizeObserver(() => {
      const panel = panelRef.current
      if (!panel) return
      setPosition((current) =>
        current
          ? clampToBounds(
              current,
              { width: panel.offsetWidth, height: panel.offsetHeight },
              { width: host.clientWidth, height: host.clientHeight },
            )
          : current,
      )
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if ((event.target as HTMLElement).closest('button')) return
    const panel = panelRef.current
    if (!panel) return
    const rect = panel.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragging(true)
  }

  const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const panel = panelRef.current
    if (!drag || !panel || drag.pointerId !== event.pointerId) return
    const hostRect = (panel.offsetParent as HTMLElement | null)?.getBoundingClientRect()
    setPosition(
      clampToBounds(
        {
          left: event.clientX - (hostRect?.left ?? 0) - drag.offsetX,
          top: event.clientY - (hostRect?.top ?? 0) - drag.offsetY,
        },
        { width: panel.offsetWidth, height: panel.offsetHeight },
        measureBounds(),
      ),
    )
  }

  const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    setDragging(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
  }

  const sourcePreview =
    sourceText.length > SOURCE_PREVIEW_LIMIT
      ? `${sourceText.slice(0, SOURCE_PREVIEW_LIMIT)}…`
      : sourceText
  const changed = draft !== sourceText

  return (
    <div
      ref={panelRef}
      className={`absolute z-30 rounded-xl border border-border/60 bg-popover backdrop-blur-md ${
        dragging ? 'shadow-2xl shadow-black/30' : 'shadow-2xl'
      }`}
      style={{
        left: position?.left ?? EDGE_GAP,
        top: position?.top ?? EDGE_GAP,
        width: PANEL_WIDTH,
        visibility: position ? 'visible' : 'hidden',
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      {/* 头部：拖动把手 */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border/40 select-none touch-none"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="text-xs font-medium text-text-primary truncate">AI 修改文档内容</span>
        <span className="ml-auto text-[11px] tabular-nums text-text-muted shrink-0">
          {sourceText ? `${sourceText.length} 字` : '无文字'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="w-6 h-6 -mr-1 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors shrink-0"
          aria-label="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 选中的原文 */}
      <div className="px-3 pt-2 space-y-1">
        <div className="text-[11px] font-medium text-text-muted">选中的原文</div>
        {sourcePreview ? (
          <p className="rounded-lg bg-text-primary/[0.04] px-2 py-1.5 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap break-words max-h-24 overflow-y-auto custom-scrollbar">
            {sourcePreview}
          </p>
        ) : (
          <p className="rounded-lg bg-text-primary/[0.04] px-2 py-1.5 text-[11px] leading-relaxed text-text-muted italic">
            选中的形状没有文字，在下面输入内容后会直接写入该形状
          </p>
        )}
      </div>

      {/* 替换为 */}
      <div className="px-3 pt-2 space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-text-muted">替换为</span>
          {changed && (
            <button
              type="button"
              onClick={() => setDraft(sourceText)}
              className="ml-auto flex items-center gap-0.5 text-[11px] text-text-muted hover:text-text-primary transition-colors"
            >
              <RotateCcw className="w-3 h-3" />
              恢复原文
            </button>
          )}
        </div>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={4}
          className="w-full resize-y min-h-[72px] max-h-56 rounded-lg bg-input border border-input-border px-2.5 py-2 text-xs leading-relaxed text-text-primary focus:outline-none focus:border-accent/60"
        />
      </div>

      {/* 修改要求 + 让 AI 改写 */}
      <div className="px-3 pt-2">
        <textarea
          ref={instructionRef}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              if (instruction.trim()) onAskAI(instruction.trim(), draft)
            }
          }}
          rows={2}
          placeholder="说明要怎么改，例如：这段改成更正式的书面语，保留原有数据"
          className="w-full resize-none rounded-lg bg-input border border-input-border px-2.5 py-2 text-xs text-text-primary placeholder:text-text-muted/70 focus:outline-none focus:border-accent/60"
        />
      </div>

      <div className="p-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onAskAI(instruction.trim(), draft)}
          disabled={!instruction.trim()}
          className="flex items-center gap-1 px-2.5 h-7 rounded-lg border border-border/60 text-[11px] text-text-secondary hover:text-text-primary hover:bg-text-primary/[0.05] disabled:opacity-40 transition-colors"
        >
          <Sparkles className="w-3 h-3" />
          让 AI 改写
        </button>

        <button
          type="button"
          onClick={() => onApply(draft)}
          disabled={!draft.trim() || !changed}
          className="ml-auto px-3 h-7 text-[11px] font-medium rounded-lg bg-accent text-white disabled:opacity-40 enabled:hover:bg-accent/90 transition-colors"
        >
          应用到文档
        </button>
      </div>
    </div>
  )
}
