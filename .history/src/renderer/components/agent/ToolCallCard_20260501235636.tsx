import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Copy, FileCode, Search, Terminal, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useShallow } from 'zustand/react/shallow'
import { vscDarkPlus, vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { useStore } from '@store'
import { t } from '@renderer/i18n'
import type { ToolCall } from '@renderer/agent/types'
import { useToolDisplayState } from '@renderer/agent/presentation/toolDisplay'
import { useToolCardExpansion } from '@renderer/hooks'
import { JsonHighlight } from '@utils/jsonHighlight'
import { toast } from '@components/common/ToastProvider'
import { RichContentRenderer } from './RichContentRenderer'
import InlineDiffPreview from './InlineDiffPreview'
import { getExtension, getFileName } from '@shared/utils/pathUtils'
import { TextWithFileLinks } from '../common/TextWithFileLinks'
import { SyntaxHighlighter } from '@renderer/utils/syntaxHighlighter'
import { themeManager } from '../../config/themeConfig'

interface ToolCallCardProps {
    toolCall: ToolCall
    isAwaitingApproval?: boolean
    onApprove?: () => void
    onReject?: () => void
    defaultExpanded?: boolean
}

type ToolArgs = Record<string, unknown>

const TOOL_LABEL_KEYS: Record<string, string> = {
    read_file: 'tool.label.read_file',
    read_multiple_files: 'tool.label.read_multiple_files',
    list_directory: 'tool.label.list_directory',
    search_files: 'tool.label.search_files',
    codebase_search: 'tool.label.codebase_search',
    edit_file: 'tool.label.edit_file',
    write_file: 'tool.label.write_file',
    create_file: 'tool.label.create_file',
    create_file_or_folder: 'tool.label.create_file_or_folder',
    delete_file_or_folder: 'tool.label.delete_file_or_folder',
    run_command: 'tool.label.run_command',
    get_lint_errors: 'tool.label.get_lint_errors',
    find_references: 'tool.label.find_references',
    go_to_definition: 'tool.label.go_to_definition',
    get_hover_info: 'tool.label.get_hover_info',
    get_document_symbols: 'tool.label.get_document_symbols',
    web_search: 'tool.label.web_search',
    read_url: 'tool.label.read_url',
    ask_user: 'tool.label.ask_user',
    remember: 'tool.label.remember',
    uiux_search: 'tool.label.uiux_search',
    uiux_recommend: 'tool.label.uiux_recommend',
    apply_skill: 'tool.label.apply_skill',
    todo_write: 'tool.label.todo_write',
}

const guessLanguage = (filename: string) => {
    const ext = getExtension(filename)
    const map: Record<string, string> = {
        js: 'javascript',
        jsx: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        json: 'json',
        css: 'css',
        html: 'html',
        md: 'markdown',
        py: 'python',
        rs: 'rust',
        go: 'go',
        sh: 'bash',
        yml: 'yaml',
        yaml: 'yaml',
        xml: 'xml',
    }
    return map[ext] || 'typescript'
}

const asString = (value: unknown): string => typeof value === 'string' ? value : ''

const asStringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

const getPathList = (value: unknown): string[] => {
    if (typeof value === 'string') return value ? [value] : []
    return asStringArray(value).filter(Boolean)
}

const getToolPathList = (args: ToolArgs): string[] => {
    const directPaths = getPathList(args.path)
    if (directPaths.length > 0) return directPaths

    const pluralPaths = getPathList(args.paths)
    if (pluralPaths.length > 0) return pluralPaths

    return []
}

const getPrimaryToolPath = (args: ToolArgs): string => getToolPathList(args)[0] || ''

const getPathDisplayName = (path: string): string => getFileName(path) || path

const getPathSummary = (paths: string[], maxItems = 3): string => {
    if (paths.length === 0) return ''
    if (paths.length === 1) return getPathDisplayName(paths[0])

    const preview = paths
        .slice(0, maxItems)
        .map(path => `"${getPathDisplayName(path)}"`)
        .join(', ')

    return `${paths.length} files (${preview}${paths.length > maxItems ? ', ...' : ''})`
}

function getStatusText(name: string, args: ToolArgs, status: ToolCall['status'], isStreaming: boolean, language: string): string {
    const isRunning = status === 'running' || status === 'pending' || isStreaming
    const isSuccess = status === 'success'
    const isError = status === 'error'
    const paths = getToolPathList(args)
    const path = getPrimaryToolPath(args)
    const pathSummary = getPathSummary(paths)

    if (name === 'run_command') {
        const cmd = asString(args.command)
        if (!cmd) return isRunning ? t('tool.status.preparingCmd', language as any) : ''
        if (isRunning) return t('tool.status.executing', language as any, { cmd })
        if (isSuccess) return t('tool.status.executed', language as any, { cmd })
        if (isError) return t('tool.status.cmdFailed', language as any, { cmd })
        return cmd
    }

    if (name === 'read_multiple_files') {
        if (paths.length > 0) {
            if (isRunning) return t('tool.status.reading', language as any, { target: pathSummary })
            if (isSuccess) return t('tool.status.read', language as any, { target: pathSummary })
            if (isError) return t('tool.status.readFailed', language as any, { target: '' })
            return t('tool.status.reading', language as any, { target: pathSummary })
        }
        return t('tool.status.readingFiles', language as any)
    }

    if (['read_file', 'list_directory'].includes(name)) {
        if (paths.length > 1) {
            if (isRunning) return t('tool.status.reading', language as any, { target: pathSummary })
            if (isSuccess) return t('tool.status.read', language as any, { target: pathSummary })
            if (isError) return t('tool.status.readFailed', language as any, { target: '' })
            return t('tool.status.reading', language as any, { target: pathSummary })
        }
        if (!path) return isRunning ? t('tool.status.readingEllipsis', language as any) : ''
        if (isRunning) return t('tool.status.reading', language as any, { target: path })
        if (isSuccess) return t('tool.status.read', language as any, { target: path })
        if (isError) return t('tool.status.readFailed', language as any, { target: path })
        return t('tool.status.reading', language as any, { target: path })
    }

    if (['write_file', 'create_file', 'create_file_or_folder'].includes(name)) {
        if (!path) return isRunning ? t('tool.status.creatingEllipsis', language as any) : ''
        if (isRunning) return t('tool.status.creating', language as any, { target: path })
        if (isSuccess) return t('tool.status.created', language as any, { target: path })
        if (isError) return t('tool.status.createFailed', language as any, { target: path })
        return t('tool.status.creating', language as any, { target: path })
    }

    if (name === 'edit_file') {
        if (!path) return isRunning ? t('tool.status.editingEllipsis', language as any) : ''
        if (isRunning) return t('tool.status.editing', language as any, { target: path })
        if (isSuccess) return t('tool.status.updated', language as any, { target: path })
        if (isError) return t('tool.status.editFailed', language as any, { target: path })
        return t('tool.status.editing', language as any, { target: path })
    }

    if (name === 'delete_file_or_folder') {
        if (!path) return isRunning ? t('tool.status.deletingEllipsis', language as any) : ''
        if (isRunning) return t('tool.status.deleting', language as any, { target: path })
        if (isSuccess) return t('tool.status.deleted', language as any, { target: path })
        if (isError) return t('tool.status.deleteFailed', language as any, { target: path })
        return t('tool.status.deleting', language as any, { target: path })
    }

    if (['search_files', 'codebase_search', 'web_search', 'uiux_search'].includes(name)) {
        const query = asString(args.pattern) || asString(args.query)
        const value = query ? `"${query}"` : ''
        if (!value) return isRunning ? t('tool.status.searchingEllipsis', language as any) : ''
        if (isRunning) return t('tool.status.searching', language as any, { query: value })
        if (isSuccess) return t('tool.status.searched', language as any, { query: value })
        if (isError) return t('tool.status.searchFailed', language as any)
        return t('tool.status.searching', language as any, { query: value })
    }

    if (name === 'read_url') {
        const url = asString(args.url)
        let hostname = ''
        if (url) {
            try {
                hostname = new URL(url).hostname
            } catch {
                hostname = url
            }
        }
        if (!hostname) return isRunning ? t('tool.status.readingUrlEllipsis', language as any) : ''
        if (isRunning) return t('tool.status.readingUrl', language as any, { host: hostname })
        if (isSuccess) return t('tool.status.readUrl', language as any, { host: hostname })
        if (isError) return t('tool.status.readUrlFailed', language as any, { host: hostname })
        return t('tool.status.readingUrl', language as any, { host: hostname })
    }

    if (['get_lint_errors', 'find_references', 'go_to_definition', 'get_hover_info', 'get_document_symbols'].includes(name)) {
        if (!path) return isRunning ? t('tool.status.analyzingEllipsis', language as any) : ''
        if (isRunning) return t('tool.status.analyzing', language as any, { target: path })
        if (isSuccess) return t('tool.status.analyzed', language as any, { target: path })
        if (isError) return t('tool.status.analysisFailed', language as any)
        return t('tool.status.analyzing', language as any, { target: path })
    }

    if (name === 'apply_skill') {
        const skillName = asString(args.skill_name)
        if (!skillName) return isRunning ? t('tool.status.applyingEllipsis', language as any) : ''
        if (isRunning) return t('tool.status.applying', language as any, { name: skillName })
        if (isSuccess) return t('tool.status.applied', language as any, { name: skillName })
        if (isError) return t('tool.status.applyFailed', language as any, { name: skillName })
        return t('tool.status.applying', language as any, { name: skillName })
    }

    if (name === 'todo_write') {
        if (isRunning) return t('tool.status.updatingTasks', language as any)
        if (isSuccess) return t('tool.status.tasksUpdated', language as any)
        if (isError) return t('tool.status.tasksUpdateFailed', language as any)
        return t('tool.status.updatingTasks', language as any)
    }

    return isRunning ? t('tool.status.processing', language as any) : ''
}

const getHeightPx = (heightClass: string): number => {
    const bracketMatch = heightClass.match(/\[(\d+)px\]/)
    if (bracketMatch) return Number(bracketMatch[1])

    const remMatch = heightClass.match(/max-h-(\d+)/)
    if (remMatch) return Number(remMatch[1]) * 4

    return 200
}

function PendingPreviewSkeleton() {
    return (
        <div className="p-2 space-y-1.5 opacity-70" aria-hidden="true">
            <div className="h-2 rounded-full bg-text-primary/[0.06] animate-pulse w-[72%]" />
            <div className="h-2 rounded-full bg-text-primary/[0.06] animate-pulse w-[48%]" />
        </div>
    )
}

export function ExpandablePreviewContainer({
    children,
    maxHeight = 'max-h-[200px]',
    expandedHeight = 'max-h-[350px]',
    language = 'en',
}: {
    children: React.ReactNode
    maxHeight?: string
    expandedHeight?: string
    language?: string
}) {
    const [expanded, setExpanded] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);
    const innerRef = useRef<HTMLDivElement>(null);
    const [isOverflowing, setIsOverflowing] = useState(false);
    const [measuredHeight, setMeasuredHeight] = useState(0);

    const collapsedMaxHeight = useMemo(() => getHeightPx(maxHeight), [maxHeight])
    const expandedMaxHeight = useMemo(() => getHeightPx(expandedHeight), [expandedHeight])
    const activeMaxHeight = expanded ? expandedMaxHeight : collapsedMaxHeight

    useLayoutEffect(() => {
        const content = contentRef.current
        const inner = innerRef.current
        if (!content || !inner) return

        const measure = () => {
            const contentHeight = inner.scrollHeight
            const totalHeight = contentHeight
            const nextHeight = Math.max(1, Math.min(totalHeight, activeMaxHeight))
            const nextOverflowing = totalHeight > activeMaxHeight + 10

            setIsOverflowing(nextOverflowing)
            setMeasuredHeight(nextHeight)
        }

        measure()
        const resizeObserver = new ResizeObserver(measure)
        resizeObserver.observe(content)
        resizeObserver.observe(inner)
        return () => resizeObserver.disconnect()
    }, [children, expanded, activeMaxHeight]);

    const heightValue = useMemo(() => {
        const match = expandedHeight.match(/\[(.*?)\]/);
        return match ? match[1] : expandedHeight.replace('max-h-', '');
    }, [expandedHeight]);

    return (
        <div className="mt-1 relative overflow-hidden">
            <div
                ref={contentRef}
                className="overflow-y-auto custom-scrollbar transition-[height,background-color] duration-300 ease-out relative"
                style={{ height: measuredHeight || undefined, maxHeight: activeMaxHeight }}
            >
                <div ref={innerRef}>
                    {children}
                </div>
            </div>
            {isOverflowing && !expanded && (
                <div
                    onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
                    className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-surface/80 via-surface/40 to-transparent flex items-end justify-center pb-2 cursor-pointer transition-all opacity-90 hover:opacity-100"
                >
                    <div className="flex items-center gap-1 font-medium pb-0.5 pointer-events-none bg-surface-elevated text-text-muted hover:text-accent px-3 py-1 rounded-full shadow-sm border border-border/40 text-[11px] transition-colors">
                        <ChevronDown className="w-3 h-3" />
                        {t('toolExpand', language as any, { height: heightValue })}
                    </div>
                </div>
            )}
            {isOverflowing && expanded && (
                <div
                    onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
                    className="w-full text-center py-2 mt-1 cursor-pointer flex items-center justify-center"
                >
                    <div className="flex items-center gap-1 font-medium pointer-events-none bg-surface-elevated text-text-muted hover:text-accent px-4 py-1 rounded-full shadow-sm border border-border/40 text-[11px] transition-colors">
                        <ChevronDown className="w-3 h-3 rotate-180 pointer-events-none" />
                        {t('toolCollapse', language as any)}
                    </div>
                </div>
            )}
        </div>
    )
}

function ToolPreview({
    toolCall,
    args,
    effectiveName,
    isRunning,
    isStreaming,
    language,
    currentTheme,
    onCopyResult,
    setTerminalVisible,
}: {
    toolCall: ToolCall
    args: ToolArgs
    effectiveName: string
    isRunning: boolean
    isStreaming: boolean
    language: string
    currentTheme: string
    onCopyResult: () => void
    setTerminalVisible: (visible: boolean) => void
}) {
    const stringResult = typeof toolCall.result === 'string' ? toolCall.result : ''
    const pendingPreview = (label?: string) => (
        <ExpandablePreviewContainer language={language}>
            <div className="p-2 text-[12px] text-text-muted italic">
                {label || t('tool.status.waitingOutput', language as any)}
            </div>
            <PendingPreviewSkeleton />
        </ExpandablePreviewContainer>
    )

    if (effectiveName === 'run_command') {
        const cmd = asString(args.command)
        const meta = (args as { _meta?: { terminalId?: string; executionMode?: string } })._meta
        const terminalId = meta?.terminalId
        const hasLiveTerminal = !!terminalId
        const wasDirectExecution = !!meta?.executionMode && meta.executionMode !== 'terminal'

        return (
            <div className="font-mono text-[12px] space-y-1">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-text-muted min-w-0">
                        <span className="text-accent/60 select-none flex-shrink-0">$</span>
                        <span className="text-text-primary break-all">{cmd}</span>
                    </div>
                    <button
                        onClick={async event => {
                            event.stopPropagation()
                            if (!terminalId) {
                                toast.info(
                                    wasDirectExecution
                                        ? t('tool.directExecutionNoTerminal', language as any)
                                        : t('tool.noTerminalSession', language as any)
                                )
                                return
                            }

                            const { terminalManager } = await import('@/renderer/services/TerminalManager')
                            if (!terminalManager.hasTerminal(terminalId)) {
                                toast.info(t('tool.terminalClosed', language as any))
                                return
                            }
                            setTerminalVisible(true)
                            terminalManager.setActiveTerminal(terminalId)
                            window.setTimeout(() => terminalManager.setActiveTerminal(terminalId), 0)
                        }}
                        className={`flex items-center gap-1 flex-shrink-0 ml-2 text-[11px] px-1.5 py-0.5 rounded transition-colors ${
                            isRunning
                                ? 'text-accent bg-accent/10'
                                : hasLiveTerminal
                                    ? 'text-text-muted hover:text-text-primary hover:bg-surface-hover'
                                    : 'text-text-muted/90 bg-surface-elevated/60 cursor-not-allowed'
                        }`}
                        title={t('tool.viewInTerminal', language as any)}
                    >
                        <Terminal className={`w-3 h-3 ${isRunning ? 'animate-pulse' : ''}`} />
                        <span>
                            {isRunning
                                ? t('tool.running', language as any)
                                : hasLiveTerminal
                                    ? t('tool.terminal', language as any)
                                    : t('tool.direct', language as any)}
                        </span>
                    </button>
                </div>
                {stringResult ? (
                    <ExpandablePreviewContainer language={language}>
                        <div className="text-text-muted/90 whitespace-pre-wrap break-all p-2 font-mono text-[12px]">
                            {stringResult.slice(0, 5000)}
                            {stringResult.length > 5000 && <span className="opacity-50 inline-block ml-1">{t('tool.truncated', language as any)}</span>}
                        </div>
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview(t('tool.status.waitingTerminalOutput', language as any))
                )}
            </div>
        )
    }

    if (effectiveName === 'send_terminal_input') {
        const input = asString(args.input)
        const display = args.is_ctrl ? `Ctrl+${input.toUpperCase()}` : input.replace(/\n|\r/g, '\\n')
        const badgeClass = args.is_ctrl ? 'bg-orange-500/10 text-orange-400' : 'bg-surface-elevated text-text-secondary'

        return (
            <div className="font-mono text-[12px] space-y-1">
                <div className="flex items-center gap-2">
                    <Terminal className="w-3.5 h-3.5 text-text-muted" />
                    <span className="text-text-muted">{t('tool.sentInput', language as any)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${badgeClass}`}>{display}</span>
                    <span className="text-text-muted/85 text-[11px] ml-1">{t('tool.to', language as any)} {asString(args.terminal_id)}</span>
                </div>
            </div>
        )
    }

    if (effectiveName === 'stop_terminal') {
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

    if (effectiveName === 'read_terminal_output') {
        return (
            <div className="font-mono text-[12px] space-y-1">
                <div className="flex items-center gap-2 text-text-muted">
                    <Terminal className="w-3.5 h-3.5 text-accent/70" />
                    <span>{t('tool.readTerminalLogs', language as any)}</span>
                    <span className="opacity-50 text-[11px]">{asString(args.terminal_id)}</span>
                </div>
                {stringResult.length > 0 ? (
                    <ExpandablePreviewContainer language={language}>
                        <div className="text-text-muted/90 whitespace-pre-wrap break-all p-2 bg-surface/50">
                            {stringResult}
                        </div>
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview(t('tool.status.waitingTerminalOutput', language as any))
                )}
            </div>
        )
    }

    if (['search_files', 'codebase_search', 'web_search', 'uiux_search'].includes(effectiveName)) {
        const query = asString(args.pattern) || asString(args.query)
        const searchType = effectiveName === 'codebase_search' ? 'Semantic' : effectiveName === 'web_search' ? 'Web' : effectiveName === 'uiux_search' ? 'UI/UX' : 'Files'

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
                ) : (isRunning || isStreaming) && (
                    pendingPreview('Searching...')
                )}
            </div>
        )
    }

    if (effectiveName === 'list_directory') {
        const paths = getToolPathList(args)
        const path = paths[0] || ''
        const displayName = paths.length > 1 ? getPathSummary(paths) : getPathDisplayName(path) || '.'

        return (
            <div className="space-y-1 text-[12px]">
                <div className="flex items-center gap-1.5 text-text-muted">
                    <FileCode className="w-3 h-3" />
                    <span className="text-text-primary font-medium" title={path || undefined}>{displayName}</span>
                </div>
                {stringResult ? (
                    <ExpandablePreviewContainer language={language}>
                        <div className="p-2 font-mono text-text-secondary whitespace-pre">
                            {stringResult.slice(0, 5000)}
                            {stringResult.length > 5000 && <span className="opacity-50 mt-1 block">{t('tool.truncated', language as any)}</span>}
                        </div>
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview('Reading directory...')
                )}
            </div>
        )
    }

    if (['edit_file', 'write_file'].includes(effectiveName)) {
        const filePath = getPrimaryToolPath(args)
        const oldString = asString(args.old_string)
        const nextContent = asString(args.content) || asString(args.new_string)
        const oldContent = oldString.slice(0, 5000)
        const newContent = nextContent.slice(0, 5000)
        const meta = args._meta as Record<string, unknown> | undefined
        const isLargeWrite = meta?.isLargeWrite === true || meta?.contentTruncated === true
        const isTruncated = isLargeWrite || nextContent.length > 5000 || oldString.length > 5000

        if (newContent || isStreaming) {
            return (
                <div className="space-y-1">
                    <div className="flex items-center flex-wrap gap-2 text-[12px] text-text-muted">
                        <FileCode className="w-3 h-3 flex-shrink-0" />
                        {filePath ? (
                            <span className="font-medium text-text-primary transition-colors break-all" title={filePath}>
                                <TextWithFileLinks text={getFileName(filePath)} />
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
                        {isTruncated && !isStreaming && <span className="text-amber-500">(truncated)</span>}
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
                                {stringResult.slice(0, 1000)}
                            </div>
                        </ExpandablePreviewContainer>
                    )}
                </div>
            )
        }
    }

    if (['create_file_or_folder', 'delete_file_or_folder'].includes(effectiveName)) {
        const paths = getToolPathList(args)
        const path = paths[0] || ''
        const isDelete = effectiveName === 'delete_file_or_folder'
        const isFolder = path.endsWith('/')
        const displayName = paths.length > 1 ? getPathSummary(paths) : (path ? getPathDisplayName(path) : '<no path>')

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[12px]">
                    <FileCode className={`w-3 h-3 ${isDelete ? 'text-status-error' : 'text-status-success'}`} />
                    <span className={`font-medium ${isDelete ? 'text-status-error' : 'text-status-success'}`}>
                        {isDelete ? 'Delete' : 'Create'} {isFolder ? 'folder' : 'file'}:
                    </span>
                    <span className="text-text-primary break-all" title={path || undefined}>{displayName}</span>
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

    if (['read_file', 'read_multiple_files'].includes(effectiveName)) {
        const paths = getToolPathList(args)
        const filePath = paths[0] || ''
        const hasResolvedReadTarget = paths.length > 0
        if (!hasResolvedReadTarget && !toolCall.result && !toolCall.richContent?.length && !isRunning && !isStreaming) {
            return null
        }
        const displayName = paths.length > 1 ? getPathSummary(paths) : (filePath ? getPathDisplayName(filePath) : '<no path>')
        const theme = themeManager.getThemeById(currentTheme)
        const syntaxStyle = theme?.type === 'light' ? vs : vscDarkPlus

        return (
            <div className="space-y-1 mt-1">
                <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
                    <FileCode className="w-3 h-3" />
                    <span className="font-medium text-text-primary transition-colors hover:underline cursor-pointer" title={paths.join('\n') || undefined}>
                        <TextWithFileLinks text={displayName} />
                    </span>
                </div>
                {stringResult ? (
                    <ExpandablePreviewContainer language={language}>
                        <SyntaxHighlighter
                            style={syntaxStyle}
                            language={filePath ? guessLanguage(filePath) : 'typescript'}
                            PreTag="div"
                            className="!bg-transparent !p-2 !m-0 !text-[12px] leading-relaxed font-mono"
                            customStyle={{ background: 'transparent', margin: 0, padding: 0, border: 'none', boxShadow: 'none', fontFamily: 'inherit' }}
                            wrapLines
                            wrapLongLines
                        >
                            {stringResult.slice(0, 5000)}
                        </SyntaxHighlighter>
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview('Reading file...')
                )}
            </div>
        )
    }

    if (effectiveName === 'read_url') {
        const url = asString(args.url)
        let hostname = '<no url>'
        if (url) {
            try {
                hostname = new URL(url).hostname
            } catch {
                hostname = url
            }
        }

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
                    <Search className="w-3 h-3" />
                    <a href={url} target="_blank" rel="noreferrer" className="text-text-primary font-medium hover:underline truncate hover:text-accent transition-colors">
                        {hostname}
                    </a>
                </div>
                {stringResult ? (
                    <ExpandablePreviewContainer language={language}>
                        <div className="p-2 text-[12px] text-text-secondary whitespace-pre-wrap break-all">
                            {stringResult.slice(0, 5000)}
                            {stringResult.length > 5000 && <span className="opacity-50 mt-1 block">... (truncated)</span>}
                        </div>
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview('Reading URL...')
                )}
            </div>
        )
    }

    if (['get_lint_errors', 'find_references', 'go_to_definition', 'get_hover_info', 'get_document_symbols'].includes(effectiveName)) {
        const path = getPrimaryToolPath(args)
        const line = typeof args.line === 'number' ? args.line : undefined

        return (
            <div className="space-y-1">
                <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
                    <FileCode className="w-3 h-3" />
                    <span className="font-medium text-text-primary transition-colors hover:underline cursor-pointer" title={path || undefined}>
                        <TextWithFileLinks text={getFileName(path) || '<unknown path>'} />
                    </span>
                    {line && <span className="text-text-muted/90">:{line}</span>}
                </div>
                {toolCall.result ? (
                    <ExpandablePreviewContainer language={language}>
                        <JsonHighlight data={toolCall.result} className="p-2 bg-transparent m-0" maxHeight="max-h-full" maxLength={3000} />
                    </ExpandablePreviewContainer>
                ) : (isRunning || isStreaming) && (
                    pendingPreview(t('tool.status.analyzingEllipsis', language as any))
                )}
            </div>
        )
    }

    const hasArgs = Object.keys(args).some(key => !key.startsWith('_'))
    const filteredArgs = Object.fromEntries(Object.entries(args).filter(([key]) => !key.startsWith('_')))

    return (
        <div className="space-y-1 mt-1 text-[12px]">
            {hasArgs && (
                <>
                    <div className="flex items-center gap-1.5 text-text-muted">
                        <FileCode className="w-3 h-3" />
                        <span>Arguments:</span>
                    </div>
                    <ExpandablePreviewContainer language={language} maxHeight="max-h-[150px]">
                        <JsonHighlight data={filteredArgs} className="p-2 bg-transparent m-0" maxHeight="max-h-full" maxLength={1500} />
                    </ExpandablePreviewContainer>
                </>
            )}
            {toolCall.richContent && toolCall.richContent.length > 0 && (
                <ExpandablePreviewContainer language={language}>
                    <div className="p-2">
                        <RichContentRenderer content={toolCall.richContent} maxHeight="max-h-full" />
                    </div>
                </ExpandablePreviewContainer>
            )}
            {toolCall.result && (!toolCall.richContent || toolCall.richContent.length === 0) && (
                <>
                    <div className="flex items-center justify-between gap-1.5 text-text-muted mt-2 group/title">
                        <div className="flex items-center gap-1.5">
                            <Terminal className="w-3 h-3" />
                            <span>Result:</span>
                        </div>
                        <button
                            onClick={event => {
                                event.stopPropagation()
                                onCopyResult()
                            }}
                            className="opacity-0 group-hover/title:opacity-100 transition-opacity p-0.5 hover:bg-surface-elevated rounded text-text-muted hover:text-text-primary"
                            title="Copy Result"
                        >
                            <Copy className="w-3 h-3" />
                        </button>
                    </div>
                    <ExpandablePreviewContainer language={language}>
                        <JsonHighlight data={toolCall.result} className="p-2 bg-transparent m-0" maxHeight="max-h-full" maxLength={3000} />
                    </ExpandablePreviewContainer>
                </>
            )}
            {!toolCall.result && (!toolCall.richContent || toolCall.richContent.length === 0) && (isRunning || isStreaming) && pendingPreview()}
        </div>
    )
}

const ToolCallCard = memo(function ToolCallCard({
    toolCall,
    isAwaitingApproval,
    onApprove,
    onReject,
    defaultExpanded,
}: ToolCallCardProps) {
    const { language, setTerminalVisible, currentTheme, expandAgentBlocksByDefault } = useStore(useShallow(state => ({
        language: state.language,
        setTerminalVisible: state.setTerminalVisible,
        currentTheme: state.currentTheme,
        expandAgentBlocksByDefault: state.agentConfig.expandAgentBlocksByDefault ?? false,
    })))
    const { args, effectiveName, isSuccess, isError, isRejected, isRunning, isStreaming } = useToolDisplayState(toolCall)
    const isActive = isRunning || isStreaming
    const { isExpanded, animateContent, handleToggleExpanded } = useToolCardExpansion({
        defaultExpanded: defaultExpanded ?? expandAgentBlocksByDefault,
        isActive,
    })

    const statusText = useMemo(
        () => getStatusText(effectiveName, args, toolCall.status, isStreaming, language),
        [effectiveName, args, toolCall.status, isStreaming, language]
    )

    const cardStyle = useMemo(() => {
        if (isAwaitingApproval) return 'border border-yellow-500/20 bg-yellow-500/5 rounded-lg shadow-sm shadow-yellow-500/5 overflow-hidden'
        if (isError) return 'bg-red-500/5 rounded-lg overflow-hidden'
        if (isStreaming || isRunning) return 'bg-accent/5 rounded-lg overflow-hidden'
        return 'hover:bg-text-primary/[0.02] transition-colors rounded-lg overflow-hidden'
    }, [isAwaitingApproval, isError, isStreaming, isRunning])

    const contentBody = (
        <div className="pl-[26px] pr-3 pb-3 pt-0 relative border-t-0">
            <div className="absolute left-[13.5px] top-0 bottom-4 w-[1.5px] bg-border/40 rounded-full" />

            <div className="relative z-10 space-y-2 mt-1">
                <ToolPreview
                    toolCall={toolCall}
                    args={args}
                    effectiveName={effectiveName}
                    isRunning={isRunning}
                    isStreaming={isStreaming}
                    language={language}
                    currentTheme={currentTheme}
                    onCopyResult={() => {
                        if (toolCall.result) {
                            navigator.clipboard.writeText(toolCall.result)
                        }
                    }}
                    setTerminalVisible={setTerminalVisible}
                />
                {toolCall.error && (
                    <div className="px-3 py-2 bg-red-500/10 rounded-md">
                        <div className="flex items-center gap-2 text-red-400 text-xs font-medium mb-1">
                            <AlertTriangle className="w-3 h-3" />
                            Error
                        </div>
                        <p className="text-[12px] text-red-300 font-mono break-all">{toolCall.error}</p>
                    </div>
                )}
            </div>
        </div>
    )

    return (
        <div className={`group my-0.5 relative ${cardStyle}`}>
            {(isStreaming || isRunning) && (
                <div className="absolute inset-0 pointer-events-none rounded-lg overflow-hidden">
                    <div className="absolute inset-0 w-[200%] h-full bg-gradient-to-r from-transparent via-accent/10 to-transparent tool-card-sweep" />
                </div>
            )}

            <div className="flex min-h-[32px] items-center gap-2 py-1.5 cursor-pointer select-none" onClick={handleToggleExpanded}>
                <motion.div animate={{ rotate: isExpanded ? 90 : 0 }} transition={{ duration: 0.15 }} className="shrink-0 text-text-muted/85 hover:text-text-muted">
                    <ChevronDown className="w-3.5 h-3.5 -rotate-90" />
                </motion.div>

                <div className="shrink-0 relative z-10 w-4 h-4 flex items-center justify-center">
                    {isStreaming || isRunning ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-accent/20 flex items-center justify-center border border-accent/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        </div>
                    ) : isSuccess ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-green-500/10 flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-green-500" />
                        </div>
                    ) : isError ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-red-500/10 flex items-center justify-center">
                            <X className="w-2.5 h-2.5 text-red-500" />
                        </div>
                    ) : isRejected ? (
                        <div className="w-3.5 h-3.5 rounded-full bg-yellow-500/10 flex items-center justify-center">
                            <X className="w-2.5 h-2.5 text-yellow-500" />
                        </div>
                    ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-text-muted/30" />
                    )}
                </div>

                <div className="flex-1 min-w-0 flex items-center gap-2 overflow-hidden relative z-10">
                    <span className={`text-[12px] truncate ${isStreaming || isRunning ? 'text-text-primary tool-text-shimmer' : 'text-text-secondary group-hover:text-text-primary transition-colors'}`}>
                        {statusText || (
                            <span className="opacity-50 inline-flex items-center gap-1.5">
                                <span>{TOOL_LABEL_KEYS[effectiveName] ? t(TOOL_LABEL_KEYS[effectiveName] as any, language as any) : effectiveName}</span>
                            </span>
                        )}
                    </span>
                </div>
            </div>

            {isExpanded && (
                animateContent ? (
                    <AnimatePresence initial={false}>
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.16, ease: 'easeOut' }}
                        >
                            {contentBody}
                        </motion.div>
                    </AnimatePresence>
                ) : (
                    contentBody
                )
            )}

            {isAwaitingApproval && (
                <div className="flex items-center justify-end gap-2 px-3 py-2 border-t border-yellow-500/10 bg-yellow-500/5">
                    <button onClick={onReject} className="px-3 py-1.5 text-xs font-medium text-text-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all">
                        {t('toolReject', language as any)}
                    </button>
                    <button onClick={onApprove} className="px-3 py-1.5 text-xs font-medium bg-accent text-white hover:bg-accent-hover rounded-md transition-all">
                        {t('toolApprove', language as any)}
                    </button>
                </div>
            )}
        </div>
    )
})

export default ToolCallCard
