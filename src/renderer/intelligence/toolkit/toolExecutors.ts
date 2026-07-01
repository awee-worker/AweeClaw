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
import { getAccessToken, getServerUrl } from '@services/backendApi'
import { composerService } from '../runtime/composerEngine'
import { agentStorePlanBridge, agentStoreTodoBridge } from '../state/intelligenceBridge'
import { useAgentStore } from '../state/IntelligenceStore'
import { buildFileChangeDescriptor } from '@intelligence/utils/fileMutationHelper'
import { EventBus } from '../engine/EventDispatcher'
import { isLongRunningCommand } from './commandExecutor'
import { internalWriteTracker } from '@services/writeTracker'
import { toolRegistry } from './toolRegistry'
import { terminalManager } from '@services/TerminalAdapter'
import pLimit from 'p-limit'
import { skillService } from '../runtime/skillRepository'
import type { Language } from '@renderer/i18n'
import type { ReplaceErrorCode } from '@utils/smartReplace'
import { resolveAgentLanguage, pickLocalizedText, translateAgentText } from '@intelligence/utils/intelligenceTextUtils'
import { guardWriteFile } from './fileWritePolicy'

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

function notifyWorkspaceTreeChange(opts: {
    workspacePath: string
    targetPath: string
    changeType: 'create' | 'modify' | 'delete'
    isDirectory?: boolean
}): void {
    if (typeof window === 'undefined' || !opts.targetPath) return

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


// ─── 文档提取辅助函数（模块级，供 extract_document 执行器调用） ───

/** 文档提取结果构建选项 */
interface ExtractResultOptions {
    sheetNames?: string[]
    ocrUsed?: boolean
    source?: 'local' | 'backend'
}

/**
 * 构建提取结果（统一格式化输出）
 * - 大文件截断保护（100KB）
 * - 输出带元信息的轻量 Markdown
 */
function buildExtractResult(
    ext: string,
    rawText: string,
    startTime: number,
    options: ExtractResultOptions = {},
): ToolExecutionResult {
    const MAX_LEN = 100 * 1024
    const truncated = rawText.length > MAX_LEN
    const content = truncated
        ? rawText.slice(0, MAX_LEN) + `\n\n...(已截断，共 ${rawText.length} 字符)`
        : rawText

    const durationMs = Date.now() - startTime
    const source = options.source || 'local'

    const meta = [
        `格式: ${ext}`,
        `字符数: ${rawText.length}${truncated ? ` (已截断至 ${MAX_LEN})` : ''}`,
        options.sheetNames && options.sheetNames.length > 0 ? `工作表: ${options.sheetNames.join(', ')}` : '',
        `OCR: ${options.ocrUsed ? '是' : '否'}`,
        `来源: ${source === 'backend' ? '后端兜底' : '本地'}`,
        `耗时: ${durationMs}ms`,
    ].filter(Boolean).join(' | ')

    const result = `> 📄 文档提取: ${meta}\n\n${content}`

    logger.agent.info(`[extract_document] Success: format=${ext}, chars=${rawText.length}, source=${source}, duration=${durationMs}ms`)

    return { success: true, result }
}

/**
 * 本地提取（IPC 调用 main 进程原生库）
 * 调用 api.file.extractXxxText 系列函数，对应格式自动分发
 */
async function extractDocumentLocal(
    filePath: string,
    ext: string,
    startTime: number,
): Promise<ToolExecutionResult> {
    try {
        let rawText: string | null = null
        let sheetNames: string[] | undefined

        switch (ext) {
            case 'pdf':
                rawText = await api.file.extractPdfText(filePath)
                break
            case 'docx':
                rawText = await api.file.extractDocxText(filePath)
                break
            case 'doc':
                rawText = await api.file.extractDocText(filePath)
                break
            case 'xlsx':
            case 'xls':
            case 'csv':
                rawText = await api.file.extractXlsxText(filePath)
                sheetNames = rawText?.match(/## Sheet: (.+)/g)?.map(m => m.replace('## Sheet: ', '')) || []
                break
            case 'ppt':
            case 'pptx':
                rawText = await api.file.extractPptText(filePath)
                break
            case 'txt':
            case 'md':
                rawText = await api.file.read(filePath)
                break
        }

        if (!rawText || rawText.trim().length === 0) {
            const durationMs = Date.now() - startTime
            return {
                success: false,
                result: '',
                error: `本地文本提取为空（耗时 ${durationMs}ms）。该文档可能是扫描版/图片型，需要 OCR 或后端兜底。`,
            }
        }

        return buildExtractResult(ext, rawText, startTime, { sheetNames, source: 'local' })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.agent.warn(`[extract_document] Local failed: ${filePath}, error: ${message}`)
        return {
            success: false,
            result: '',
            error: `本地提取失败: ${message}`,
        }
    }
}

/**
 * 后端兜底提取（multipart/form-data 上传文件到 /api/v1/document-extract）
 * 当本地提取失败或返回空内容时触发，复用后端的提取能力（含未来 OCR 扩展）
 */
async function extractDocumentViaBackend(
    filePath: string,
    ext: string,
    startTime: number,
): Promise<ToolExecutionResult> {
    const serverUrl = getServerUrl()
    const accessToken = getAccessToken()

    if (!serverUrl) {
        logger.agent.warn(`[extract_document] Backend fallback skipped: server URL not configured`)
        return { success: false, result: '', error: '后端服务未配置，无法兜底' }
    }

    try {
        // 1. 读取文件二进制数据（readBinary 返回 base64 字符串）
        const base64Data = await api.file.readBinary(filePath)
        if (!base64Data) {
            return { success: false, result: '', error: `无法读取文件: ${filePath}` }
        }
        const filename = filePath.split(/[\\/]/).pop() || `document.${ext}`

        // 2. base64 解码为 Uint8Array，构建 FormData 上传
        const binaryString = atob(base64Data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }
        const formData = new FormData()
        const blob = new Blob([bytes])
        formData.append('file', blob, filename)

        // 3. 调用后端接口
        const response = await fetch(`${serverUrl}/api/v1/document-extract`, {
            method: 'POST',
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            body: formData,
        })

        if (!response.ok) {
            const errText = await response.text().catch(() => '')
            logger.agent.warn(`[extract_document] Backend HTTP ${response.status}: ${errText}`)
            return { success: false, result: '', error: `后端提取失败 (HTTP ${response.status})` }
        }

        const json = await response.json() as {
            success: boolean
            data?: {
                format: string
                content: string
                meta: {
                    charCount: number
                    sheetNames?: string[]
                    ocrUsed: boolean
                    durationMs: number
                    truncated: boolean
                }
                error?: string
            }
        }

        if (!json.success || !json.data?.content) {
            return {
                success: false,
                result: '',
                error: json.data?.error || '后端提取返回空内容，可能为扫描版需 OCR',
            }
        }

        return buildExtractResult(ext, json.data.content, startTime, {
            sheetNames: json.data.meta.sheetNames,
            ocrUsed: json.data.meta.ocrUsed,
            source: 'backend',
        })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.agent.warn(`[extract_document] Backend fallback failed: ${filePath}, error: ${message}`)
        return { success: false, result: '', error: `后端兜底失败: ${message}` }
    }
}

/**
 * 后端流式兜底提取（SSE，分块接收内容）
 *
 * 调用后端 POST /api/v1/document-extract/stream：
 * - 服务端推送 progress 事件（cache_check / extracting / ocr_start / ocr_progress）
 * - 内容分块通过 content 事件推送（每块 8KB），客户端按 index 顺序拼接
 * - 最终 done 事件携带元信息（format / meta / error）
 *
 * 适用场景：大文件提取、扫描版 PDF OCR 等耗时操作，避免 HTTP 长连接超时，
 * 同时支持流式注入 AI 上下文（边接收边显示进度）。
 *
 * 失败回退：若 SSE 建立失败，自动回退到非流式 extractDocumentViaBackend。
 */
async function extractDocumentViaBackendStream(
    filePath: string,
    ext: string,
    startTime: number,
): Promise<ToolExecutionResult> {
    const serverUrl = getServerUrl()
    const accessToken = getAccessToken()

    if (!serverUrl) {
        return extractDocumentViaBackend(filePath, ext, startTime)
    }

    try {
        const base64Data = await api.file.readBinary(filePath)
        if (!base64Data) {
            return { success: false, result: '', error: `无法读取文件: ${filePath}` }
        }
        const filename = filePath.split(/[\\/]/).pop() || `document.${ext}`

        const binaryString = atob(base64Data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }
        const formData = new FormData()
        const blob = new Blob([bytes])
        formData.append('file', blob, filename)

        const response = await fetch(`${serverUrl}/api/v1/document-extract/stream`, {
            method: 'POST',
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
            body: formData,
        })

        if (!response.ok || !response.body) {
            logger.agent.warn(`[extract_document] Stream HTTP ${response.status}, fallback to non-stream`)
            return extractDocumentViaBackend(filePath, ext, startTime)
        }

        // ── SSE 解析 ──
        const reader = response.body.getReader()
        const decoder = new TextDecoder('utf-8')
        let buffer = ''

        /** 按序号缓存的内容块 */
        const chunks = new Map<number, string>()
        let totalChunks = 0
        let doneMeta: {
            success: boolean
            format?: string
            meta?: { sheetNames?: string[]; ocrUsed?: boolean; charCount?: number; durationMs?: number }
            error?: string
        } | null = null

        /** 解析 SSE 事件块 */
        const parseSseEvents = (raw: string): Array<{ event: string; data: string }> => {
            const events: Array<{ event: string; data: string }> = []
            const blocks = raw.split('\n\n')
            for (const block of blocks) {
                if (!block.trim()) continue
                let event = 'message'
                let data = ''
                for (const line of block.split('\n')) {
                    if (line.startsWith('event: ')) event = line.slice(7).trim()
                    else if (line.startsWith('data: ')) data += line.slice(6)
                }
                events.push({ event, data })
            }
            return events
        }

        while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })

            // 按空行切分事件
            const lastDoubleNewline = buffer.lastIndexOf('\n\n')
            if (lastDoubleNewline === -1) continue

            const rawEvents = buffer.slice(0, lastDoubleNewline + 2)
            buffer = buffer.slice(lastDoubleNewline + 2)

            for (const { event, data } of parseSseEvents(rawEvents)) {
                try {
                    const payload = JSON.parse(data)
                    if (event === 'progress') {
                        logger.agent.info(
                            `[extract_document] Stream progress: ${payload.stage} ${payload.percent}% - ${payload.message}`,
                        )
                    } else if (event === 'content') {
                        chunks.set(payload.index, payload.chunk)
                        totalChunks = Math.max(totalChunks, payload.total)
                    } else if (event === 'done') {
                        doneMeta = payload
                    } else if (event === 'error') {
                        logger.agent.warn(`[extract_document] Stream error event: ${payload.message}`)
                        return { success: false, result: '', error: `后端流式提取失败: ${payload.message}` }
                    }
                } catch (err) {
                    logger.agent.warn(`[extract_document] SSE parse error: ${err instanceof Error ? err.message : err}`)
                }
            }
        }

        if (!doneMeta || !doneMeta.success) {
            return {
                success: false,
                result: '',
                error: doneMeta?.error || '后端流式提取返回失败',
            }
        }

        // 按 index 顺序拼接内容
        let content = ''
        for (let i = 0; i < totalChunks; i++) {
            content += chunks.get(i) || ''
        }

        if (!content) {
            return { success: false, result: '', error: '后端流式提取返回空内容' }
        }

        return buildExtractResult(ext, content, startTime, {
            sheetNames: doneMeta.meta?.sheetNames,
            ocrUsed: doneMeta.meta?.ocrUsed,
            source: 'backend',
        })
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        logger.agent.warn(`[extract_document] Stream failed, fallback: ${message}`)
        return extractDocumentViaBackend(filePath, ext, startTime)
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
        const config = resolveAgentConfig()
        const timeout = args.timeout
            ? (args.timeout as number) * 1000
            : config.toolTimeoutMs

        const isLongRunningProcess = isLongRunningCommand(command, isBackground)

        try {
            if (!isLongRunningProcess) {
                const directExecutionResult = await runInlineScriptViaTempFile(command, ctx, timeout)
                if (directExecutionResult) {
                    return directExecutionResult
                }

                const pythonFileResult = await tryRunPythonFile(command, ctx, timeout)
                if (pythonFileResult) {
                    return pythonFileResult
                }
            }


            // 先唤出面板，再创建/获取终端，避免竞态：
            // 若先创建终端，notify() 触发时面板还不可见 → useEffect 销毁刚创建的终端
            useStore.getState().setTerminalVisible(true)

            // 获取或复用 Agent 专属终端（初始 cwd 用工作区根目录，避免反复改变终端目录）
            const termId = await terminalManager.getOrCreateAgentTerminal(
                ctx.workspacePath || '/'
            )

            // 激活 Agent 终端 tab，让用户看到执行过程
            terminalManager.setActiveTerminal(termId)

            // === 长进程：直接写入并立即返回，让用户在终端里跟踪 ===
            if (isLongRunningProcess) {
                // 长进程也需要处理 cwd
                const bgCmd = resolvedCwd
                    ? (/windows/i.test(navigator.userAgent)
                        ? `Push-Location "${resolvedCwd}"; ${command}; Pop-Location`
                        : `(cd "${resolvedCwd}" && ${command})`)
                    : command
                terminalManager.writeToTerminal(termId, `${bgCmd}\r`)

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
                    result: `[Background Process Started]\nCommand: ${command}\nTerminal ID: ${termId}\nSession ID: ${detachedSession.commandSessionId}\n\nThe process is running in the Agent terminal panel. Use 'read_terminal_output' with terminal_id="${termId}" to check logs. Use 'send_terminal_input' to send input or Ctrl+C (is_ctrl=true). Use 'stop_terminal' to kill it.`,
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

            const commandResult = await terminalManager.executeCommandWithOutput(
                termId,
                command,
                timeout,
                resolvedCwd || undefined,
            )

            const displayOutput = (commandResult.output || commandResult.partialOutput || '').trim()
            let resultText = displayOutput

            if (!resultText) {
                if (commandResult.finalStatus === 'timed_out') {
                    resultText = `Command timed out after ${timeout / 1000}s`
                } else if (commandResult.exitCode === 0 && commandResult.finalStatus === 'completed') {
                    resultText = 'Command executed successfully (no output)'
                } else {
                    resultText = `Command finished with status ${commandResult.finalStatus}${commandResult.exitCode !== null ? ` (exit code ${commandResult.exitCode})` : ''} (no output)`
                }
            }

            if (commandResult.finalStatus === 'timed_out' && displayOutput) {
                resultText = `[Timed out after ${timeout / 1000}s]\n${displayOutput}`
            }

            if (commandResult.finalStatus === 'interrupted' && !commandResult.sentinelMatched) {
                resultText = displayOutput
                    ? `[Partial output captured before prompt recovery]\n${displayOutput}`
                    : 'Command ended without a sentinel. Partial output may have been recovered from the terminal prompt.'
            }

            if (commandResult.finalStatus === 'shell_exited' && displayOutput) {
                resultText = `[Shell exited while command was running]\n${displayOutput}`
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
        const timeout = (args.timeout as number) || 30
        const result = await api.http.webSearch(args.query as string, args.max_results as number, timeout * 1000)
        if (!result.success || !result.results) return { success: false, result: '', error: result.error || 'Search failed' }
        return { success: true, result: result.results.map((r: { title: string; url: string; snippet: string }) => `[${r.title}](${r.url})\n${r.snippet}`).join('\n\n') }
    },

    async read_url(args) {
        // timeout 参数单位是秒，转换为毫秒，最小 30 秒，默认 60 秒
        const timeoutSec = Math.max((args.timeout as number) || 60, 30)
        const result = await api.http.readUrl(args.url as string, timeoutSec * 1000)
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
        const tasks = args.tasks as Array<{
            title: string
            description: string
            suggestedProvider: string
            suggestedModel: string
            suggestedRole: string
            dependencies?: string[]
        }>
        const executionMode = (args.executionMode as 'sequential' | 'parallel') || 'sequential'

        if (!ctx.workspacePath) {
            return { success: false, result: 'No workspace path available' }
        }

        try {
            // 生成唯一 ID
            const timestamp = Date.now()
            const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 30)
            const planId = `${slug}-${timestamp}`

            const planDir = `${ctx.workspacePath}/${BRAND.dirName}/plan`
            await api.file.mkdir(planDir)

            // 保存需求文档 (markdown)
            const mdPath = `${planDir}/${planId}.md`
            internalWriteTracker.mark(mdPath)
            await api.file.write(mdPath, requirementsDoc)

            // 构建任务对象
            // 处理 "default" 值，转换为真实的默认配置
            const resolveDefault = (value: string | undefined, fallback: string) => {
                if (!value || value === 'default' || value === 'Default') return fallback
                return value
            }

            const planTasks = tasks.map((t, idx) => ({
                id: `task-${idx + 1}`,
                title: t.title,
                description: t.description,
                provider: resolveDefault(t.suggestedProvider, 'anthropic'),
                model: resolveDefault(t.suggestedModel, 'claude-sonnet-4-20250514'),
                role: resolveDefault(t.suggestedRole, 'coder'),
                dependencies: t.dependencies || [],
                status: 'pending' as const,
            }))

            // 构建规划对象
            const plan = {
                id: planId,
                name,
                createdAt: timestamp,
                updatedAt: timestamp,
                requirementsDoc: `${planId}.md`,
                executionMode,
                status: 'draft' as const,
                tasks: planTasks,
            }

            // 保存规划文件 (json)
            const jsonPath = `${planDir}/${planId}.json`
            internalWriteTracker.mark(jsonPath)
            await api.file.write(jsonPath, JSON.stringify(plan, null, 2))

            // 添加到 store 并打开 ExecutionBoard
            agentStorePlanBridge.addPlan(plan)

            // 打开 plan 文件（触发 ExecutionBoard 渲染）
            useStore.getState().openFile(jsonPath, JSON.stringify(plan, null, 2))

            return {
                success: true,
                result: getLocalizedText(
                    getCurrentLanguage(),
                    `已创建任务规划“${name}”，共 ${tasks.length} 个任务。\n规划文件：${jsonPath}\n需求文档：${mdPath}\n\nTaskBoard 已打开，请先审核规划，再点击“开始执行”。`,
                    `Created task plan "${name}" with ${tasks.length} tasks.\nPlan file: ${jsonPath}\nRequirements: ${mdPath}\n\nThe ExecutionBoard has been opened for user review. Please review the plan and click "Start Execution" to proceed.`,
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
            const addTasks = args.addTasks as Array<{
                title: string
                description: string
                suggestedProvider?: string
                suggestedModel?: string
                suggestedRole?: string
                insertAfter?: string
            }> | undefined
            const removeTasks = args.removeTasks as string[] | undefined
            const updateTasks = args.updateTasks as Array<{
                taskId: string
                title?: string
                description?: string
                provider?: string
                model?: string
                role?: string
            }> | undefined
            const executionMode = args.executionMode as 'sequential' | 'parallel' | undefined

            const store = agentStorePlanBridge
            const plan = store.getPlanById(planId)

            if (!plan) {
                return { success: false, result: `Plan not found: ${planId}` }
            }

            const changes: string[] = []

            // 更新需求文档
            if (updateRequirements) {
                const mdPath = `${ctx.workspacePath}/${BRAND.dirName}/planner/${plan.requirementsDoc}`
                const existingContent = (await api.file.read(mdPath)) || ''
                const newContent = `${existingContent}\n\n---\n## Updates\n${updateRequirements}`
                internalWriteTracker.mark(mdPath)
                await api.file.write(mdPath, newContent)
                changes.push('Updated requirements document')
            }

            // 删除任务
            if (removeTasks?.length) {
                const newTasks = plan.tasks.filter(t => !removeTasks.includes(t.id))
                store.updatePlan(planId, { tasks: newTasks })
                changes.push(`Removed ${removeTasks.length} tasks`)
            }

            // 添加任务
            if (addTasks?.length) {
                const timestamp = Date.now()
                const newTasks = addTasks.map((t, i) => ({
                    id: `task-${timestamp}-${i}`,
                    title: t.title,
                    description: t.description,
                    provider: t.suggestedProvider || 'anthropic',
                    model: t.suggestedModel || 'claude-sonnet-4-20250514',
                    role: t.suggestedRole || 'coder',
                    status: 'pending' as const,
                    dependencies: [],
                }))

                const currentPlan = store.getPlanById(planId)
                if (currentPlan) {
                    store.updatePlan(planId, { tasks: [...currentPlan.tasks, ...newTasks] })
                }
                changes.push(`Added ${addTasks.length} tasks`)
            }

            // 更新任务
            if (updateTasks?.length) {
                for (const update of updateTasks) {
                    store.updateTask(planId, update.taskId, {
                        title: update.title,
                        description: update.description,
                        provider: update.provider,
                        model: update.model,
                        role: update.role,
                    })
                }
                changes.push(`Updated ${updateTasks.length} tasks`)
            }

            // 更新执行模式
            if (executionMode) {
                store.updatePlan(planId, { executionMode })
                changes.push(`Changed execution mode to ${executionMode}`)
            }

            // 更新 JSON 文件
            const updatedPlan = store.getPlanById(planId)
            if (updatedPlan) {
                const jsonPath = `${ctx.workspacePath}/${BRAND.dirName}/planner/${planId}.json`
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
            let timeoutMs: number
            if (['generate_tests', 'run_command', 'edit_file', 'replace_file_content', 'web_search'].includes(name)) {
                timeoutMs = 120000
            } else {
                timeoutMs = 60000
            }
            let timer: ReturnType<typeof setTimeout>

            try {
                return await Promise.race([
                    executor(args, ctx),
                    new Promise<ToolExecutionResult>((_, reject) => {
                        timer = setTimeout(() => reject(new Error(`Tool [${name}] execution timed out after ${timeoutMs / 1000}s`)), timeoutMs)
                    })
                ]).finally(() => clearTimeout(timer))
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
