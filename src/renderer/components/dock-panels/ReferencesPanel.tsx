/**
 * 引用结果面板（Dock Tab: references）
 *
 * 展示「查找引用」的全部结果：
 *  - 按文件分组、可折叠
 *  - 每行显示行号 + 原文预览（命中区间高亮）
 *  - 点击 / 回车跳转到对应位置（写入导航历史，支持随后 Alt+← 返回）
 *  - 支持按文件名或代码内容过滤
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode, TextSearch, CornerDownLeft, RefreshCw } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { useReferencesStore, type ReferenceItem } from '@services/referencesRepository'
import { revealLocation } from '@services/editorNavigation'

/** 单次最多渲染的引用行数（超大结果集保护） */
const MAX_RENDERED_REFERENCES = 600

interface FileGroup {
  filePath: string
  fileName: string
  dirPath: string
  items: ReferenceItem[]
}

/** 相对工作区展示路径（不在工作区内时回退为原路径） */
function toDisplayDir(dirPath: string, workspacePath: string | null): string {
  if (!dirPath) return ''
  if (!workspacePath) return dirPath
  const normalizedDir = dirPath.replace(/\\/g, '/').replace(/\/+$/, '')
  const normalizedWs = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '')
  if (!normalizedWs) return dirPath
  if (normalizedDir === normalizedWs) return '.'
  if (normalizedDir.startsWith(`${normalizedWs}/`)) {
    return normalizedDir.slice(normalizedWs.length + 1) || '.'
  }
  return dirPath
}

/** 预览文本中的命中区间（转成 0-based 偏移，供高亮切片） */
function getMatchRange(item: ReferenceItem, preview: string): [number, number] | null {
  const start = item.column - 1
  const end = item.endColumn - 1
  if (start < 0 || end <= start) return null
  if (start >= preview.length) return null
  return [start, Math.min(end, preview.length)]
}

const ReferencesPanel: React.FC = () => {
  const items = useReferencesStore((s) => s.items)
  const loading = useReferencesStore((s) => s.loading)
  const error = useReferencesStore((s) => s.error)
  const symbol = useReferencesStore((s) => s.symbol)
  const query = useReferencesStore((s) => s.query)
  const refresh = useReferencesStore((s) => s.refresh)

  const language = useStore((s) => s.language) as Language
  const workspacePath = useStore((s) => s.workspacePath)
  const setCursorPosition = useStore((s) => s.setCursorPosition)

  const [keyword, setKeyword] = useState('')
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())
  const [focusIndex, setFocusIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const isZh = language === 'zh'

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return items
    return items.filter((item) =>
      item.fileName.toLowerCase().includes(kw)
      || item.filePath.toLowerCase().includes(kw)
      || (item.preview ?? '').toLowerCase().includes(kw))
  }, [items, keyword])

  const groups = useMemo<FileGroup[]>(() => {
    const map = new Map<string, FileGroup>()
    filtered.forEach((item) => {
      const group = map.get(item.filePath)
      if (group) group.items.push(item)
      else map.set(item.filePath, {
        filePath: item.filePath,
        fileName: item.fileName,
        dirPath: item.dirPath,
        items: [item],
      })
    })
    return Array.from(map.values()).sort((a, b) => b.items.length - a.items.length)
  }, [filtered])

  /** 键盘导航用的扁平可见列表 */
  const visibleItems = useMemo(
    () => groups.filter((g) => !collapsedFiles.has(g.filePath)).flatMap((g) => g.items),
    [groups, collapsedFiles],
  )

  /** id → 扁平下标（键盘高亮定位用，避免每行都做一次 findIndex） */
  const indexById = useMemo(() => new Map(visibleItems.map((item, index) => [item.id, index])), [visibleItems])

  /** 超大结果集下限制单次渲染行数，避免一次性挂载过多 DOM */
  const renderedIds = useMemo(
    () => new Set(visibleItems.slice(0, MAX_RENDERED_REFERENCES).map((item) => item.id)),
    [visibleItems],
  )

  useEffect(() => {
    setFocusIndex(0)
  }, [query])

  useEffect(() => {
    setFocusIndex((index) => Math.min(index, Math.max(visibleItems.length - 1, 0)))
  }, [visibleItems.length])

  const handleJump = useCallback(async (item: ReferenceItem) => {
    // 同步 store 光标，保证随后 Alt+← 能回到跳转前的位置
    useStore.getState().setCursorPosition({ line: item.line, column: item.column })
    await revealLocation({ filePath: item.filePath, line: item.line, column: item.column })
    setCursorPosition({ line: item.line, column: item.column })
  }, [setCursorPosition])

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setFocusIndex((index) => Math.min(index + 1, visibleItems.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setFocusIndex((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = visibleItems[focusIndex]
      if (item) void handleJump(item)
    }
  }, [visibleItems, focusIndex, handleJump])

  const toggleFile = useCallback((filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }, [])

  if (!query && !loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-text-muted px-6 py-8">
        <div className="w-12 h-12 rounded-2xl bg-accent/10 border border-accent/20 flex items-center justify-center mb-3">
          <TextSearch className="w-6 h-6 text-accent" strokeWidth={1.5} />
        </div>
        <p className="text-sm font-medium text-text-primary">{t('references.emptyTitle', language)}</p>
        <p className="text-xs text-text-muted mt-1 text-center leading-relaxed">
          {t('references.emptyHint', language)}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 头部：符号名 / 结果数 / 过滤 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 flex-shrink-0">
        <TextSearch className="w-3.5 h-3.5 text-accent flex-shrink-0" />
        <span className="text-xs text-text-primary truncate max-w-[240px]" title={symbol}>
          {symbol || t('references.title', language)}
        </span>
        <span className="text-[11px] text-text-muted flex-shrink-0">
          {loading ? t('references.loading', language) : t('references.count', language, { count: filtered.length })}
        </span>
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder={t('references.filterPlaceholder', language)}
          className="ml-auto w-[180px] px-2 py-1 text-[11px] rounded-md bg-surface border border-border-subtle text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent/60"
        />
        <button
          onClick={() => void refresh()}
          disabled={!query}
          className="flex items-center justify-center w-6 h-6 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-40"
          title={t('references.refresh', language)}
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* 结果列表 */}
      <div
        ref={listRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="flex-1 min-h-0 overflow-y-auto focus:outline-none scrollbar-thin"
      >
        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center py-10 text-xs text-text-muted">
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mr-2" />
            {t('references.loading', language)}
          </div>
        ) : error ? (
          <div className="px-4 py-6 text-xs text-status-error text-center">{error}</div>
        ) : groups.length === 0 ? (
          <div className="px-4 py-8 text-xs text-text-muted text-center">
            {items.length === 0 ? t('references.none', language) : t('ctxNoResults', language)}
          </div>
        ) : (
          groups.map((group) => {
            const collapsed = collapsedFiles.has(group.filePath)
            const displayDir = toDisplayDir(group.dirPath, workspacePath)
            return (
              <div key={group.filePath}>
                <button
                  onClick={() => toggleFile(group.filePath)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 text-left text-xs text-text-secondary hover:bg-surface-hover transition-colors sticky top-0 bg-background/95 backdrop-blur-sm"
                  title={group.filePath}
                >
                  {collapsed ? <ChevronRight className="w-3 h-3 flex-shrink-0" /> : <ChevronDown className="w-3 h-3 flex-shrink-0" />}
                  <FileCode className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                  <span className="text-text-primary truncate">{group.fileName}</span>
                  <span className="text-[10px] text-text-muted truncate">{displayDir}</span>
                  <span className="ml-auto text-[10px] text-text-muted flex-shrink-0">{group.items.length}</span>
                </button>

                {!collapsed && group.items.filter((item) => renderedIds.has(item.id)).map((item) => {
                  const index = indexById.get(item.id) ?? -1
                  const isFocused = index === focusIndex
                  const preview = item.preview ?? ''
                  const match = getMatchRange(item, preview)
                  return (
                    <div
                      key={item.id}
                      onClick={() => { setFocusIndex(index); void handleJump(item) }}
                      className={`group flex items-start gap-2 pl-6 pr-2 py-1 cursor-pointer text-[11px] font-mono transition-colors ${isFocused ? 'bg-accent/15' : 'hover:bg-surface-hover'}`}
                    >
                      <span className="w-[38px] text-right text-text-muted flex-shrink-0 tabular-nums">{item.line}</span>
                      <span className="flex-1 min-w-0 truncate whitespace-pre text-text-secondary">
                        {match ? (
                          <>
                            {preview.slice(0, match[0])}
                            <span className="text-accent font-semibold bg-accent/15 rounded-sm">{preview.slice(match[0], match[1])}</span>
                            {preview.slice(match[1])}
                          </>
                        ) : (preview || t('references.previewUnavailable', language))}
                      </span>
                    </div>
                  )
                })}
              </div>
            )
          })
        )}
      </div>

      {/* 底部提示 */}
      <div className="flex items-center gap-3 px-3 py-1 border-t border-border/40 text-[10px] text-text-muted flex-shrink-0">
        <span className="flex items-center gap-1"><CornerDownLeft className="w-3 h-3" />{isZh ? '跳转' : 'Jump'}</span>
        <span>↑↓ {isZh ? '选择' : 'Select'}</span>
        {visibleItems.length > MAX_RENDERED_REFERENCES && (
          <span className="text-status-warning">{t('references.truncated', language, { max: MAX_RENDERED_REFERENCES })}</span>
        )}
        <span className="ml-auto truncate">{t('references.jumpHint', language)}</span>
      </div>
    </div>
  )
}

export default ReferencesPanel
