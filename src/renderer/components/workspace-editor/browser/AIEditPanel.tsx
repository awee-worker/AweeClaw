/**
 * AI 修改浮层
 *
 * 拾取到元素后浮在页面内容之上。它是 React 层的一块浮层，不注入页面：
 * 注入进去会被站点 CSS 污染、被页面自己的事件捕获，还会进入 DOM 干扰下一次
 * 元素选择（页面上多出来的节点会被用户点到）。
 *
 * 位置：首次出现时贴在选中元素旁边，容器内放不下就自动翻到上方；头部可以拖动，
 * 拖动范围限制在内容区内部，面板不会被拖出可视区域。拖过之后位置保持到这次
 * 浮层关闭为止，不会因为页面滚动被重新摆回去。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Sparkles, Undo2, X } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import type { PickedElement } from '../../../../main/modules/preview/previewDomProbe'

interface AIEditPanelProps {
  /** 选中元素的快照 */
  picked: PickedElement
  /** 关闭面板并退出拾取态 */
  onClose: () => void
  /** 提交修改指令（调用方负责拼装元素上下文） */
  onSubmit: (instruction: string) => void
  /** 回滚本页已应用的运行时修改 */
  onUndo: () => void
  /**
   * 首帧位置固定到右下角
   *
   * 设备模拟档下 webview 被等比缩放居中，元素矩形是页面视口坐标，与浮层所在的
   * 容器坐标不同源，跟随定位会偏出去。这种时候退回固定角落，位置可预期。
   * 无论哪种来源，落位之后都可以拖动。
   */
  pinToCorner?: boolean
}

/** 面板宽度：固定值，高度由内容自然撑开 */
const PANEL_WIDTH = 380
/** 面板高度估算值：真实尺寸测量完成之前用于边界约束 */
const PANEL_HEIGHT_FALLBACK = 226
/** 面板与容器边缘之间的最小留白（px） */
const EDGE_GAP = 8
/** 固定角落时与容器边缘的距离（px） */
const CORNER_OFFSET = 16

interface PanelPosition {
  left: number
  top: number
}

interface PanelSize {
  width: number
  height: number
}

/** 把面板限制在容器内；容器比面板还小时贴左上角 */
function clampToBounds(position: PanelPosition, size: PanelSize, bounds: PanelSize): PanelPosition {
  const maxLeft = Math.max(EDGE_GAP, bounds.width - size.width - EDGE_GAP)
  const maxTop = Math.max(EDGE_GAP, bounds.height - size.height - EDGE_GAP)
  return {
    left: Math.min(Math.max(EDGE_GAP, position.left), maxLeft),
    top: Math.min(Math.max(EDGE_GAP, position.top), maxTop),
  }
}

export default function AIEditPanel({
  picked,
  onClose,
  onSubmit,
  onUndo,
  pinToCorner = false,
}: AIEditPanelProps) {
  const language = useStore((state) => state.language) as Language
  const [instruction, setInstruction] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  /** 面板位置（相对内容区左上角）；null 表示尚未落位，首帧按元素摆好 */
  const [position, setPosition] = useState<PanelPosition | null>(null)
  const [dragging, setDragging] = useState(false)
  /** 已摆放过的元素：同一个元素只自动落位一次，之后由用户拖动决定 */
  const placedRef = useRef<string | null>(null)
  /** 拖动会话：指针 id 与指针相对面板左上角的偏移 */
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  /** 面板所在内容区的可用尺寸（offsetParent 就是浮层的定位基准） */
  const measureBounds = useCallback((): PanelSize => {
    const host = panelRef.current?.offsetParent as HTMLElement | null
    if (host) return { width: host.clientWidth, height: host.clientHeight }
    return { width: window.innerWidth, height: window.innerHeight }
  }, [])

  /**
   * 首次落位
   *
   * 绘制前先量真实高度再算位置：面板高度随摘要文案行数变化，用固定估值 clamp
   * 会把矮面板推得太高、把高面板摁到容器底部被裁掉，看起来就是下方空了一块。
   */
  useLayoutEffect(() => {
    const panel = panelRef.current
    if (!panel) return
    if (placedRef.current === picked.selector) return

    const size: PanelSize = {
      width: panel.offsetWidth || PANEL_WIDTH,
      height: panel.offsetHeight || PANEL_HEIGHT_FALLBACK,
    }
    const bounds = measureBounds()

    let next: PanelPosition
    if (pinToCorner) {
      next = {
        left: bounds.width - size.width - CORNER_OFFSET,
        top: bounds.height - size.height - CORNER_OFFSET,
      }
    } else {
      const { x, y, h } = picked.rect
      const below = y + h + 10
      const above = y - size.height - 10
      next = {
        left: x,
        top: below + size.height > bounds.height ? above : below,
      }
    }

    placedRef.current = picked.selector
    setPosition(clampToBounds(next, size, bounds))
  }, [measureBounds, picked, pinToCorner])

  // 内容区尺寸变化（窗口缩放、聊天栏开合、DevTools 停靠）后把面板收回可视范围
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

  /** 从头部空白处开始拖动；头部里的按钮保留正常点击 */
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
    const originLeft = hostRect?.left ?? 0
    const originTop = hostRect?.top ?? 0

    setPosition(
      clampToBounds(
        {
          left: event.clientX - originLeft - drag.offsetX,
          top: event.clientY - originTop - drag.offsetY,
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

  const summary = useMemo(() => {
    const id = picked.id ? `#${picked.id}` : ''
    const cls = picked.classes.length > 0 ? `.${picked.classes[0]}` : ''
    return {
      tag: `<${picked.tag}${id}${cls}>`,
      size: `${picked.rect.w}×${picked.rect.h}`,
      text: picked.selectedText || picked.text,
      sameSiblings: picked.sameSiblings,
    }
  }, [picked])

  const quickActions = useMemo(
    () => [
      { key: 'text', label: t('editor.browser.aiEditQuickText', language), seed: '改写这个元素的文案：' },
      { key: 'style', label: t('editor.browser.aiEditQuickStyle', language), seed: '调整这个元素的样式：' },
      { key: 'layout', label: t('editor.browser.aiEditQuickLayout', language), seed: '调整这个元素的布局：' },
      { key: 'hide', label: t('editor.browser.aiEditQuickHide', language), seed: '隐藏这个元素' },
    ],
    [language],
  )

  const submit = useCallback(
    (value: string) => {
      const text = value.trim()
      if (!text) return
      onSubmit(text)
      setInstruction('')
    },
    [onSubmit],
  )

  return (
    <div
      ref={panelRef}
      className={`absolute z-30 rounded-xl border border-border/60 bg-background-secondary/95 backdrop-blur-md ${
        dragging ? 'shadow-2xl shadow-black/30' : 'shadow-2xl'
      }`}
      style={{
        left: position?.left ?? EDGE_GAP,
        top: position?.top ?? EDGE_GAP,
        width: PANEL_WIDTH,
        // 落位在绘制前完成，没量到尺寸时不画，避免先画在左上角再跳过去
        visibility: position ? 'visible' : 'hidden',
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          onClose()
        }
      }}
    >
      {/* 头部：拖动把守 */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b border-border/40 select-none touch-none"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={handleDragEnd}
        onPointerCancel={handleDragEnd}
      >
        <Sparkles className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="text-xs font-medium text-text-primary truncate">
          {t('editor.browser.aiEditTitle', language)}
        </span>
        <span className="ml-auto text-[11px] tabular-nums text-text-muted shrink-0">{summary.size}</span>
        <button
          type="button"
          onClick={onClose}
          title={t('editor.browser.aiEditClose', language)}
          className="w-6 h-6 -mr-1 rounded-md flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.06] transition-colors shrink-0 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 元素摘要 */}
      <div className="px-3 py-2 space-y-1">
        <code className="block text-[11px] font-mono text-accent truncate">{summary.tag}</code>
        {summary.text ? (
          <p className="text-[11px] text-text-muted truncate leading-relaxed">“{summary.text}”</p>
        ) : null}
        {summary.sameSiblings > 1 ? (
          <p className="text-[11px] text-text-muted/80">
            {summary.sameSiblings} ×
          </p>
        ) : null}
      </div>

      {/* 快捷动作：填进输入框让用户补充，不直接发送——「调样式」太笼统，模型只会瞎猜 */}
      <div className="px-3 flex flex-wrap gap-1.5">
        {quickActions.map((action) => (
          <button
            key={action.key}
            type="button"
            onClick={() => {
              setInstruction(action.seed)
              inputRef.current?.focus()
            }}
            className="px-2 py-1 text-[11px] rounded-md bg-text-primary/[0.05] hover:bg-text-primary/[0.1] text-text-secondary transition-colors"
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* 指令输入 */}
      <div className="p-3 pt-2">
        <textarea
          ref={inputRef}
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submit(instruction)
            }
          }}
          rows={2}
          placeholder={t('editor.browser.aiEditPlaceholder', language)}
          className="w-full resize-none rounded-lg bg-background border border-border/50 px-2.5 py-2 text-xs text-text-primary placeholder:text-text-muted/70 focus:outline-none focus:border-accent/60"
        />

        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            onClick={onUndo}
            className="flex items-center gap-1 px-1.5 py-1 text-[11px] text-text-muted hover:text-text-primary transition-colors"
          >
            <Undo2 className="w-3 h-3" />
            {t('editor.browser.aiEditUndo', language)}
          </button>

          <button
            type="button"
            onClick={() => submit(instruction)}
            disabled={!instruction.trim()}
            className="ml-auto px-3 py-1.5 text-[11px] font-medium rounded-lg bg-accent text-white disabled:opacity-40 enabled:hover:bg-accent/90 transition-colors"
          >
            {t('editor.browser.aiEditSend', language)}
          </button>
        </div>
      </div>
    </div>
  )
}
