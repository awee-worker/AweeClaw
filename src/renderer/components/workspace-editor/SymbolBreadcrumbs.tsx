/**
 * 大纲面包屑（Symbol Breadcrumbs）
 *
 * 在编辑器面包屑栏中以「路径 › 类 › 方法 › 变量」的形式展示光标所在符号链路：
 *  - 数据来源：LSP documentSymbol（支持 DocumentSymbol 树 / SymbolInformation 平铺两种形态）
 *  - 点击任意一段 → 浮层列出同级符号（含后代，缩进展示），支持过滤与键盘选择
 *  - 选择后跳转到该符号（写入导航历史，可 Alt+← 返回）
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, Box, Braces, FunctionSquare, Hash, Variable, CornerDownLeft } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { getDocumentSymbols } from '@services/languageServerAdapter'
import { revealLocation } from '@services/editorNavigation'

interface SymbolBreadcrumbsProps {
  filePath: string
  language: Language
}

interface FlatSymbol {
  id: string
  name: string
  detail: string
  kind: number
  /** 1-based */
  line: number
  /** 1-based */
  endLine: number
  depth: number
  parentId: string | null
  childIds: string[]
}

/** LSP SymbolKind → 图标（保持与语言无关的通用语义） */
function getKindIcon(kind: number): React.ComponentType<{ className?: string }> {
  switch (kind) {
    case 2: case 3: case 4: return Braces
    case 5: case 10: case 11: case 23: return Box
    case 6: case 9: case 12: return FunctionSquare
    case 7: case 8: case 13: case 14: case 22: return Variable
    default: return Hash
  }
}

/** 归一化 documentSymbol 结果（树形 / 平铺）为扁平结构 */
function flattenSymbols(raw: unknown[]): FlatSymbol[] {
  const flat: FlatSymbol[] = []
  let autoId = 0

  const toLine = (value: unknown): number => {
    const num = typeof value === 'number' ? value : 0
    return num + 1
  }

  const walk = (node: any, depth: number, parentId: string | null) => {
    if (!node || typeof node !== 'object') return
    const range = node.range ?? node.location?.range ?? node.selectionRange
    if (!range?.start) return

    const id = `${autoId++}:${node.name}:${range.start.line}`
    const symbol: FlatSymbol = {
      id,
      name: String(node.name ?? ''),
      detail: typeof node.detail === 'string' ? node.detail : '',
      kind: typeof node.kind === 'number' ? node.kind : 99,
      line: toLine(range.start.line),
      endLine: toLine(range.end?.line ?? range.start.line),
      depth,
      parentId,
      childIds: [],
    }
    flat.push(symbol)

    const children: unknown[] = Array.isArray(node.children) ? node.children : []
    children.forEach((child) => walk(child, depth + 1, id))
  }

  raw.forEach((node) => walk(node, 0, null))

  // 回填子节点 id，便于按层级取同级 / 后代
  const byId = new Map(flat.map((symbol) => [symbol.id, symbol]))
  flat.forEach((symbol) => {
    if (!symbol.parentId) return
    byId.get(symbol.parentId)?.childIds.push(symbol.id)
  })

  return flat
}

export function SymbolBreadcrumbs({ filePath, language }: SymbolBreadcrumbsProps) {
  const cursorLine = useStore((s) => s.cursorPosition.line)
  const listScrollTop = useStore((s) => s.workspacePath) // 仅用于触发工作区切换后的重算

  const [symbols, setSymbols] = useState<FlatSymbol[]>([])
  const [openSegmentId, setOpenSegmentId] = useState<string | null>(null)
  const [anchorRect, setAnchorRect] = useState<{ left: number; top: number } | null>(null)
  const [keyword, setKeyword] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const searchRef = useRef<HTMLInputElement>(null)

  const loadSymbols = useCallback(async () => {
    const result = await getDocumentSymbols(filePath)
    setSymbols(flattenSymbols(Array.isArray(result) ? result : []))
  }, [filePath])

  // 文件切换 / 工作区切换 → 重新拉取符号
  useEffect(() => {
    setSymbols([])
    setOpenSegmentId(null)
    void loadSymbols()
  }, [filePath, listScrollTop, loadSymbols])

  // LSP 可能尚未就绪：空结果时做两次延迟重试，避免刚打开文件时面包屑长时间缺失
  useEffect(() => {
    if (symbols.length > 0) return
    let attempts = 0
    const timer = setInterval(() => {
      attempts += 1
      void loadSymbols()
      if (attempts >= 2) clearInterval(timer)
    }, 1500)
    return () => clearInterval(timer)
  }, [symbols.length, loadSymbols])

  // 内容变更（防抖）后刷新符号，避免每次按键都请求
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = useStore.subscribe((state, prevState) => {
      const next = state.openFiles.find((f) => f.path === filePath)?.content
      const prev = prevState.openFiles.find((f) => f.path === filePath)?.content
      if (next === prev) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => { void loadSymbols() }, 700)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [filePath, loadSymbols])

  /** 光标所在符号链路（从最外层到最内层） */
  const chain = useMemo(() => {
    if (symbols.length === 0) return [] as FlatSymbol[]
    const containing = symbols.filter((symbol) => cursorLine >= symbol.line && cursorLine <= symbol.endLine)
    if (containing.length === 0) return [] as FlatSymbol[]
    const deepest = containing.reduce((best, current) => (current.depth >= best.depth ? current : best), containing[0])

    const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]))
    const path: FlatSymbol[] = []
    let cursor: FlatSymbol | undefined = deepest
    while (cursor) {
      path.unshift(cursor)
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined
    }
    return path
  }, [symbols, cursorLine])

  /** 浮层候选：被点击段的同级及其后代（缩进展示） */
  const dropdownItems = useMemo(() => {
    if (!openSegmentId) return [] as FlatSymbol[]
    const byId = new Map(symbols.map((symbol) => [symbol.id, symbol]))
    const target = byId.get(openSegmentId)
    if (!target) return [] as FlatSymbol[]

    const roots = target.parentId ? (byId.get(target.parentId)?.childIds ?? []) : symbols.filter((s) => s.parentId === null).map((s) => s.id)
    const collected: FlatSymbol[] = []
    const collect = (id: string) => {
      const symbol = byId.get(id)
      if (!symbol) return
      collected.push(symbol)
      symbol.childIds.forEach(collect)
    }
    roots.forEach(collect)

    const baseDepth = target.parentId ? (byId.get(target.parentId)?.depth ?? 0) + 1 : 0
    return collected.map((symbol) => ({ ...symbol, depth: symbol.depth - baseDepth }))
  }, [openSegmentId, symbols])

  const filteredDropdownItems = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return dropdownItems
    return dropdownItems.filter((symbol) =>
      symbol.name.toLowerCase().includes(kw) || symbol.detail.toLowerCase().includes(kw))
  }, [dropdownItems, keyword])

  useEffect(() => {
    setActiveIndex(() => {
      const index = filteredDropdownItems.findIndex((symbol) => symbol.id === openSegmentId)
      return index >= 0 ? index : 0
    })
  }, [filteredDropdownItems, openSegmentId])

  useEffect(() => {
    if (!openSegmentId) return
    setKeyword('')
    const rect = anchorRect
    if (rect) searchRef.current?.focus()
  }, [openSegmentId, anchorRect])

  useEffect(() => {
    if (!openSegmentId) return
    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('[data-symbol-dropdown="true"]') || target.closest('[data-symbol-breadcrumb="true"]')) return
      setOpenSegmentId(null)
      setAnchorRect(null)
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [openSegmentId])

  const handleJump = useCallback(async (symbol: FlatSymbol) => {
    setOpenSegmentId(null)
    setAnchorRect(null)
    await revealLocation({ filePath, line: symbol.line, column: 1 })
  }, [filePath])

  const handleDropdownKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((index) => Math.min(index + 1, filteredDropdownItems.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const symbol = filteredDropdownItems[activeIndex]
      if (symbol) void handleJump(symbol)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      setOpenSegmentId(null)
      setAnchorRect(null)
    }
  }, [filteredDropdownItems, activeIndex, handleJump])

  if (chain.length === 0) return null

  return (
    <div className="flex items-center flex-shrink-0 min-w-0 max-w-[50%] overflow-hidden">
      {chain.map((symbol, index) => {
        const Icon = getKindIcon(symbol.kind)
        const isLast = index === chain.length - 1
        return (
          <span key={symbol.id} className="flex items-center flex-shrink-0">
            {index > 0 && <ChevronRight className="w-3 h-3 opacity-25 mx-0.5 flex-shrink-0" />}
            <button
              data-symbol-breadcrumb="true"
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect()
                setAnchorRect({ left: rect.left, top: rect.bottom })
                setOpenSegmentId((prev) => (prev === symbol.id ? null : symbol.id))
              }}
              title={`${symbol.name}${symbol.detail ? ` · ${symbol.detail}` : ''}`}
              className={`flex items-center gap-1 px-1 rounded-sm max-w-[180px] truncate transition-colors ${isLast ? 'text-text-primary' : 'text-text-muted'} hover:bg-surface-hover hover:text-text-primary`}
            >
              <Icon className="w-3 h-3 flex-shrink-0 opacity-70" />
              <span className="truncate">{symbol.name}</span>
            </button>
          </span>
        )
      })}

      {openSegmentId && anchorRect && createPortal(
        <div
          data-symbol-dropdown="true"
          onKeyDown={handleDropdownKeyDown}
          className="fixed z-[9999] no-drag bg-surface border border-border-subtle rounded-lg shadow-2xl overflow-hidden flex flex-col"
          style={{
            left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 400)),
            top: Math.min(anchorRect.top + 2, window.innerHeight - 40),
            width: 380,
            maxHeight: 320,
          }}
        >
          {dropdownItems.length > 8 && (
            <div className="px-2 py-1.5 border-b border-border-subtle flex-shrink-0">
              <input
                ref={searchRef}
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={t('outline.filterPlaceholder', language)}
                className="w-full px-2 py-1 text-[11px] rounded-md bg-background border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60"
              />
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
            {filteredDropdownItems.length === 0 ? (
              <div className="px-3 py-5 text-center text-[11px] text-text-muted">{t('ctxNoResults', language)}</div>
            ) : filteredDropdownItems.map((symbol, index) => {
              const Icon = getKindIcon(symbol.kind)
              const isActive = index === activeIndex
              return (
                <div
                  key={`${symbol.id}-${index}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => void handleJump(symbol)}
                  className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer text-[11px] transition-colors ${isActive ? 'bg-accent/15' : 'hover:bg-surface-hover'}`}
                  style={{ paddingLeft: 8 + Math.max(0, symbol.depth) * 12 }}
                >
                  <Icon className="w-3 h-3 flex-shrink-0 opacity-70" />
                  <span className="text-text-primary truncate">{symbol.name}</span>
                  {symbol.detail && <span className="text-text-muted truncate">{symbol.detail}</span>}
                  <span className="ml-auto text-[10px] text-text-muted tabular-nums flex-shrink-0">{symbol.line}</span>
                </div>
              )
            })}
          </div>

          <div className="flex items-center gap-3 px-3 py-1 border-t border-border-subtle bg-surface-hover text-[10px] text-text-muted flex-shrink-0">
            <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3" />{t('selectItem', language)}</span>
            <span>↑↓ {t('navigate', language)}</span>
            <span>Esc {t('closeMenu', language)}</span>
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
