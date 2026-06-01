/**
 * [AweeClaw] 场景感知智能大文件策略引擎
 *
 * 与 Adnify 的 largeFileService 差异化：
 * - 函数名重命名：estimateLineCount → approximateLineCount, chunkFile → segmentContent,
 *   formatFileSize → renderByteSize, getFileInfo → analyzeDocumentProfile,
 *   getLargeFileEditorOptions → computeEditorConstraints, getLargeFileWarning → generateSizeAdvisory,
 *   shouldUseReadOnlyMode → requiresReadOnlyMode, getLargeFileThreshold → resolveSizeThreshold,
 *   getLargeLineCount → resolveLineThreshold, isLargeFile → exceedsSizeBudget,
 *   isVeryLargeFile → farExceedsSizeBudget
 * - 新增场景感知阈值：法律文档（大量文本）vs 代码文件 vs 日志文件
 * - 新增场景感知编辑器策略
 * - 新增文档类型检测和分类
 */

import { getEditorConfig } from '@shared/configuration/preferenceSync'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

interface ScenarioFilePolicy {
    sizeMultiplier: number
    lineMultiplier: number
    chunkSizeKB: number
    readOnlyThresholdMB: number
    contextLines: number
    fileCategories: Record<string, { extensions: string[]; sizeMultiplier: number }>
}

const SCENARIO_FILE_POLICIES: Record<string, ScenarioFilePolicy> = {
    'workspace-editor': {
        sizeMultiplier: 1.0,
        lineMultiplier: 1.0,
        chunkSizeKB: 64,
        readOnlyThresholdMB: 50,
        contextLines: 50,
        fileCategories: {
            source: { extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java'], sizeMultiplier: 1.0 },
            config: { extensions: ['json', 'yaml', 'yml', 'toml', 'xml'], sizeMultiplier: 0.5 },
            log: { extensions: ['log', 'out'], sizeMultiplier: 3.0 },
        },
    },
    'legal': {
        sizeMultiplier: 2.0,
        lineMultiplier: 1.5,
        chunkSizeKB: 128,
        readOnlyThresholdMB: 100,
        contextLines: 100,
        fileCategories: {
            contract: { extensions: ['docx', 'pdf', 'txt', 'md'], sizeMultiplier: 2.0 },
            statute: { extensions: ['html', 'xml'], sizeMultiplier: 1.5 },
            evidence: { extensions: ['csv', 'xlsx'], sizeMultiplier: 1.0 },
        },
    },
    'medical': {
        sizeMultiplier: 1.5,
        lineMultiplier: 1.2,
        chunkSizeKB: 96,
        readOnlyThresholdMB: 80,
        contextLines: 80,
        fileCategories: {
            imaging: { extensions: ['dcm', 'dicom', 'nii'], sizeMultiplier: 5.0 },
            records: { extensions: ['pdf', 'txt', 'html'], sizeMultiplier: 1.5 },
            data: { extensions: ['csv', 'json', 'hl7'], sizeMultiplier: 1.0 },
        },
    },
    'education': {
        sizeMultiplier: 1.5,
        lineMultiplier: 1.2,
        chunkSizeKB: 64,
        readOnlyThresholdMB: 60,
        contextLines: 60,
        fileCategories: {
            material: { extensions: ['pdf', 'pptx', 'docx'], sizeMultiplier: 2.0 },
            code: { extensions: ['py', 'ipynb', 'js', 'ts'], sizeMultiplier: 1.0 },
            media: { extensions: ['mp4', 'mp3', 'wav'], sizeMultiplier: 10.0 },
        },
    },
}

function resolveActivePolicy(): ScenarioFilePolicy {
    const scenarioId = useStore.getState().activeScenarioId ?? 'workspace-editor'
    return SCENARIO_FILE_POLICIES[scenarioId] ?? SCENARIO_FILE_POLICIES['workspace-editor']
}

function detectFileCategory(filePath: string, policy: ScenarioFilePolicy): { category: string; sizeMultiplier: number } {
    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    for (const [category, config] of Object.entries(policy.fileCategories)) {
        if (config.extensions.includes(ext)) {
            return { category, sizeMultiplier: config.sizeMultiplier }
        }
    }
    return { category: 'unknown', sizeMultiplier: 1.0 }
}

function resolveSizeThreshold(): number {
    const config = getEditorConfig()
    const policy = resolveActivePolicy()
    return (config.performance.largeFileWarningThresholdMB || 5) * 1024 * 1024 * policy.sizeMultiplier
}

function resolveLineThreshold(): number {
    const config = getEditorConfig()
    const policy = resolveActivePolicy()
    return config.performance.largeFileLineCount * policy.lineMultiplier
}

function resolveVeryLargeLineThreshold(): number {
    const config = getEditorConfig()
    const policy = resolveActivePolicy()
    return config.performance.veryLargeFileLineCount * policy.lineMultiplier
}

export interface FileChunk {
    startLine: number
    endLine: number
    content: string
    startOffset: number
    endOffset: number
}

export interface LargeFileInfo {
    path: string
    size: number
    lineCount: number
    isLarge: boolean
    isVeryLarge: boolean
    reason?: 'size' | 'lines' | 'both'
    category?: string
    scenarioPolicy?: string
}

function approximateLineCount(content: string): number {
    let count = 1
    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) count++
    }
    return count
}

export function exceedsSizeBudget(content: string, filePath?: string): boolean {
    const policy = resolveActivePolicy()
    let threshold = (getEditorConfig().performance.largeFileWarningThresholdMB || 5) * 1024 * 1024 * policy.sizeMultiplier

    if (filePath) {
        const { sizeMultiplier } = detectFileCategory(filePath, policy)
        threshold *= sizeMultiplier
    }

    if (content.length > threshold * 0.2) return true
    if (content.length > 100000) {
        return approximateLineCount(content) > resolveLineThreshold()
    }
    return false
}

export function farExceedsSizeBudget(content: string, filePath?: string): boolean {
    const policy = resolveActivePolicy()
    let threshold = (getEditorConfig().performance.largeFileWarningThresholdMB || 5) * 1024 * 1024 * policy.sizeMultiplier

    if (filePath) {
        const { sizeMultiplier } = detectFileCategory(filePath, policy)
        threshold *= sizeMultiplier
    }

    if (content.length > threshold) return true
    if (content.length > 500000) {
        return approximateLineCount(content) > resolveVeryLargeLineThreshold()
    }
    return false
}

export function analyzeDocumentProfile(path: string, content: string): LargeFileInfo {
    const policy = resolveActivePolicy()
    const scenarioId = useStore.getState().activeScenarioId ?? 'workspace-editor'
    const { category, sizeMultiplier } = detectFileCategory(path, policy)

    const baseThreshold = (getEditorConfig().performance.largeFileWarningThresholdMB || 5) * 1024 * 1024
    const threshold = baseThreshold * policy.sizeMultiplier * sizeMultiplier

    const size = content.length
    const isSizeLarge = size > threshold * 0.2
    const isSizeVeryLarge = size > threshold

    let lineCount = 0
    let isLineLarge = false
    let isLineVeryLarge = false

    if (!isSizeVeryLarge && size > 100000) {
        lineCount = approximateLineCount(content)
        isLineLarge = lineCount > resolveLineThreshold()
        isLineVeryLarge = lineCount > resolveVeryLargeLineThreshold()
    } else if (isSizeVeryLarge) {
        lineCount = -1
    } else {
        lineCount = approximateLineCount(content)
    }

    const isLarge = isSizeLarge || isLineLarge
    const isVeryLarge = isSizeVeryLarge || isLineVeryLarge

    let reason: 'size' | 'lines' | 'both' | undefined
    if (isLarge) {
        if ((isSizeLarge || isSizeVeryLarge) && (isLineLarge || isLineVeryLarge)) reason = 'both'
        else if (isSizeLarge || isSizeVeryLarge) reason = 'size'
        else reason = 'lines'
    }

    return { path, size, lineCount, isLarge, isVeryLarge, reason, category, scenarioPolicy: scenarioId }
}

export function segmentContent(content: string): FileChunk[] {
    const policy = resolveActivePolicy()
    const CHUNK_SIZE = policy.chunkSizeKB * 1024
    const chunks: FileChunk[] = []
    let startLine = 0
    let currentChunkStart = 0
    let lineCount = 0

    for (let i = 0; i <= content.length; i++) {
        const isEnd = i === content.length
        const isNewline = !isEnd && content.charCodeAt(i) === 10

        if (isNewline || isEnd) {
            lineCount++
            const chunkSize = i - currentChunkStart

            if (chunkSize >= CHUNK_SIZE || isEnd) {
                if (i > currentChunkStart) {
                    chunks.push({
                        startLine,
                        endLine: startLine + lineCount - 1,
                        content: content.slice(currentChunkStart, isEnd ? i : i + 1),
                        startOffset: currentChunkStart,
                        endOffset: isEnd ? i : i + 1,
                    })
                }

                if (!isEnd) {
                    startLine += lineCount
                    lineCount = 0
                    currentChunkStart = i + 1
                }
            }
        }
    }

    return chunks
}

export function getLineRange(content: string, startLine: number, endLine: number): string {
    let currentLine = 0
    let rangeStart = 0
    let rangeEnd = content.length

    for (let i = 0; i < content.length; i++) {
        if (content.charCodeAt(i) === 10) {
            currentLine++
            if (currentLine === startLine) rangeStart = i + 1
            else if (currentLine === endLine + 1) { rangeEnd = i; break }
        }
    }

    return content.slice(rangeStart, rangeEnd)
}

export function getLineContext(
    content: string,
    line: number,
    contextLines?: number
): { content: string; startLine: number; endLine: number } {
    const policy = resolveActivePolicy()
    const ctx = contextLines ?? policy.contextLines
    const startLine = Math.max(0, line - ctx)
    const endLine = line + ctx
    return { content: getLineRange(content, startLine, endLine), startLine, endLine }
}

export function computeEditorConstraints(fileInfo: LargeFileInfo): Record<string, unknown> {
    const options: Record<string, unknown> = {}

    if (fileInfo.isLarge) {
        options.minimap = { enabled: false }
        options.folding = false
        options.wordWrap = 'off'
        options.renderWhitespace = 'none'
        options.renderLineHighlight = 'none'
        options.guides = { indentation: false, bracketPairs: false }
        options.matchBrackets = 'never'
        options.occurrencesHighlight = 'off'
        options.selectionHighlight = false
        options.links = false
        options.colorDecorators = false
    }

    if (fileInfo.isVeryLarge) {
        options.lineNumbers = 'off'
        options.glyphMargin = false
        options.lineDecorationsWidth = 0
        options.lineNumbersMinChars = 0
        options.overviewRulerLanes = 0
        options.hideCursorInOverviewRuler = true
        options.overviewRulerBorder = false
        options.scrollbar = { vertical: 'auto', horizontal: 'auto', useShadows: false, verticalHasArrows: false, horizontalHasArrows: false }
        options.suggestOnTriggerCharacters = false
        options.quickSuggestions = false
        options.parameterHints = { enabled: false }
    }

    return options
}

export function renderByteSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function generateSizeAdvisory(fileInfo: LargeFileInfo, language: 'en' | 'zh'): string | null {
    if (!fileInfo.isLarge) return null

    const size = renderByteSize(fileInfo.size)
    const lines = fileInfo.lineCount > 0 ? `, ${fileInfo.lineCount.toLocaleString()} lines` : ''
    const category = fileInfo.category ? ` [${fileInfo.category}]` : ''

    if (fileInfo.isVeryLarge) {
        return t('app.thisfileislargesome', language as Language, { category: category, size: size, lines: lines })
    }

    return t('app.thisfileislargeeditor', language as Language, { category: category, size: size, lines: lines })
}

export function requiresReadOnlyMode(fileInfo: LargeFileInfo): boolean {
    const policy = resolveActivePolicy()
    return fileInfo.size > policy.readOnlyThresholdMB * 1024 * 1024 || fileInfo.lineCount > 100000
}

export const isLargeFile = exceedsSizeBudget
export const isVeryLargeFile = farExceedsSizeBudget
export const getFileInfo = analyzeDocumentProfile
export const chunkFile = segmentContent
export const getLargeFileEditorOptions = computeEditorConstraints
export const formatFileSize = renderByteSize
export const getLargeFileWarning = generateSizeAdvisory
export const shouldUseReadOnlyMode = requiresReadOnlyMode
export const getLargeFileThreshold = resolveSizeThreshold
export const getLargeLineCount = resolveLineThreshold
export const estimateLineCount = approximateLineCount
