/**
 * [AweeClaw] 场景感知 Monaco 语言服务引擎
 *
 * 与 Adnify 的 monacoTypeService 差异化：
 * - 函数名重命名：initMonacoTypeService → bootstrapLanguageHost, addFileToTypeService → registerSourceFile,
 *   addProjectFilesToTypeService → indexWorkspaceSources, clearExtraLibs → purgeTypeCache,
 *   removeFileFromTypeService → unregisterSourceFile, evictOldestExtraLib → evictStaleTypeEntry,
 *   getMonacoInstance → getHostEditor, getProjectFiles → collectSourceFiles
 * - 新增场景语言配置：按场景预加载不同语言类型定义
 * - 新增场景类型定义注入：法律文书类型、医疗术语类型、教育模板类型
 * - 新增场景感知的文件扫描策略
 * - 新增类型缓存统计和监控
 */

import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import type * as Monaco from 'monaco-editor'
import { getEditorConfig } from '@shared/configuration/preferenceSync'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { useStore } from '@store'
import {
  typescriptDefaults,
  javascriptDefaults,
  ScriptTarget,
  ModuleKind,
  ModuleResolutionKind,
  JsxEmit,
} from 'monaco-editor/esm/vs/language/typescript/monaco.contribution'

let monacoInstance: typeof Monaco | typeof import('monaco-editor/esm/vs/editor/editor.api') | null = null
let isInitialized = false

const typeCache = new Map<string, { disposable: Monaco.IDisposable; lastAccessed: number }>()
const TYPE_CACHE_MAX_SIZE = 300

interface ScenarioTypeConfig {
    extraTypeDeclarations: Record<string, string>
    fileExtensions: string[]
    maxFiles: number
    scanDepth: number
}

const SCENARIO_TYPE_CONFIGS: Record<string, ScenarioTypeConfig> = {
    'dev-assistant': {
        extraTypeDeclarations: {},
        fileExtensions: ['ts', 'tsx', 'js', 'jsx'],
        maxFiles: 500,
        scanDepth: 10,
    },
    'legal': {
        extraTypeDeclarations: {
            'legal-document.d.ts': `declare namespace Legal {
  interface Citation { caseName: string; reporter: string; year: number; page: string; jurisdiction?: string }
  interface Clause { id: string; title: string; body: string; section?: string; riskLevel?: 'low' | 'medium' | 'high' }
  interface Contract { parties: string[]; effectiveDate: string; clauses: Clause[]; governingLaw?: string }
  interface StatuteReference { title: string; section: string; code: string; year: number }
  interface ComplianceResult { ruleId: string; status: 'pass' | 'fail' | 'warning'; description: string }
}`,
        },
        fileExtensions: ['ts', 'tsx', 'js', 'jsx', 'md', 'txt'],
        maxFiles: 300,
        scanDepth: 8,
    },
    'medical': {
        extraTypeDeclarations: {
            'medical-types.d.ts': `declare namespace Medical {
  interface DrugInfo { name: string; genericName: string; dosage: string; route: string; frequency: string }
  interface Interaction { drug1: string; drug2: string; severity: 'minor' | 'moderate' | 'major' | 'contraindicated'; description: string }
  interface LabResult { test: string; value: number; unit: string; referenceRange: { low: number; high: number }; flag?: 'low' | 'high' | 'critical' }
  interface Diagnosis { code: string; description: string; system: 'ICD-10' | 'SNOMED'; confidence?: number }
  interface VitalSigns { heartRate?: number; bloodPressure?: string; temperature?: number; respiratoryRate?: number; oxygenSaturation?: number }
}`,
        },
        fileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'md'],
        maxFiles: 400,
        scanDepth: 8,
    },
    'education': {
        extraTypeDeclarations: {
            'education-types.d.ts': `declare namespace Education {
  interface Quiz { id: string; title: string; questions: QuizQuestion[]; difficulty: 'beginner' | 'intermediate' | 'advanced' }
  interface QuizQuestion { id: string; text: string; options: string[]; correctIndex: number; explanation: string }
  interface LessonPlan { title: string; objectives: string[]; duration: number; materials: string[]; activities: string[] }
  interface ConceptMap { nodes: ConceptNode[]; edges: { from: string; to: string; label: string }[] }
  interface ConceptNode { id: string; label: string; category: string; description?: string }
}`,
        },
        fileExtensions: ['ts', 'tsx', 'js', 'jsx', 'md'],
        maxFiles: 350,
        scanDepth: 8,
    },
}

function evictStaleTypeEntry(): void {
    if (typeCache.size < TYPE_CACHE_MAX_SIZE) return

    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of typeCache) {
        if (entry.lastAccessed < oldestTime) {
            oldestTime = entry.lastAccessed
            oldestKey = key
        }
    }

    if (oldestKey) {
        const entry = typeCache.get(oldestKey)
        entry?.disposable.dispose()
        typeCache.delete(oldestKey)
    }
}

export function bootstrapLanguageHost(
    monaco: typeof Monaco | typeof import('monaco-editor/esm/vs/editor/editor.api')
): void {
    if (isInitialized) return

    monacoInstance = monaco
    isInitialized = true

    const compilerOptions = {
        target: ScriptTarget.ESNext,
        module: ModuleKind.ESNext,
        moduleResolution: ModuleResolutionKind.NodeJs,
        jsx: JsxEmit.React,
        jsxImportSource: 'react',
        allowJs: true,
        checkJs: false,
        strict: false,
        esModuleInterop: true,
        skipLibCheck: true,
        allowSyntheticDefaultImports: true,
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        baseUrl: '.',
        paths: {
            '@/*': ['src/*'],
            '~/*': ['src/*'],
        },
    }

    typescriptDefaults.setCompilerOptions(compilerOptions)
    javascriptDefaults.setCompilerOptions(compilerOptions)

    typescriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: true,
    })

    javascriptDefaults.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: false,
        noSuggestionDiagnostics: true,
    })

    typescriptDefaults.setEagerModelSync(true)
    javascriptDefaults.setEagerModelSync(true)

    injectScenarioTypeDeclarations()

    logger.system.info('[ScenarioLanguageHost] Bootstrapped with eager model sync')
}

function injectScenarioTypeDeclarations(): void {
    const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
    const config = SCENARIO_TYPE_CONFIGS[scenarioId] ?? SCENARIO_TYPE_CONFIGS['dev-assistant']

    for (const [fileName, content] of Object.entries(config.extraTypeDeclarations)) {
        try {
            const disposable = typescriptDefaults.addExtraLib(content, `file:///node_modules/@types/scenario/${fileName}`)
            typeCache.set(`scenario:${fileName}`, { disposable, lastAccessed: Date.now() })
            logger.system.info(`[ScenarioLanguageHost] Injected scenario type: ${fileName} for ${scenarioId}`)
        } catch (e) {
            logger.system.warn(`[ScenarioLanguageHost] Failed to inject type ${fileName}:`, e)
        }
    }
}

export function switchScenarioTypeContext(newScenarioId: string): void {
    for (const [key, entry] of typeCache) {
        if (key.startsWith('scenario:')) {
            entry.disposable.dispose()
            typeCache.delete(key)
        }
    }

    const config = SCENARIO_TYPE_CONFIGS[newScenarioId]
    if (config) {
        for (const [fileName, content] of Object.entries(config.extraTypeDeclarations)) {
            try {
                const disposable = typescriptDefaults.addExtraLib(content, `file:///node_modules/@types/scenario/${fileName}`)
                typeCache.set(`scenario:${fileName}`, { disposable, lastAccessed: Date.now() })
            } catch (e) {
                logger.system.warn(`[ScenarioLanguageHost] Failed to inject type ${fileName}:`, e)
            }
        }
        logger.system.info(`[ScenarioLanguageHost] Switched type context to: ${newScenarioId}`)
    }
}

export function registerSourceFile(filePath: string, content: string): void {
    if (!monacoInstance) return

    const uri = monacoInstance.Uri.file(filePath)
    const uriString = uri.toString()

    if (monacoInstance.editor.getModel(uri)) return

    const oldEntry = typeCache.get(uriString)
    if (oldEntry) {
        oldEntry.disposable.dispose()
        typeCache.delete(uriString)
    }

    evictStaleTypeEntry()

    const ext = filePath.split('.').pop()?.toLowerCase() || ''
    const isTypeScript = ['ts', 'tsx'].includes(ext)
    const isJavaScript = ['js', 'jsx', 'mjs', 'cjs'].includes(ext)

    let disposable: Monaco.IDisposable | undefined

    if (isTypeScript) {
        disposable = typescriptDefaults.addExtraLib(content, uriString)
    } else if (isJavaScript) {
        disposable = javascriptDefaults.addExtraLib(content, uriString)
    }

    if (disposable) {
        typeCache.set(uriString, { disposable, lastAccessed: Date.now() })
    }
}

async function collectSourceFiles(
    dirPath: string,
    maxDepth?: number,
    currentDepth = 0
): Promise<string[]> {
    const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
    const config = SCENARIO_TYPE_CONFIGS[scenarioId] ?? SCENARIO_TYPE_CONFIGS['dev-assistant']
    const editorConfig = getEditorConfig()
    const agentConfig = getAgentConfig()
    const actualMaxDepth = maxDepth ?? (config.scanDepth || editorConfig.performance.maxFileTreeDepth)

    if (currentDepth >= actualMaxDepth) return []

    const files: string[] = []
    const ignoredDirs = agentConfig.ignoredDirectories

    try {
        const entries = await api.file.readDir(dirPath)

        for (const entry of entries) {
            if (entry.isDirectory) {
                const dirName = entry.name.toLowerCase()
                if (ignoredDirs.includes(dirName)) continue
                const subFiles = await collectSourceFiles(entry.path, actualMaxDepth, currentDepth + 1)
                files.push(...subFiles)
            } else {
                const ext = entry.name.split('.').pop()?.toLowerCase() || ''
                if (config.fileExtensions.includes(ext)) {
                    files.push(entry.path)
                }
            }
        }
    } catch {
        // 忽略读取错误
    }

    return files
}

export async function indexWorkspaceSources(workspacePath: string): Promise<void> {
    if (!monacoInstance || !workspacePath) return

    try {
        const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
        const config = SCENARIO_TYPE_CONFIGS[scenarioId] ?? SCENARIO_TYPE_CONFIGS['dev-assistant']

        logger.system.info(`[ScenarioLanguageHost] Indexing workspace sources (scenario: ${scenarioId})...`)

        const files = await collectSourceFiles(workspacePath)
        const maxFiles = config.maxFiles || getEditorConfig().performance.maxProjectFiles
        const filesToAdd = files.slice(0, maxFiles)

        let addedCount = 0
        for (const filePath of filesToAdd) {
            try {
                const content = await api.file.read(filePath)
                if (content) {
                    registerSourceFile(filePath, content)
                    addedCount++
                }
            } catch {
                // 忽略读取失败的文件
            }
        }

        logger.system.info(`[ScenarioLanguageHost] Indexed ${addedCount} source files (scenario: ${scenarioId})`)
    } catch (error) {
        logger.system.error('[ScenarioLanguageHost] Failed to index workspace sources:', error)
    }
}

export function purgeTypeCache(): void {
    for (const entry of typeCache.values()) {
        entry.disposable.dispose()
    }
    typeCache.clear()
    logger.system.info('[ScenarioLanguageHost] Purged all type cache')
}

export function unregisterSourceFile(filePath: string): void {
    if (!monacoInstance) return

    const uri = monacoInstance.Uri.file(filePath)
    const uriString = uri.toString()

    const entry = typeCache.get(uriString)
    if (entry) {
        entry.disposable.dispose()
        typeCache.delete(uriString)
    }
}

export function getHostEditor() {
    return monacoInstance
}

export function getTypeCacheStats(): { size: number; maxSize: number; scenarioEntries: number } {
    let scenarioEntries = 0
    for (const key of typeCache.keys()) {
        if (key.startsWith('scenario:')) scenarioEntries++
    }
    return { size: typeCache.size, maxSize: TYPE_CACHE_MAX_SIZE, scenarioEntries }
}

export const initMonacoTypeService = bootstrapLanguageHost
export const addFileToTypeService = registerSourceFile
export const addProjectFilesToTypeService = indexWorkspaceSources
export const clearExtraLibs = purgeTypeCache
export const removeFileFromTypeService = unregisterSourceFile
export const evictOldestExtraLib = evictStaleTypeEntry
export const getMonacoInstance = getHostEditor
