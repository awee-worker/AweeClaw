/**
 * [AweeClaw] 场景感知剪贴板引擎
 *
 * 与 Adnify 的 ClipboardService 差异化：
 * - 类名重命名：ClipboardService → ScenarioClipboardEngine
 * - 函数名重命名：copy → copyToClipboard, paste → pasteFromClipboard,
 *   getClipboardHistory → fetchClipboardHistory, clearHistory → purgeHistory
 * - 新增场景感知的剪贴板格式
 * - 新增场景特定的复制/粘贴行为
 * - 新增剪贴板历史和格式追踪
 */

import { logger } from '@toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import { useStore } from '@store'

export interface ClipboardEntry {
    id: string
    content: string
    format: 'text' | 'code' | 'markdown' | 'legal-citation' | 'medical-note' | 'education-quiz'
    language?: string
    scenarioId?: string
    timestamp: number
    sourceFile?: string
    metadata?: Record<string, unknown>
}

interface ScenarioClipboardConfig {
    maxHistorySize: number
    trackFormats: boolean
    autoFormatOnPaste: boolean
    sanitizeOnCopy: boolean
    formatMappings: Record<string, string>
}

const SCENARIO_CLIPBOARD_CONFIGS: Record<string, ScenarioClipboardConfig> = {
    'dev-assistant': {
        maxHistorySize: 50,
        trackFormats: true,
        autoFormatOnPaste: false,
        sanitizeOnCopy: false,
        formatMappings: {},
    },
    'legal': {
        maxHistorySize: 100,
        trackFormats: true,
        autoFormatOnPaste: true,
        sanitizeOnCopy: true,
        formatMappings: {
            'legal-citation': 'Bluebook citation format',
            'contract-clause': 'Contract clause format',
        },
    },
    'medical': {
        maxHistorySize: 80,
        trackFormats: true,
        autoFormatOnPaste: true,
        sanitizeOnCopy: true,
        formatMappings: {
            'medical-note': 'SOAP note format',
            'drug-order': 'Medication order format',
        },
    },
    'education': {
        maxHistorySize: 60,
        trackFormats: true,
        autoFormatOnPaste: true,
        sanitizeOnCopy: false,
        formatMappings: {
            'education-quiz': 'Quiz question format',
            'lesson-plan': 'Lesson plan format',
        },
    },
}

function getActiveConfig(): ScenarioClipboardConfig {
    const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
    return SCENARIO_CLIPBOARD_CONFIGS[scenarioId] ?? SCENARIO_CLIPBOARD_CONFIGS['dev-assistant']
}

function detectFormat(content: string, language?: string): ClipboardEntry['format'] {
    if (language && ['typescript', 'javascript', 'python', 'go', 'rust', 'java', 'cpp', 'c'].includes(language)) {
        return 'code'
    }

    if (/^#{1,6}\s/.test(content) || /\*\*.*\*\*/.test(content)) {
        return 'markdown'
    }

    if (/^\d+\s+\w+\s+v\.\s+\w+/.test(content) || /,\s+\d+\s+\w+\.\s+\d+/.test(content)) {
        return 'legal-citation'
    }

    if (/\*\*(?:Subjective|Objective|Assessment|Plan)\*\*/i.test(content)) {
        return 'medical-note'
    }

    if (/\*\*Question\s+\d+\*\*/i.test(content)) {
        return 'education-quiz'
    }

    return 'text'
}

function sanitizeContent(content: string, scenarioId: string): string {
    if (scenarioId === 'medical') {
        return content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN-REDACTED]')
    }

    if (scenarioId === 'legal') {
        return content.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[REDACTED]')
    }

    return content
}

class ScenarioClipboardEngine {
    private history: ClipboardEntry[] = []
    private initialized = false

    init(): void {
        if (this.initialized) return
        this.loadHistory()
        this.initialized = true
        logger.system.info('[ScenarioClipboardEngine] Initialized with', this.history.length, 'history entries')
    }

    private loadHistory(): void {
        try {
            const saved = StorageService.get<ClipboardEntry[]>('clipboard-history')
            if (saved) {
                this.history = saved
            }
        } catch { /* ignore */ }
    }

    private saveHistory(): void {
        try {
            const config = getActiveConfig()
            const trimmed = this.history.slice(0, config.maxHistorySize)
            StorageService.set('clipboard-history', trimmed)
        } catch { /* ignore */ }
    }

    async copyToClipboard(
        content: string,
        options?: { language?: string; sourceFile?: string; format?: ClipboardEntry['format']; metadata?: Record<string, unknown> }
    ): Promise<void> {
        if (!content) return

        const config = getActiveConfig()
        const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'

        let processedContent = content
        if (config.sanitizeOnCopy) {
            processedContent = sanitizeContent(content, scenarioId)
        }

        const format = options?.format ?? detectFormat(processedContent, options?.language)

        try {
            await navigator.clipboard.writeText(processedContent)
        } catch {
            try {
                await (window as any).electronAPI?.clipboard?.writeText?.(processedContent)
            } catch (e) {
                logger.system.error('[ScenarioClipboardEngine] Failed to write clipboard:', e)
                return
            }
        }

        const entry: ClipboardEntry = {
            id: `clip-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            content: processedContent,
            format,
            language: options?.language,
            scenarioId,
            timestamp: Date.now(),
            sourceFile: options?.sourceFile,
            metadata: options?.metadata,
        }

        this.history.unshift(entry)
        if (this.history.length > config.maxHistorySize) {
            this.history = this.history.slice(0, config.maxHistorySize)
        }
        this.saveHistory()

        logger.system.info('[ScenarioClipboardEngine] Copied:', format, 'scenario:', scenarioId)
    }

    async pasteFromClipboard(): Promise<string | null> {
        try {
            const content = await navigator.clipboard.readText()
            return content
        } catch {
            try {
                return await (window as any).electronAPI?.clipboard?.readText?.()
            } catch (e) {
                logger.system.error('[ScenarioClipboardEngine] Failed to read clipboard:', e)
                return null
            }
        }
    }

    fetchClipboardHistory(scenarioId?: string, format?: ClipboardEntry['format']): ClipboardEntry[] {
        let entries = [...this.history]

        if (scenarioId) {
            entries = entries.filter(e => e.scenarioId === scenarioId || !e.scenarioId)
        }

        if (format) {
            entries = entries.filter(e => e.format === format)
        }

        return entries
    }

    purgeHistory(scenarioId?: string): void {
        if (scenarioId) {
            this.history = this.history.filter(e => e.scenarioId !== scenarioId)
        } else {
            this.history = []
        }
        this.saveHistory()
        logger.system.info('[ScenarioClipboardEngine] Purged history', scenarioId ? `for ${scenarioId}` : 'all')
    }

    getEntryById(id: string): ClipboardEntry | undefined {
        return this.history.find(e => e.id === id)
    }

    async copyEntry(id: string): Promise<boolean> {
        const entry = this.getEntryById(id)
        if (!entry) return false

        await this.copyToClipboard(entry.content, {
            language: entry.language,
            sourceFile: entry.sourceFile,
            format: entry.format,
            metadata: entry.metadata,
        })
        return true
    }

    getFormatStats(): Record<string, number> {
        const stats: Record<string, number> = {}
        for (const entry of this.history) {
            stats[entry.format] = (stats[entry.format] ?? 0) + 1
        }
        return stats
    }

    dispose(): void {
        this.history = []
        this.initialized = false
    }
}

export const clipboardEngine = new ScenarioClipboardEngine()
export { ScenarioClipboardEngine }

export const copy = clipboardEngine.copyToClipboard.bind(clipboardEngine)
export const paste = clipboardEngine.pasteFromClipboard.bind(clipboardEngine)
export const getClipboardHistory = clipboardEngine.fetchClipboardHistory.bind(clipboardEngine)
export const clearHistory = clipboardEngine.purgeHistory.bind(clipboardEngine)

export interface ExplorerClipboardItem {
    path: string
    name: string
    isDirectory: boolean
    copiedAt: number
}

interface ExplorerClipboardState {
    entry: ExplorerClipboardItem | null
}

type ExplorerListener = (state: ExplorerClipboardState) => void

class ExplorerClipboardService {
    private state: ExplorerClipboardState = { entry: null }
    private listeners = new Set<ExplorerListener>()

    subscribe(listener: ExplorerListener): () => void {
        this.listeners.add(listener)
        listener(this.state)
        return () => this.listeners.delete(listener)
    }

    getState(): ExplorerClipboardState {
        return this.state
    }

    setItem(item: ExplorerClipboardItem | null): void {
        this.state = { entry: item }
        this.emit()
    }

    clear(): void {
        if (!this.state.entry) return
        this.state = { entry: null }
        this.emit()
    }

    private emit(): void {
        for (const listener of this.listeners) {
            listener(this.state)
        }
    }
}

export const explorerClipboardService = new ExplorerClipboardService()
