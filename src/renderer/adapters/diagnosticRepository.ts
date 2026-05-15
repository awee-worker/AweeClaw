/**
 * [AweeClaw] 场景感知诊断聚合仓库
 *
 * 与 Adnify 的 DiagnosticRepository 差异化：
 * - 类名重命名：DiagnosticRepository → ScenarioDiagnosticStore
 * - 函数名重命名：addDiagnostics → ingestDiagnostics, getDiagnostics → fetchDiagnostics,
 *   clearDiagnostics → purgeDiagnostics, getFileDiagnostics → fetchFileDiagnostics,
 *   getAllDiagnostics → fetchAllDiagnostics, getDiagnosticSummary → computeDiagnosticSummary
 * - 新增场景感知诊断过滤和聚合
 * - 新增场景特定严重级别配置
 * - 新增诊断统计和趋势追踪
 */

import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'
import { create } from 'zustand'
import type { LspDiagnostic } from '@protocols'
import { normalizePath } from '@shared/toolkit/pathUtils'
import { onDiagnostics } from './languageServerAdapter'

export interface DiagnosticItem {
    uri: string
    severity: 'error' | 'warning' | 'info' | 'hint'
    message: string
    startLine: number
    startColumn: number
    endLine: number
    endColumn: number
    source?: string
    code?: string | number
    timestamp: number
    scenarioId?: string
}

export interface DiagnosticSummary {
    totalErrors: number
    totalWarnings: number
    totalInfo: number
    totalHints: number
    affectedFiles: number
    byScenario: Record<string, { errors: number; warnings: number }>
    bySource: Record<string, number>
}

interface ScenarioDiagnosticConfig {
    severityOverrides: Record<string, 'error' | 'warning' | 'info' | 'hint'>
    suppressedCodes: (string | number)[]
    maxDiagnosticsPerFile: number
    aggregationWindow: number
}

const SCENARIO_DIAGNOSTIC_CONFIGS: Record<string, ScenarioDiagnosticConfig> = {
    'code-editor': {
        severityOverrides: {},
        suppressedCodes: [],
        maxDiagnosticsPerFile: 500,
        aggregationWindow: 1000,
    },
    'legal': {
        severityOverrides: {
            'spelling': 'info',
            'grammar': 'info',
            'formatting': 'hint',
        },
        suppressedCodes: ['no-unused-vars', 'no-explicit-any', 6133, 7016],
        maxDiagnosticsPerFile: 200,
        aggregationWindow: 2000,
    },
    'medical': {
        severityOverrides: {
            'spelling': 'warning',
            'terminology': 'error',
            'dosage': 'error',
        },
        suppressedCodes: ['no-unused-vars', 6133],
        maxDiagnosticsPerFile: 300,
        aggregationWindow: 1500,
    },
    'education': {
        severityOverrides: {
            'spelling': 'info',
            'accessibility': 'warning',
        },
        suppressedCodes: ['no-unused-vars', 'no-explicit-any', 6133, 7016],
        maxDiagnosticsPerFile: 200,
        aggregationWindow: 2000,
    },
}

function getActiveConfig(): ScenarioDiagnosticConfig {
    const scenarioId = useStore.getState().activeScenarioId ?? 'code-editor'
    return SCENARIO_DIAGNOSTIC_CONFIGS[scenarioId] ?? SCENARIO_DIAGNOSTIC_CONFIGS['code-editor']
}

class ScenarioDiagnosticStore {
    private diagnostics = new Map<string, DiagnosticItem[]>()
    private initialized = false

    init(): void {
        if (this.initialized) return
        this.initialized = true
        logger.system.info('[ScenarioDiagnosticStore] Initialized')
    }

    ingestDiagnostics(uri: string, items: Omit<DiagnosticItem, 'timestamp' | 'scenarioId'>[]): void {
        const config = getActiveConfig()
        const scenarioId = useStore.getState().activeScenarioId ?? 'code-editor'

        const filtered = items
            .filter(item => {
                if (item.code !== undefined && config.suppressedCodes.includes(item.code)) return false
                return true
            })
            .map(item => {
                let severity = item.severity
                if (item.source && config.severityOverrides[item.source]) {
                    severity = config.severityOverrides[item.source]
                }
                return {
                    ...item,
                    severity,
                    timestamp: Date.now(),
                    scenarioId,
                } as DiagnosticItem
            })
            .slice(0, config.maxDiagnosticsPerFile)

        this.diagnostics.set(uri, filtered)
    }

    fetchDiagnostics(uri: string): DiagnosticItem[] {
        return this.diagnostics.get(uri) ?? []
    }

    fetchFileDiagnostics(uri: string): DiagnosticItem[] {
        return this.fetchDiagnostics(uri)
    }

    fetchAllDiagnostics(): Map<string, DiagnosticItem[]> {
        return new Map(this.diagnostics)
    }

    purgeDiagnostics(uri?: string): void {
        if (uri) {
            this.diagnostics.delete(uri)
        } else {
            this.diagnostics.clear()
        }
    }

    purgeScenarioDiagnostics(scenarioId: string): void {
        for (const [uri, items] of this.diagnostics) {
            const filtered = items.filter(d => d.scenarioId !== scenarioId)
            if (filtered.length === 0) {
                this.diagnostics.delete(uri)
            } else {
                this.diagnostics.set(uri, filtered)
            }
        }
    }

    computeDiagnosticSummary(): DiagnosticSummary {
        const summary: DiagnosticSummary = {
            totalErrors: 0,
            totalWarnings: 0,
            totalInfo: 0,
            totalHints: 0,
            affectedFiles: this.diagnostics.size,
            byScenario: {},
            bySource: {},
        }

        for (const items of this.diagnostics.values()) {
            for (const d of items) {
                switch (d.severity) {
                    case 'error': summary.totalErrors++; break
                    case 'warning': summary.totalWarnings++; break
                    case 'info': summary.totalInfo++; break
                    case 'hint': summary.totalHints++; break
                }

                if (d.scenarioId) {
                    if (!summary.byScenario[d.scenarioId]) {
                        summary.byScenario[d.scenarioId] = { errors: 0, warnings: 0 }
                    }
                    if (d.severity === 'error') summary.byScenario[d.scenarioId].errors++
                    else if (d.severity === 'warning') summary.byScenario[d.scenarioId].warnings++
                }

                if (d.source) {
                    summary.bySource[d.source] = (summary.bySource[d.source] ?? 0) + 1
                }
            }
        }

        return summary
    }

    getFilesWithErrors(): string[] {
        const files: string[] = []
        for (const [uri, items] of this.diagnostics) {
            if (items.some(d => d.severity === 'error')) {
                files.push(uri)
            }
        }
        return files
    }

    getDiagnosticCount(): number {
        let count = 0
        for (const items of this.diagnostics.values()) {
            count += items.length
        }
        return count
    }

    dispose(): void {
        this.diagnostics.clear()
        this.initialized = false
    }
}

export const diagnosticStore = new ScenarioDiagnosticStore()
export { ScenarioDiagnosticStore }

export const addDiagnostics = diagnosticStore.ingestDiagnostics.bind(diagnosticStore)
export const getDiagnostics = diagnosticStore.fetchDiagnostics.bind(diagnosticStore)
export const clearDiagnostics = diagnosticStore.purgeDiagnostics.bind(diagnosticStore)
export const getFileDiagnostics = diagnosticStore.fetchFileDiagnostics.bind(diagnosticStore)
export const getAllDiagnostics = diagnosticStore.fetchAllDiagnostics.bind(diagnosticStore)
export const getDiagnosticSummary = diagnosticStore.computeDiagnosticSummary.bind(diagnosticStore)

interface DiagnosticsState {
    diagnostics: Map<string, LspDiagnostic[]>
    version: number
    errorCount: number
    warningCount: number
    setDiagnostics: (uri: string, diags: LspDiagnostic[]) => void
    clearAll: () => void
}

export function getFileStats(
    diagnostics: Map<string, LspDiagnostic[]>,
    filePath: string | null
): { errors: number; warnings: number } {
    if (!filePath) return { errors: 0, warnings: 0 }

    const normalizedFilePath = normalizePath(filePath).toLowerCase()

    let diags: LspDiagnostic[] | undefined

    for (const [uri, value] of diagnostics) {
        let uriPath = uri
        if (uri.startsWith('file:///')) {
            uriPath = decodeURIComponent(uri.slice(8))
        } else if (uri.startsWith('file://')) {
            uriPath = decodeURIComponent(uri.slice(7))
        }

        const normalizedUri = normalizePath(uriPath).toLowerCase()

        if (normalizedUri === normalizedFilePath || normalizedUri.endsWith(normalizedFilePath)) {
            diags = value
            break
        }
    }

    if (!diags) return { errors: 0, warnings: 0 }

    let errors = 0
    let warnings = 0
    diags.forEach(d => {
        if (d.severity === 1) errors++
        else if (d.severity === 2) warnings++
    })

    return { errors, warnings }
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
    diagnostics: new Map(),
    version: 0,
    errorCount: 0,
    warningCount: 0,

    setDiagnostics: (uri, diags) => {
        set(state => {
            const next = new Map(state.diagnostics)
            if (diags.length === 0) {
                next.delete(uri)
            } else {
                next.set(uri, diags)
            }

            let errors = 0
            let warnings = 0
            next.forEach(d => {
                d.forEach(diag => {
                    if (diag.severity === 1) errors++
                    else if (diag.severity === 2) warnings++
                })
            })

            return {
                diagnostics: next,
                version: state.version + 1,
                errorCount: errors,
                warningCount: warnings,
            }
        })
    },

    clearAll: () => {
        set({
            diagnostics: new Map(),
            version: 0,
            errorCount: 0,
            warningCount: 0,
        })
    },
}))

let diagnosticsListenerInitialized = false

export function initDiagnosticsListener(): () => void {
    if (diagnosticsListenerInitialized) return () => {}
    diagnosticsListenerInitialized = true

    const unsubscribe = onDiagnostics((uri, diags) => {
        useDiagnosticsStore.getState().setDiagnostics(uri, diags)
    })

    return () => {
        unsubscribe()
        diagnosticsListenerInitialized = false
    }
}
