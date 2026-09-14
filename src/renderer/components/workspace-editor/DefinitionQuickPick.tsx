/**
 * 多定义 Quick Pick
 *
 * 当一个符号存在多个定义（重载 / 接口多实现 / 同名符号）时，
 * 由 F12、Ctrl+Click、右键「转到定义」统一唤起本组件让用户选择目标。
 *  - 支持输入过滤（文件名 / 路径 / 定义行内容）
 *  - 支持 ↑↓ 选择、回车确认、Esc 关闭
 *  - 异步补齐每个候选的定义行预览，不阻塞弹窗打开
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft, FileCode } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { readFileContentForPreview, type DefinitionCandidate } from '@services/editorNavigation'

export type { DefinitionCandidate }

interface DefinitionQuickPickProps {
  items: DefinitionCandidate[]
  /** 光标屏幕坐标（client 坐标） */
  position: { x: number; y: number }
  onSelect: (item: DefinitionCandidate) => void
  onClose: () => void
}

const PANEL_WIDTH = 460
const PANEL_MAX_HEIGHT = 320
const VIEWPORT_MARGIN = 8

export default function DefinitionQuickPick({ items, position, onSelect, onClose }: DefinitionQuickPickProps) {
  const language = useStore((s) => s.language) as Language

  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [keyword, setKeyword] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [layout, setLayout] = useState(() => ({
    left: position.x,
    top: position.y + VIEWPORT_MARGIN,
  }))
  const [previews, setPreviews] = useState<Record<string, string | null>>({})

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return items
    return items.filter((item) =>
      item.label.toLowerCase().includes(kw)
      || item.detail.toLowerCase().includes(kw)
      || (previews[item.uri] ?? '').toLowerCase().includes(kw))
  }, [items, keyword, previews])

  useEffect(() => {
    setActiveIndex(0)
  }, [keyword])

  // 位置自适应：优先在光标下方展开，空间不足则上翻，并做视口左右收敛
  useEffect(() => {
    const height = Math.min(PANEL_MAX_HEIGHT, 56 + Math.max(items.length, 1) * 44)
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, position.x),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - PANEL_WIDTH - VIEWPORT_MARGIN),
    )
    const belowTop = position.y + VIEWPORT_MARGIN
    const overflows = belowTop + height > window.innerHeight - VIEWPORT_MARGIN
    setLayout({ left, top: overflows ? Math.max(VIEWPORT_MARGIN, position.y - height) : belowTop })
  }, [position.x, position.y, items.length])

  // 异步补齐定义行预览
  useEffect(() => {
    let cancelled = false
    const filePaths = Array.from(new Set(items.map((item) => item.filePath))).slice(0, 30)
    void (async () => {
      const next: Record<string, string | null> = {}
      await Promise.all(filePaths.map(async (filePath) => {
        const content = await readFileContentForPreview(filePath)
        const lines = content === null ? [] : content.split(/\r?\n/)
        items
          .filter((item) => item.filePath === filePath)
          .forEach((item) => {
            const text = lines[item.line - 1]
            next[item.uri] = typeof text === 'string' ? text.trim() : null
          })
      }))
      if (!cancelled) setPreviews((prev) => ({ ...prev, ...next }))
    })()
    return () => { cancelled = true }
  }, [items])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [onClose])

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, filtered.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = filtered[activeIndex]
      if (item) onSelect(item)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }, [filtered, activeIndex, onSelect, onClose])

  return createPortal(
    <div
      ref={containerRef}
      className="fixed z-[9999] no-drag bg-surface border border-border-subtle rounded-lg shadow-2xl overflow-hidden flex flex-col"
      style={{ left: layout.left, top: layout.top, width: PANEL_WIDTH, maxHeight: PANEL_MAX_HEIGHT }}
      onKeyDown={handleKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle flex-shrink-0">
        <FileCode className="w-3.5 h-3.5 text-accent flex-shrink-0" />
        <span className="text-xs text-text-secondary">{t('definitionPicker.title', language, { count: items.length })}</span>
        <input
          ref={inputRef}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t('definitionPicker.placeholder', language)}
          className="ml-auto w-[200px] px-2 py-1 text-[11px] rounded-md bg-background border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60"
        />
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {filtered.length === 0 ? (
          <div className="px-3 py-6 text-center text-[11px] text-text-muted">{t('ctxNoResults', language)}</div>
        ) : filtered.map((item, index) => (
          <div
            key={`${item.uri}:${item.line}:${item.column}`}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => onSelect(item)}
            className={`px-3 py-2 cursor-pointer border-b border-border/30 last:border-b-0 transition-colors ${index === activeIndex ? 'bg-accent/15' : 'hover:bg-surface-hover'}`}
          >
            <div className="flex items-center gap-2">
              <span className="text-xs text-text-primary truncate">{item.label}</span>
              <span className="text-[10px] text-text-muted truncate ml-auto">{item.detail}</span>
            </div>
            <div className="mt-0.5 text-[11px] font-mono text-text-muted truncate whitespace-pre">
              {previews[item.uri] ?? t('definitionPicker.loadingPreview', language)}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3 px-3 py-1.5 border-t border-border-subtle bg-surface-hover text-[10px] text-text-muted flex-shrink-0">
        <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3" />{t('selectItem', language)}</span>
        <span>↑↓ {t('navigate', language)}</span>
        <span>Esc {t('closeMenu', language)}</span>
      </div>
    </div>,
    document.body,
  )
}
