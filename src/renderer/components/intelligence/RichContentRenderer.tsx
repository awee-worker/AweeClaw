/**
 * 富内容渲染器
 *
 * 设计理念：
 * - 组件拆分：每种内容类型独立组件，便于维护
 * - 统一复制：useCopy hook 统一处理复制逻辑
 * - 可访问性：ARIA 标签、键盘操作
 * - 性能优化：memo 组件、useCallback
 * - 类型安全：完整 TypeScript 类型
 */

import { useState, useMemo, memo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Image as ImageIcon,
  Code,
  FileText,
  Link as LinkIcon,
  Table,
  Copy,
  Check,
  ExternalLink,
  Maximize2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ToolRichContent } from '@intelligence/providerTypes'
import { JsonHighlight } from '@utils/jsonHighlight'
import { getFileName } from '@shared/toolkit/pathHelper'
import { SafeMarkdownHTML, SafeHTML } from '@components/foundation/SanitizedHTML'
import { useStore } from '@store'
import { themeManager } from '../../config/themeDefinition'
import { t, type Language } from '@renderer/i18n'
import { openUrlInBrowser } from '@utils/browserLauncher'

/** 复制成功状态保持时间（毫秒） */
const COPY_RESET_DELAY = 2000

interface RichContentRendererProps {
  content: ToolRichContent[]
  maxHeight?: string
  className?: string
}

export const RichContentRenderer = memo(function RichContentRenderer({
  content,
  maxHeight = 'max-h-96',
  className = '',
}: RichContentRendererProps) {
  if (!content || content.length === 0) return null

  return (
    <div className={`space-y-3 ${className}`}>
      {content.map((item, index) => (
        <RichContentItem
          key={`${item.type}-${index}`}
          item={item}
          maxHeight={maxHeight}
        />
      ))}
    </div>
  )
})

const RichContentItem = memo(function RichContentItem({
  item,
  maxHeight,
}: {
  item: ToolRichContent
  maxHeight: string
}) {
  switch (item.type) {
    case 'image':
      return <ImageContent item={item} />
    case 'code':
      return <CodeContent item={item} maxHeight={maxHeight} />
    case 'json':
      return <JsonContent item={item} maxHeight={maxHeight} />
    case 'markdown':
      return <MarkdownContent item={item} maxHeight={maxHeight} />
    case 'html':
      return <HtmlContent item={item} maxHeight={maxHeight} />
    case 'file':
      return <FileContent item={item} />
    case 'link':
      return <LinkContent item={item} />
    case 'table':
      return <TableContent item={item} maxHeight={maxHeight} />
    case 'text':
    default:
      return <TextContent item={item} maxHeight={maxHeight} />
  }
})

// =================== Hook：复制功能 ===================

/**
 * 统一复制 hook
 *
 * @returns { copied, copy }
 */
function useCopy() {
  const [copied, setCopied] = useState(false)

  const copy = useCallback((text: string) => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), COPY_RESET_DELAY)
  }, [])

  return { copied, copy }
}

// =================== 通用容器 ===================

interface ContentCardProps {
  title: string
  icon: LucideIcon
  actions?: React.ReactNode
  children: React.ReactNode
  noPadding?: boolean
}

const ContentCard = memo(function ContentCard({
  title,
  icon: Icon,
  actions,
  children,
  noPadding = false,
}: ContentCardProps) {
  return (
    <div className="mt-2 text-[12px]">
      <div className="flex items-center justify-between gap-1.5 text-text-muted mb-1 group/title">
        <div className="flex items-center gap-1.5">
          <Icon className="w-3 h-3" aria-hidden />
          <span>{title}</span>
        </div>
        {actions && (
          <div className="flex items-center gap-1 opacity-0 group-hover/title:opacity-100 transition-opacity">
            {actions}
          </div>
        )}
      </div>
      <div className={`pl-2 ml-1 ${noPadding ? '' : 'py-1'}`}>{children}</div>
    </div>
  )
})

// =================== 复制按钮 ===================

interface CopyButtonProps {
  text: string
}

const CopyButton = memo(function CopyButton({ text }: CopyButtonProps) {
  const { copied, copy } = useCopy()

  return (
    <button
      onClick={() => copy(text)}
      className="p-0.5 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary transition-colors"
      aria-label={copied ? '已复制' : '复制'}
    >
      {copied ? (
        <Check className="w-3 h-3 text-emerald-400" />
      ) : (
        <Copy className="w-3 h-3" />
      )}
    </button>
  )
})

// =================== 图片内容 ===================

function ImageContent({ item }: { item: ToolRichContent }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const { copied, copy } = useCopy()
  const language = useStore((s) => s.language) as Language

  const imageSrc = useMemo(() => {
    if (!item.data) return null
    return item.data.startsWith('data:')
      ? item.data
      : `data:${item.mimeType || 'image/png'};base64,${item.data}`
  }, [item.data, item.mimeType])

  if (!imageSrc) return null

  const modal = isExpanded
    ? createPortal(
        <AnimatePresence>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/95 backdrop-blur-lg p-8"
            onClick={() => setIsExpanded(false)}
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
            role="dialog"
            aria-modal="true"
            aria-label={item.title || '图片预览'}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={imageSrc}
                alt={item.title || 'Image'}
                className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl"
              />
            </motion.div>
            <button
              onClick={() => setIsExpanded(false)}
              className="absolute top-6 right-6 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-all z-[100000]"
              aria-label="关闭预览"
            >
              <X className="w-5 h-5" />
            </button>
          </motion.div>
        </AnimatePresence>,
        document.body,
      )
    : null

  return (
    <>
      <ContentCard
        title={item.title || t('rich.imagePreview', language)}
        icon={ImageIcon}
        noPadding
        actions={
          <>
            <button
              onClick={() => copy(imageSrc)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted transition-colors"
              aria-label={copied ? '已复制' : '复制图片地址'}
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              onClick={() => setIsExpanded(true)}
              className="p-1.5 rounded-lg hover:bg-white/10 text-text-muted transition-colors"
              aria-label="放大查看"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </>
        }
      >
        <div className="flex flex-col group relative mt-1">
          <img
            src={imageSrc}
            alt={item.title || 'Image'}
            className="max-w-full max-h-64 object-contain cursor-zoom-in rounded"
            onClick={() => setIsExpanded(true)}
          />
        </div>
      </ContentCard>
      {modal}
    </>
  )
}

// =================== 代码内容 ===================

function CodeContent({
  item,
  maxHeight,
}: {
  item: ToolRichContent
  maxHeight: string
}) {
  const language = useStore((s) => s.language) as Language

  return (
    <ContentCard
      title={item.language || t('rich.sourceCode', language)}
      icon={Code}
      noPadding
      actions={<CopyButton text={item.text || ''} />}
    >
      <pre
        className={`overflow-auto ${maxHeight} text-[12px] font-mono text-text-secondary custom-scrollbar`}
      >
        <code>{item.text}</code>
      </pre>
    </ContentCard>
  )
}

// =================== 表格内容 ===================

function TableContent({
  item,
  maxHeight,
}: {
  item: ToolRichContent
  maxHeight: string
}) {
  if (!item.tableData) return null
  const { headers, rows } = item.tableData

  return (
    <ContentCard
      title={`Data Table (${rows.length})`}
      icon={Table}
      noPadding
    >
      <div className={`overflow-auto ${maxHeight} custom-scrollbar rounded`}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-surface/50 sticky top-0 z-10">
              {headers.map((h, i) => (
                <th
                  key={h || `header-${i}`}
                  className="px-3 py-2 text-left font-bold text-text-primary border-b border-border/50 uppercase tracking-tighter"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-surface/30 transition-colors group">
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className="px-3 py-2 text-text-secondary border-b border-border/20 group-last:border-0"
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ContentCard>
  )
}

// =================== 文件内容 ===================

function FileContent({ item }: { item: ToolRichContent }) {
  const fileName = item.title || (item.uri ? getFileName(item.uri) : 'File')

  return (
    <div className="flex items-center gap-1.5 text-[12px] group mt-1">
      <FileText className="w-3 h-3 text-text-muted" aria-hidden />
      <span
        className="font-medium text-text-primary transition-colors cursor-pointer hover:underline"
        title={item.uri}
      >
        {fileName}
      </span>
      <ExternalLink className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer hover:text-accent" />
    </div>
  )
}

// =================== 链接内容 ===================

function LinkContent({ item }: { item: ToolRichContent }) {
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      if (item.url) openUrlInBrowser(item.url)
    },
    [item.url],
  )

  return (
    <a
      href={item.url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-1.5 text-[12px] group mt-1"
      onClick={handleClick}
    >
      <LinkIcon className="w-3 h-3 text-text-muted" aria-hidden />
      <span className="font-medium text-text-primary hover:text-accent truncate transition-colors cursor-pointer hover:underline">
        {item.title || item.url}
      </span>
      <ExternalLink className="w-3 h-3 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
    </a>
  )
}

// =================== JSON 内容 ===================

function JsonContent({
  item,
  maxHeight,
}: {
  item: ToolRichContent
  maxHeight: string
}) {
  const language = useStore((s) => s.language) as Language

  return (
    <ContentCard
      title={t('rich.jsonData', language)}
      icon={Code}
      noPadding
      actions={<CopyButton text={item.text || ''} />}
    >
      <div
        className={`font-mono text-[12px] ${maxHeight} overflow-auto custom-scrollbar`}
      >
        <JsonHighlight data={item.text} maxHeight="none" />
      </div>
    </ContentCard>
  )
}

// =================== Markdown 内容 ===================

function MarkdownContent({
  item,
  maxHeight,
}: {
  item: ToolRichContent
  maxHeight: string
}) {
  const currentTheme = useStore((s) => s.currentTheme)
  const language = useStore((s) => s.language) as Language
  const theme = themeManager.getThemeById(currentTheme)
  const isLight = theme?.type === 'light'

  return (
    <ContentCard
      title={t('rich.markdown', language)}
      icon={FileText}
      noPadding
      actions={<CopyButton text={item.text || ''} />}
    >
      <div
        className={`${maxHeight} overflow-auto custom-scrollbar prose prose-sm max-w-none text-[12px] ${
          isLight ? '' : 'prose-invert'
        }`}
      >
        <SafeMarkdownHTML html={item.text} />
      </div>
    </ContentCard>
  )
}

// =================== HTML 内容 ===================

function HtmlContent({
  item,
  maxHeight,
}: {
  item: ToolRichContent
  maxHeight: string
}) {
  const language = useStore((s) => s.language) as Language

  return (
    <ContentCard
      title={t('rich.htmlPreview', language)}
      icon={Code}
      noPadding
      actions={<CopyButton text={item.text || ''} />}
    >
      <SafeHTML
        html={item.text}
        className={`p-4 bg-white/5 ${maxHeight} overflow-auto custom-scrollbar`}
      />
    </ContentCard>
  )
}

// =================== 文本内容 ===================

function TextContent({
  item,
  maxHeight,
}: {
  item: ToolRichContent
  maxHeight: string
}) {
  return (
    <div
      className={`p-4 bg-surface/10 rounded-2xl text-sm text-text-secondary leading-relaxed ${maxHeight} overflow-auto custom-scrollbar`}
    >
      {item.text}
    </div>
  )
}

export default RichContentRenderer
