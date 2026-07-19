/**
 * 工具调用预览渲染器
 * 采用「预览策略注册表」架构：
 *  - 每个工具名注册一个预览渲染器，消除冗长 if-else
 *  - 渲染器接收统一上下文，返回 React 节点
 *  - 未注册的工具走通用渲染器
 */
import { FileCode, Search, Terminal, Zap, Copy } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import type { ToolCall } from '@intelligence/providerTypes'
import { openUrlInBrowser } from '@utils/browserLauncher'
import { JsonHighlight } from '@utils/jsonHighlight'
import { FilePathAnchor as TextWithFileLinks } from '../../foundation/FilePathAnchor'
import { CodeHighlight } from '../CodeHighlight'
import InlineDiffPreview from '../InlineDiffPreview'
import { RichContentRenderer } from '../RichContentRenderer'
import { themeManager } from '../../../config/themeDefinition'
import { ExpandablePreviewContainer } from './ExpandablePreviewContainer'
import {
  asString,
  guessLanguage,
  getPrimaryToolPath,
  getToolPathList,
  getPathDisplayName,
  getPathSummary,
  type ToolArgs,
} from './helpers'

/** 预览渲染上下文 */
interface PreviewContext {
  toolCall: ToolCall
  args: ToolArgs
  isRunning: boolean
  isStreaming: boolean
  language: Language
  currentTheme: string
  onCopyResult: () => void
  /** 流式预览状态（包含 partialOutput 等实时数据） */
  previewState?: import('@intelligence/providerTypes').ToolStreamingPreview
}

/** 预览渲染器类型 */
type PreviewRenderer = (ctx: PreviewContext) => React.ReactNode | null

/** 等待输出骨架 */
function PendingPreviewSkeleton() {
  return (
    <div className="p-2 space-y-1.5 opacity-70" aria-hidden="true">
      <div className="h-2 rounded-full bg-text-primary/[0.06] animate-pulse w-[72%]" />
      <div className="h-2 rounded-full bg-text-primary/[0.06] animate-pulse w-[48%]" />
      <div className="mt-2 h-[2px] rounded-full bg-accent/10 overflow-hidden">
        <div className="h-full w-1/3 bg-accent/30 rounded-full animate-[skeleton-progress_2s_ease-in-out_infinite]" />
      </div>
    </div>
  )
}

/** 等待输出占位 */
function pendingPreview(label: string | undefined, language: Language) {
  return (
    <ExpandablePreviewContainer language={language}>
      <div className="p-2 text-[12px] text-text-muted italic">
        {label || t('tool.status.waitingOutput', language as any)}
      </div>
      <PendingPreviewSkeleton />
    </ExpandablePreviewContainer>
  )
}

/** 截断结果文本展示 */
function TruncatedText({ text, max, language }: { text: string; max: number; language: Language }) {
  return (
    <>
      {text.slice(0, max)}
      {text.length > max && <span className="opacity-50 mt-1 block">{t('tool.truncated', language as any)}</span>}
    </>
  )
}

/** 命令行工具预览 */
const renderRunCommand: PreviewRenderer = (ctx) => {
  const { args, toolCall, isRunning, language, previewState } = ctx
  const cmd = asString(args.command)
  const stringResult = typeof toolCall.result === 'string' ? toolCall.result : ''
  // 流式输出：命令执行过程中实时显示终端输出
  const streamingOutput = previewState?.partialOutput || ''

  return (
    <div className="font-mono text-[12px] space-y-1">
      <div className="flex items-start gap-1.5">
        <span className="text-accent/60 select-none flex-shrink-0 mt-px">$</span>
        <span className="text-text-primary whitespace-pre-wrap break-all flex-1 min-w-0">{cmd}</span>
        {isRunning && !stringResult && !streamingOutput && (
          <span className="text-accent flex items-center gap-1 flex-shrink-0 mt-px">
            <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />
          </span>
        )}
      </div>
      {/* 优先显示最终结果，其次显示流式输出 */}
      {stringResult ? (
        <ExpandablePreviewContainer language={language}>
          <div className="text-text-muted/90 whitespace-pre-wrap break-all p-2 font-mono text-[12px]">
            <TruncatedText text={stringResult} max={5000} language={language} />
          </div>
        </ExpandablePreviewContainer>
      ) : streamingOutput ? (
        <ExpandablePreviewContainer language={language}>
          <div className="text-text-muted/90 whitespace-pre-wrap break-all p-2 font-mono text-[12px]">
            <TruncatedText text={streamingOutput} max={5000} language={language} />
            {isRunning && (
              <span className="inline-block w-1.5 h-3 bg-accent/60 animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        </ExpandablePreviewContainer>
      ) : null}
    </div>
  )
}

/** 终端输入工具预览 */
const renderSendTerminalInput: PreviewRenderer = (ctx) => {
  const { args, language } = ctx
  const input = asString(args.input)
  const display = args.is_ctrl ? `Ctrl+${input.toUpperCase()}` : input.replace(/\n|\r/g, '\\n')
  const badgeClass = args.is_ctrl ? 'bg-orange-500/10 text-orange-400' : 'bg-surface-elevated text-text-secondary'
  return (
    <div className="font-mono text-[12px] space-y-1">
      <div className="flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 text-text-muted" />
        <span className="text-text-muted">{t('tool.sentInput', language as any)}</span>
        <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${badgeClass}`}>{display}</span>
        <span className="text-text-muted/85 text-[11px] ml-1">
          {t('tool.to', language as any)} {asString(args.terminal_id)}
        </span>
      </div>
    </div>
  )
}

/** 终端停止工具预览 */
const renderStopTerminal: PreviewRenderer = (ctx) => {
  const { args, language } = ctx
  return (
    <div className="font-mono text-[12px] space-y-1 text-red-400">
      <div className="flex items-center gap-2">
        <Terminal className="w-3.5 h-3.5 opacity-80" />
        <span className="font-medium">{t('tool.forceTerminated', language as any)}</span>
        <span className="opacity-50 text-[11px]">{asString(args.terminal_id)}</span>
      </div>
    </div>
  )
}

/** 终端输出读取工具预览 */
const renderReadTerminalOutput: PreviewRenderer = (ctx) => {
  const { args, toolCall, isRunning, isStreaming, language } = ctx
  const stringResult = typeof toolCall.result === 'string' ? toolCall.result : ''
  return (
    <div className="font-mono text-[12px] space-y-1">
      <div className="flex items-center gap-2 text-text-muted">
        <Terminal className="w-3.5 h-3.5 text-accent/70" />
        <span>{t('tool.readTerminalLogs', language as any)}</span>
        <span className="opacity-50 text-[11px]">{asString(args.terminal_id)}</span>
      </div>
      {stringResult.length > 0 ? (
        <ExpandablePreviewContainer language={language}>
          <div className="text-text-muted/90 whitespace-pre-wrap break-all p-2 bg-surface/50">{stringResult}</div>
        </ExpandablePreviewContainer>
      ) : (
        (isRunning || isStreaming) && pendingPreview(t('tool.status.waitingTerminalOutput', language as any), language)
      )}
    </div>
  )
}

/** 搜索类工具预览 */
const renderSearch: PreviewRenderer = (ctx) => {
  const { args, toolCall, effectiveName, isRunning, isStreaming, language } = ctx as PreviewContext & {
    effectiveName: string
  }
  const query = asString(args.pattern) || asString(args.query)
  const searchTypeKey =
    effectiveName === 'codebase_search'
      ? 'tool.searchType.semantic'
      : effectiveName === 'web_search'
        ? 'tool.searchType.web'
        : effectiveName === 'uiux_search'
          ? 'tool.searchType.uiux'
          : 'tool.searchType.files'
  const searchType = t(searchTypeKey as any, language as any)

  return (
    <div className="space-y-1 text-[12px]">
      <div className="flex items-center gap-1.5 text-text-muted">
        <Search className="w-3 h-3" />
        <span>{searchType}:</span>
        <span className="text-text-primary font-medium truncate">"{query}"</span>
      </div>
      {toolCall.result ? (
        <ExpandablePreviewContainer language={language}>
          <JsonHighlight data={toolCall.result} className="p-2 bg-transparent m-0" maxHeight="max-h-full" maxLength={3000} />
        </ExpandablePreviewContainer>
      ) : (
        (isRunning || isStreaming) && pendingPreview('Searching...', language)
      )}
    </div>
  )
}

/** 目录列表工具预览 */
const renderListDirectory: PreviewRenderer = (ctx) => {
  const { args, toolCall, isRunning, isStreaming, language } = ctx
  const paths = getToolPathList(args)
  const path = paths[0] || ''
  const displayName = paths.length > 1 ? getPathSummary(paths) : getPathDisplayName(path) || '.'
  const stringResult = typeof toolCall.result === 'string' ? toolCall.result : ''

  return (
    <div className="space-y-1 text-[12px]">
      <div className="flex items-center gap-1.5 text-text-muted">
        <FileCode className="w-3 h-3" />
        <span className="text-text-primary font-medium" title={path || undefined}>
          {displayName}
        </span>
      </div>
      {stringResult ? (
        <ExpandablePreviewContainer language={language}>
          <div className="p-2 font-mono text-text-secondary whitespace-pre">
            <TruncatedText text={stringResult} max={5000} language={language} />
          </div>
        </ExpandablePreviewContainer>
      ) : (
        (isRunning || isStreaming) && pendingPreview('Reading directory...', language)
      )}
    </div>
  )
}

/** 文件编辑/写入工具预览 */
const renderEditFile: PreviewRenderer = (ctx) => {
  const { args, toolCall, isStreaming, isRunning, language } = ctx
  const filePath = getPrimaryToolPath(args)
  const oldString = asString(args.old_string)
  const nextContent = asString(args.content) || asString(args.new_string)
  const oldContent = oldString.slice(0, 5000)
  const newContent = nextContent.slice(0, 5000)
  const meta = args._meta as Record<string, unknown> | undefined
  const isLargeWrite = meta?.isLargeWrite === true || meta?.contentTruncated === true
  const isTruncated = isLargeWrite || nextContent.length > 5000 || oldString.length > 5000
  const stringResult = typeof toolCall.result === 'string' ? toolCall.result : ''

  if (!newContent && !isStreaming) return null

  return (
    <div className="space-y-1">
      <div className="flex items-center flex-wrap gap-2 text-[12px] text-text-muted">
        <FileCode className="w-3 h-3 flex-shrink-0" />
        {filePath ? (
          <span className="font-medium text-text-primary transition-colors break-all" title={filePath}>
            <TextWithFileLinks text={filePath.split('/').pop() || filePath} />
          </span>
        ) : (isStreaming || isRunning) ? (
          <span className="font-medium tool-text-shimmer italic">editing...</span>
        ) : (
          <span className="font-medium text-text-primary opacity-50">&lt;empty path&gt;</span>
        )}
        {isStreaming && (
          <span className="text-accent flex items-center gap-1">
            <span className="w-1 h-1 rounded-full bg-accent animate-pulse" />
            Writing...
          </span>
        )}
        {isTruncated && !isStreaming && (
          <span className="text-amber-500">({t('tool.truncated', language as any).replace('... ', '')})</span>
        )}
      </div>
      {isLargeWrite && !isStreaming ? (
        <div className="ml-1 rounded-md border border-amber-500/20 bg-amber-500/5 px-2 py-2 text-[12px] text-text-muted">
          Large file preview deferred. Open the file to inspect the full content safely.
        </div>
      ) : (
        <div className="max-h-64 overflow-auto custom-scrollbar pl-2 ml-1">
          <InlineDiffPreview
            oldContent={oldContent}
            newContent={newContent}
            filePath={filePath}
            isStreaming={isStreaming}
            maxLines={30}
          />
        </div>
      )}
      {stringResult && !isStreaming && (
        <ExpandablePreviewContainer language={language} maxHeight="max-h-[100px]">
          <div className="p-2 text-[12px] text-text-muted">
            <TruncatedText text={stringResult} max={1000} language={language} />
          </div>
        </ExpandablePreviewContainer>
      )}
    </div>
  )
}

/** 创建/删除文件工具预览 */
const renderCreateDelete: PreviewRenderer = (ctx) => {
  const { args, toolCall, effectiveName, language } = ctx as PreviewContext & { effectiveName: string }
  const paths = getToolPathList(args)
  const path = paths[0] || ''
  const isDelete = effectiveName === 'delete_file_or_folder'
  const isFolder = path.endsWith('/')
  const displayName = paths.length > 1 ? getPathSummary(paths) : path ? getPathDisplayName(path) : '<no path>'
  const stringResult = typeof toolCall.result === 'string' ? toolCall.result : ''

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[12px]">
        <FileCode className={`w-3 h-3 ${isDelete ? 'text-status-error' : 'text-status-success'}`} />
        <span className={`font-medium ${isDelete ? 'text-status-error' : 'text-status-success'}`}>
          {isDelete ? 'Delete' : 'Create'} {isFolder ? 'folder' : 'file'}:
        </span>
        <span className="text-text-primary break-all" title={path || undefined}>
          {displayName}
        </span>
      </div>
      {stringResult && (
        <ExpandablePreviewContainer language={language} maxHeight="max-h-[100px]">
          <div className="p-2 text-[12px] text-text-muted">
            <TextWithFileLinks text={stringResult.slice(0, 1000)} />
          </div>
        </ExpandablePreviewContainer>
      )}
    </div>
  )
}

/** 文件读取工具预览 */
const renderReadFile: PreviewRenderer = (ctx) => {
  const { args, toolCall, isRunning, isStreaming, language, currentTheme } = ctx
  const paths = getToolPathList(args)
  const filePath = paths[0] || ''
  const hasResolvedReadTarget = paths.length > 0
  if (!hasResolvedReadTarget && !toolCall.result && !toolCall.richContent?.length && !isRunning && !isStreaming) {
    return null
  }
  const displayName = paths.length > 1 ? getPathSummary(paths) : filePath ? getPathDisplayName(filePath) : '<no path>'
  const theme = themeManager.getThemeById(currentTheme)
  const isDark = theme?.type === 'dark'
  const safeResult = typeof toolCall.result === 'string' ? toolCall.result : ''

  return (
    <div className="space-y-1 mt-1">
      <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
        <FileCode className="w-3 h-3" />
        <span
          className="font-medium text-text-primary transition-colors hover:underline cursor-pointer"
          title={paths.join('\n') || undefined}
        >
          <TextWithFileLinks text={displayName} />
        </span>
      </div>
      {safeResult ? (
        <ExpandablePreviewContainer language={language}>
          <CodeHighlight
            code={safeResult.slice(0, 5000)}
            language={filePath ? guessLanguage(filePath) : 'typescript'}
            isDark={isDark}
            isStreaming={isRunning || isStreaming}
            fontSize={12}
          />
        </ExpandablePreviewContainer>
      ) : (
        (isRunning || isStreaming) && pendingPreview('Reading file...', language)
      )}
    </div>
  )
}

/** URL 读取工具预览 */
const renderReadUrl: PreviewRenderer = (ctx) => {
  const { args, toolCall, isRunning, isStreaming, language } = ctx
  const url = asString(args.url)
  let hostname = '<no url>'
  if (url) {
    try {
      hostname = new URL(url).hostname
    } catch {
      hostname = url
    }
  }
  const stringResult = typeof toolCall.result === 'string' ? toolCall.result : ''

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
        <Search className="w-3 h-3" />
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-text-primary font-medium hover:underline truncate hover:text-accent transition-colors"
          onClick={(e) => {
            e.preventDefault()
            openUrlInBrowser(url)
          }}
        >
          {hostname}
        </a>
      </div>
      {stringResult ? (
        <ExpandablePreviewContainer language={language}>
          <div className="p-2 text-[12px] text-text-secondary whitespace-pre-wrap break-all">
            <TruncatedText text={stringResult} max={5000} language={language} />
          </div>
        </ExpandablePreviewContainer>
      ) : (
        (isRunning || isStreaming) && pendingPreview('Reading URL...', language)
      )}
    </div>
  )
}

/** 技能应用工具预览 */
const renderApplySkill: PreviewRenderer = (ctx) => {
  const { args, toolCall, isRunning, language } = ctx
  const skillName = asString(args.skill_name)
  const isDone = toolCall.status === 'success'
  const isFailed = toolCall.status === 'error'
  const stringResult = typeof toolCall.result === 'string' ? toolCall.result : ''

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[12px]">
        <Zap
          className={`w-3 h-3 ${isRunning ? 'text-accent animate-pulse' : isDone ? 'text-green-400' : isFailed ? 'text-red-400' : 'text-text-muted'}`}
        />
        <span className="text-text-muted">
          {isDone
            ? t('tool.status.applied', language as any, { name: skillName || 'Skill' })
            : isRunning
              ? t('tool.status.applying', language as any, { name: skillName || 'Skill' })
              : skillName || 'Skill'}
        </span>
      </div>
      {stringResult ? (
        <ExpandablePreviewContainer language={language} maxHeight="max-h-[150px]">
          <div className="p-2 text-[12px] text-text-muted whitespace-pre-wrap break-all">
            <TruncatedText text={stringResult} max={3000} language={language} />
          </div>
        </ExpandablePreviewContainer>
      ) : (
        isRunning && pendingPreview(t('tool.status.applyingEllipsis', language as any), language)
      )}
    </div>
  )
}

/** 代码分析工具预览 */
const renderCodeAnalysis: PreviewRenderer = (ctx) => {
  const { args, toolCall, isRunning, isStreaming, language } = ctx
  const path = getPrimaryToolPath(args)
  const line = typeof args.line === 'number' ? args.line : undefined

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
        <FileCode className="w-3 h-3" />
        <span
          className="font-medium text-text-primary transition-colors hover:underline cursor-pointer"
          title={path || undefined}
        >
          <TextWithFileLinks text={path.split('/').pop() || '<unknown path>'} />
        </span>
        {line && <span className="text-text-muted/90">:{line}</span>}
      </div>
      {toolCall.result ? (
        <ExpandablePreviewContainer language={language}>
          <JsonHighlight data={toolCall.result} className="p-2 bg-transparent m-0" maxHeight="max-h-full" maxLength={3000} />
        </ExpandablePreviewContainer>
      ) : (
        (isRunning || isStreaming) && pendingPreview(t('tool.status.analyzingEllipsis', language as any), language)
      )}
    </div>
  )
}

/** 通用预览渲染器 */
function renderGeneric(ctx: PreviewContext): React.ReactNode {
  const { args, toolCall, isRunning, isStreaming, language, onCopyResult } = ctx
  const filteredArgs = Object.fromEntries(Object.entries(args).filter(([key]) => !key.startsWith('_')))
  const hasArgs = Object.keys(filteredArgs).length > 0
  const hasRichContent = !!toolCall.richContent && toolCall.richContent.length > 0

  return (
    <div className="space-y-1 mt-1 text-[12px]">
      {hasArgs && (
        <>
          <div className="flex items-center gap-1.5 text-text-muted">
            <FileCode className="w-3 h-3" />
            <span>{t('tool.arguments', language as any)}</span>
          </div>
          <ExpandablePreviewContainer language={language} maxHeight="max-h-[150px]">
            <JsonHighlight data={filteredArgs} className="p-2 bg-transparent m-0" maxHeight="max-h-full" maxLength={1500} />
          </ExpandablePreviewContainer>
        </>
      )}
      {hasRichContent && toolCall.richContent && (
        <ExpandablePreviewContainer language={language}>
          <div className="p-2">
            <RichContentRenderer content={toolCall.richContent} maxHeight="max-h-full" />
          </div>
        </ExpandablePreviewContainer>
      )}
      {toolCall.result && !hasRichContent && (
        <>
          <div className="flex items-center justify-between gap-1.5 text-text-muted mt-2 group/title">
            <div className="flex items-center gap-1.5">
              <Terminal className="w-3 h-3" />
              <span>{t('tool.result', language as any)}</span>
            </div>
            <button
              onClick={(event) => {
                event.stopPropagation()
                onCopyResult()
              }}
              className="opacity-0 group-hover/title:opacity-100 transition-opacity p-0.5 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary"
              title={t('tool.copyResult', language as any)}
            >
              <Copy className="w-3 h-3" />
            </button>
          </div>
          <ExpandablePreviewContainer language={language}>
            <JsonHighlight data={toolCall.result} className="p-2 bg-transparent m-0" maxHeight="max-h-full" maxLength={3000} />
          </ExpandablePreviewContainer>
        </>
      )}
      {!toolCall.result && !hasRichContent && (isRunning || isStreaming) && pendingPreview(undefined, language)}
    </div>
  )
}

/** 预览渲染器注册表 */
const PREVIEW_REGISTRY: Record<string, PreviewRenderer> = {
  run_command: renderRunCommand,
  send_terminal_input: renderSendTerminalInput,
  stop_terminal: renderStopTerminal,
  read_terminal_output: renderReadTerminalOutput,
  search_files: renderSearch,
  codebase_search: renderSearch,
  web_search: renderSearch,
  uiux_search: renderSearch,
  list_directory: renderListDirectory,
  edit_file: renderEditFile,
  write_file: renderEditFile,
  create_file_or_folder: renderCreateDelete,
  delete_file_or_folder: renderCreateDelete,
  read_file: renderReadFile,
  read_multiple_files: renderReadFile,
  read_url: renderReadUrl,
  apply_skill: renderApplySkill,
  get_lint_errors: renderCodeAnalysis,
  find_references: renderCodeAnalysis,
  go_to_definition: renderCodeAnalysis,
  get_hover_info: renderCodeAnalysis,
  get_document_symbols: renderCodeAnalysis,
}

/** 渲染工具预览 */
export function renderToolPreview(ctx: PreviewContext & { effectiveName: string }): React.ReactNode {
  const renderer = PREVIEW_REGISTRY[ctx.effectiveName]
  if (renderer) return renderer(ctx)
  return renderGeneric(ctx)
}
