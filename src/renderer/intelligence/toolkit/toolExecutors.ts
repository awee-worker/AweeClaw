/**
 * 工具执行器实现
 * 所有内置工具的执行逻辑
 */

import { api } from '../../adapters/electronBridge'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { resolveEditFileRequest } from '@toolkit/fileEditor'
import { resolveReadFileRequest } from '@toolkit/fileReader'
import { logger } from '@toolkit/LogEngine'
import type { ToolExecutionResult, ToolExecutionContext } from '@intelligence/providerTypes'
import { PLAN_DIR_NAME } from '@intelligence/providerTypes'
import {
    buildPlanFromToolArgs,
    buildAddedTask,
    applyUpdateEdges,
    type PlanTaskArg,
    type PlanEdgeArg,
} from './planBuilder'
import { validatePath, isSensitivePath, platform, getDirname } from '@shared/toolkit/pathHelper'
import { pathToLspUri } from '@shared/toolkit/uriHelper'
import { waitForDiagnostics, isLanguageSupported, getLanguageId, didOpenDocument } from '@services/languageServerAdapter'
import {
    calculateLineChanges,
} from '@utils/searchReplace'
import { smartReplace, normalizeLineEndings, checkLineReplaceWarnings } from '@utils/smartReplace'
import { resolveAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { BRAND } from '@shared/brand'
import { fileCacheService } from '../runtime/fileCacheManager'
import { getReadStrategy, buildReadTruncationMessage } from './fileReadPolicies'
import { lintService } from '../runtime/codeAnalysisService'
import { memoryService } from '../runtime/recallService'
import { knowledgeService } from '../runtime/knowledgeService'
import type { KnowledgeCategory, KnowledgeEntry } from '@intelligence/providerTypes'
import { useStore } from '@store'
import { composerService } from '../runtime/composerEngine'
import { agentStorePlanBridge, agentStoreTodoBridge } from '../state/intelligenceBridge'
import { useAgentStore } from '../state/IntelligenceStore'
import { buildFileChangeDescriptor } from '@intelligence/utils/fileMutationHelper'
import { EventBus } from '../engine/EventDispatcher'
import { isLongRunningCommand } from './commandExecutor'
import { internalWriteTracker } from '@services/writeTracker'
import { toolRegistry } from './toolRegistry'
import { terminalManager } from '@services/TerminalAdapter'
import { isDangerousCommand, matchDangerousCommand } from '@shared/configuration/dangerousCommands'
import pLimit from 'p-limit'
import { skillService } from '../runtime/skillRepository'
import type { Language } from '@renderer/i18n'
import type { ReplaceErrorCode } from '@utils/smartReplace'
import { resolveAgentLanguage, pickLocalizedText, translateAgentText } from '@intelligence/utils/intelligenceTextUtils'
import { guardWriteFile } from './fileWritePolicy'
import { executeAddNode, executeAddEdge } from './graphToolExecutors'
import {
    extractDocumentLocal,
    extractDocumentViaBackendStream,
} from './documentExtractor'

// ===== 辅助函数 =====

function getLocalizedText(language: Language, zh: string, en: string): string {
    return pickLocalizedText(zh, en, language as 'en' | 'zh')
}

function getCurrentLanguage(): Language {
    return resolveAgentLanguage() as Language
}

function translate(key: string, params?: Record<string, string | number>): string {
    return translateAgentText(key, params)
}

function getReplaceErrorMessage(errorCode?: ReplaceErrorCode): string {
    switch (errorCode) {
        case 'IDENTICAL_STRINGS':
            return translate('agent.tool.edit.identicalStrings')
        case 'MISSING_OLD_STRING':
            return translate('agent.tool.edit.missingOldString')
        case 'MULTIPLE_MATCHES':
            return translate('agent.tool.edit.multipleMatches')
        case 'OLD_STRING_NOT_FOUND':
            return translate('agent.tool.edit.oldStringNotFound')
        default:
            return translate('agent.tool.edit.replaceFailed')
    }
}

async function checkParentPathNotFile(filePath: string): Promise<string | null> {
    const parentDir = getDirname(filePath)
    if (!parentDir || parentDir === filePath) return null

    try {
        const entries = await api.file.readDir(parentDir)
        const targetName = filePath.split(/[/\\]/).pop()!
        const entry = entries?.find(e => e.name === targetName || e.path === filePath)
        if (entry && !entry.isDirectory) {
            return `Path conflict: "${targetName}" already exists as a file (not a directory) in "${parentDir}". You cannot create files inside a file. To fix this: 1) Delete the existing file "${filePath}" first, then recreate it as a directory using create_file_or_folder with a trailing "/"; or 2) Use a different path.`
        }
    } catch {
    }

    const pathParts = filePath.split(/[/\\]/)
    for (let i = 1; i < pathParts.length - 1; i++) {
        const checkPath = pathParts.slice(0, i + 1).join('/')
        try {
            const exists = await api.file.exists(checkPath)
            if (exists) {
                const readResult = await api.file.read(checkPath)
                if (readResult !== null && readResult !== undefined) {
                    return `Path conflict: "${checkPath}" is a file, not a directory. You are trying to write to "${filePath}" but "${checkPath}" is a regular file. To fix this: 1) Delete "${checkPath}" first; 2) Create it as a directory using create_file_or_folder with path "${checkPath}/"; 3) Then write files inside it.`
                }
            }
        } catch {
        }
    }

    return null
}

async function checkWriteFailureReason(filePath: string): Promise<string> {
    const parentConflict = await checkParentPathNotFile(filePath)
    if (parentConflict) return parentConflict

    try {
        const parentDir = getDirname(filePath)
        if (parentDir) {
            const parentExists = await api.file.exists(parentDir)
            if (!parentExists) {
                return `Parent directory "${parentDir}" does not exist and could not be created. Try creating it first using create_file_or_folder with a trailing "/".`
            }
        }
    } catch {
    }

    return 'Write failed due to an unknown error. Check that the path is valid and you have write permissions.'
}

/**
 * 文件写入后通知 LSP 并等待诊断
 *
 * 关键：必须先 didOpen/didChange 让 LSP 感知文件内容，
 * 否则 LSP 不会为未打开的文件推送诊断。
 */
async function notifyLspAfterWrite(filePath: string, newContent?: string): Promise<void> {
    const languageId = getLanguageId(filePath)
    if (!isLanguageSupported(languageId)) return

    try {
        if (newContent !== undefined) {
            await didOpenDocument(filePath, newContent)
        }
        if (newContent !== undefined && shouldTreatAsLargeWrite(null, newContent)) {
            return
        }
        waitForDiagnostics(filePath).catch(() => {})
    } catch {
    }
}

/**
 * 文件变更后通知 composerService（行内预览集成）
 */
function notifyComposerChange(opts: {
    filePath: string
    workspacePath: string
    oldContent: string | null
    newContent: string | null
    changeType: 'create' | 'modify' | 'delete'
    linesAdded: number
    linesRemoved: number
    isLargeWrite?: boolean
    contentTruncated?: boolean
    oldContentLength?: number
    newContentLength?: number
    toolCallId?: string
}): void {
    composerService.ensureSession()
    composerService.addChange(buildFileChangeDescriptor({
        filePath: opts.filePath,
        workspacePath: opts.workspacePath,
        oldContent: opts.oldContent,
        newContent: opts.newContent,
        changeType: opts.changeType,
        linesAdded: opts.linesAdded,
        linesRemoved: opts.linesRemoved,
        isLargeWrite: opts.isLargeWrite,
        contentTruncated: opts.contentTruncated,
        oldContentLength: opts.oldContentLength,
        newContentLength: opts.newContentLength,
        toolCallId: opts.toolCallId,
    }))
    notifyWorkspaceTreeChange({
        workspacePath: opts.workspacePath,
        targetPath: opts.filePath,
        changeType: opts.changeType,
    })
}

function dispatchWorkspaceFilesChanged(opts: {
    workspacePath: string
    targetPath: string
    changeType: 'create' | 'modify' | 'delete'
    isDirectory?: boolean
}): void {
    const parentPath = getDirname(opts.targetPath)
    const affectedPaths = new Set<string>()

    if (parentPath) {
        affectedPaths.add(parentPath)
    }

    if (opts.isDirectory && opts.changeType === 'create') {
        affectedPaths.add(opts.targetPath)
    }

    if (opts.workspacePath && parentPath === opts.workspacePath) {
        affectedPaths.add(opts.workspacePath)
    }

    window.dispatchEvent(new CustomEvent('workspace:files-changed', {
        detail: {
            affectedPaths: Array.from(affectedPaths),
            deletedPaths: opts.changeType === 'delete' ? [opts.targetPath] : [],
            refreshRoot: Boolean(opts.workspacePath && parentPath === opts.workspacePath),
        },
    }))
}

function notifyWorkspaceTreeChange(opts: {
    workspacePath: string
    targetPath: string
    changeType: 'create' | 'modify' | 'delete'
    isDirectory?: boolean
}): void {
    if (typeof window === 'undefined' || !opts.targetPath) return

    // Windows 文件系统存在写入后延迟可见的问题：
    // writeFileSync 返回后，readdir 可能暂时读不到新文件，
    // 导致工作区目录刷新后仍看不到刚写入的文件。
    // 解决方案：Windows 上延迟派发事件给文件系统 flush 时间，
    // 并在更长延迟后二次刷新作为兜底，确保文件最终可见。
    if (platform.isWindows) {
        // 首次刷新：等待 150ms 让文件系统完成 flush
        setTimeout(() => dispatchWorkspaceFilesChanged(opts), 150)
        // 二次兜底刷新：600ms 后再刷一次，覆盖 flush 较慢的情况
        setTimeout(() => dispatchWorkspaceFilesChanged(opts), 600)
        return
    }

    dispatchWorkspaceFilesChanged(opts)
}

interface DirTreeNode {
    name: string
    path: string
    isDirectory: boolean
    children?: DirTreeNode[]
}

async function buildDirTree(dirPath: string, maxDepth: number, currentDepth = 0): Promise<DirTreeNode[]> {
    if (currentDepth >= maxDepth) return []

    const items = await api.file.readDir(dirPath)
    if (!items) return []

    const ignoreDirs = resolveAgentConfig().ignoredDirectories

    const nodes: DirTreeNode[] = []
    for (const item of items) {
        if (item.name.startsWith('.') && item.name !== '.env') continue
        if (ignoreDirs.includes(item.name)) continue

        const node: DirTreeNode = { name: item.name, path: item.path, isDirectory: item.isDirectory }
        if (item.isDirectory && currentDepth < maxDepth - 1) {
            node.children = await buildDirTree(item.path, maxDepth, currentDepth + 1)
        }
        nodes.push(node)
    }

    return nodes.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
        return a.name.localeCompare(b.name)
    })
}

function formatDirTree(nodes: DirTreeNode[], prefix = ''): string {
    let result = ''
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i]
        const isLast = i === nodes.length - 1
        result += `${prefix}${isLast ? '└── ' : '├── '}${node.isDirectory ? '📁 ' : '📄 '}${node.name}\n`
        if (node.children?.length) {
            result += formatDirTree(node.children, prefix + (isLast ? '    ' : '│   '))
        }
    }
    return result
}

function resolvePath(p: unknown, workspacePath: string | null, allowRead = false): string {
    if (typeof p !== 'string') throw new Error('Invalid path: not a string')
    const validation = validatePath(p, workspacePath, { allowSensitive: false, allowOutsideWorkspace: false })
    if (!validation.valid) throw new Error(`Security: ${validation.error}`)
    if (!allowRead && isSensitivePath(validation.sanitizedPath!)) {
        throw new Error('Security: Cannot modify sensitive files')
    }
    return validation.sanitizedPath!
}

function hashContent(content: string | null): string {
    const input = content ?? '__NULL__'
    let hash = 2166136261
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i)
        hash = Math.imul(hash, 16777619)
    }
    return (hash >>> 0).toString(16).padStart(8, '0')
}

const LARGE_WRITE_CHAR_THRESHOLD = 120_000
const LARGE_WRITE_TOTAL_CHAR_THRESHOLD = 200_000
const LARGE_META_PREVIEW_CHARS = 4_000

function countLinesFast(content: string | null | undefined): number {
    if (!content) return 0

    let count = 1
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) count++
    }
    return count
}

function getApproxLineChanges(oldContent: string, newContent: string): { added: number; removed: number } {
    const oldLines = countLinesFast(oldContent)
    const newLines = countLinesFast(newContent)
    return {
        added: Math.max(0, newLines - oldLines),
        removed: Math.max(0, oldLines - newLines),
    }
}

function shouldTreatAsLargeWrite(oldContent: string | null, newContent: string): boolean {
    const oldLength = oldContent?.length || 0
    const newLength = newContent.length
    return (
        oldLength >= LARGE_WRITE_CHAR_THRESHOLD ||
        newLength >= LARGE_WRITE_CHAR_THRESHOLD ||
        oldLength + newLength >= LARGE_WRITE_TOTAL_CHAR_THRESHOLD
    )
}

function buildMetaContent(content: string | null | undefined, isLargeWrite: boolean): string | null {
    if (content === null || content === undefined) return null
    if (!isLargeWrite || content.length <= LARGE_META_PREVIEW_CHARS) return content
    return `${content.slice(0, LARGE_META_PREVIEW_CHARS)}\n\n/* content truncated for preview */`
}

function buildWriteMeta(
    filePath: string,
    oldContent: string | null,
    newContent: string | null,
    lineChanges: { added: number; removed: number },
    hashes: { preHash: string; postHash: string },
    extra: Record<string, unknown> = {}
): Record<string, unknown> {
    const isLargeWrite = shouldTreatAsLargeWrite(oldContent, newContent || '')

    return {
        filePath,
        oldContent: buildMetaContent(oldContent, isLargeWrite),
        newContent: buildMetaContent(newContent, isLargeWrite),
        linesAdded: lineChanges.added,
        linesRemoved: lineChanges.removed,
        preHash: hashes.preHash,
        postHash: hashes.postHash,
        isLargeWrite,
        contentTruncated: isLargeWrite,
        oldContentLength: oldContent?.length || 0,
        newContentLength: newContent?.length || 0,
        ...extra,
    }
}

function getLineChangesForWrite(oldContent: string, newContent: string): { added: number; removed: number } {
    if (shouldTreatAsLargeWrite(oldContent, newContent)) {
        return getApproxLineChanges(oldContent, newContent)
    }
    return calculateLineChanges(oldContent, newContent)
}

function getWritePreviewFlags(oldContent: string | null, newContent: string | null): {
    isLargeWrite: boolean
    contentTruncated: boolean
    oldContentLength: number
    newContentLength: number
} {
    const isLargeWrite = shouldTreatAsLargeWrite(oldContent, newContent || '')
    return {
        isLargeWrite,
        contentTruncated: isLargeWrite,
        oldContentLength: oldContent?.length || 0,
        newContentLength: newContent?.length || 0,
    }
}

function getPathSeparator(basePath: string): string {
    return basePath.includes('\\') ? '\\' : '/'
}

function joinPath(basePath: string, ...parts: string[]): string {
    const sep = getPathSeparator(basePath)
    const trimmedBase = basePath.replace(/[\\/]+$/, '')
    const trimmedParts = parts.map(part => part.replace(/^[\\/]+|[\\/]+$/g, ''))
    return [trimmedBase, ...trimmedParts].join(sep)
}

type InlineScriptRuntime = 'python' | 'node' | 'powershell' | 'sh'

interface InlineScriptCommand {
    runtime: InlineScriptRuntime
    executable: string
    script: string
    extension: string
    args: string[]
}

function unwrapInlineScript(script: string): string {
    const trimmed = script.trim()
    if (!trimmed) return trimmed

    if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
        const quote = trimmed[0]
        const inner = trimmed.slice(1, -1)
        if (quote === '"') {
            return inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
        }
        return inner.replace(/''/g, "'")
    }

    return trimmed
}

function parseInlineScriptCommand(command: string): InlineScriptCommand | null {
    const patterns: Array<{
        regex: RegExp
        runtime: InlineScriptRuntime
        extension: string
        executable?: (raw: string) => string
        args: (tempFile: string, executable: string) => string[]
    }> = [
        {
            regex: /^\s*(python(?:\d+(?:\.\d+)*)?|python3|py(?:\s+-\d+(?:\.\d+)*)?)\s+-c\s+([\s\S]+?)\s*$/i,
            runtime: 'python',
            extension: '.py',
            executable: raw => raw.trim().toLowerCase().startsWith('py') ? 'python' : raw.trim(),
            args: tempFile => [tempFile],
        },
        {
            regex: /^\s*(node(?:\.exe)?)\s+-e\s+([\s\S]+?)\s*$/i,
            runtime: 'node',
            extension: '.js',
            args: tempFile => [tempFile],
        },
        {
            regex: /^\s*(powershell(?:\.exe)?|pwsh(?:\.exe)?)\s+-(?:Command|c)\s+([\s\S]+?)\s*$/i,
            runtime: 'powershell',
            extension: '.ps1',
            args: (tempFile, executable) => executable.toLowerCase().startsWith('powershell')
                ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tempFile]
                : ['-NoProfile', '-File', tempFile],
        },
        {
            regex: /^\s*(bash|sh)\s+-c\s+([\s\S]+?)\s*$/i,
            runtime: 'sh',
            extension: '.sh',
            args: tempFile => [tempFile],
        },
    ]

    for (const pattern of patterns) {
        const match = command.match(pattern.regex)
        if (!match) continue

        const rawExecutable = match[1].trim()
        const executable = pattern.executable ? pattern.executable(rawExecutable) : rawExecutable
        return {
            runtime: pattern.runtime,
            executable,
            script: unwrapInlineScript(match[2]),
            extension: pattern.extension,
            args: pattern.args('__TEMP_FILE__', executable),
        }
    }

    return null
}

async function runInlineScriptViaTempFile(
    command: string,
    ctx: ToolExecutionContext,
    timeout: number
): Promise<ToolExecutionResult | null> {
    const parsed = parseInlineScriptCommand(command)
    if (!parsed) return null

    if (parsed.runtime === 'python') {
        const dependencies = extractPythonDependencies(parsed.script)
        const result = await api.python.executeInlineScript({
            script: parsed.script,
            dependencies,
            cwd: ctx.workspacePath || undefined,
            timeout,
        })

        const output = (result.stdout || result.stderr || '').trim()
        const resultText = output || (result.success ? 'Command executed successfully (no output)' : `Command failed${result.exitCode != null ? ` (exit code ${result.exitCode})` : ''}`)

        return {
            success: result.success,
            result: resultText,
            error: result.success ? undefined : (result.error || resultText),
            meta: {
                command,
                cwd: ctx.workspacePath || undefined,
                exitCode: result.exitCode,
                executionMode: 'uv-run-inline-python',
            }
        }
    }

    const baseDir = ctx.workspacePath || await api.settings.getUserDataPath()
    const tempDir = joinPath(baseDir, BRAND.dirName, 'agent-temp')
    const tempFile = joinPath(
        tempDir,
        `inline-${parsed.runtime}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${parsed.extension}`
    )

    try {
        await api.file.ensureDir(tempDir)
        const writeOk = await api.file.write(tempFile, parsed.script)
        if (!writeOk) {
            return {
                success: false,
                result: `Error: Failed to prepare temporary ${parsed.runtime} script at ${tempFile}`,
                error: `Failed to prepare temporary ${parsed.runtime} script`,
            }
        }

        const execResult = await api.shell.executeSecure({
            command: parsed.executable,
            args: parsed.args.map(arg => arg === '__TEMP_FILE__' ? tempFile : arg),
            cwd: ctx.workspacePath || undefined,
            timeout,
            requireConfirm: false,
        })

        const output = (execResult.output || execResult.errorOutput || '').trim()
        const resultText = output || (execResult.success ? 'Command executed successfully (no output)' : `Command failed${execResult.exitCode != null ? ` (exit code ${execResult.exitCode})` : ''}`)

        return {
            success: !!execResult.success,
            result: resultText,
            error: execResult.success ? undefined : (execResult.error || resultText),
            meta: {
                command,
                cwd: ctx.workspacePath || undefined,
                exitCode: execResult.exitCode,
                executionMode: `inline-${parsed.runtime}-temp-file`,
                tempFile,
            }
        }
    } finally {
        try {
            await api.file.delete(tempFile)
        } catch {
            // Best-effort cleanup for temp scripts.
        }
    }
}

const PYTHON_IMPORT_TO_PACKAGE: Record<string, string> = {
    pandas: 'pandas',
    pd: 'pandas',
    numpy: 'numpy',
    np: 'numpy',
    openpyxl: 'openpyxl',
    xlrd: 'xlrd',
    xlwt: 'xlwt',
    matplotlib: 'matplotlib',
    plt: 'matplotlib',
    seaborn: 'sns',
    scipy: 'scipy',
    sklearn: 'scikit-learn',
    requests: 'requests',
    beautifulsoup4: 'bs4',
    bs4: 'beautifulsoup4',
    pillow: 'PIL',
    PIL: 'pillow',
    plotly: 'plotly',
    sympy: 'sympy',
    statsmodels: 'statsmodels',
    sqlalchemy: 'sqlalchemy',
    psycopg2: 'psycopg2-binary',
}

function extractPythonDependencies(script: string): string[] {
    const deps = new Set<string>()
    const importRegex = /^\s*(?:from|import)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm
    let match: RegExpExecArray | null
    while ((match = importRegex.exec(script)) !== null) {
        const mod = match[1]
        const pkg = PYTHON_IMPORT_TO_PACKAGE[mod]
        if (pkg) deps.add(pkg)
    }
    return Array.from(deps)
}

async function tryRunPythonFile(
    command: string,
    ctx: ToolExecutionContext,
    timeout: number
): Promise<ToolExecutionResult | null> {
    const pythonFilePattern = /^\s*(python(?:\d+(?:\.\d+)*)?|python3|py)\s+([^\s;|&<>]+\.py(?:\s+[^\s;|&<>]*)*)\s*$/i
    const match = command.match(pythonFilePattern)
    if (!match) return null

    const parts = match[2].trim().split(/\s+/)
    const scriptPath = parts[0]
    const scriptArgs = parts.slice(1)

    const resolvedScript = resolvePath(scriptPath, ctx.workspacePath, false)

    const result = await api.python.executeScript({
        scriptPath: resolvedScript,
        args: scriptArgs,
        cwd: ctx.workspacePath || undefined,
        timeout,
    })

    const output = (result.stdout || result.stderr || '').trim()
    const resultText = output || (result.success ? 'Command executed successfully (no output)' : `Command failed${result.exitCode != null ? ` (exit code ${result.exitCode})` : ''}`)

    return {
        success: result.success,
        result: resultText,
        error: result.success ? undefined : (result.error || resultText),
        meta: {
            command,
            cwd: ctx.workspacePath || undefined,
            exitCode: result.exitCode,
            executionMode: 'uv-run-python-file',
            scriptPath: resolvedScript,
        }
    }
}

async function guardedWriteFile(opts: {
    path: string
    nextContent: string
    originalContent: string | null
    staleMessage?: string
    skipStaleCheck?: boolean
}): Promise<
    | { success: true; meta: { preHash: string; postHash: string } }
    | { success: false; result: ToolExecutionResult }
> {
    const originalHash = hashContent(opts.originalContent)
    if (!opts.skipStaleCheck) {
        const currentContent = await api.file.read(opts.path)
        const currentHash = hashContent(currentContent)

        if (currentHash !== originalHash) {
            return {
                success: false,
                result: {
                    success: false,
                    result: '',
                    error: opts.staleMessage || 'Write conflict detected: file changed since it was read',
                    outcome: { kind: 'conflict', code: 'STALE_WRITE', retryable: false },
                    envelope: { executionId: crypto.randomUUID(), startedAt: Date.now(), completedAt: Date.now(), errorCategory: 'conflict', retryable: false },
                    meta: {
                        filePath: opts.path,
                        preHash: originalHash,
                        currentHash,
                    }
                }
            }
        }
    }

    internalWriteTracker.mark(opts.path)
    const success = await api.file.write(opts.path, opts.nextContent)
    if (!success) {
        const reason = await checkWriteFailureReason(opts.path)
        return {
            success: false,
            result: {
                success: false,
                result: '',
                error: reason,
            }
        }
    }

    return {
        success: true,
        meta: {
            preHash: originalHash,
            postHash: hashContent(opts.nextContent),
        }
    }
}


const rawToolExecutors: Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>> = {
    async read_file(args, ctx) {
        const BINARY_EXT_SET = new Set([
            'xlsx', 'xls', 'xlsm', 'xlsb',
            'docx', 'doc', 'pptx', 'ppt',
            'pdf', 'odt', 'ods', 'odp',
            'zip', 'tar', 'gz', 'rar', '7z', 'bz2',
            'exe', 'dll', 'so', 'dylib',
            'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'webp',
            'mp3', 'mp4', 'wav', 'avi', 'mov', 'mkv',
            'db', 'sqlite', 'sqlite3',
        ])

        function isBinaryPath(p: string): boolean {
            const ext = p.split('.').pop()?.toLowerCase() || ''
            return BINARY_EXT_SET.has(ext)
        }

        // 支持单个文件或多个文件
        const resolution = resolveReadFileRequest(args)
        if (!resolution.ok) {
            return { success: false, result: '', error: `Validation failed: ${resolution.error}` }
        }

        const paths = resolution.mode === 'multi' ? resolution.args.paths : [resolution.args.path]

        // 如果是多个文件，使用并行读取
        if (paths.length > 1) {
            const limit = pLimit(5)

            const results = await Promise.all(
                paths.map(p => limit(async () => {
                    try {
                        const validPath = resolvePath(p, ctx.workspacePath, true)
                        if (isBinaryPath(validPath)) {
                            const ext = validPath.split('.').pop()?.toUpperCase() || 'BINARY'
                            return `\n--- File: ${p} ---\n[Binary file: ${ext} format. Cannot read as text.]\n`
                        }
                        const content = await api.file.read(validPath)
                        if (content !== null && content !== undefined) {
                            fileCacheService.markFileAsRead(validPath, content)
                            let graphContent = ''
                            try {
                                const nodes = await api.index.parseCallGraph(validPath, content)
                                if (nodes && nodes.length > 0) {
                                    graphContent = '\n--- AST Call Graph Summary ---\n'
                                    const defs = nodes.filter(n => n.type === 'definition')
                                    const calls = nodes.filter(n => n.type === 'call')
                                    for (const def of defs) {
                                        const relatedCalls = calls.filter(c => c.callerName === def.name).map(c => c.name)
                                        const callStr = relatedCalls.length > 0 ? ` (calls: ${Array.from(new Set(relatedCalls)).join(', ')})` : ''
                                        graphContent += `- func ${def.name}() [Line ${def.startLine}-${def.endLine}]${callStr}\n`
                                    }
                                }
                            } catch (e) { logger.tool.warn('Failed to parse call graph for file:', e) }
                            return `\n--- File: ${p} ---\n${content}\n${graphContent}\n`
                        }
                        return `\n--- File: ${p} ---\n[File not found]\n`
                    } catch (e: unknown) {
                        return `\n--- File: ${p} ---\n[Error: ${(e as Error).message}]\n`
                    }
                }))
            )

            return { success: true, result: results.join('') }
        }

        // 单个文件读取（原有逻辑）
        const path = resolvePath(paths[0], ctx.workspacePath, true)

        if (isBinaryPath(path)) {
            const ext = path.split('.').pop()?.toUpperCase() || 'BINARY'
            return {
                success: true,
                result: `[Binary file: ${ext} format. Cannot read as text.]`,
                meta: { filePath: path },
            }
        }

        const content = await api.file.read(path)
        if (content === null || content === undefined) return { success: false, result: '', error: `File not found: ${path}` }

        fileCacheService.markFileAsRead(path, content)

        let graphContent = ''
        try {
            const nodes = await api.index.parseCallGraph(path, content)
            if (nodes && nodes.length > 0) {
                graphContent = '\n\n--- AST Call Graph Summary ---\n'
                const defs = nodes.filter(n => n.type === 'definition')
                const calls = nodes.filter(n => n.type === 'call')
                for (const def of defs) {
                    const relatedCalls = calls.filter(c => c.callerName === def.name).map(c => c.name)
                    const callStr = relatedCalls.length > 0 ? ` (calls: ${Array.from(new Set(relatedCalls)).join(', ')})` : ''
                    graphContent += `- func ${def.name}() [Line ${def.startLine}-${def.endLine}]${callStr}\n`
                }
            }
        } catch (e) { logger.tool.warn('Failed to build call graph:', e) }

        // 将文件内容拆分为行数组
        const lines = content.split('\n')

        // 根据文件类型获取读取策略
        const hasExplicitLineRange = resolution.mode === 'single' && (
            typeof resolution.args.start_line === 'number' || typeof resolution.args.end_line === 'number'
        )
        const config = resolveAgentConfig()
        const strategy = getReadStrategy({
            path,
            baseMaxChars: config.maxSingleFileChars,
            hasExplicitLineRange: !!hasExplicitLineRange,
        })

        const startLine = resolution.mode === 'single' && typeof resolution.args.start_line === 'number'
            ? Math.max(1, resolution.args.start_line)
            : 1
        const endLine = resolution.mode === 'single' && typeof resolution.args.end_line === 'number'
            ? Math.min(lines.length, resolution.args.end_line)
            : lines.length

        // 根据策略决定是否添加行号
        let displayContent: string
        if (strategy.includeLineNumbers) {
            displayContent = lines.slice(startLine - 1, endLine).map((line: string, i: number) => `${startLine + i}: ${line}`).join('\n')
        } else {
            displayContent = lines.slice(startLine - 1, endLine).join('\n')
        }

        // 使用策略中的 maxChars 限制输出大小
        if (displayContent.length > strategy.maxChars) {
            const visibleLines = endLine - startLine + 1
            displayContent = displayContent.slice(0, strategy.maxChars) +
                buildReadTruncationMessage(strategy, visibleLines, lines.length)
        }

        // 根据策略决定是否附加 AST 摘要
        const finalGraphContent = strategy.includeAstSummary ? graphContent : ''

        return { success: true, result: displayContent + finalGraphContent, meta: { filePath: path } }
    },

    async list_directory(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const recursive = args.recursive as boolean | undefined
        const maxDepth = (args.max_depth as number) || 3

        if (recursive) {
            // 递归模式（原 get_dir_tree）
            const tree = await buildDirTree(path, maxDepth)
            const result = formatDirTree(tree)
            logger.agent.info(`[list_directory] Recursive: Path: ${path}, Tree nodes: ${tree.length}, Result length: ${result.length}`)
            return { success: true, result: result || 'Empty directory tree' }
        } else {
            // 非递归模式（原 list_directory）
            const items = await api.file.readDir(path)
            if (!items) return { success: false, result: '', error: `Directory not found: ${path}` }
            const result = items.map(item => `${item.isDirectory ? '📁' : '📄'} ${item.name}`).join('\n')
            logger.agent.info(`[list_directory] Non-recursive: Path: ${path}, Items: ${items.length}, Result length: ${result.length}`)
            return { success: true, result: result || 'Empty directory' }
        }
    },

    /**
     * 文档提取工具：从 PDF/Word/Excel/PPT/TXT 等二进制文档格式提取文本内容
     *
     * 三层调用架构：
     * 1. 客户端本地提取（IPC 调用 main 进程的原生库）
     * 2. 本地失败 → 后端流式兜底（POST /api/v1/document-extract/stream，SSE）
     *    ↳ 流式不可用自动回退到非流式 POST /api/v1/document-extract
     * 3. 后端返回空内容 → 提示用户可能需 OCR
     *
     * 返回轻量 Markdown + 元信息（字符数/页数/工作表/OCR 标记/耗时）
     */
    async extract_document(args, ctx) {
        const rawPath = args.file_path as string
        if (!rawPath) {
            return { success: false, result: '', error: 'file_path is required' }
        }

        const filePath = resolvePath(rawPath, ctx.workspacePath, false)
        const ext = filePath.split('.').pop()?.toLowerCase() || ''
        const startTime = Date.now()

        /** 支持的文档格式白名单 */
        const SUPPORTED = new Set(['pdf', 'docx', 'doc', 'xlsx', 'xls', 'csv', 'ppt', 'pptx', 'txt', 'md'])
        if (!SUPPORTED.has(ext)) {
            return {
                success: false,
                result: '',
                error: `Unsupported format: .${ext}. Supported: pdf, docx, doc, xlsx, xls, csv, ppt, pptx, txt, md`,
            }
        }

        // ── 阶段一：客户端本地提取 ──
        const localResult = await extractDocumentLocal(filePath, ext, startTime)
        if (localResult.success) {
            return localResult
        }

        // ── 阶段二：后端流式兜底提取（含 OCR + Redis 缓存） ──
        logger.agent.info(`[extract_document] Local failed, trying backend stream fallback: ${filePath}`)
        const backendResult = await extractDocumentViaBackendStream(filePath, ext, startTime)
        if (backendResult.success) {
            return backendResult
        }

        // ── 阶段三：均失败 → 返回本地错误（含 OCR 提示） ──
        return localResult
    },

    async search_files(args, ctx) {
        const pathArg = args.path as string
        const resolvedPath = resolvePath(pathArg, ctx.workspacePath, true)
        const pattern = args.pattern as string
        // 自动启用 regex 模式（如果包含 | 符号）
        const isRegex = !!args.is_regex || pattern.includes('|')

        // 判断是文件还是目录：尝试读取目录内容，如果失败则认为是文件
        const dirItems = await api.file.readDir(resolvedPath)
        const isDirectory = dirItems !== null

        if (!isDirectory) {
            // 单文件搜索模式（替代原 search_in_file）
            const content = await api.file.read(resolvedPath)
            if (content === null || content === undefined) return { success: false, result: '', error: `File not found: ${resolvedPath}` }

            // 验证正则表达式
            if (isRegex) {
                try {
                    new RegExp(pattern)
                } catch (e) {
                    return { success: false, result: '', error: `Invalid regular expression: ${(e as Error).message}` }
                }
            }

            const matches: string[] = []
            const searchRegex = isRegex ? new RegExp(pattern, 'gi') : null

            content.split('\n').forEach((line, index) => {
                let matched: boolean
                if (searchRegex) {
                    searchRegex.lastIndex = 0
                    matched = searchRegex.test(line)
                } else {
                    matched = line.toLowerCase().includes(pattern.toLowerCase())
                }
                if (matched) matches.push(`${pathArg}:${index + 1}: ${line.trim()}`)
            })

            return {
                success: true,
                result: matches.length
                    ? `Found ${matches.length} matches:\n${matches.slice(0, 100).join('\n')}`
                    : `No matches found for "${pattern}"`
            }
        }

        // 目录搜索模式（原有逻辑）
        const results = await api.file.search(pattern, resolvedPath, {
            isRegex,
            include: args.file_pattern as string | undefined,
            isCaseSensitive: false
        })
        if (!results) return { success: false, result: '', error: 'Search failed' }
        return { success: true, result: results.slice(0, 50).map(r => `${r.path}:${r.line}: ${r.text.trim()}`).join('\n') || 'No matches found' }
    },

    async edit_file(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath)

        // 发送文件正在编写事件，触发自动打开预览
        EventBus.emit({ type: 'file:writing', filePath: path, workspacePath: ctx.workspacePath || '' })

        const originalContent = await api.file.read(path)
        if (originalContent === null || originalContent === undefined) return { success: false, result: '', error: `File not found: ${path}. Use write_file to create new files.` }

        const resolution = resolveEditFileRequest(args)

        // 判断使用哪种模式：content 单独存在时不触发 line mode（保持与 validate 逻辑一致）
        if (!resolution.ok) {
            return { success: false, result: '', error: `Validation failed: ${resolution.error}` }
        }

        const hasBatchMode = resolution.mode === 'batch'
        const hasLineMode = resolution.mode === 'line'

        // 🎯 Fast-Edit 精华：批量编辑模式
        if (hasBatchMode) {
            const { edits } = resolution.args

            // 验证缓存
            if (!fileCacheService.hasValidCache(path)) {
                logger.agent.warn(`[edit_file] File ${path} not in cache, line numbers may be inaccurate`)
            }

            let lines = originalContent.split('\n')

            // 🎯 关键优化：从后往前排序，避免行号偏移
            const sortedEdits = [...edits].sort((a, b) => {
                const aLine = a.start_line || a.after_line || 0
                const bLine = b.start_line || b.after_line || 0
                return bLine - aLine
            })

            // 🎯 检测重叠编辑
            const getEditRange = (edit: typeof edits[0]): [number, number] => {
                if (edit.action === 'replace' || edit.action === 'delete') {
                    return [edit.start_line!, edit.end_line!]
                } else if (edit.action === 'insert') {
                    return [edit.after_line!, edit.after_line!]
                }
                return [0, 0]
            }

            const ranges: Array<[number, number, number, string]> = []
            sortedEdits.forEach((edit, idx) => {
                const [start, end] = getEditRange(edit)
                if (start > 0) {
                    ranges.push([start, end, idx, edit.action])
                }
            })

            ranges.sort((a, b) => a[0] - b[0])

            for (let i = 0; i < ranges.length - 1; i++) {
                const [s1, e1, , act1] = ranges[i]
                const [s2, e2, , act2] = ranges[i + 1]

                if (act1 === 'insert' && act2 === 'insert') continue

                if (s2 <= e1) {
                    return {
                        success: false,
                        result: '',
                        error: `Overlapping edits detected: ${act1} [${s1}-${e1}] overlaps with ${act2} [${s2}-${e2}]. Split into separate calls or adjust line ranges.`
                    }
                }
            }

            const allWarnings: import('@utils/smartReplace').EditWarning[] = []
            let linesAdded = 0
            let linesRemoved = 0

            // 应用所有编辑
            for (const edit of sortedEdits) {
                if (edit.action === 'replace') {
                    const { start_line, end_line, content } = edit

                    if (start_line! < 1 || end_line! > lines.length || start_line! > end_line!) {
                        return {
                            success: false,
                            result: '',
                            error: `Invalid line range: ${start_line}-${end_line}. File has ${lines.length} lines.`
                        }
                    }

                    const oldLines = lines.slice(start_line! - 1, end_line)
                    const newLines = content!.split('\n')

                    lines = [
                        ...lines.slice(0, start_line! - 1),
                        ...newLines,
                        ...lines.slice(end_line)
                    ]

                    linesRemoved += oldLines.length
                    linesAdded += newLines.length

                    // 检测警告
                    const warnings = checkLineReplaceWarnings(oldLines, newLines, lines, start_line!, end_line!)
                    allWarnings.push(...warnings)

                } else if (edit.action === 'insert') {
                    const { after_line, content } = edit

                    if (after_line! < 0 || after_line! > lines.length) {
                        return {
                            success: false,
                            result: '',
                            error: `Invalid after_line: ${after_line}. File has ${lines.length} lines.`
                        }
                    }

                    const newLines = content!.split('\n')
                    lines = [
                        ...lines.slice(0, after_line),
                        ...newLines,
                        ...lines.slice(after_line)
                    ]

                    linesAdded += newLines.length

                } else if (edit.action === 'delete') {
                    const { start_line, end_line } = edit

                    if (start_line! < 1 || end_line! > lines.length || start_line! > end_line!) {
                        return {
                            success: false,
                            result: '',
                            error: `Invalid line range: ${start_line}-${end_line}. File has ${lines.length} lines.`
                        }
                    }

                    const removed = end_line! - start_line! + 1
                    lines = [
                        ...lines.slice(0, start_line! - 1),
                        ...lines.slice(end_line)
                    ]

                    linesRemoved += removed
                }
            }

            const newContent = lines.join('\n')
            const guardedWrite = await guardedWriteFile({
                path,
                nextContent: newContent,
                originalContent,
                staleMessage: 'Batch edit conflict detected: file changed since it was read',
                skipStaleCheck: true,
            })
            if (!guardedWrite.success) return guardedWrite.result

            fileCacheService.markFileAsRead(path, newContent)

            notifyComposerChange({
                filePath: path,
                workspacePath: ctx.workspacePath || '',
                oldContent: originalContent,
                newContent,
                changeType: 'modify',
                linesAdded,
                linesRemoved,
                ...getWritePreviewFlags(originalContent, newContent),
                toolCallId: ctx.toolCallId
            })

            await notifyLspAfterWrite(path, newContent)

            if (allWarnings.length > 0) {
                logger.agent.warn(`[edit_file] ${path}: Detected ${allWarnings.length} potential issues in batch`, allWarnings)
            }

            const warningsSuffix = allWarnings.length > 0 ? ` (${allWarnings.length} warning${allWarnings.length > 1 ? 's' : ''} detected)` : ''
            const meta = buildWriteMeta(
                path,
                originalContent,
                newContent,
                { added: linesAdded, removed: linesRemoved },
                guardedWrite.meta,
                {
                    totalLines: lines.length,
                    editsApplied: edits.length,
                    ...(allWarnings.length > 0 && { warnings: allWarnings }),
                }
            )

            // 发送文件编写完成事件
            EventBus.emit({ type: 'file:written', filePath: path, workspacePath: ctx.workspacePath || '', content: newContent })

            return {
                success: true,
                result: `File updated successfully (batch mode: ${edits.length} edits applied)${warningsSuffix}`,
                meta
            }
        }

        if (hasLineMode) {
            // 行模式（原 replace_file_content）
            const { start_line: startLine, end_line: endLine, content } = resolution.args

            // 验证缓存
            if (!fileCacheService.hasValidCache(path)) {
                logger.agent.warn(`[edit_file] File ${path} not in cache, line numbers may be inaccurate`)
            }

            if (originalContent === '') {
                const guardedWrite = await guardedWriteFile({
                    path,
                    nextContent: content,
                    originalContent,
                    staleMessage: 'Line edit conflict detected: file changed before empty-file write completed',
                })
                if (guardedWrite.success) fileCacheService.markFileAsRead(path, content)
                return guardedWrite.success
                    ? {
                        success: true,
                        result: 'File written (was empty)',
                        meta: buildWriteMeta(
                            path,
                            '',
                            content,
                            { added: countLinesFast(content), removed: 0 },
                            guardedWrite.meta
                        )
                    }
                    : guardedWrite.result
            }

            const lines = originalContent.split('\n')

            // 验证行号范围
            if (startLine < 1 || endLine > lines.length || startLine > endLine) {
                return {
                    success: false,
                    result: '',
                    error: `Invalid line range: ${startLine}-${endLine}. File has ${lines.length} lines. Use read_file to verify line numbers.`
                }
            }

            // 提取被替换的行（用于警告检测）
            const oldLines = lines.slice(startLine - 1, endLine)
            const newLines = content.split('\n')

            // 执行替换
            lines.splice(startLine - 1, endLine - startLine + 1, ...newLines)
            const newContent = lines.join('\n')

            // Fast-Edit 精华：智能警告检测
            const warnings = checkLineReplaceWarnings(oldLines, newLines, lines, startLine, endLine)

            if (warnings.length > 0) {
                logger.agent.warn(`[edit_file] ${path}: Detected ${warnings.length} potential issues`, warnings)
            }

            const guardedWrite = await guardedWriteFile({
                path,
                nextContent: newContent,
                originalContent,
                staleMessage: 'Line edit conflict detected: file changed since it was read',
                skipStaleCheck: true,
            })
            if (!guardedWrite.success) return guardedWrite.result

            fileCacheService.markFileAsRead(path, newContent)

            const lineChanges = getLineChangesForWrite(originalContent, newContent)
            notifyComposerChange({
                filePath: path,
                workspacePath: ctx.workspacePath || '',
                oldContent: originalContent,
                newContent,
                changeType: 'modify',
                linesAdded: lineChanges.added,
                linesRemoved: lineChanges.removed,
                ...getWritePreviewFlags(originalContent, newContent),
                toolCallId: ctx.toolCallId
            })

            await notifyLspAfterWrite(path, newContent)

            const warningsSuffix = warnings.length > 0 ? ` (${warnings.length} warning${warnings.length > 1 ? 's' : ''} detected)` : ''
            const meta = buildWriteMeta(
                path,
                originalContent,
                newContent,
                lineChanges,
                guardedWrite.meta,
                {
                    ...(warnings.length > 0 && { warnings }),
                }
            )

            // 发送文件编写完成事件
            EventBus.emit({ type: 'file:written', filePath: path, workspacePath: ctx.workspacePath || '', content: newContent })

            return {
                success: true,
                result: `File updated successfully (line mode)${warningsSuffix}`,
                meta
            }
        } else {
            // 字符串模式（原 edit_file）
            const { old_string: oldString, new_string: newString, replace_all: replaceAll } = resolution.args

            const normalizedContent = normalizeLineEndings(originalContent)
            const normalizedOld = normalizeLineEndings(oldString)
            const normalizedNew = normalizeLineEndings(newString)

            const result = smartReplace(normalizedContent, normalizedOld, normalizedNew, replaceAll)

            if (!result.success) {
                const { findSimilarContent, analyzeEditError, generateFixSuggestion } = await import('../utils/editRetryPolicy')

                const errorType = analyzeEditError(result.error, result.errorCode)
                const hasCache = fileCacheService.hasValidCache(path)

                const similar = findSimilarContent(normalizedContent, normalizedOld)

                const suggestion = generateFixSuggestion(errorType, {
                    path,
                    oldString: normalizedOld,
                    similarContent: similar.similarText,
                    lineNumber: similar.lineNumber,
                })

                let errorMsg = getReplaceErrorMessage(result.errorCode)

                if (similar.found) {
                    errorMsg += `\n\n${translate('agent.tool.edit.similarContentFound', {
                        line: similar.lineNumber || 0,
                        similarity: Math.round((similar.similarity || 0) * 100),
                    })}`
                }

                if (!hasCache) {
                    errorMsg += `\n\n${translate('agent.tool.edit.readBeforeEdit')}`
                }

                errorMsg += `\n\n${translate('agent.tool.edit.suggestionPrefix')} ${suggestion}`

                return { success: false, result: '', error: errorMsg }
            }

            const newContent = result.newContent!
            const guardedWrite = await guardedWriteFile({
                path,
                nextContent: newContent,
                originalContent,
                staleMessage: 'String edit conflict detected: file changed since it was read',
                skipStaleCheck: true,
            })
            if (!guardedWrite.success) return guardedWrite.result

            fileCacheService.markFileAsRead(path, newContent)

            const lineChanges = getLineChangesForWrite(originalContent, newContent)
            notifyComposerChange({
                filePath: path,
                workspacePath: ctx.workspacePath || '',
                oldContent: originalContent,
                newContent,
                changeType: 'modify',
                linesAdded: lineChanges.added,
                linesRemoved: lineChanges.removed,
                ...getWritePreviewFlags(originalContent, newContent),
                toolCallId: ctx.toolCallId
            })

            await notifyLspAfterWrite(path, newContent)

            const strategyInfo = result.stage !== 'exact' ? ` (matched via ${result.stage} strategy)` : ''

            const meta = buildWriteMeta(
                path,
                originalContent,
                newContent,
                lineChanges,
                guardedWrite.meta,
                {
                    matchStrategy: result.stage,
                }
            )

            // 发送文件编写完成事件
            EventBus.emit({ type: 'file:written', filePath: path, workspacePath: ctx.workspacePath || '', content: newContent })

            return {
                success: true,
                result: `File updated successfully${strategyInfo}`,
                meta
            }
        }
    },

    async write_file(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath)
        const content = args.content as string

        // 发送文件正在编写事件，触发自动打开预览
        EventBus.emit({ type: 'file:writing', filePath: path, workspacePath: ctx.workspacePath || '' })

        const parentConflict = await checkParentPathNotFile(path)
        if (parentConflict) {
            return {
                success: false,
                result: '',
                error: parentConflict,
            }
        }

        const originalContent = await api.file.read(path) || ''
        const writeDecision = guardWriteFile({
            path,
            originalContent,
            nextContent: content,
            hasRecentRead: fileCacheService.hasValidCache(path),
        })
        if (!writeDecision.allow) {
            return {
                success: false,
                result: '',
                // 把拒绝原因直接返回给模型，促使它切换到 edit_file 的合适模式。
                error: writeDecision.reason || 'write_file rejected by write strategy',
            }
        }
        const guardedWrite = await guardedWriteFile({
            path,
            nextContent: content,
            originalContent,
            staleMessage: 'Write conflict detected: file changed before overwrite completed',
            skipStaleCheck: true,
        })
        if (!guardedWrite.success) return guardedWrite.result
        // 写入成功后立即刷新缓存，保证后续 edit/read 判定看到的是最新内容。
        fileCacheService.markFileAsRead(path, content)

        // 通知 LSP 并等待诊断
        await notifyLspAfterWrite(path, content)

        const lineChanges = getLineChangesForWrite(originalContent, content)

        notifyComposerChange({
            filePath: path,
            workspacePath: ctx.workspacePath || '',
            oldContent: originalContent,
            newContent: content,
            changeType: originalContent ? 'modify' : 'create',
            linesAdded: lineChanges.added,
            linesRemoved: lineChanges.removed,
            ...getWritePreviewFlags(originalContent, content),
            toolCallId: ctx.toolCallId
        })

        // 发送文件编写完成事件
        EventBus.emit({ type: 'file:written', filePath: path, workspacePath: ctx.workspacePath || '', content })
        return {
            success: true,
            result: 'File written successfully',
            meta: buildWriteMeta(path, originalContent, content, lineChanges, guardedWrite.meta, {
                writeIntent: writeDecision.intent,
                writeAnalysis: writeDecision.analysis,
            })
        }
    },

    async create_file_or_folder(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath)
        const isFolder = path.endsWith('/') || path.endsWith('\\')

        // 发送文件正在编写事件（仅文件），触发自动打开预览
        if (!isFolder) {
            EventBus.emit({ type: 'file:writing', filePath: path, workspacePath: ctx.workspacePath || '' })
        }

        if (isFolder) {
            const parentConflict = await checkParentPathNotFile(path)
            if (parentConflict) {
                return { success: false, result: '', error: parentConflict }
            }
            const success = await api.file.mkdir(path)
            if (success) {
                notifyWorkspaceTreeChange({
                    workspacePath: ctx.workspacePath || '',
                    targetPath: path,
                    changeType: 'create',
                    isDirectory: true,
                })
            } else {
                const reason = await checkWriteFailureReason(path)
                return { success: false, result: '', error: `Failed to create directory "${path}". ${reason}` }
            }
            return { success: true, result: 'Folder created' }
        }

        const parentConflict = await checkParentPathNotFile(path)
        if (parentConflict) {
            return { success: false, result: '', error: parentConflict }
        }

        const originalContent = await api.file.read(path) ?? null
        const content = (args.content as string) || ''
        const guardedWrite = await guardedWriteFile({
            path,
            nextContent: content,
            originalContent,
            staleMessage: 'Create file conflict detected: target path changed before creation completed',
        })

        if (guardedWrite.success) {
            // 通知 LSP 并等待诊断
            await notifyLspAfterWrite(path, content)

            notifyComposerChange({
                filePath: path,
                workspacePath: ctx.workspacePath || '',
                oldContent: null,
                newContent: content,
                changeType: 'create',
                linesAdded: content.split('\n').length,
                linesRemoved: 0,
                ...getWritePreviewFlags(null, content),
                toolCallId: ctx.toolCallId
            })
        }

        if (!guardedWrite.success) return guardedWrite.result

        // 发送文件编写完成事件
        EventBus.emit({ type: 'file:written', filePath: path, workspacePath: ctx.workspacePath || '', content })

        return {
            success: true,
            result: 'File created',
            meta: buildWriteMeta(
                path,
                null,
                content,
                { added: countLinesFast(content), removed: 0 },
                guardedWrite.meta,
                { isNewFile: true }
            )
        }
    },

    async delete_file_or_folder(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath)
        const success = await api.file.delete(path)
        if (success) {
            notifyComposerChange({ filePath: path, workspacePath: ctx.workspacePath || '', oldContent: null, newContent: null, changeType: 'delete', linesAdded: 0, linesRemoved: 0 })
        }
        return { success, result: success ? 'Deleted successfully' : 'Failed to delete' }
    },

    async run_command(args, ctx) {
        const command = args.command as string
        // cwd 解析：若 AI 传了 cwd 参数，解析为绝对路径；否则用工作区根目录
        const resolvedCwd = args.cwd ? resolvePath(args.cwd, ctx.workspacePath, true) : null
        const isBackground = args.is_background as boolean
        // 默认超时 120 秒，防止命令因 sentinel 失败等原因卡住导致 AI 无限等待
        // 长进程（isLongRunningProcess）走 detached 路径，不受此超时影响
        const timeout = 120_000

        // ── 安全底线：危险命令硬拦截 ──────────────────────────
        // 即使 toolOrchestrator 审批通过，仍在此处做最终内容校验。
        // 审批机制问的是"是否允许执行此工具"，此处校验的是"命令内容是否安全"。
        // 命中 DANGEROUS_COMMAND_PATTERNS 的命令（rm -rf /、curl|sh、sudo 等）
        // 一律拒绝执行，AI 需改用更安全的替代方案或提示用户手动操作。
        // 用户如需执行这些命令，可直接在终端面板中手动输入（不经过 AI 工具入口）。
        if (typeof command === 'string' && isDangerousCommand(command)) {
            const matchedPattern = matchDangerousCommand(command) || 'unknown'
            logger.security.warn(
                `[run_command] Blocked dangerous command (pattern: ${matchedPattern}): ${command.slice(0, 200)}`,
            )
            return {
                success: false,
                result: `命令被安全策略拦截：命中危险模式 "${matchedPattern}"。\n该命令可能造成不可逆的系统损害（如删除文件、远程脚本执行、权限提升等）。\n如确需执行，请用户在终端面板中手动输入。`,
                error: 'Command blocked by safety policy',
                meta: {
                    command,
                    cwd: resolvedCwd,
                    finalStatus: 'blocked',
                    terminationReason: 'safety_policy_violation',
                    blockedPattern: matchedPattern,
                },
            }
        }

        // 中止信号处理：用户点击停止按钮时，立即取消命令执行
        // 避免长命令阻塞 AI 主循环，确保停止按钮能真正中断所有操作
        const abortSignal = ctx.abortSignal
        if (abortSignal?.aborted) {
            return {
                success: false,
                result: 'Command cancelled by user before execution',
                error: 'Aborted by user',
                meta: { command, finalStatus: 'cancelled', terminationReason: 'aborted_before_start' }
            }
        }

        // 注册中止监听器：信号触发时调用 terminalManager.abortActiveAgentCommands()
        // 作为 IntelligenceCore.abort() 流程的兜底，确保终端命令被中断
        let abortListener: (() => void) | null = null
        if (abortSignal) {
            abortListener = () => {
                try {
                    terminalManager.abortActiveAgentCommands()
                } catch (err) {
                    logger.agent.warn('[run_command] Abort listener failed to cancel terminal commands:', err)
                }
            }
            abortSignal.addEventListener('abort', abortListener, { once: true })
        }

        // 中止结果工厂：统一构造被取消的返回值
        const buildCancelledResult = (partialOutput?: string): ToolExecutionResult => ({
            success: false,
            result: partialOutput
                ? `[Command cancelled by user]\n${partialOutput}`
                : 'Command cancelled by user',
            error: 'Aborted by user',
            meta: {
                command,
                cwd: resolvedCwd,
                finalStatus: 'cancelled',
                terminationReason: 'aborted_by_user',
            }
        })

        // 将任意 Promise 与中止信号竞争：信号触发时返回 cancelled 结果
        // 用于让 runInlineScriptViaTempFile / tryRunPythonFile / executeCommandWithOutput
        // 都能响应停止按钮，避免阻塞 AI 主循环
        const raceWithAbort = <T>(promise: Promise<T>): Promise<T | { __aborted: true }> => {
            if (!abortSignal) return promise
            return new Promise<T | { __aborted: true }>((resolve) => {
                const onAbort = () => resolve({ __aborted: true })
                if (abortSignal.aborted) {
                    resolve({ __aborted: true })
                    return
                }
                abortSignal.addEventListener('abort', onAbort, { once: true })
                promise.then(
                    (val) => {
                        abortSignal.removeEventListener('abort', onAbort)
                        resolve(val)
                    },
                    (err) => {
                        abortSignal.removeEventListener('abort', onAbort)
                        resolve({ __aborted: true, __error: err } as any)
                    }
                )
            })
        }

        // 清理中止监听器（在函数返回前调用）
        const cleanupAbortListener = () => {
            if (abortListener && abortSignal) {
                abortSignal.removeEventListener('abort', abortListener)
                abortListener = null
            }
        }

        const isLongRunningProcess = isLongRunningCommand(command, isBackground)

        try {
            if (!isLongRunningProcess) {
                // 内联脚本路径：与中止信号竞争，避免长脚本阻塞停止按钮
                const inlineResult = await raceWithAbort(runInlineScriptViaTempFile(command, ctx, timeout))
                if (inlineResult && !('__aborted' in inlineResult)) {
                    return inlineResult
                }
                if (inlineResult && '__aborted' in inlineResult) {
                    return buildCancelledResult()
                }

                // Python 文件路径：同样与中止信号竞争
                const pythonResult = await raceWithAbort(tryRunPythonFile(command, ctx, timeout))
                if (pythonResult && !('__aborted' in pythonResult)) {
                    return pythonResult
                }
                if (pythonResult && '__aborted' in pythonResult) {
                    return buildCancelledResult()
                }
            }


            // 终端面板默认不弹出：AI 执行命令静默进行，结果直接返回给 AI。
            // 用户可通过命令容器右侧的">_终端"按钮手动打开终端查看当前命令。
            // 长进程也不再自动弹出面板（通过 ToolCallCard 的"运行中"状态和终端按钮提示用户）

            // 获取或复用 Agent 专属终端（初始 cwd 用工作区根目录，避免反复改变终端目录）
            const termId = await terminalManager.getOrCreateAgentTerminal(
                ctx.workspacePath || '/'
            )

            // 不自动激活终端 tab：静默执行，避免打断用户当前关注的终端
            // 仅当终端面板已可见时才激活（用户已主动打开终端的场景）
            if (useStore.getState().terminalVisible) {
                terminalManager.setActiveTerminal(termId)
                // 面板可见时等待 xterm mount + fit，确保 PTY cols 与 xterm 一致
                await terminalManager.ensureTerminalReady(termId)
            }
            // 面板不可见时不等待 xterm mount（xterm 不会 mount，等待会超时浪费 1 秒）
            // PTY 用默认 cols（120）执行，用户后续点击查看时 xterm mount + fit 会修正

            // === 长进程：直接写入并立即返回，让用户在终端里跟踪 ===
            if (isLongRunningProcess) {
                // 长进程也需要处理 cwd
                const bgCmd = resolvedCwd
                    ? (/windows/i.test(navigator.userAgent)
                        ? `Push-Location "${resolvedCwd}"; ${command}; Pop-Location`
                        : `(cd "${resolvedCwd}" && ${command})`)
                    : command
                // 先发送 \r 确保光标在行首（复用终端时上次输出可能残留光标位置），
                // 再写入命令并执行。避免命令从非行首位置开始显示导致排版错乱。
                terminalManager.writeToTerminal(termId, `\r${bgCmd}\r`)

                const detachedSession = terminalManager.recordDetachedCommand(
                    termId,
                    command,
                    resolvedCwd || undefined,
                    'agent',
                )

                // 长进程占用了当前终端的 shell，释放 agentTerminalId
                // 使下一次 run_command 自动创建新终端，避免命令被 stdin 吞掉
                terminalManager.releaseAgentTerminal()

                return {
                    success: true,
                    result: `[后台进程已启动]\n命令: ${command}\n终端 ID: ${termId}\n会话 ID: ${detachedSession.commandSessionId}\n\n该进程已在 Agent 终端面板中运行，不会自动退出。命令已成功启动，你可以继续执行下一步任务。\n\n如需查看实时日志：调用 read_terminal_output（terminal_id="${termId}"）\n如需发送输入或 Ctrl+C：调用 send_terminal_input（is_ctrl=true 发送中断）\n如需停止进程：调用 stop_terminal`,
                    meta: {
                        command,
                        cwd: resolvedCwd,
                        terminalId: termId,
                        commandSessionId: detachedSession.commandSessionId,
                        finalStatus: detachedSession.status,
                        terminationReason: detachedSession.terminationReason,
                        isBackground: true,
                    }
                }
            }

            // 流式输出回调：将命令执行过程中的实时输出推送到聊天界面
            // 通过 setToolStreamingPreview 更新 ToolStreamingPreview.partialOutput
            // 让 renderRunCommand 能够实时渲染执行结果
            const toolCallIdForStream = ctx.toolCallId
            const threadIdForStream = ctx.threadId
            let lastFlushedLength = 0
            let flushTimer: ReturnType<typeof setTimeout> | null = null
            const STREAM_FLUSH_INTERVAL_MS = 150

            const flushPartialOutput = (partialOutput: string) => {
                if (!toolCallIdForStream || !threadIdForStream) return
                // 只在有新内容时更新，避免重复刷新
                if (partialOutput.length <= lastFlushedLength) return
                lastFlushedLength = partialOutput.length

                const store = useAgentStore.getState()
                const threadStore = store.forThread(threadIdForStream)
                threadStore.setToolStreamingPreview(toolCallIdForStream, {
                    isStreaming: true,
                    partialOutput,
                    lastUpdateTime: Date.now(),
                })
            }

            const onPartialOutput = (partialOutput: string) => {
                // 节流：避免频繁更新 store 导致渲染压力
                if (flushTimer) clearTimeout(flushTimer)
                flushTimer = setTimeout(() => {
                    flushTimer = null
                    flushPartialOutput(partialOutput)
                }, STREAM_FLUSH_INTERVAL_MS)
            }

            // 终端执行路径：与中止信号竞争
            // 即使 abortActiveAgentCommands() 已经调用 finalize，raceWithAbort 作为兜底
            // 确保极端情况下（如 finalize 失败）也能及时返回
            let commandResult
            const racedResult = await raceWithAbort(
                terminalManager.executeCommandWithOutput(
                    termId,
                    command,
                    timeout,
                    resolvedCwd || undefined,
                    onPartialOutput,
                )
            )

            try {
                if ('__aborted' in racedResult) {
                    // 中止触发：尽力获取已捕获的部分输出
                    let partialSnapshot = ''
                    try {
                        partialSnapshot = terminalManager.getOutputPreview(termId, 200, 8000) || ''
                    } catch {
                        // 终端可能已关闭，忽略
                    }
                    // 直接返回 cancelled 结果，跳过后续状态映射逻辑
                    return buildCancelledResult(partialSnapshot.trim() || undefined)
                } else {
                    commandResult = racedResult
                }
            } finally {
                // 命令结束后：清除节流定时器，立即刷新最后一次输出
                if (flushTimer) {
                    clearTimeout(flushTimer)
                    flushTimer = null
                }
                // 清除流式预览状态（命令已结束，renderRunCommand 会显示最终 result）
                if (toolCallIdForStream && threadIdForStream) {
                    const store = useAgentStore.getState()
                    const threadStore = store.forThread(threadIdForStream)
                    threadStore.clearToolStreamingPreview(toolCallIdForStream)
                }
            }

            const displayOutput = (commandResult.output || commandResult.partialOutput || '').trim()
            let resultText = displayOutput

            if (!resultText) {
                if (commandResult.finalStatus === 'timed_out') {
                    resultText = timeout > 0
                        ? `Command timed out after ${timeout / 1000}s`
                        : 'Command timed out'
                } else if (commandResult.exitCode === 0 && commandResult.finalStatus === 'completed') {
                    resultText = 'Command executed successfully (no output)'
                } else {
                    resultText = `Command finished with status ${commandResult.finalStatus}${commandResult.exitCode !== null ? ` (exit code ${commandResult.exitCode})` : ''} (no output)`
                }
            }

            if (commandResult.finalStatus === 'timed_out' && displayOutput) {
                resultText = timeout > 0
                    ? `[Timed out after ${timeout / 1000}s]\n${displayOutput}`
                    : `[Timed out]\n${displayOutput}`
            }

            if (commandResult.finalStatus === 'interrupted' && !commandResult.sentinelMatched) {
                resultText = displayOutput
                    ? `[Partial output captured before prompt recovery]\n${displayOutput}`
                    : 'Command ended without a sentinel. Partial output may have been recovered from the terminal prompt.'
            }

            if (commandResult.finalStatus === 'shell_exited' && displayOutput) {
                resultText = `[Shell exited while command was running]\n${displayOutput}`
            }

            // 错误检测主动终止：terminalWatcher 检测到错误关键字后主动结束命令
            // 添加前缀让 AI 明确知道这是因错误被提前终止，而非正常完成
            if (commandResult.terminationReason === 'error_detected' && displayOutput) {
                resultText = `[Command terminated due to error detected in output]\n${displayOutput}`
            }

            return {
                success: commandResult.success,
                result: resultText,
                meta: {
                    command,
                    cwd: resolvedCwd,
                    terminalId: termId,
                    commandSessionId: commandResult.commandSessionId,
                    exitCode: commandResult.exitCode,
                    timedOut: commandResult.timedOut,
                    finalStatus: commandResult.finalStatus,
                    durationMs: commandResult.durationMs,
                    terminationReason: commandResult.terminationReason,
                    sentinelMatched: commandResult.sentinelMatched,
                },
                error: commandResult.success ? undefined : resultText
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            logger.agent.error('[run_command] Execution failed:', errorMsg)
            return {
                success: false,
                result: `Error: Failed to execute command: ${errorMsg}`,
                error: errorMsg
            }
        } finally {
            // 清理中止监听器，避免内存泄漏
            cleanupAbortListener()
        }
    },

    async read_terminal_output(args) {
        const terminalId = args.terminal_id as string
        const linesCount = (args.lines as number) || 100

        try {
            const lines = terminalManager.getOutputBuffer(terminalId)

            if (!lines || lines.length === 0) {
                return {
                    success: true,
                    result: '[Empty buffer. Either the terminal was closed, invalid, or it has not produced output yet]'
                }
            }

            // 返回清理掉 ANSI 色彩字符的内容以便 AI 解析
            const rawOutput = lines.slice(-linesCount).join('')
            const cleanOutput = rawOutput
                .replace(/\x1b\[[0-9;]*[mGK]/g, '')
                .replace(/\r\n/g, '\n')
                .trim()

            return {
                success: true,
                result: cleanOutput || '[Terminal produced no printable output]',
                meta: { terminalId }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return { success: false, result: `Failed to read terminal output: ${errorMsg}`, error: errorMsg }
        }
    },

    async send_terminal_input(args) {
        const terminalId = args.terminal_id as string
        const input = args.input as string
        const isCtrl = args.is_ctrl as boolean

        try {

            let dataToSend = input
            if (isCtrl) {
                // 将诸如 'c' 转换为 \x03 (Ctrl+C)
                const charCode = input.toLowerCase().charCodeAt(0)
                if (charCode >= 97 && charCode <= 122) { // 'a' - 'z'
                    dataToSend = String.fromCharCode(charCode - 96)
                }
            }

            // ── 安全底线：对非 Ctrl 的文本输入做行级危险命令检测 ──
            // Ctrl 组合键（如 Ctrl+C）是控制信号，不携带命令内容，跳过检测。
            // 普通文本输入可能包含完整命令行（如 AI 向 REPL 发送 "import os; os.system('rm -rf /')"），
            // 按换行符拆分后对每行做 isDangerousCommand 检测，命中即拦截。
            if (!isCtrl && typeof dataToSend === 'string' && dataToSend.length > 0) {
                const lines = dataToSend.split(/\r?\n/)
                for (const line of lines) {
                    const trimmed = line.trim()
                    if (!trimmed) continue
                    if (isDangerousCommand(trimmed)) {
                        const matchedPattern = matchDangerousCommand(trimmed) || 'unknown'
                        logger.security.warn(
                            `[send_terminal_input] Blocked dangerous input (pattern: ${matchedPattern}): ${trimmed.slice(0, 200)}`,
                        )
                        return {
                            success: false,
                            result: `输入被安全策略拦截：命中危险模式 "${matchedPattern}"。\n如确需执行，请用户在终端面板中手动输入。`,
                            error: 'Input blocked by safety policy',
                            meta: { terminalId, sentCtrl: isCtrl, blockedPattern: matchedPattern },
                        }
                    }
                }
            }

            terminalManager.writeToTerminal(terminalId, dataToSend)

            return {
                success: true,
                result: `Successfully sent ${isCtrl ? 'Ctrl+' + input.toUpperCase() : 'input'} to terminal ${terminalId}`,
                meta: { terminalId, sentCtrl: isCtrl }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return { success: false, result: `Failed to send terminal input: ${errorMsg}`, error: errorMsg }
        }
    },

    async stop_terminal(args) {
        const terminalId = args.terminal_id as string

        try {
            terminalManager.closeTerminal(terminalId)
            return {
                success: true,
                result: `Terminal ${terminalId} stopped and closed successfully.`,
                meta: { terminalId }
            }
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error)
            return { success: false, result: `Failed to stop terminal: ${errorMsg}`, error: errorMsg }
        }
    },

    async get_lint_errors(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const { errors, notInstalled } = await lintService.getLintErrors(path, args.refresh as boolean)
        if (notInstalled) {
            return { success: true, result: notInstalled }
        }
        return { success: true, result: errors.length ? errors.map((e) => `[${e.severity}] ${e.message} (Line ${e.startLine})`).join('\n') : 'No lint errors found.' }
    },

    async codebase_search(args, ctx) {
        if (!ctx.workspacePath) return { success: false, result: '', error: 'No workspace open' }
        try {
            const results = await api.index.hybridSearch(ctx.workspacePath, args.query as string, (args.top_k as number) || 10)
            if (!results?.length) return { success: true, result: 'No results found' }
            return { success: true, result: results.map((r: { relativePath: string; startLine: number; content: string }) => `${r.relativePath}:${r.startLine}: ${r.content.trim()}`).join('\n') }
        } catch (e) {
            return { success: false, result: '', error: e instanceof Error ? e.message : 'Search failed' }
        }
    },

    async find_references(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const locations = await api.lsp.references({
            uri: pathToLspUri(path), line: (args.line as number) - 1, character: (args.column as number) - 1, workspacePath: ctx.workspacePath
        })
        if (!locations?.length) return { success: true, result: 'No references found' }

        // 转换 URI 为相对路径
        const formatLocation = (loc: { uri: string; range: { start: { line: number; character: number } } }) => {
            let filePath = loc.uri
            if (filePath.startsWith('file:///')) filePath = filePath.slice(8)
            else if (filePath.startsWith('file://')) filePath = filePath.slice(7)
            try { filePath = decodeURIComponent(filePath) } catch { /* already decoded */ }
            // 转为相对路径
            if (ctx.workspacePath && filePath.toLowerCase().startsWith(ctx.workspacePath.toLowerCase().replace(/\\/g, '/'))) {
                filePath = filePath.slice(ctx.workspacePath.length).replace(/^[/\\]+/, '')
            }
            return `${filePath}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`
        }
        return { success: true, result: locations.map(formatLocation).join('\n') }
    },

    async go_to_definition(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const locations = await api.lsp.definition({
            uri: pathToLspUri(path), line: (args.line as number) - 1, character: (args.column as number) - 1, workspacePath: ctx.workspacePath
        })
        if (!locations?.length) return { success: true, result: 'Definition not found' }

        // 转换 URI 为相对路径
        const formatLocation = (loc: { uri: string; range: { start: { line: number; character: number } } }) => {
            let filePath = loc.uri
            if (filePath.startsWith('file:///')) filePath = filePath.slice(8)
            else if (filePath.startsWith('file://')) filePath = filePath.slice(7)
            try { filePath = decodeURIComponent(filePath) } catch { /* already decoded */ }
            // 转为相对路径
            if (ctx.workspacePath && filePath.toLowerCase().startsWith(ctx.workspacePath.toLowerCase().replace(/\\/g, '/'))) {
                filePath = filePath.slice(ctx.workspacePath.length).replace(/^[/\\]+/, '')
            }
            return `${filePath}:${loc.range.start.line + 1}:${loc.range.start.character + 1}`
        }
        return { success: true, result: locations.map(formatLocation).join('\n') }
    },

    async get_hover_info(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const hover = await api.lsp.hover({
            uri: pathToLspUri(path), line: (args.line as number) - 1, character: (args.column as number) - 1, workspacePath: ctx.workspacePath
        })
        if (!hover?.contents) return { success: true, result: 'No hover info' }
        const contents = Array.isArray(hover.contents) ? hover.contents.join('\n') : (typeof hover.contents === 'string' ? hover.contents : hover.contents.value)
        return { success: true, result: contents }
    },

    async get_document_symbols(args, ctx) {
        const path = resolvePath(args.path, ctx.workspacePath, true)
        const symbols = await api.lsp.documentSymbol({ uri: pathToLspUri(path), workspacePath: ctx.workspacePath })
        if (!symbols?.length) return { success: true, result: 'No symbols found' }

        const format = (s: { name: string; kind: number; children?: unknown[] }, depth: number): string => {
            let out = `${'  '.repeat(depth)}${s.name} (${s.kind})\n`
            if (s.children) out += (s.children as typeof s[]).map((c: typeof s) => format(c, depth + 1)).join('')
            return out
        }
        return { success: true, result: symbols.map((s: { name: string; kind: number; children?: unknown[] }) => format(s, 0)).join('') }
    },

    async web_search(args) {
        // 取消网络搜索超时限制
        const result = await api.http.webSearch(args.query as string, args.max_results as number, 0)
        if (!result.success || !result.results) return { success: false, result: '', error: result.error || 'Search failed' }
        return { success: true, result: result.results.map((r: { title: string; url: string; snippet: string }) => `[${r.title}](${r.url})\n${r.snippet}`).join('\n\n') }
    },

    async read_url(args) {
        // 取消 URL 读取超时限制
        const result = await api.http.readUrl(args.url as string, 0)
        if (!result.success || !result.content) return { success: false, result: '', error: result.error || 'Failed to read URL' }
        return { success: true, result: `Title: ${result.title}\n\n${result.content}` }
    },

    async ask_user(args, _ctx) {
        const question = args.question as string
        const rawOptions = args.options as Array<{ id?: string; value?: string; label: string; description?: string }>
        const multiSelect = (args.multi_select as boolean) || false

        const options = rawOptions.map((opt, idx) => ({
            id: opt.id || opt.value || `option-${idx}`,
            label: opt.label,
            description: opt.description,
        }))

        return {
            success: true,
            result: `Waiting for user to select from options. Question: "${question}"`,
            meta: {
                waitingForUser: true,
                interactive: { type: 'interactive' as const, question, options, multiSelect },
            },
        }
    },

    async ask_form(args, _ctx) {
        const title = args.title as string
        const description = args.description as string | undefined
        const submitLabel = (args.submit_label as string) || 'Submit'
        const rawFields = args.fields as Array<Record<string, unknown>>

        const fields = rawFields.map(field => {
            const type = (field.type as string) || 'text'
            const fieldDef: Record<string, unknown> = {
                id: field.id as string,
                type,
                label: field.label as string,
                placeholder: field.placeholder as string | undefined,
                required: field.required === true,
                description: field.description as string | undefined,
            }

            if (field.default_value !== undefined) {
                if (type === 'number') {
                    fieldDef.defaultValue = Number(field.default_value)
                } else if (type === 'checkbox') {
                    fieldDef.defaultValue = field.default_value === 'true' || field.default_value === true
                } else {
                    fieldDef.defaultValue = String(field.default_value)
                }
            }

            if (['select', 'radio'].includes(type) && Array.isArray(field.options)) {
                fieldDef.options = (field.options as Array<Record<string, string>>).map(opt => ({
                    label: opt.label,
                    value: opt.value,
                }))
            }

            if (type === 'number') {
                if (field.min !== undefined) fieldDef.min = Number(field.min)
                if (field.max !== undefined) fieldDef.max = Number(field.max)
            }

            if (field.pattern !== undefined) {
                fieldDef.pattern = String(field.pattern)
            }

            return fieldDef
        })

        return {
            success: true,
            result: `Waiting for user to fill in form: "${title}"`,
            meta: {
                waitingForUser: true,
                form: {
                    type: 'form' as const,
                    title,
                    description,
                    fields,
                    submitLabel,
                },
            },
        }
    },

    async create_task_plan(args, ctx) {
        const name = args.name as string
        const requirementsDoc = args.requirementsDoc as string

        if (!ctx.workspacePath) {
            return { success: false, result: 'No workspace path available' }
        }

        try {
            // 生成唯一 ID
            const timestamp = Date.now()
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)
            const planId = `${slug}-${timestamp}`

            const planDir = `${ctx.workspacePath}/${BRAND.dirName}/${PLAN_DIR_NAME}`
            await api.file.mkdir(planDir)

            // 保存需求文档 (markdown)
            const mdPath = `${planDir}/${planId}.md`
            internalWriteTracker.mark(mdPath)
            await api.file.write(mdPath, requirementsDoc)

            // 构建规划对象（通过 planBuilder 纯函数，支持 graphVersion=2 图扩展字段）
            const plan = buildPlanFromToolArgs({
                args: {
                    name,
                    requirementsDoc,
                    tasks: args.tasks as PlanTaskArg[],
                    executionMode: args.executionMode as string | undefined,
                    graphVersion: args.graphVersion as number | undefined,
                    allowDynamicExpansion: args.allowDynamicExpansion as boolean | undefined,
                    edges: args.edges as PlanEdgeArg[] | undefined,
                },
                planId,
                timestamp,
            })

            // 保存规划文件 (json)
            const jsonPath = `${planDir}/${planId}.json`
            internalWriteTracker.mark(jsonPath)
            await api.file.write(jsonPath, JSON.stringify(plan, null, 2))

            // 添加到 store 并打开 ExecutionBoard
            agentStorePlanBridge.addPlan(plan)

            // 打开 plan 文件（触发 ExecutionBoard 渲染）
            useStore.getState().openFile(jsonPath, JSON.stringify(plan, null, 2))

            // 根据是否图计划构造反馈信息
            const isGraphPlan = plan.graphVersion === 2
            const graphHint = isGraphPlan
                ? getLocalizedText(
                    getCurrentLanguage(),
                    '（图计划：已启用条件边/循环节点）',
                    ' (Graph plan: conditional edges/loops enabled)',
                )
                : ''

            return {
                success: true,
                result: getLocalizedText(
                    getCurrentLanguage(),
                    `已创建任务规划“${name}”，共 ${plan.tasks.length} 个任务${graphHint}。\n规划文件：${jsonPath}\n需求文档：${mdPath}\n\nTaskBoard 已打开，请先审核规划，再点击“开始执行”。`,
                    `Created task plan "${name}" with ${plan.tasks.length} task(s)${graphHint}.\nPlan file: ${jsonPath}\nRequirements: ${mdPath}\n\nThe ExecutionBoard has been opened for user review. Please review the plan and click "Start Execution" to proceed.`,
                ),
                meta: { planId, planPath: jsonPath, stopLoop: true },
            }
        } catch (err) {
            const error = toAppError(err)
            return { success: false, result: error.message }
        }
    },

    async update_task_plan(args, ctx) {
        try {
            const planId = args.planId as string
            const updateRequirements = args.updateRequirements as string | undefined
            const addTasks = args.addTasks as PlanTaskArg[] | undefined
            const removeTasks = args.removeTasks as string[] | undefined
            const updateTasks = args.updateTasks as Array<{
                taskId: string
                title?: string
                description?: string
                provider?: string
                model?: string
                role?: string
                nodeType?: string
                maxIterations?: number
                reflectionPrompt?: string
                requireApproval?: boolean
            }> | undefined
            const executionMode = args.executionMode as 'sequential' | 'parallel' | undefined
            const setGraphVersion = args.setGraphVersion as number | undefined
            const setAllowDynamicExpansion = args.setAllowDynamicExpansion as boolean | undefined
            const updateEdges = args.updateEdges as PlanEdgeArg[] | undefined

            const store = agentStorePlanBridge
            const plan = store.getPlanById(planId)

            if (!plan) {
                return { success: false, result: `Plan not found: ${planId}` }
            }

            const changes: string[] = []

            // 更新需求文档
            if (updateRequirements) {
                const mdPath = `${ctx.workspacePath}/${BRAND.dirName}/${PLAN_DIR_NAME}/${plan.requirementsDoc}`
                const existingContent = (await api.file.read(mdPath)) || ''
                const newContent = `${existingContent}\n\n---\n## Updates\n${updateRequirements}`
                internalWriteTracker.mark(mdPath)
                await api.file.write(mdPath, newContent)
                changes.push('Updated requirements document')
            }

            // 删除任务
            if (removeTasks?.length) {
                const currentPlan1 = store.getPlanById(planId)
                if (currentPlan1) {
                    const newTasks = currentPlan1.tasks.filter(t => !removeTasks.includes(t.id))
                    store.updatePlan(planId, { tasks: newTasks })
                }
                changes.push(`Removed ${removeTasks.length} tasks`)
            }

            // 添加任务（复用 planBuilder.buildAddedTask，支持图扩展字段）
            if (addTasks?.length) {
                const timestamp = Date.now()
                const newTasks = addTasks.map((t, i) => buildAddedTask(t, timestamp, i))

                const currentPlan = store.getPlanById(planId)
                if (currentPlan) {
                    store.updatePlan(planId, { tasks: [...currentPlan.tasks, ...newTasks] })
                }
                changes.push(`Added ${addTasks.length} tasks`)
            }

            // 更新任务（含图扩展字段 nodeType/maxIterations/reflectionPrompt/requireApproval）
            if (updateTasks?.length) {
                const currentPlan = store.getPlanById(planId)
                if (currentPlan) {
                    const updatedTasks = currentPlan.tasks.map(task => {
                        const update = updateTasks.find(u => u.taskId === task.id)
                        if (!update) return task

                        const merged: any = { ...task }
                        if (update.title !== undefined) merged.title = update.title
                        if (update.description !== undefined) merged.description = update.description
                        if (update.provider !== undefined) merged.provider = update.provider
                        if (update.model !== undefined) merged.model = update.model
                        if (update.role !== undefined) merged.role = update.role
                        // 图扩展字段
                        if (update.nodeType !== undefined) {
                            const valid = ['task', 'llm', 'tool', 'decision', 'human']
                            if (valid.includes(update.nodeType)) {
                                merged.nodeType = update.nodeType
                            }
                        }
                        if (update.maxIterations !== undefined) merged.maxIterations = update.maxIterations
                        if (update.reflectionPrompt !== undefined) merged.reflectionPrompt = update.reflectionPrompt
                        if (update.requireApproval !== undefined) merged.requireApproval = update.requireApproval
                        return merged
                    })
                    store.updatePlan(planId, { tasks: updatedTasks })
                }
                changes.push(`Updated ${updateTasks.length} tasks`)
            }

            // 升级/切换 graphVersion（图能力版本）
            if (setGraphVersion !== undefined) {
                const currentPlan = store.getPlanById(planId)
                if (currentPlan) {
                    const graphPlan: any = { ...currentPlan }
                    graphPlan.graphVersion = setGraphVersion === 2 ? 2 : 1
                    store.updatePlan(planId, graphPlan)
                    changes.push(`Set graphVersion to ${graphPlan.graphVersion}`)
                }
            }

            // 切换 allowDynamicExpansion
            if (setAllowDynamicExpansion !== undefined) {
                const currentPlan = store.getPlanById(planId)
                if (currentPlan) {
                    const graphPlan: any = { ...currentPlan }
                    graphPlan.allowDynamicExpansion = setAllowDynamicExpansion
                    // 若开启动态扩展但 graphVersion 未设，自动升级到 2
                    if (setAllowDynamicExpansion && graphPlan.graphVersion !== 2) {
                        graphPlan.graphVersion = 2
                        changes.push('Auto-upgraded graphVersion to 2 (allowDynamicExpansion requires it)')
                    }
                    store.updatePlan(planId, graphPlan)
                    changes.push(`Set allowDynamicExpansion to ${setAllowDynamicExpansion}`)
                }
            }

            // 更新图边（重分配节点级出边）
            if (updateEdges?.length) {
                const currentPlan = store.getPlanById(planId)
                if (currentPlan) {
                    const tasks = currentPlan.tasks.map(t => ({ ...t }))
                    applyUpdateEdges(tasks, updateEdges)
                    store.updatePlan(planId, { tasks })
                    changes.push(`Updated ${updateEdges.length} edges`)
                }
            }

            // 更新执行模式
            if (executionMode) {
                store.updatePlan(planId, { executionMode })
                changes.push(`Changed execution mode to ${executionMode}`)
            }

            // 更新 JSON 文件
            const updatedPlan = store.getPlanById(planId)
            if (updatedPlan) {
                const jsonPath = `${ctx.workspacePath}/${BRAND.dirName}/${PLAN_DIR_NAME}/${planId}.json`
                internalWriteTracker.mark(jsonPath)
                await api.file.write(jsonPath, JSON.stringify(updatedPlan, null, 2))
            }

            return {
                success: true,
                result: getLocalizedText(
                    getCurrentLanguage(),
                    `规划已更新：\n${changes.map(c => `- ${c}`).join('\n')}\n\n请在 ExecutionBoard 中审核这些变更。`,
                    `Plan updated:\n${changes.map(c => `- ${c}`).join('\n')}\n\nPlease review the changes in the ExecutionBoard.`,
                ),
                meta: { stopLoop: true },
            }
        } catch (err) {
            const error = toAppError(err)
            return { success: false, result: error.message }
        }
    },

    async start_task_execution(args) {
        try {
            const planId = args.planId as string | undefined

            // 验证计划存在且可执行
            const store = agentStorePlanBridge

            const plan = planId
                ? store.getPlanById(planId)
                : store.getActivePlan()

            if (!plan) {
                return {
                    success: false,
                    result: getLocalizedText(
                        getCurrentLanguage(),
                        '错误：未找到可执行的任务规划。开始执行前，你需要先用 `create_task_plan` 创建规划。\n\n请按这个顺序进行：\n1. 使用 `ask_user` 收集需求\n2. 使用 `create_task_plan` 创建规划\n3. 等待用户审核并确认\n4. 然后再使用 `start_task_execution`',
                        'Error: No task plan found. You must first create a plan using `create_task_plan` before starting execution.\n\nPlease:\n1. Use `ask_user` to gather requirements\n2. Use `create_task_plan` to create a plan\n3. Wait for user to review and approve\n4. Then use `start_task_execution`',
                    )
                }
            }

            if (plan.tasks.length === 0) {
                return {
                    success: false,
                    result: getLocalizedText(
                        getCurrentLanguage(),
                        '错误：当前规划没有任务，请先使用 `update_task_plan` 添加任务。',
                        'Error: Plan has no tasks. Use `update_task_plan` to add tasks first.',
                    )
                }
            }

            if (plan.status === 'executing') {
                return {
                    success: false,
                    result: getLocalizedText(
                        getCurrentLanguage(),
                        '错误：当前规划已经在执行中。',
                        'Error: Plan is already being executed.',
                    )
                }
            }

            // Graph Runtime 阶段六：graphVersion=2 计划结构完整性校验（拦截非法图计划）
            const { validatePlan, formatValidationIssues } = await import('../planner/planValidator')
            const validation = validatePlan(plan)
            if (!validation.valid) {
                const issueText = formatValidationIssues(validation)
                return {
                    success: false,
                    result: getLocalizedText(
                        getCurrentLanguage(),
                        `错误：图计划校验失败，存在 ${validation.issues.filter(i => i.severity === 'error').length} 个严重问题：\n${issueText}\n\n请使用 update_task_plan 修正边定义或节点配置后重试。`,
                        `Error: Graph plan validation failed with ${validation.issues.filter(i => i.severity === 'error').length} error(s):\n${issueText}\n\nPlease fix edge definitions or node config via update_task_plan and retry.`,
                    ),
                }
            }

            const { startPlanExecution } = await import('../planner/taskExecutor')

            // 异步启动执行（不等待完成）
            const result = await startPlanExecution(plan.id)

            if (!result.success) {
                return { success: false, result: result.message }
            }

            return {
                success: true,
                result: getLocalizedText(
                    getCurrentLanguage(),
                    `已开始执行规划“${plan.name}”，共 ${plan.tasks.length} 个任务。\n\n进度会显示在 ExecutionBoard 中。`,
                    `Started executing plan "${plan.name}" with ${plan.tasks.length} tasks.\n\nProgress will be shown in the ExecutionBoard.`,
                ),
                meta: { stopLoop: true },
            }
        } catch (err) {
            const error = toAppError(err)
            return { success: false, result: error.message }
        }
    },

    /**
     * 动态添加图节点（Graph Runtime 阶段三）
     *
     * 委托给 graphToolExecutors.executeAddNode，通过 GraphExecutionBridge 定位
     * 当前执行中的图（graphVersion=2）并调用 GraphScheduler.addNode 扩展图。
     * 实现独立于本文件，便于单独测试与演进。
     */
    async add_node(args, ctx) {
        return executeAddNode(args, ctx)
    },

    /**
     * 动态添加图边（Graph Runtime 阶段三）
     *
     * 委托给 graphToolExecutors.executeAddEdge，调用 GraphScheduler.addEdge
     * 为节点添加出边（simple/conditional/loop）。
     */
    async add_edge(args, ctx) {
        return executeAddEdge(args, ctx)
    },

    async uiux_search(args) {
        const { uiuxDatabase } = await import('./uiux')

        const query = args.query as string
        const domain = args.domain as string | undefined
        const stack = args.stack as string | undefined
        const maxResults = (args.max_results as number) || 3

        try {
            await uiuxDatabase.initialize()

            // 如果指定了 stack，搜索技术栈指南
            if (stack) {
                // 验证 stack 类型
                const validStacks = ['html-tailwind', 'react', 'nextjs', 'vue', 'svelte', 'swiftui', 'react-native', 'flutter'] as const
                const techStack = (validStacks as readonly string[]).includes(stack) ? stack as import('./uiux').TechStack : 'react'

                const result = await uiuxDatabase.searchStack(query, techStack, maxResults)
                if (result.count === 0) {
                    return {
                        success: true,
                        result: `No ${stack} guidelines found for "${query}". Try different keywords.`
                    }
                }
                return {
                    success: true,
                    result: formatUiuxResults(result),
                    richContent: [{
                        type: 'json' as const,
                        text: JSON.stringify(result, null, 2),
                        title: `${stack} Guidelines: ${query}`,
                    }],
                }
            }

            // 否则搜索域数据
            // 验证 domain 类型
            const validDomains = ['style', 'color', 'typography', 'chart', 'landing', 'product', 'ux', 'prompt'] as const
            const uiuxDomain = domain && (validDomains as readonly string[]).includes(domain) ? domain as import('./uiux').UiuxDomain : undefined

            const result = await uiuxDatabase.search(query, uiuxDomain, maxResults)
            if (result.count === 0) {
                return {
                    success: true,
                    result: `No ${result.domain} results found for "${query}". Try different keywords or specify a different domain.`
                }
            }

            return {
                success: true,
                result: formatUiuxResults(result),
                richContent: [{
                    type: 'json' as const,
                    text: JSON.stringify(result, null, 2),
                    title: `UI/UX ${result.domain}: ${query}`,
                }],
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `UI/UX search failed: ${toAppError(err).message}`,
            }
        }
    },

    async uiux_recommend(args) {
        const { uiuxDatabase } = await import('./uiux')

        const productType = args.product_type as string

        try {
            await uiuxDatabase.initialize()
            const recommendation = await uiuxDatabase.getRecommendation(productType)

            if (!recommendation.product) {
                return {
                    success: true,
                    result: `No product type found matching "${productType}". Try: saas, e-commerce, fintech, healthcare, gaming, portfolio, etc.`,
                }
            }

            const result = formatRecommendation(productType, recommendation)

            return {
                success: true,
                result,
                richContent: [{
                    type: 'json' as const,
                    text: JSON.stringify(recommendation, null, 2),
                    title: `Design Recommendation: ${productType}`,
                }],
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `UI/UX recommendation failed: ${toAppError(err).message}`,
            }
        }
    },

    async remember(args, _ctx) {
        const content = args.content as string
        if (!content) return { success: false, result: '', error: 'Missing content' }

        try {
            await memoryService.addMemory(content)
            return {
                success: true,
                result: `Successfully remembered: ${content}`,
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Failed to remember: ${toAppError(err).message}`,
            }
        }
    },

    async knowledge_search(args, _ctx) {
        const query = args.query as string
        if (!query) return { success: false, result: '', error: 'Missing query' }

        try {
            const category = args.category as KnowledgeCategory | undefined
            const deepSearch = args.deep_search as boolean | undefined

            if (deepSearch) {
                const queries = [
                    query,
                    ...query.split(/\s+/).filter(w => w.length > 3).slice(0, 3).map(w => w),
                ]
                if (query.includes(' of ') || query.includes(' 的 ')) {
                    const parts = query.split(/\s+(?:of|的)\s+/)
                    queries.push(...parts.filter(p => p.length > 2))
                }

                const allResults = new Map<string, { entry: KnowledgeEntry; score: number }>()
                for (const q of queries) {
                    const results = await knowledgeService.semanticSearch({
                        query: q,
                        category,
                        limit: 15,
                    })
                    for (const r of results) {
                        const existing = allResults.get(r.entry.id)
                        if (existing) {
                            existing.score = Math.max(existing.score, r.score)
                        } else {
                            allResults.set(r.entry.id, { entry: r.entry, score: r.score })
                        }
                    }
                }

                const results = [...allResults.values()]
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 20)

                if (results.length === 0) {
                    return {
                        success: true,
                        result: 'No relevant knowledge entries found (deep search).',
                    }
                }

                const lines = results.map(r => {
                    const entry = r.entry
                    const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : ''
                    return `- [${entry.category}]${tags} ${entry.content} (score: ${r.score.toFixed(1)}, source: ${entry.source})`
                })

                return {
                    success: true,
                    result: `Deep search found ${results.length} relevant knowledge entries:\n${lines.join('\n')}`,
                }
            }

            const results = await knowledgeService.semanticSearch({
                query,
                category,
                limit: 10,
            })

            if (results.length === 0) {
                return {
                    success: true,
                    result: 'No relevant knowledge entries found.',
                }
            }

            const lines = results.map(r => {
                const entry = r.entry
                const tags = entry.tags.length > 0 ? ` [${entry.tags.join(', ')}]` : ''
                return `- [${entry.category}]${tags} ${entry.content} (score: ${r.score.toFixed(1)}, source: ${entry.source})`
            })

            return {
                success: true,
                result: `Found ${results.length} relevant knowledge entries:\n${lines.join('\n')}`,
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Knowledge search failed: ${toAppError(err).message}`,
            }
        }
    },

    async apply_skill(args, _ctx) {
        const skillName = args.skill_name as string
        if (!skillName) return { success: false, result: '', error: 'Missing skill_name' }

        try {
            const skill = await skillService.getSkillByName(skillName)
            if (!skill) {
                return {
                    success: false,
                    result: '',
                    error: `Skill "${skillName}" not found. Check available skills in the system prompt.`,
                }
            }

            // skill 安装目录
            const installPath = skill.filePath.replace(/[/\\]SKILL\.md$/i, '')
            const isWin = platform.isWindows
            const normalizedPath = isWin ? installPath.replace(/\//g, '\\') : installPath

            // 扫描 skill 目录下的所有文件，让 AI 知道有哪些脚本可用
            let fileTree = ''
            try {
                const items = await api.file.readDir(installPath)
                if (items && items.length > 0) {
                    const listFiles = async (dir: string, prefix: string): Promise<string[]> => {
                        const entries = await api.file.readDir(dir)
                        if (!entries) return []
                        const lines: string[] = []
                        for (const entry of entries) {
                            if (entry.name === 'SKILL.md' || entry.name.startsWith('.') || entry.name === 'node_modules') continue
                            const entryPath = `${dir}${isWin ? '\\' : '/'}${entry.name}`
                            if (entry.isDirectory) {
                                lines.push(`${prefix}${entry.name}/`)
                                lines.push(...await listFiles(entryPath, prefix + '  '))
                            } else {
                                lines.push(`${prefix}${entry.name}`)
                            }
                        }
                        return lines
                    }
                    const tree = await listFiles(installPath, '  ')
                    if (tree.length > 0) {
                        fileTree = `\n\n## Skill Directory Contents\n\`\`\`\n${normalizedPath}/\n${tree.join('\n')}\n\`\`\``
                    }
                }
            } catch {
                // 扫描失败不影响主流程
            }

            const scriptHint = isWin
                ? `On Windows: use \`node\` for .js, \`python\` for .py, \`cmd /c\` for .bat/.cmd`
                : `Use \`bash\` for .sh, \`node\` for .js, \`python\` for .py`

            const result = [
                `<skill name="${skill.name}" path="${normalizedPath}">`,
                skill.content,
                `</skill>`,
                fileTree,
                ``,
                `## Execution Guidelines`,
                `- **Working Directory (CRITICAL)**: Set \`cwd\` to \`${normalizedPath}\` for ALL shell commands from this skill`,
                `- **Scripts**: If the skill references scripts or commands, execute them from the skill directory. ${scriptHint}`,
                `- **Relative Paths**: All relative paths in the skill instructions are relative to \`${normalizedPath}\``,
            ].join('\n')

            return { success: true, result }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Failed to load skill: ${toAppError(err).message}`,
            }
        }
    },

    async schedule(args, _ctx) {
        const action = args.action as string
        if (!action) return { success: false, result: '', error: 'Missing action parameter' }

        try {
            switch (action) {
                case 'create': {
                    const name = args.name as string
                    const pattern = args.pattern as string
                    const command = args.command as string
                    if (!name || !pattern || !command) {
                        return { success: false, result: '', error: 'create requires: name, pattern, command' }
                    }
                    const result = await api.cron.register({
                        name,
                        description: (args.description as string) || '',
                        expression: pattern,
                        command,
                        maxCalls: (args.max_calls as number) || 0,
                        active: true,
                    })
                    if (!result.success) return { success: false, result: '', error: 'Failed to create task' }
                    const task = result.task
                    return {
                        success: true,
                        result: `Created scheduled task "${task.name}" (ID: ${task.id})\nPattern: ${task.expression}\nCommand: ${task.command}\nNext run: ${task.nextRunAt > 0 ? new Date(task.nextRunAt).toLocaleString() : 'N/A'}${task.maxCalls > 0 ? `\nMax calls: ${task.maxCalls}` : ''}`,
                    }
                }

                case 'list': {
                    const result = await api.cron.getAllTasks()
                    if (!result.success || !result.tasks || result.tasks.length === 0) {
                        return { success: true, result: 'No scheduled tasks found.' }
                    }
                    const lines = result.tasks.map((t: any) => {
                        const status = t.status === 'active' ? '●' : t.status === 'paused' ? '○' : '◉'
                        const nextRun = t.nextRunAt > 0 ? new Date(t.nextRunAt).toLocaleString() : 'N/A'
                        const maxInfo = t.maxCalls > 0 ? ` | ${t.runCount}/${t.maxCalls}` : ` | ${t.runCount} runs`
                        return `${status} ${t.name} (${t.id})\n  Pattern: ${t.expression} | Status: ${t.status}${maxInfo}\n  Command: ${t.command.substring(0, 80)}${t.command.length > 80 ? '...' : ''}\n  Next: ${nextRun}`
                    })
                    return { success: true, result: `Scheduled Tasks:\n\n${lines.join('\n\n')}` }
                }

                case 'update': {
                    const taskId = args.task_id as string
                    if (!taskId) return { success: false, result: '', error: 'update requires: task_id' }
                    const updates: Record<string, any> = {}
                    if (args.name !== undefined) updates.name = args.name
                    if (args.description !== undefined) updates.description = args.description
                    if (args.pattern !== undefined) updates.expression = args.pattern
                    if (args.command !== undefined) updates.command = args.command
                    if (args.max_calls !== undefined) updates.maxCalls = args.max_calls
                    const result = await api.cron.update(taskId, updates)
                    if (!result.success) return { success: false, result: '', error: result.error || 'Failed to update task' }
                    return { success: true, result: `Updated task "${result.task.name}" (${taskId})` }
                }

                case 'delete': {
                    const taskId = args.task_id as string
                    if (!taskId) return { success: false, result: '', error: 'delete requires: task_id' }
                    const result = await api.cron.unregister(taskId)
                    if (!result.success) return { success: false, result: '', error: 'Task not found or already deleted' }
                    return { success: true, result: `Deleted scheduled task (${taskId})` }
                }

                case 'toggle': {
                    const taskId = args.task_id as string
                    const enabled = args.enabled as boolean
                    if (!taskId || enabled === undefined) return { success: false, result: '', error: 'toggle requires: task_id, enabled' }
                    const result = enabled
                        ? await api.cron.resume(taskId)
                        : await api.cron.pause(taskId)
                    if (!result.success) return { success: false, result: '', error: `Failed to ${enabled ? 'enable' : 'disable'} task` }
                    return { success: true, result: `Task ${taskId} ${enabled ? 'enabled' : 'disabled'}` }
                }

                default:
                    return { success: false, result: '', error: `Unknown action: ${action}. Use: create, list, update, delete, toggle` }
            }
        } catch (err) {
            return {
                success: false,
                result: '',
                error: `Schedule operation failed: ${toAppError(err).message}`,
            }
        }
    },

    async todo_write(args) {
        if (useStore.getState().teamModeEnabled) {
            return { success: true, result: 'Task list skipped in team mode' }
        }

        const todos = args.todos as Array<{ content: string; status: string; activeForm: string }>
        if (!Array.isArray(todos)) {
            return { success: false, result: '', error: 'todos must be an array' }
        }

        const store = agentStoreTodoBridge

        if (todos.length === 0) {
            store.setTodos([])
            return { success: true, result: 'Task list cleared' }
        }

        for (const todo of todos) {
            if (!todo.content || !todo.status || !todo.activeForm) {
                return { success: false, result: '', error: 'Each todo must have content, status, and activeForm' }
            }
            if (!['pending', 'in_progress', 'verifying', 'completed'].includes(todo.status)) {
                return { success: false, result: '', error: `Invalid status: ${todo.status}` }
            }
        }

        const currentTodos: Array<{ content: string; status: string; activeForm: string }> = useAgentStore.getState().getTodos() || []
        const newContents = new Set(todos.map(t => t.content.trim()))
        const lostCompleted = currentTodos.filter(
            (t: { content: string; status: string; activeForm: string }) => t.status === 'completed' && !newContents.has(t.content.trim())
        )
        const merged = [...lostCompleted, ...todos]

        store.setTodos(
            merged.map(t => ({
                content: t.content,
                status: t.status as 'pending' | 'in_progress' | 'verifying' | 'completed',
                activeForm: t.activeForm,
            }))
        )

        const completed = merged.filter(t => t.status === 'completed').length
        const inProgress = merged.find(t => t.status === 'in_progress')
        const allCompleted = merged.every(t => t.status === 'completed')
        const summary = allCompleted
            ? `All ${merged.length} tasks completed.`
            : `Task list updated (${completed}/${merged.length} completed)` +
              (inProgress ? `. Currently: ${inProgress.activeForm}` : '')
        return { success: true, result: summary }
    },

    async send_file_to_channel(args, ctx) {
        const filePath = args.file_path as string
        if (!filePath) {
            return { success: false, result: '', error: 'file_path is required' }
        }

        const threadId = ctx.threadId
        if (!threadId) {
            return { success: false, result: '', error: 'No active thread context for channel file sending' }
        }

        const { channelConversationService } = await import('../runtime/channelConversationService')
        const conversationKey = channelConversationService.getConversationKey(threadId)
        if (!conversationKey) {
            return { success: false, result: '', error: 'No active channel conversation for this thread' }
        }

        const fileName = (args.file_name as string) || undefined
        const mediaType = (args.media_type as 'file' | 'image' | 'audio' | 'video') || 'file'

        try {
            const result = await api.channel.sendFile(conversationKey, filePath, fileName, mediaType)
            if (result.success) {
                return { success: true, result: `File sent successfully: ${filePath}` }
            }
            return { success: false, result: '', error: result.error || 'Failed to send file' }
        } catch (err) {
            return { success: false, result: '', error: `Failed to send file: ${toAppError(err).message}` }
        }
    },
}


/**
 * 格式化 UI/UX 搜索结果为可读文本
 */
function formatUiuxResults(result: { domain: string; query: string; count: number; results: Record<string, unknown>[]; stack?: string }): string {
    const lines: string[] = []

    if (result.stack) {
        lines.push(`## ${result.stack} Guidelines for "${result.query}"`)
    } else {
        lines.push(`## UI/UX ${result.domain} results for "${result.query}"`)
    }
    lines.push(`Found ${result.count} result(s)\n`)

    for (let i = 0; i < result.results.length; i++) {
        const item = result.results[i]
        lines.push(`### Result ${i + 1}`)

        for (const [key, value] of Object.entries(item)) {
            if (value && String(value).trim()) {
                lines.push(`- **${key}**: ${value}`)
            }
        }
        lines.push('')
    }

    return lines.join('\n')
}

/**
 * 格式化设计推荐结果
 */
function formatRecommendation(
    productType: string,
    rec: {
        product: Record<string, unknown> | null
        style: Record<string, unknown> | null
        prompt: Record<string, unknown> | null
        color: Record<string, unknown> | null
        typography: Record<string, unknown> | null
        landing: Record<string, unknown> | null
    }
): string {
    const lines: string[] = []

    lines.push(`# Design Recommendation for "${productType}"`)
    lines.push('')

    // Product Overview
    if (rec.product) {
        lines.push('## Product Analysis')
        lines.push(`- **Type**: ${rec.product['Product Type'] || productType}`)
        lines.push(`- **Recommended Style**: ${rec.product['Primary Style Recommendation'] || 'N/A'}`)
        lines.push(`- **Secondary Styles**: ${rec.product['Secondary Styles'] || 'N/A'}`)
        lines.push(`- **Color Focus**: ${rec.product['Color Palette Focus'] || 'N/A'}`)
        lines.push(`- **Key Considerations**: ${rec.product['Key Considerations'] || 'N/A'}`)
        lines.push('')
    }

    // Style Details
    if (rec.style) {
        lines.push('## UI Style')
        lines.push(`- **Style**: ${rec.style['Style Category'] || 'N/A'}`)
        lines.push(`- **Keywords**: ${rec.style['Keywords'] || 'N/A'}`)
        lines.push(`- **Primary Colors**: ${rec.style['Primary Colors'] || 'N/A'}`)
        lines.push(`- **Effects**: ${rec.style['Effects & Animation'] || 'N/A'}`)
        lines.push(`- **Best For**: ${rec.style['Best For'] || 'N/A'}`)
        lines.push('')
    }

    // CSS/Tailwind Keywords
    if (rec.prompt) {
        lines.push('## Implementation Keywords')
        lines.push(`- **AI Prompt**: ${rec.prompt['AI Prompt Keywords (Copy-Paste Ready)'] || 'N/A'}`)
        lines.push(`- **CSS/Technical**: ${rec.prompt['CSS/Technical Keywords'] || 'N/A'}`)
        lines.push(`- **Design Variables**: ${rec.prompt['Design System Variables'] || 'N/A'}`)
        lines.push('')
    }

    // Color Palette
    if (rec.color) {
        lines.push('## Color Palette')
        lines.push(`- **Product Type**: ${rec.color['Product Type'] || 'N/A'}`)
        lines.push(`- **Primary**: ${rec.color['Primary Color'] || rec.color['Primary Colors'] || 'N/A'}`)
        lines.push(`- **Secondary**: ${rec.color['Secondary Color'] || rec.color['Secondary Colors'] || 'N/A'}`)
        lines.push(`- **Accent**: ${rec.color['Accent Color'] || rec.color['Accent Colors'] || 'N/A'}`)
        lines.push(`- **Background**: ${rec.color['Background'] || 'N/A'}`)
        lines.push('')
    }

    // Typography
    if (rec.typography) {
        lines.push('## Typography')
        lines.push(`- **Pairing**: ${rec.typography['Pairing Name'] || rec.typography['Font Pairing'] || 'N/A'}`)
        lines.push(`- **Heading Font**: ${rec.typography['Heading Font'] || 'N/A'}`)
        lines.push(`- **Body Font**: ${rec.typography['Body Font'] || 'N/A'}`)
        lines.push(`- **Google Fonts**: ${rec.typography['Google Fonts Import'] || 'N/A'}`)
        lines.push(`- **Tailwind Config**: ${rec.typography['Tailwind Config'] || 'N/A'}`)
        lines.push('')
    }

    // Landing Page Pattern
    if (rec.landing) {
        lines.push('## Landing Page Pattern')
        lines.push(`- **Pattern**: ${rec.landing['Pattern Name'] || 'N/A'}`)
        lines.push(`- **Section Order**: ${rec.landing['Section Order'] || 'N/A'}`)
        lines.push(`- **CTA Placement**: ${rec.landing['Primary CTA Placement'] || 'N/A'}`)
        lines.push(`- **Color Strategy**: ${rec.landing['Color Strategy'] || 'N/A'}`)
        lines.push(`- **Effects**: ${rec.landing['Recommended Effects'] || 'N/A'}`)
        lines.push('')
    }

    return lines.join('\n')
}

export const toolExecutors = Object.fromEntries(
    Object.entries(rawToolExecutors).map(([name, executor]) => [
        name,
        async (args: Record<string, unknown>, ctx: ToolExecutionContext): Promise<ToolExecutionResult> => {
            // timeoutMs = 0 表示不限制超时（AI 执行命令时取消超时限制）
            const timeoutMs = 0
            let timer: ReturnType<typeof setTimeout>

            try {
                const resultPromise = executor(args, ctx)
                if (timeoutMs > 0) {
                    return await Promise.race([
                        resultPromise,
                        new Promise<ToolExecutionResult>((_, reject) => {
                            timer = setTimeout(() => reject(new Error(`Tool [${name}] execution timed out after ${timeoutMs / 1000}s`)), timeoutMs)
                        })
                    ]).finally(() => clearTimeout(timer))
                }
                return await resultPromise
            } catch (err) {
                logger.agent.error(`[ToolExecutor] Error executing ${name}:`, err)
                return {
                    success: false,
                    result: '',
                    error: `Tool execution error: ${toAppError(err).message}`
                }
            }
        }
    ])
) as Record<string, (args: Record<string, unknown>, ctx: ToolExecutionContext) => Promise<ToolExecutionResult>>

/**
 * 初始化工具注册表
 * 注意：每次调用都会更新 globalExecutors，支持热重载
 */
export async function initializeTools(): Promise<void> {
    // 每次都调用 registerAll 以更新 globalExecutors（支持热重载）
    // registerAll 内部会更新 globalExecutors 引用
    toolRegistry.registerAll(toolExecutors)
}
