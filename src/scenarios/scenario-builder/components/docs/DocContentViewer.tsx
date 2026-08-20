/**
 * 文档内容查看器
 *
 * 全屏弹窗展示选中章节的 Markdown 内容：
 * - 标题栏：章节标题 + 子章节下拉选择 + 关闭按钮
 * - 主体：Markdown 渲染（react-markdown + remark-gfm）
 * - 底部：上一章 / 下一章按钮（章节间导航）
 *
 * 设计要点：
 * - 全屏弹窗，最大化阅读体验
 * - Markdown 渲染样式适配深浅色主题
 * - 代码块使用等宽字体（Menlo/Monaco/Consolas）
 * - 字号均 ≥ 13px，遵循 UI 规范
 */
import { useState, useMemo, useCallback, useEffect } from 'react'
import type React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useI18n } from '@renderer/i18n'
import { getLucideIcon } from '@components/foundation/IconMap'
import { X, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react'
import type { DocChapter } from '../../config/docs-content'

interface DocContentViewerProps {
  /** 初始章节 ID */
  chapterId: string
  /** 初始子章节 ID（可选） */
  sectionId?: string
  /** 所有章节（用于上下导航） */
  chapters: DocChapter[]
  onClose: () => void
}

const DocContentViewer: React.FC<DocContentViewerProps> = ({
  chapterId,
  sectionId,
  chapters,
  onClose,
}) => {
  const { t } = useI18n()
  const [currentChapterIdx, setCurrentChapterIdx] = useState(() => {
    const idx = chapters.findIndex((c) => c.id === chapterId)
    return idx >= 0 ? idx : 0
  })
  const [currentSectionIdx, setCurrentSectionIdx] = useState(() => {
    if (!sectionId) return 0
    const chapter = chapters.find((c) => c.id === chapterId)
    if (!chapter) return 0
    const sIdx = chapter.sections.findIndex((s) => s.id === sectionId)
    return sIdx >= 0 ? sIdx : 0
  })

  const currentChapter = chapters[currentChapterIdx]
  const currentSection = currentChapter?.sections[currentSectionIdx]

  // 切换章节时重置 section 索引
  useEffect(() => {
    if (currentSectionIdx >= (currentChapter?.sections.length ?? 0)) {
      setCurrentSectionIdx(0)
    }
  }, [currentChapter, currentSectionIdx])

  // 渲染的 Markdown 内容
  const markdownContent = useMemo(() => {
    if (!currentSection) return ''
    // 在内容前加上章节标题，便于阅读
    return `## ${currentSection.title}\n\n${currentSection.content}`
  }, [currentSection])

  // 上一章
  const handlePrev = useCallback(() => {
    if (currentSectionIdx > 0) {
      setCurrentSectionIdx(currentSectionIdx - 1)
    } else if (currentChapterIdx > 0) {
      setCurrentChapterIdx(currentChapterIdx - 1)
      const prevChapter = chapters[currentChapterIdx - 1]
      setCurrentSectionIdx(Math.max(0, prevChapter.sections.length - 1))
    }
  }, [currentChapterIdx, currentSectionIdx, chapters])

  // 下一章
  const handleNext = useCallback(() => {
    if (currentChapter && currentSectionIdx < currentChapter.sections.length - 1) {
      setCurrentSectionIdx(currentSectionIdx + 1)
    } else if (currentChapterIdx < chapters.length - 1) {
      setCurrentChapterIdx(currentChapterIdx + 1)
      setCurrentSectionIdx(0)
    }
  }, [currentChapter, currentChapterIdx, currentSectionIdx, chapters])

  // 是否可上下导航
  const canPrev = currentSectionIdx > 0 || currentChapterIdx > 0
  const canNext = currentChapter
    ? currentSectionIdx < currentChapter.sections.length - 1 || currentChapterIdx < chapters.length - 1
    : false

  const ChapterIcon = currentChapter ? getLucideIcon(currentChapter.icon) : BookOpen

  // 切换章节下拉
  const handleChapterChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const newIdx = Number(e.target.value)
    setCurrentChapterIdx(newIdx)
    setCurrentSectionIdx(0)
  }, [])

  // 切换子章节下拉
  const handleSectionChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    setCurrentSectionIdx(Number(e.target.value))
  }, [])

  if (!currentChapter || !currentSection) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-text-inverted/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-4xl flex-col rounded-2xl border border-border/50 bg-background shadow-2xl shadow-black/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
              <ChapterIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <select
                  value={currentChapterIdx}
                  onChange={handleChapterChange}
                  className="max-w-full truncate rounded border border-border bg-background px-2 py-1 text-sm font-medium"
                >
                  {chapters.map((c, idx) => (
                    <option key={c.id} value={idx}>
                      {c.title}
                    </option>
                  ))}
                </select>
                <span className="text-muted-foreground">/</span>
                <select
                  value={currentSectionIdx}
                  onChange={handleSectionChange}
                  className="max-w-full truncate rounded border border-border bg-background px-2 py-1 text-sm"
                >
                  {currentChapter.sections.map((s, idx) => (
                    <option key={s.id} value={idx}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {currentChapter.summary}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('builder.common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <article className="docs-content prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <h1 className="mt-4 mb-3 text-xl font-bold text-foreground">{children}</h1>
                ),
                h2: ({ children }) => (
                  <h2 className="mt-4 mb-2 text-lg font-semibold text-foreground">{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 className="mt-3 mb-2 text-base font-medium text-foreground">{children}</h3>
                ),
                p: ({ children }) => (
                  <p className="my-2 text-sm leading-relaxed text-foreground/90">{children}</p>
                ),
                ul: ({ children }) => (
                  <ul className="my-2 ml-5 list-disc text-sm text-foreground/90">{children}</ul>
                ),
                ol: ({ children }) => (
                  <ol className="my-2 ml-5 list-decimal text-sm text-foreground/90">{children}</ol>
                ),
                li: ({ children }) => <li className="my-0.5 text-sm">{children}</li>,
                code: ({ className, children }) => {
                  const isInline = !className
                  if (isInline) {
                    return (
                      <code className="rounded bg-muted px-1 py-0.5 text-[13px] font-mono text-accent">
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
                  <table className="my-3 w-full border-collapse border border-border text-sm">
                    {children}
                  </table>
                ),
                th: ({ children }) => (
                  <th className="border border-border bg-muted/40 px-2 py-1 text-left font-medium">
                    {children}
                  </th>
                ),
                td: ({ children }) => (
                  <td className="border border-border px-2 py-1">{children}</td>
                ),
              }}
            >
              {markdownContent}
            </ReactMarkdown>
          </article>
        </div>

        {/* 底部导航 */}
        <div className="flex items-center justify-between border-t border-border p-4">
          <button
            onClick={handlePrev}
            disabled={!canPrev}
            className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            {t('builder.docs.prev')}
          </button>
          <span className="text-xs text-muted-foreground">
            {currentChapterIdx + 1} / {chapters.length}
          </span>
          <button
            onClick={handleNext}
            disabled={!canNext}
            className="flex items-center gap-1 rounded border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-40"
          >
            {t('builder.docs.next')}
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  )
}

export default DocContentViewer
