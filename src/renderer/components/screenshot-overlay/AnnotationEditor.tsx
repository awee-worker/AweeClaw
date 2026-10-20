/**
 * 截图标注编辑层
 *
 * 覆盖窗口完成框选后，主进程把裁剪好的截图回传到这里，本组件把截图
 * 铺回选区原位并叠加标注图层，形成「截图后可编辑」的完整体验。
 *
 * 图层结构：
 * - 底层 canvas：底图 + 已确认标注，仅在标注集合变化时重绘
 * - 上层 canvas：当前拖拽中的草稿，每次指针移动重绘，与底层互不干扰
 *
 * 坐标约定：画布尺寸取截图物理像素，鼠标 CSS 偏移乘以 scaleFactor 后写入标注。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ANNOTATION_COLORS,
  ANNOTATION_LINE_WIDTHS,
  type AnnotationItem,
  type AnnotationTool,
  type EditImagePayload,
  type Point,
} from './annotationTypes'
import { createItem, renderCommitted, renderDraft } from './annotationDrawing'

interface AnnotationEditorProps {
  /** 主进程回传的截图 */
  image: EditImagePayload
  /** 选区在覆盖窗口内的 CSS 位置与尺寸 */
  rect: { x: number; y: number; width: number; height: number }
  screenWidth: number
  /** 可用工作区底部相对窗口顶部的偏移，用于工具栏避让 Dock */
  workAreaBottom: number
  onSave: (base64: string, width: number, height: number) => void
  onCopy: (base64: string) => void
  onDownload: (base64: string) => void
  onCancel: () => void
}

/** 工具栏固定宽度：位置计算与内容排布共用 */
const TOOLBAR_WIDTH = 728
/** 工具栏高度（含内边距），用于下方空间判断 */
const TOOLBAR_HEIGHT = 44
/** 文字工具的基准字号（CSS 像素） */
const TEXT_FONT_SIZE = 18

interface ToolMeta {
  tool: AnnotationTool
  label: string
  path: React.ReactNode
}

const TOOLS: ToolMeta[] = [
  {
    tool: 'rect',
    label: '矩形',
    path: <rect x="4" y="6" width="16" height="12" rx="1.5" />,
  },
  {
    tool: 'ellipse',
    label: '椭圆',
    path: <ellipse cx="12" cy="12" rx="8" ry="6.5" />,
  },
  {
    tool: 'arrow',
    label: '箭头',
    path: (
      <>
        <path d="M5 19 L19 5" />
        <path d="M19 5 L12 5 M19 5 L19 12" />
      </>
    ),
  },
  {
    tool: 'pen',
    label: '画笔',
    path: <path d="M4 17 C8 7 11 15 15 10 S20 7 20 7" />,
  },
  {
    tool: 'highlight',
    label: '高亮',
    path: <rect x="3" y="9.5" width="18" height="5.5" rx="1.5" />,
  },
  {
    tool: 'mosaic',
    label: '马赛克',
    path: (
      <>
        <rect x="4" y="4" width="7" height="7" />
        <rect x="13" y="4" width="7" height="7" />
        <rect x="4" y="13" width="7" height="7" />
        <rect x="13" y="13" width="7" height="7" />
      </>
    ),
  },
  {
    tool: 'text',
    label: '文字',
    path: (
      <>
        <path d="M5 6 L19 6" />
        <path d="M12 6 L12 19" />
      </>
    ),
  },
]

/** 判断一条标注是否值得保留（过滤误触产生的极小图形） */
function isValidItem(item: AnnotationItem): boolean {
  if (item.tool === 'pen') return item.points.length > 1
  if (item.tool === 'text') return Boolean(item.text && item.text.trim())
  if (item.tool === 'arrow') {
    return Math.hypot(item.end.x - item.start.x, item.end.y - item.start.y) >= 6
  }
  const width = Math.abs(item.end.x - item.start.x)
  const height = Math.abs(item.end.y - item.start.y)
  return width >= 4 && height >= 4
}

interface TextInputState {
  /** 输入框相对编辑区的 CSS 偏移 */
  cssX: number
  cssY: number
  value: string
}

export function AnnotationEditor(props: AnnotationEditorProps): React.ReactElement {
  const { image, rect, screenWidth, workAreaBottom } = props

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const committedRef = useRef<HTMLCanvasElement | null>(null)
  const draftRef = useRef<HTMLCanvasElement | null>(null)
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null)

  const [tool, setTool] = useState<AnnotationTool>('rect')
  const [color, setColor] = useState<string>(ANNOTATION_COLORS[0])
  const [lineWidth, setLineWidth] = useState<number>(ANNOTATION_LINE_WIDTHS[0])

  const [items, setItems] = useState<AnnotationItem[]>([])
  const [draft, setDraftState] = useState<AnnotationItem | null>(null)
  const [textInput, setTextInput] = useState<TextInputState | null>(null)
  const [imageReady, setImageReady] = useState(false)
  const [toast, setToast] = useState('')

  // 拖拽中的草稿同时写入 ref：pointerup 时 state 尚未提交，需读最新值
  const draftRefValue = useRef<AnnotationItem | null>(null)
  const draggingRef = useRef(false)
  const scaleFactor = image.scaleFactor || 1

  const setDraft = useCallback((next: AnnotationItem | null) => {
    draftRefValue.current = next
    setDraftState(next)
  }, [])

  // 底图解码：图片尺寸与画布尺寸一致，直接 1:1 绘制
  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = image.width
    canvas.height = image.height
    baseCanvasRef.current = canvas
    setImageReady(false)

    const img = new Image()
    img.onload = () => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0, image.width, image.height)
      setImageReady(true)
    }
    img.src = `data:image/png;base64,${image.base64}`
  }, [image.base64, image.width, image.height])

  // 底层重绘：底图 + 全部已确认标注
  useEffect(() => {
    const ctx = committedRef.current?.getContext('2d')
    const base = baseCanvasRef.current
    if (!ctx || !base || !imageReady) return
    renderCommitted(ctx, base, items, image.width, image.height)
  }, [items, imageReady, image.width, image.height])

  // 上层重绘：只画当前草稿
  useEffect(() => {
    const ctx = draftRef.current?.getContext('2d')
    const base = baseCanvasRef.current
    if (!ctx || !base) return
    renderDraft(ctx, base, draft, image.width, image.height)
  }, [draft, image.width, image.height])

  /** 把指针位置换算成画布物理像素坐标 */
  const toCanvasPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const box = wrapRef.current?.getBoundingClientRect()
      if (!box) return { x: 0, y: 0 }
      return {
        x: (clientX - box.left) * scaleFactor,
        y: (clientY - box.top) * scaleFactor,
      }
    },
    [scaleFactor],
  )

  /** 合成最终图片：底层已含底图与标注，若仍有草稿则一并叠加 */
  const exportBase64 = useCallback((): string => {
    const out = document.createElement('canvas')
    out.width = image.width
    out.height = image.height
    const ctx = out.getContext('2d')
    if (!ctx) return ''
    if (committedRef.current) ctx.drawImage(committedRef.current, 0, 0)
    if (draftRef.current) ctx.drawImage(draftRef.current, 0, 0)
    const dataUrl = out.toDataURL('image/png')
    return dataUrl.slice(dataUrl.indexOf(',') + 1)
  }, [image.width, image.height])

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.button !== 0) return

      if (tool === 'text') {
        const box = wrapRef.current?.getBoundingClientRect()
        if (!box) return
        setTextInput({
          cssX: e.clientX - box.left,
          cssY: e.clientY - box.top,
          value: '',
        })
        return
      }

      e.currentTarget.setPointerCapture(e.pointerId)
      draggingRef.current = true
      setDraft(createItem(tool, color, lineWidth * scaleFactor, toCanvasPoint(e.clientX, e.clientY)))
    },
    [tool, color, lineWidth, scaleFactor, toCanvasPoint, setDraft],
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!draggingRef.current) return
      const point = toCanvasPoint(e.clientX, e.clientY)
      const current = draftRefValue.current
      if (!current) return

      if (current.tool === 'pen') {
        const last = current.points[current.points.length - 1]
        // 采样抽稀：距离过近的点丢弃，避免轨迹数组膨胀
        if (last && Math.hypot(point.x - last.x, point.y - last.y) < 2) return
        setDraft({ ...current, points: [...current.points, point], end: point })
        return
      }

      setDraft({ ...current, end: point })
    },
    [toCanvasPoint, setDraft],
  )

  const handlePointerUp = useCallback(() => {
    if (!draggingRef.current) return
    draggingRef.current = false
    const current = draftRefValue.current
    setDraft(null)
    if (current && isValidItem(current)) {
      setItems((prev) => [...prev, current])
    }
  }, [setDraft])

  /** 提交文字输入 */
  const commitText = useCallback(() => {
    const pending = textInput
    setTextInput(null)
    const content = pending?.value.trim()
    if (!pending || !content) return
    setItems((prev) => [
      ...prev,
      {
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        tool: 'text',
        color,
        lineWidth: lineWidth * scaleFactor,
        start: {
          x: pending.cssX * scaleFactor,
          y: pending.cssY * scaleFactor,
        },
        end: {
          x: pending.cssX * scaleFactor,
          y: pending.cssY * scaleFactor,
        },
        points: [],
        text: content,
        fontSize: TEXT_FONT_SIZE * scaleFactor,
      },
    ])
  }, [textInput, color, lineWidth, scaleFactor])

  const handleUndo = useCallback(() => {
    setItems((prev) => prev.slice(0, -1))
  }, [])

  const handleSave = useCallback(() => {
    const base64 = exportBase64()
    if (!base64) return
    props.onSave(base64, image.width, image.height)
  }, [exportBase64, props, image.width, image.height])

  const handleCopy = useCallback(() => {
    const base64 = exportBase64()
    if (!base64) return
    props.onCopy(base64)
    setToast('已复制到剪贴板')
  }, [exportBase64, props])

  const handleDownload = useCallback(() => {
    const base64 = exportBase64()
    if (!base64) return
    props.onDownload(base64)
  }, [exportBase64, props])

  // 提示 1.6s 后自动消失
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(''), 1600)
    return () => window.clearTimeout(timer)
  }, [toast])

  // 快捷键：Enter 完成、Esc 取消、Cmd/Ctrl+Z 撤销
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const inTextarea = target?.tagName === 'TEXTAREA'

      if (e.key === 'Escape') {
        if (inTextarea) {
          setTextInput(null)
          e.stopPropagation()
          return
        }
        props.onCancel()
        return
      }

      if (inTextarea) return

      if (e.key === 'Enter') {
        e.preventDefault()
        handleSave()
        return
      }

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        handleUndo()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [handleSave, handleUndo, props])

  /** 工具栏位置：优先贴选区下方，空间不足时翻到上方 */
  const toolbarPosition = useMemo(() => {
    const belowTop = rect.y + rect.height + 10
    const useBelow = belowTop + TOOLBAR_HEIGHT + 10 <= workAreaBottom
    const top = useBelow ? belowTop : Math.max(rect.y - TOOLBAR_HEIGHT - 10, 8)
    const left = Math.max(
      8,
      Math.min(
        rect.x + rect.width / 2 - TOOLBAR_WIDTH / 2,
        Math.max(8, screenWidth - TOOLBAR_WIDTH - 8),
      ),
    )
    return { top, left }
  }, [rect, workAreaBottom, screenWidth])

  const canvasStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    display: 'block',
  }

  const cursor = tool === 'text' ? 'text' : 'crosshair'

  return (
    <div
      ref={wrapRef}
      data-overlay-control
      style={{
        position: 'absolute',
        left: rect.x,
        top: rect.y,
        width: rect.width,
        height: rect.height,
        overflow: 'hidden',
        cursor,
        boxShadow: '0 0 0 1px rgba(59, 130, 246, 0.9)',
        zIndex: 12,
      }}
    >
      <style>{ANNOTATION_EDITOR_CSS}</style>

      <canvas ref={committedRef} width={image.width} height={image.height} style={canvasStyle} />
      <canvas
        ref={draftRef}
        width={image.width}
        height={image.height}
        style={{ ...canvasStyle, touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />

      {textInput && (
        <textarea
          autoFocus
          value={textInput.value}
          onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
          onBlur={commitText}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              commitText()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setTextInput(null)
            }
          }}
          placeholder="输入文字"
          style={{
            position: 'absolute',
            left: textInput.cssX,
            top: textInput.cssY,
            minWidth: 140,
            maxWidth: Math.max(140, rect.width - textInput.cssX - 8),
            minHeight: TEXT_FONT_SIZE * 1.5,
            padding: '2px 4px',
            background: 'rgba(0, 0, 0, 0.55)',
            color,
            border: `1px solid ${color}`,
            borderRadius: 3,
            outline: 'none',
            resize: 'none',
            fontSize: TEXT_FONT_SIZE,
            lineHeight: 1.35,
            fontWeight: 600,
            fontFamily: '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif',
          }}
        />
      )}

      {toast && (
        <div
          style={{
            position: 'absolute',
            left: '50%',
            top: 12,
            transform: 'translateX(-50%)',
            padding: '5px 14px',
            borderRadius: 14,
            background: 'rgba(0, 0, 0, 0.78)',
            color: '#fff',
            fontSize: 12,
            pointerEvents: 'none',
            zIndex: 5,
          }}
        >
          {toast}
        </div>
      )}

      <div
        data-overlay-control
        className="awx-annot-toolbar"
        style={{
          position: 'fixed',
          top: toolbarPosition.top,
          left: toolbarPosition.left,
          width: TOOLBAR_WIDTH,
          minHeight: TOOLBAR_HEIGHT,
          zIndex: 20,
        }}
      >
        <div className="awx-annot-group">
          {TOOLS.map((meta) => (
            <button
              key={meta.tool}
              type="button"
              title={meta.label}
              className={`awx-annot-btn${tool === meta.tool ? ' is-active' : ''}`}
              onClick={() => setTool(meta.tool)}
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {meta.path}
              </svg>
            </button>
          ))}
        </div>

        <span className="awx-annot-divider" />

        <div className="awx-annot-group">
          {ANNOTATION_COLORS.map((value) => (
            <button
              key={value}
              type="button"
              title={value}
              className={`awx-annot-swatch${color === value ? ' is-active' : ''}`}
              style={{ background: value }}
              onClick={() => setColor(value)}
            />
          ))}
        </div>

        <span className="awx-annot-divider" />

        <div className="awx-annot-group">
          {ANNOTATION_LINE_WIDTHS.map((value) => (
            <button
              key={value}
              type="button"
              title={`线宽 ${value}`}
              className={`awx-annot-btn${lineWidth === value ? ' is-active' : ''}`}
              onClick={() => setLineWidth(value)}
            >
              <span
                style={{
                  display: 'block',
                  width: 16,
                  height: value,
                  borderRadius: value,
                  background: 'currentColor',
                }}
              />
            </button>
          ))}
        </div>

        <span className="awx-annot-divider" />

        <button
          type="button"
          title="撤销 (Cmd/Ctrl+Z)"
          className="awx-annot-btn"
          disabled={items.length === 0}
          onClick={handleUndo}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 14 L4 9 L9 4" />
            <path d="M4 9 L15 9 A5 5 0 0 1 15 19 L11 19" />
          </svg>
        </button>

        <span className="awx-annot-spacer" />

        <button type="button" className="awx-annot-text" onClick={props.onCancel}>
          取消
        </button>
        <button type="button" className="awx-annot-text" onClick={handleCopy}>
          复制
        </button>
        <button type="button" className="awx-annot-text" onClick={handleDownload}>
          保存
        </button>
        <button type="button" className="awx-annot-text is-primary" onClick={handleSave}>
          完成
        </button>
      </div>
    </div>
  )
}

/** 工具条样式：内联 <style> 便于使用 hover / active 伪类 */
const ANNOTATION_EDITOR_CSS = `
.awx-annot-toolbar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  box-sizing: border-box;
  background: rgba(28, 28, 30, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  color: #f2f2f7;
  font-size: 13px;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
  user-select: none;
}
.awx-annot-group { display: flex; align-items: center; gap: 2px; }
.awx-annot-divider {
  width: 1px;
  height: 20px;
  margin: 0 4px;
  background: rgba(255, 255, 255, 0.14);
  flex: none;
}
.awx-annot-spacer { flex: 1 1 auto; }
.awx-annot-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #e5e5ea;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.awx-annot-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.12); }
.awx-annot-btn.is-active { background: #0a84ff; color: #fff; }
.awx-annot-btn:disabled { opacity: 0.35; cursor: default; }
.awx-annot-swatch {
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.awx-annot-swatch:hover { transform: scale(1.12); }
.awx-annot-swatch.is-active {
  box-shadow: 0 0 0 2px #0a84ff, 0 0 0 3px rgba(0, 0, 0, 0.6);
}
.awx-annot-text {
  height: 28px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #e5e5ea;
  font-size: 13px;
  cursor: pointer;
  transition: background 120ms ease;
}
.awx-annot-text:hover { background: rgba(255, 255, 255, 0.12); }
.awx-annot-text.is-primary {
  margin-left: 4px;
  background: #0a84ff;
  color: #fff;
  font-weight: 600;
}
.awx-annot-text.is-primary:hover { background: #0071e3; }
`
