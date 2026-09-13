/**
 * ProjectFilePreview — 项目文件独立预览面板
 *
 * 设计目标：
 *  - 在项目详情界面内独立预览文件，不抢占工作区编辑器
 *  - 按文件类型分发到合适的预览组件（Markdown / 图片 / HTML / 代码 / PDF / Word / PPT / Excel / CSV）
 *  - 头部提供「在工作区编辑器中打开」「最大化/还原」「关闭」操作
 *  - 底部展示文件元信息（大小、类型、修改时间）
 *  - 加载 / 错误状态友好，支持重试
 *
 * 复用既有预览组件，保持视觉与交互一致。
 */
import { useState, useCallback, useMemo, useEffect, useRef, Suspense } from 'react'
import {
  Loader2, X, Maximize2, Minimize2, ExternalLink, RefreshCw,
  FileText, Image as ImageIcon, FileQuestion, AlertTriangle, FileType2,
  FileSpreadsheet, Presentation, Video, Box,
} from 'lucide-react'
import { useStore } from '@store'
import { api } from '@renderer/adapters/electronBridge'
import type { FileItem } from '@shared/protocols'
import {
  getFileType,
  MarkdownPreview,
  ImagePreview,
  HtmlPreview,
  UnsupportedFile,
  type FileType,
} from '@renderer/components/workspace-editor/FilePreviewPanel'
import { CodeHighlight } from '@renderer/components/intelligence/CodeHighlight'
import { ActionButton } from '@renderer/components/ui'
import { themeManager } from '@renderer/config/themeDefinition'
import { safeLazy, safeNamedLazy } from '@renderer/utils/safeImport'

// ─── 文档预览组件懒加载 ───────────────────────────────────
// PDF / Word / PPT / Excel 依赖 pdfjs-dist / mammoth / exceljs / xlsx / jszip 等重型库，
// 按需加载，避免首屏体积膨胀。与工作区 WorkspaceEditor 保持一致。
const PdfPreview = safeNamedLazy(
  () => import('@renderer/components/workspace-editor/DocumentPreview'),
  'PdfPreview', { label: 'PdfPreview', silent: true },
)
const DocxPreview = safeNamedLazy(
  () => import('@renderer/components/workspace-editor/DocumentPreview'),
  'DocxPreview', { label: 'DocxPreview', silent: true },
)
const DocPreview = safeNamedLazy(
  () => import('@renderer/components/workspace-editor/DocumentPreview'),
  'DocPreview', { label: 'DocPreview', silent: true },
)
const PptPreview = safeNamedLazy(
  () => import('@renderer/components/workspace-editor/DocumentPreview'),
  'PptPreview', { label: 'PptPreview', silent: true },
)
const XlsxEditor = safeNamedLazy(
  () => import('@renderer/components/workspace-editor/DocumentPreview'),
  'XlsxEditor', { label: 'XlsxEditor', silent: true },
)
const CsvPreview = safeNamedLazy(
  () => import('@renderer/components/workspace-editor/DocumentPreview'),
  'CsvPreview', { label: 'CsvPreview', silent: true },
)
// pptx 使用工作区同款富预览组件（默认导出）
const WorkspacePptxPreview = safeLazy(
  () => import('@renderer/components/ppt-preview/WorkspacePptxPreview'),
  { label: 'WorkspacePptxPreview', silent: true },
)

/** 懒加载占位 */
function PreviewLoading() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <Loader2 className="w-5 h-5 text-accent animate-spin" />
    </div>
  )
}

// ─── 类型映射：扩展名 → 代码语言 ───────────────────────────
const EXT_LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  vue: 'vue', py: 'python', go: 'go', rs: 'rust', java: 'java',
  c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
  rb: 'ruby', php: 'php', swift: 'swift', kt: 'kotlin',
  sh: 'bash', bash: 'bash', zsh: 'bash', yml: 'yaml', yaml: 'yaml',
  json: 'json', xml: 'xml', html: 'html', css: 'css', scss: 'scss',
  sql: 'sql', toml: 'toml', ini: 'ini', dockerfile: 'dockerfile',
  makefile: 'makefile', gradle: 'gradle', lua: 'lua', r: 'r',
}

function detectLanguage(filePath: string): string {
  const fileName = filePath.split('/').pop()?.toLowerCase() || ''
  // 优先匹配特殊文件名
  if (fileName === 'dockerfile') return 'dockerfile'
  if (fileName === 'makefile') return 'makefile'
  const ext = fileName.split('.').pop() || ''
  return EXT_LANGUAGE_MAP[ext] || 'text'
}

// ─── 文件类型徽标 ─────────────────────────────────────────
function FileTypeBadge({ fileType }: { fileType: FileType }) {
  const config: Record<FileType, { label: string; icon: React.ReactNode; cls: string }> = {
    markdown: { label: 'Markdown', icon: <FileText className="w-3 h-3" />, cls: 'text-blue-400' },
    image: { label: 'Image', icon: <ImageIcon className="w-3 h-3" />, cls: 'text-green-400' },
    video: { label: 'Video', icon: <Video className="w-3 h-3" />, cls: 'text-purple-400' },
    html: { label: 'HTML', icon: <FileType2 className="w-3 h-3" />, cls: 'text-orange-400' },
    text: { label: 'Text', icon: <FileText className="w-3 h-3" />, cls: 'text-text-muted' },
    pdf: { label: 'PDF', icon: <FileText className="w-3 h-3" />, cls: 'text-red-400' },
    docx: { label: 'DOCX', icon: <FileType2 className="w-3 h-3" />, cls: 'text-blue-500' },
    doc: { label: 'DOC', icon: <FileType2 className="w-3 h-3" />, cls: 'text-blue-500' },
    pptx: { label: 'PPTX', icon: <Presentation className="w-3 h-3" />, cls: 'text-orange-500' },
    ppt: { label: 'PPT', icon: <Presentation className="w-3 h-3" />, cls: 'text-orange-500' },
    xlsx: { label: 'XLSX', icon: <FileSpreadsheet className="w-3 h-3" />, cls: 'text-green-500' },
    csv: { label: 'CSV', icon: <FileSpreadsheet className="w-3 h-3" />, cls: 'text-green-500' },
    model3d: { label: '3D', icon: <Box className="w-3 h-3" />, cls: 'text-cyan-400' },
    binary: { label: 'Binary', icon: <FileQuestion className="w-3 h-3" />, cls: 'text-text-muted' },
    unknown: { label: 'Unknown', icon: <AlertTriangle className="w-3 h-3" />, cls: 'text-warning' },
  }
  const c = config[fileType] || config.unknown
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-medium ${c.cls}`}>
      {c.icon}
      {c.label}
    </span>
  )
}

// ─── 文件大小格式化 ───────────────────────────────────────
function formatFileSize(bytes?: number): string {
  if (bytes === undefined || bytes === null) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '-'
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ─── 主组件 ───────────────────────────────────────────────

export interface ProjectFilePreviewProps {
  /** 待预览的文件 */
  file: FileItem
  /** 中文环境 */
  isZh: boolean
  /** 是否最大化（影响按钮图标） */
  isMaximized: boolean
  /** 关闭预览 */
  onClose: () => void
  /** 切换最大化 / 还原 */
  onToggleMaximize: () => void
  /** 在工作区编辑器中打开（保留原能力，作为可选入口） */
  onOpenInEditor: (file: FileItem) => void
}

export function ProjectFilePreview({
  file,
  isZh,
  isMaximized,
  onClose,
  onToggleMaximize,
  onOpenInEditor,
}: ProjectFilePreviewProps) {
  const currentTheme = useStore(s => s.currentTheme)
  const isDark = useMemo(() => {
    const theme = themeManager.getThemeById(currentTheme)
    return theme?.type === 'dark'
  }, [currentTheme])

  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const loadTokenRef = useRef(0)

  const fileType = useMemo(() => getFileType(file.path), [file.path])
  const language = useMemo(() => detectLanguage(file.path), [file.path])

  // 是否需要预读文本内容：
  //  - markdown / html / text / csv：需先读取文本再交给预览组件
  //  - image / pdf / docx / doc / pptx / ppt / xlsx：由各自组件读取二进制，无需预读
  const needsTextContent =
    fileType === 'markdown' || fileType === 'html' || fileType === 'text' || fileType === 'csv'

  const loadFileContent = useCallback(async () => {
    // 非文本类（图片 / PDF / Office / Excel）由各自组件读取二进制，无需预读
    if (!needsTextContent) {
      setContent(null)
      setLoading(false)
      setError(false)
      return
    }
    const token = ++loadTokenRef.current
    setLoading(true)
    setError(false)
    try {
      const text = await api.file.read(file.path)
      // 防止竞态：仅保留最后一次请求结果
      if (token !== loadTokenRef.current) return
      setContent(text ?? '')
    } catch {
      if (token !== loadTokenRef.current) return
      setError(true)
      setContent(null)
    } finally {
      if (token === loadTokenRef.current) setLoading(false)
    }
  }, [file.path, needsTextContent])

  useEffect(() => {
    void loadFileContent()
  }, [loadFileContent])

  // ─── 渲染：加载中 ─────────────────────────────────────
  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <PreviewHeader
          file={file}
          isZh={isZh}
          isMaximized={isMaximized}
          fileType={fileType}
          onClose={onClose}
          onToggleMaximize={onToggleMaximize}
          onOpenInEditor={onOpenInEditor}
        />
        <div className="flex-1 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-accent animate-spin" />
        </div>
      </div>
    )
  }

  // ─── 渲染：错误 ───────────────────────────────────────
  if (error) {
    return (
      <div className="flex flex-col h-full">
        <PreviewHeader
          file={file}
          isZh={isZh}
          isMaximized={isMaximized}
          fileType={fileType}
          onClose={onClose}
          onToggleMaximize={onToggleMaximize}
          onOpenInEditor={onOpenInEditor}
        />
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <AlertTriangle className="w-10 h-10 text-warning mb-3 opacity-80" />
          <p className="text-sm text-text-primary font-medium mb-1">
            {isZh ? '无法加载文件内容' : 'Failed to load file'}
          </p>
          <p className="text-[12px] text-text-muted mb-4 break-all max-w-xs">
            {file.path}
          </p>
          <ActionButton variant="ghost" size="sm" onClick={loadFileContent} className="gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            {isZh ? '重试' : 'Retry'}
          </ActionButton>
        </div>
      </div>
    )
  }

  // ─── 渲染：正文 ───────────────────────────────────────
  return (
    <div className="flex flex-col h-full min-h-0">
      <PreviewHeader
        file={file}
        isZh={isZh}
        isMaximized={isMaximized}
        fileType={fileType}
        onClose={onClose}
        onToggleMaximize={onToggleMaximize}
        onOpenInEditor={onOpenInEditor}
      />

      {/* 预览内容区 */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {fileType === 'markdown' && content !== null && (
          <MarkdownPreview content={content} fontSize={14} />
        )}
        {fileType === 'image' && (
          <ImagePreview path={file.path} />
        )}
        {fileType === 'html' && content !== null && (
          <HtmlPreview content={content} filePath={file.path} />
        )}
        {fileType === 'text' && content !== null && (
          <div className="h-full overflow-auto custom-scrollbar">
            <CodeHighlight code={content} language={language} isDark={isDark} fontSize={13} />
          </div>
        )}
        {fileType === 'csv' && content !== null && (
          <CsvPreview path={file.path} content={content} />
        )}
        {/* 文档类预览：PDF / Word / PPT / Excel（懒加载重型解析库，与工作区一致） */}
        {(fileType === 'pdf' || fileType === 'docx' || fileType === 'doc'
          || fileType === 'pptx' || fileType === 'ppt' || fileType === 'xlsx') && (
          <Suspense fallback={<PreviewLoading />}>
            {fileType === 'pdf' && <PdfPreview path={file.path} />}
            {fileType === 'docx' && <DocxPreview path={file.path} />}
            {fileType === 'doc' && <DocPreview path={file.path} />}
            {fileType === 'pptx' && <WorkspacePptxPreview path={file.path} />}
            {fileType === 'ppt' && <PptPreview path={file.path} />}
            {fileType === 'xlsx' && <XlsxEditor path={file.path} />}
          </Suspense>
        )}
        {/* 二进制 / 未知类型不支持内联预览 */}
        {(fileType === 'binary' || fileType === 'unknown') && (
          <UnsupportedFile path={file.path} fileType={fileType === 'unknown' ? 'unknown' : 'binary'} />
        )}
      </div>

      {/* 底部元信息 */}
      <PreviewFooter file={file} isZh={isZh} contentLength={content?.length} />
    </div>
  )
}

// ─── 头部 ─────────────────────────────────────────────────

interface PreviewHeaderProps {
  file: FileItem
  isZh: boolean
  isMaximized: boolean
  fileType: FileType
  onClose: () => void
  onToggleMaximize: () => void
  onOpenInEditor: (file: FileItem) => void
}

function PreviewHeader({
  file, isZh, isMaximized, fileType, onClose, onToggleMaximize, onOpenInEditor,
}: PreviewHeaderProps) {
  const dirName = useMemo(() => {
    const parts = file.path.replace(/\\/g, '/').split('/')
    parts.pop()
    return parts.slice(-2).join('/')
  }, [file.path])

  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-border bg-surface/40">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-text-primary truncate" title={file.name}>
            {file.name}
          </span>
          <FileTypeBadge fileType={fileType} />
        </div>
        <div className="text-[12px] text-text-muted/70 truncate" title={file.path}>
          {dirName}
        </div>
      </div>

      <div className="flex items-center gap-0.5 flex-shrink-0">
        <button
          onClick={() => onOpenInEditor(file)}
          className="p-1.5 rounded-md hover:bg-surface-hover/60 text-text-muted hover:text-text-primary transition-colors"
          title={isZh ? '在工作区编辑器中打开' : 'Open in workspace editor'}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={onToggleMaximize}
          className="p-1.5 rounded-md hover:bg-surface-hover/60 text-text-muted hover:text-text-primary transition-colors"
          title={isMaximized ? (isZh ? '还原' : 'Restore') : (isZh ? '最大化' : 'Maximize')}
        >
          {isMaximized ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
        </button>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-colors"
          title={isZh ? '关闭预览' : 'Close preview'}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ─── 底部元信息 ───────────────────────────────────────────

interface PreviewFooterProps {
  file: FileItem
  isZh: boolean
  contentLength?: number
}

function PreviewFooter({ file, isZh, contentLength }: PreviewFooterProps) {
  const charCount = contentLength !== undefined ? `${contentLength.toLocaleString()} ${isZh ? '字符' : 'chars'}` : null
  return (
    <div className="flex-shrink-0 flex items-center gap-3 px-3 py-1.5 border-t border-border bg-surface/30 text-[12px] text-text-muted">
      <span>{formatFileSize(file.size)}</span>
      <span className="text-text-muted/30">·</span>
      <span>{formatTime(file.lastModified)}</span>
      {charCount && (
        <>
          <span className="text-text-muted/30">·</span>
          <span>{charCount}</span>
        </>
      )}
    </div>
  )
}

export default ProjectFilePreview
