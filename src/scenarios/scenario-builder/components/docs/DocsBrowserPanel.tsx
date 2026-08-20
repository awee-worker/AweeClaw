/**
 * 文档浏览面板（DocsBrowserPanel）
 *
 * 场景开发助手的结构化文档浏览器，替代旧版 KnowledgePanel 的全文预渲染模式。
 *
 * 设计要点：
 * - 三视图切换：目录视图 / 搜索结果视图 / 内容视图
 *   * 目录视图：树状章节列表，章节可展开显示子章节
 *   * 搜索结果视图：搜索框有内容时显示，点击结果跳转到内容视图
 *   * 内容视图：Markdown 渲染选中章节，带返回按钮与上下章导航
 * - 单列布局，适合侧边栏宽度（minWidth 170，maxWidth 600）
 * - 字号均 ≥ 12px，遵循 UI 规范
 * - 代码块使用等宽字体（Menlo/Monaco/Consolas）
 * - 复用 config/docs-content.ts 中的结构化文档树与 searchDocs API
 */
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import type React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useI18n } from '@renderer/i18n'
import { getLucideIcon } from '@components/foundation/IconMap'
import {
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronRight as ChevronRightIcon,
  ArrowLeft,
  BookOpen,
  ListTree,
  ChevronsDown,
  ChevronsUp,
  FileText,
  X,
} from 'lucide-react'
import {
  getDocTree,
  searchDocs,
  type DocChapter,
  type DocSection,
  type DocSearchResult,
} from '../../config/docs-content'

// ==========================================
// 组件 Props
// ==========================================

interface DocsBrowserPanelProps {
  /** 初始展开的章节 ID 列表（默认全部折叠，仅展开第一章） */
  defaultExpandedChapterIds?: string[]
}

// ==========================================
// 视图模式
// ==========================================

type ViewMode = 'toc' | 'content' | 'search'

// ==========================================
// 主组件
// ==========================================

const DocsBrowserPanel: React.FC<DocsBrowserPanelProps> = ({
  defaultExpandedChapterIds,
}) => {
  const { t } = useI18n()

  // 文档树（懒加载，仅在首次使用时解析）
  const docTree = useMemo(() => getDocTree(), [])

  // 视图模式
  const [viewMode, setViewMode] = useState<ViewMode>('toc')

  // 搜索关键词
  const [searchQuery, setSearchQuery] = useState('')

  // 搜索结果（防抖后实际用于渲染的查询词）
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 展开的章节 ID 集合
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(() => {
    if (defaultExpandedChapterIds?.length) {
      return new Set(defaultExpandedChapterIds)
    }
    // 默认展开第一章，便于用户立即看到子章节结构
    const firstChapter = getDocTree().chapters[0]
    return firstChapter ? new Set([firstChapter.id]) : new Set()
  })

  // 当前选中的章节 / 子章节
  const [selectedChapterId, setSelectedChapterId] = useState<string>('')
  const [selectedSectionId, setSelectedSectionId] = useState<string>('')

  // 内容区滚动容器引用（切换章节时滚动到顶部）
  const contentScrollRef = useRef<HTMLDivElement>(null)

  // ==========================================
  // 搜索防抖（300ms）
  // ==========================================

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery.trim())
    }, 300)
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [searchQuery])

  // 搜索关键词变化时切换视图模式
  useEffect(() => {
    if (searchQuery.trim()) {
      setViewMode('search')
    } else if (viewMode === 'search') {
      setViewMode('toc')
    }
    // 仅依赖 searchQuery，避免 viewMode 变化触发循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery])

  // 搜索结果
  const searchResults = useMemo<DocSearchResult[]>(() => {
    if (!debouncedQuery) return []
    return searchDocs(debouncedQuery, 30)
  }, [debouncedQuery])

  // ==========================================
  // 目录视图操作
  // ==========================================

  /** 切换章节展开/折叠 */
  const toggleChapter = useCallback((chapterId: string) => {
    setExpandedChapters((prev) => {
      const next = new Set(prev)
      if (next.has(chapterId)) {
        next.delete(chapterId)
      } else {
        next.add(chapterId)
      }
      return next
    })
  }, [])

  /** 全部展开 */
  const expandAll = useCallback(() => {
    setExpandedChapters(new Set(docTree.chapters.map((c) => c.id)))
  }, [docTree])

  /** 全部折叠 */
  const collapseAll = useCallback(() => {
    setExpandedChapters(new Set())
  }, [])

  /** 点击章节标题：进入内容视图 */
  const handleChapterClick = useCallback((chapterId: string, sectionId?: string) => {
    const chapter = docTree.chapters.find((c) => c.id === chapterId)
    if (!chapter) return
    setSelectedChapterId(chapterId)
    // 若未指定 section，默认选中第一章首节
    const targetSectionId = sectionId ?? chapter.sections[0]?.id ?? ''
    setSelectedSectionId(targetSectionId)
    setViewMode('content')
    // 清空搜索，避免回到搜索视图
    setSearchQuery('')
  }, [docTree])

  // ==========================================
  // 内容视图操作
  // ==========================================

  const currentChapter = useMemo<DocChapter | null>(
    () => docTree.chapters.find((c) => c.id === selectedChapterId) ?? null,
    [docTree, selectedChapterId],
  )

  const currentSection = useMemo<DocSection | null>(() => {
    if (!currentChapter || !selectedSectionId) return null
    return currentChapter.sections.find((s) => s.id === selectedSectionId) ?? null
  }, [currentChapter, selectedSectionId])

  const currentChapterIdx = useMemo(
    () => docTree.chapters.findIndex((c) => c.id === selectedChapterId),
    [docTree, selectedChapterId],
  )
  const currentSectionIdx = useMemo(() => {
    if (!currentChapter || !selectedSectionId) return 0
    return currentChapter.sections.findIndex((s) => s.id === selectedSectionId)
  }, [currentChapter, selectedSectionId])

  // 切换章节时滚动到顶部
  useEffect(() => {
    if (viewMode === 'content' && contentScrollRef.current) {
      contentScrollRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [viewMode, selectedChapterId, selectedSectionId])

  /** 上一章 / 上一节 */
  const handlePrev = useCallback(() => {
    if (!currentChapter) return
    if (currentSectionIdx > 0) {
      setSelectedSectionId(currentChapter.sections[currentSectionIdx - 1].id)
    } else if (currentChapterIdx > 0) {
      const prevChapter = docTree.chapters[currentChapterIdx - 1]
      setSelectedChapterId(prevChapter.id)
      setSelectedSectionId(prevChapter.sections[prevChapter.sections.length - 1]?.id ?? '')
    }
  }, [currentChapter, currentSectionIdx, currentChapterIdx, docTree])

  /** 下一章 / 下一节 */
  const handleNext = useCallback(() => {
    if (!currentChapter) return
    if (currentSectionIdx < currentChapter.sections.length - 1) {
      setSelectedSectionId(currentChapter.sections[currentSectionIdx + 1].id)
    } else if (currentChapterIdx < docTree.chapters.length - 1) {
      const nextChapter = docTree.chapters[currentChapterIdx + 1]
      setSelectedChapterId(nextChapter.id)
      setSelectedSectionId(nextChapter.sections[0]?.id ?? '')
    }
  }, [currentChapter, currentSectionIdx, currentChapterIdx, docTree])

  const canPrev = currentChapterIdx > 0 || currentSectionIdx > 0
  const canNext = currentChapter
    ? currentSectionIdx < currentChapter.sections.length - 1 ||
      currentChapterIdx < docTree.chapters.length - 1
    : false

  /** 返回目录视图 */
  const handleBackToToc = useCallback(() => {
    setViewMode('toc')
    setSearchQuery('')
  }, [])

  /** 切换子章节 */
  const handleSectionChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedSectionId(e.target.value)
  }, [])

  /** 切换章节（下拉） */
  const handleChapterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newChapterId = e.target.value
    const chapter = docTree.chapters.find((c) => c.id === newChapterId)
    if (!chapter) return
    setSelectedChapterId(newChapterId)
    setSelectedSectionId(chapter.sections[0]?.id ?? '')
  }, [docTree])

  // ==========================================
  // 搜索结果点击
  // ==========================================

  const handleSearchResultClick = useCallback(
    (result: DocSearchResult) => {
      const chapter = docTree.chapters.find((c) => c.id === result.chapterId)
      if (!chapter) return
      setSelectedChapterId(result.chapterId)
      // 若未命中子章节，选中章节首节
      const targetSectionId = result.sectionId ?? chapter.sections[0]?.id ?? ''
      setSelectedSectionId(targetSectionId)
      setViewMode('content')
      setSearchQuery('')
    },
    [docTree],
  )

  /** 清空搜索 */
  const handleClearSearch = useCallback(() => {
    setSearchQuery('')
    setViewMode('toc')
  }, [])

  // ==========================================
  // 渲染
  // ==========================================

  const ChapterIcon = currentChapter ? getLucideIcon(currentChapter.icon) : BookOpen

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ========== 顶部标题栏 + 搜索框 ========== */}
      <div className="shrink-0 border-b border-border">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-1.5">
            <BookOpen className="h-3.5 w-3.5 text-accent" />
            <h2 className="text-[13px] font-medium">{t('builder.docs.title')}</h2>
          </div>
          {viewMode === 'content' && (
            <button
              onClick={handleBackToToc}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              aria-label={t('builder.docs.back')}
            >
              <ArrowLeft className="h-3 w-3" />
              <span>{t('builder.docs.toc')}</span>
            </button>
          )}
        </div>

        {/* 搜索框 */}
        <div className="px-2 pb-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('builder.docs.searchPlaceholder')}
              className="w-full rounded border border-border bg-background py-1.5 pl-7 pr-7 text-[12px] outline-none transition-colors placeholder:text-muted-foreground/70 focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label={t('builder.common.close')}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ========== 主区域 ========== */}
      <div className="flex-1 overflow-hidden">
        {/* ---------- 目录视图 ---------- */}
        {viewMode === 'toc' && (
          <div className="flex h-full flex-col">
            {/* 工具栏 */}
            <div className="flex items-center justify-between border-b border-border px-2 py-1">
              <div className="flex items-center gap-1 text-[12px] text-muted-foreground">
                <ListTree className="h-3 w-3" />
                <span>
                  {t('builder.docs.chapters')}: {docTree.chapters.length}
                </span>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={expandAll}
                  title={t('builder.docs.expandAll')}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronsDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={collapseAll}
                  title={t('builder.docs.collapseAll')}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronsUp className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* 章节列表 */}
            <div className="flex-1 overflow-y-auto py-1">
              {docTree.chapters.map((chapter) => {
                const isExpanded = expandedChapters.has(chapter.id)
                const ChapterListIcon = getLucideIcon(chapter.icon)
                return (
                  <div key={chapter.id} className="mb-0.5">
                    {/* 章节标题行 */}
                    <div className="group flex items-center">
                      <button
                        onClick={() => toggleChapter(chapter.id)}
                        className="flex h-6 w-5 shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
                        aria-label={isExpanded ? t('builder.docs.collapseAll') : t('builder.docs.expandAll')}
                      >
                        {isExpanded ? (
                          <ChevronDown className="h-3 w-3" />
                        ) : (
                          <ChevronRightIcon className="h-3 w-3" />
                        )}
                      </button>
                      <button
                        onClick={() => handleChapterClick(chapter.id)}
                        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 py-1 text-left text-[12px] transition-colors hover:bg-muted/60"
                      >
                        <ChapterListIcon className="h-3.5 w-3.5 shrink-0 text-accent/80" />
                        <span className="truncate font-medium text-foreground/90">
                          {chapter.title}
                        </span>
                      </button>
                    </div>

                    {/* 子章节列表 */}
                    {isExpanded && chapter.sections.length > 0 && (
                      <ul className="ml-5 border-l border-border/60 pl-1.5">
                        {chapter.sections.map((section) => (
                          <li key={section.id}>
                            <button
                              onClick={() => handleChapterClick(chapter.id, section.id)}
                              className="block w-full truncate rounded px-2 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                              title={section.title}
                            >
                              {section.title}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}

              {/* 空状态 */}
              {docTree.chapters.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <FileText className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-[12px] text-muted-foreground">{t('builder.docs.empty')}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------- 搜索结果视图 ---------- */}
        {viewMode === 'search' && (
          <div className="flex h-full flex-col">
            <div className="border-b border-border px-3 py-1.5">
              <span className="text-[12px] text-muted-foreground">
                {t('builder.docs.resultCount').replace('{count}', String(searchResults.length))}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {searchResults.length === 0 ? (
                <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                  <Search className="h-8 w-8 text-muted-foreground/40" />
                  <p className="text-[12px] text-muted-foreground">{t('builder.docs.noResults')}</p>
                  <p className="text-[12px] text-muted-foreground/70">「{debouncedQuery}」</p>
                </div>
              ) : (
                <ul className="py-1">
                  {searchResults.map((result, idx) => (
                    <li key={`${result.chapterId}-${result.sectionId ?? 'all'}-${idx}`}>
                      <button
                        onClick={() => handleSearchResultClick(result)}
                        className="block w-full border-l-2 border-transparent px-3 py-2 text-left transition-colors hover:border-accent hover:bg-muted/40"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[12px] font-medium text-foreground">
                            {result.chapterTitle}
                          </span>
                          {result.sectionTitle && (
                            <>
                              <span className="text-muted-foreground">/</span>
                              <span className="truncate text-[12px] text-muted-foreground">
                                {result.sectionTitle}
                              </span>
                            </>
                          )}
                        </div>
                        {result.snippet && (
                          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground/80">
                            {result.snippet}
                          </p>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* ---------- 内容视图 ---------- */}
        {viewMode === 'content' && currentChapter && currentSection && (
          <div className="flex h-full flex-col">
            {/* 章节导航条 */}
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-accent/10 text-accent">
                <ChapterIcon className="h-4 w-4" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <select
                  value={currentChapter.id}
                  onChange={handleChapterChange}
                  className="w-full max-w-full truncate rounded border border-border bg-background px-2 py-1 text-[12px] font-medium"
                >
                  {docTree.chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
                {currentChapter.sections.length > 1 && (
                  <select
                    value={currentSection.id}
                    onChange={handleSectionChange}
                    className="w-full max-w-full truncate rounded border border-border bg-background px-2 py-0.5 text-[12px]"
                  >
                    {currentChapter.sections.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* 内容主体（Markdown 渲染） */}
            <div ref={contentScrollRef} className="flex-1 overflow-y-auto px-4 py-3">
              <article className="docs-content max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    h1: ({ children }) => (
                      <h1 className="mt-3 mb-3 text-base font-bold text-foreground">{children}</h1>
                    ),
                    h2: ({ children }) => (
                      <h2 className="mt-4 mb-2 text-[15px] font-semibold text-foreground">{children}</h2>
                    ),
                    h3: ({ children }) => (
                      <h3 className="mt-3 mb-2 text-[14px] font-medium text-foreground">{children}</h3>
                    ),
                    h4: ({ children }) => (
                      <h4 className="mt-2 mb-1.5 text-[13px] font-medium text-foreground/90">{children}</h4>
                    ),
                    p: ({ children }) => (
                      <p className="my-2 text-[13px] leading-relaxed text-foreground/90">{children}</p>
                    ),
                    ul: ({ children }) => (
                      <ul className="my-2 ml-5 list-disc text-[13px] text-foreground/90">{children}</ul>
                    ),
                    ol: ({ children }) => (
                      <ol className="my-2 ml-5 list-decimal text-[13px] text-foreground/90">{children}</ol>
                    ),
                    li: ({ children }) => <li className="my-0.5 text-[13px]">{children}</li>,
                    code: ({ className, children }) => {
                      const isInline = !className
                      if (isInline) {
                        return (
                          <code className="rounded bg-muted px-1 py-0.5 text-[12px] font-mono text-accent">
                            {children}
                          </code>
                        )
                      }
                      return (
                        <code className={`block text-[13px] ${className ?? ''}`}>{children}</code>
                      )
                    },
                    pre: ({ children }) => (
                      <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-muted/40 p-3 text-[13px] font-mono leading-relaxed">
                        {children}
                      </pre>
                    ),
                    a: ({ href, children }) => (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        {children}
                      </a>
                    ),
                    blockquote: ({ children }) => (
                      <blockquote className="my-3 border-l-4 border-accent/40 pl-3 italic text-foreground/70">
                        {children}
                      </blockquote>
                    ),
                    table: ({ children }) => (
                      <div className="my-3 overflow-x-auto">
                        <table className="w-full border-collapse border border-border text-[12px]">
                          {children}
                        </table>
                      </div>
                    ),
                    th: ({ children }) => (
                      <th className="border border-border bg-muted/40 px-2 py-1 text-left text-[12px] font-medium">
                        {children}
                      </th>
                    ),
                    td: ({ children }) => (
                      <td className="border border-border px-2 py-1 text-[12px]">{children}</td>
                    ),
                    hr: () => <hr className="my-4 border-border" />,
                  }}
                >
                  {`## ${currentSection.title}\n\n${currentSection.content}`}
                </ReactMarkdown>
              </article>
            </div>

            {/* 底部导航 */}
            <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-2">
              <button
                onClick={handlePrev}
                disabled={!canPrev}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <ChevronLeft className="h-3 w-3" />
                {t('builder.docs.prev')}
              </button>
              <span className="text-[12px] text-muted-foreground">
                {currentChapterIdx + 1}
                {t('builder.docs.of')}
                {docTree.chapters.length}
              </span>
              <button
                onClick={handleNext}
                disabled={!canNext}
                className="flex items-center gap-1 rounded border border-border px-2 py-1 text-[12px] transition-colors hover:bg-muted disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {t('builder.docs.next')}
                <ChevronRight className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}

        {/* ---------- 内容视图无数据兜底 ---------- */}
        {viewMode === 'content' && (!currentChapter || !currentSection) && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <FileText className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-[12px] text-muted-foreground">{t('builder.docs.empty')}</p>
            <button
              onClick={handleBackToToc}
              className="mt-2 rounded border border-border px-3 py-1 text-[12px] hover:bg-muted"
            >
              {t('builder.docs.back')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default DocsBrowserPanel
