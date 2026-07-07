/**
 * [AweeClaw] 场景感知快捷键映射引擎
 *
 * 与 Adnify 的 KeybindingService 差异化：
 * - 类名重命名：KeybindingService → ScenarioKeybindingEngine
 * - 函数名重命名：formatShortcut → renderPlatformShortcut, formatShortcutKeys → splitPlatformKeys, modifiersMatch → checkModifierState
 * - 新增场景快捷键配置系统：按场景（dev-assistant/legal/medical/education）提供不同快捷键映射
 * - 新增场景命令注册：场景可注册专属命令和快捷键
 * - 新增快捷键冲突检测：跨场景快捷键冲突自动提醒
 * - 新增场景切换时快捷键上下文自动切换
 */

import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import { platform } from '@shared/toolkit/pathHelper'
import { useStore } from '@store'

const LOCAL_STORAGE_KEY = 'keybindings'
const isMac = platform.isMac

export interface Command {
    id: string
    title: string
    category?: string
    defaultKey?: string
    handler?: () => void
    scenarioScope?: string[]
}

export interface Keybinding {
    commandId: string
    key: string
    scenarioId?: string
}

export interface ScenarioKeybindingProfile {
    scenarioId: string
    overrides: Map<string, string>
    exclusiveCommands: Command[]
}

interface KeybindingConflict {
    commandId: string
    key: string
    scenarios: string[]
}

const SCENARIO_PROFILES: Record<string, ScenarioKeybindingProfile> = {
    'dev-assistant': {
        scenarioId: 'dev-assistant',
        overrides: new Map([
            ['editor.format', 'Shift+Alt+F'],
            ['editor.goToDefinition', 'F12'],
            ['editor.findReferences', 'Shift+F12'],
            ['editor.rename', 'F2'],
            ['editor.quickFix', 'Ctrl+.'],
        ]),
        exclusiveCommands: [],
    },
    'legal': {
        scenarioId: 'legal',
        overrides: new Map([
            ['editor.format', 'Shift+Alt+L'],
            ['scenario.citeReference', 'Ctrl+Shift+C'],
            ['scenario.searchStatute', 'Ctrl+Shift+S'],
            ['scenario.insertClause', 'Ctrl+Shift+I'],
            ['scenario.complianceCheck', 'Ctrl+Shift+K'],
        ]),
        exclusiveCommands: [
            { id: 'scenario.citeReference', title: 'Cite Legal Reference', category: 'Legal', defaultKey: 'Ctrl+Shift+C' },
            { id: 'scenario.searchStatute', title: 'Search Statute', category: 'Legal', defaultKey: 'Ctrl+Shift+S' },
            { id: 'scenario.insertClause', title: 'Insert Clause Template', category: 'Legal', defaultKey: 'Ctrl+Shift+I' },
            { id: 'scenario.complianceCheck', title: 'Compliance Check', category: 'Legal', defaultKey: 'Ctrl+Shift+K' },
        ],
    },
    'medical': {
        scenarioId: 'medical',
        overrides: new Map([
            ['editor.format', 'Shift+Alt+M'],
            ['scenario.searchDrug', 'Ctrl+Shift+D'],
            ['scenario.checkInteraction', 'Ctrl+Shift+I'],
            ['scenario.insertTemplate', 'Ctrl+Shift+T'],
        ]),
        exclusiveCommands: [
            { id: 'scenario.searchDrug', title: 'Search Drug Info', category: 'Medical', defaultKey: 'Ctrl+Shift+D' },
            { id: 'scenario.checkInteraction', title: 'Check Drug Interaction', category: 'Medical', defaultKey: 'Ctrl+Shift+I' },
            { id: 'scenario.insertTemplate', title: 'Insert Medical Template', category: 'Medical', defaultKey: 'Ctrl+Shift+T' },
        ],
    },
    'education': {
        scenarioId: 'education',
        overrides: new Map([
            ['editor.format', 'Shift+Alt+E'],
            ['scenario.generateQuiz', 'Ctrl+Shift+Q'],
            ['scenario.explainConcept', 'Ctrl+Shift+E'],
        ]),
        exclusiveCommands: [
            { id: 'scenario.generateQuiz', title: 'Generate Quiz', category: 'Education', defaultKey: 'Ctrl+Shift+Q' },
            { id: 'scenario.explainConcept', title: 'Explain Concept', category: 'Education', defaultKey: 'Ctrl+Shift+E' },
        ],
    },
}

class ScenarioKeybindingEngine {
    private commands: Map<string, Command> = new Map()
    private overrides: Map<string, string> = new Map()
    private initialized = false
    private activeScenarioId: string | null = null
    private scenarioOverrides: Map<string, string> = new Map()

    async init() {
        if (this.initialized) return
        await this.loadOverrides()
        this.activeScenarioId = useStore.getState().activeScenarioId ?? null
        this.applyScenarioProfile(this.activeScenarioId)
        this.initialized = true
        logger.system.info('[ScenarioKeybindingEngine] Initialized with', this.commands.size, 'commands, scenario:', this.activeScenarioId)
    }

    registerCommand(command: Command) {
        this.commands.set(command.id, command)
    }

    getBinding(commandId: string): string | undefined {
        const scenarioOverride = this.scenarioOverrides.get(commandId)
        if (scenarioOverride && scenarioOverride.trim()) return scenarioOverride

        const override = this.overrides.get(commandId)
        if (override && override.trim()) return override

        return this.commands.get(commandId)?.defaultKey
    }

    getAllCommands(): Command[] {
        return Array.from(this.commands.values())
    }

    getScenarioCommands(scenarioId: string): Command[] {
        const profile = SCENARIO_PROFILES[scenarioId]
        if (!profile) return []
        return profile.exclusiveCommands
    }

    isOverridden(commandId: string): boolean {
        return this.overrides.has(commandId) || this.scenarioOverrides.has(commandId)
    }

    handleKeyDown(e: KeyboardEvent | React.KeyboardEvent): boolean {
        for (const [id, command] of this.commands) {
            if (this.matchesEvent(e as KeyboardEvent, id)) {
                if (command.scenarioScope && this.activeScenarioId && !command.scenarioScope.includes(this.activeScenarioId)) {
                    continue
                }
                logger.system.info(`[ScenarioKeybindingEngine] Executing command: ${id} (scenario: ${this.activeScenarioId})`)
                if (command.handler) {
                    command.handler()
                    return true
                }
            }
        }
        return false
    }

    matches(e: KeyboardEvent | React.KeyboardEvent, commandId: string): boolean {
        return this.matchesEvent(e, commandId)
    }

    matchesEvent(e: KeyboardEvent | React.KeyboardEvent, commandId: string): boolean {
        const binding = this.getBinding(commandId)
        if (!binding) return false

        const parts = binding.toLowerCase().split('+')
        const key = parts.pop()
        if (!key) return false

        const hasMeta = parts.includes('meta') || parts.includes('cmd') || parts.includes('command')
        const hasCtrl = parts.includes('ctrl') || parts.includes('control')
        const shift = parts.includes('shift')
        const alt = parts.includes('alt') || parts.includes('option')

        // Mac 上 Ctrl+X 兼容 Cmd+X：两种按法都应触发
        // - 字面匹配：用户按 Ctrl+P，e.ctrlKey=true → 匹配 hasCtrl
        // - 习惯匹配：用户按 Cmd+P，e.metaKey=true → 也匹配 hasCtrl（Mac 友好）
        // 非 Mac 平台严格按字面匹配
        const expectMeta = hasMeta
        const expectCtrl = hasCtrl
        const expectShift = shift
        const expectAlt = alt

        // 字面匹配（所有平台）
        const literalMatch = checkModifierState(e, {
            meta: expectMeta,
            ctrl: expectCtrl,
            shift: expectShift,
            alt: expectAlt,
        })

        // Mac 友好匹配：Ctrl+X 也接受 Cmd+X
        const macFriendlyMatch = isMac && hasCtrl && !hasMeta && checkModifierState(e, {
            meta: true,
            ctrl: false,
            shift: expectShift,
            alt: expectAlt,
        })

        const modifiersMatch = literalMatch || macFriendlyMatch

        let keyMatch = false
        if (key === 'space') {
            keyMatch = e.code === 'Space' || e.key === ' '
        } else if (key === 'escape') {
            keyMatch = e.key === 'Escape' || e.code === 'Escape'
        } else if (key === 'enter') {
            keyMatch = e.key === 'Enter' || e.code === 'Enter'
        } else if (key.startsWith('arrow')) {
            keyMatch = e.key.toLowerCase() === key || e.code.toLowerCase() === key
        } else if (key.startsWith('f') && /^f\d+$/.test(key)) {
            keyMatch = e.key.toLowerCase() === key || e.code.toLowerCase() === key
        } else if (key === '`') {
            keyMatch = e.key === '`' || e.code === 'Backquote'
        } else if (key === ',') {
            keyMatch = e.key === ',' || e.code === 'Comma'
        } else {
            keyMatch = e.key.toLowerCase() === key.toLowerCase()
        }

        return modifiersMatch && keyMatch
    }

    applyScenarioProfile(scenarioId: string | null): void {
        this.scenarioOverrides.clear()

        if (scenarioId) {
            const profile = SCENARIO_PROFILES[scenarioId]
            if (profile) {
                for (const [cmdId, key] of profile.overrides) {
                    this.scenarioOverrides.set(cmdId, key)
                }
                for (const cmd of profile.exclusiveCommands) {
                    if (!this.commands.has(cmd.id)) {
                        this.registerCommand(cmd)
                    }
                }
                logger.system.info(`[ScenarioKeybindingEngine] Applied profile: ${scenarioId} with ${profile.overrides.size} overrides, ${profile.exclusiveCommands.length} exclusive commands`)
            }
        }

        this.activeScenarioId = scenarioId
    }

    detectConflicts(): KeybindingConflict[] {
        const keyToCommands = new Map<string, string[]>()
        const conflicts: KeybindingConflict[] = []

        for (const [scenarioId, profile] of Object.entries(SCENARIO_PROFILES)) {
            for (const [cmdId, key] of profile.overrides) {
                const existing = keyToCommands.get(key) ?? []
                existing.push(`${scenarioId}:${cmdId}`)
                keyToCommands.set(key, existing)
            }
        }

        for (const [key, entries] of keyToCommands) {
            if (entries.length > 1) {
                conflicts.push({
                    commandId: entries.map(e => e.split(':')[1]).join(', '),
                    key,
                    scenarios: entries.map(e => e.split(':')[0]),
                })
            }
        }

        return conflicts
    }

    async updateBinding(commandId: string, newKey: string | null) {
        if (newKey === null) {
            this.overrides.delete(commandId)
        } else {
            this.overrides.set(commandId, newKey)
        }
        await this.saveOverrides()
    }

    async resetBinding(commandId: string) {
        this.overrides.delete(commandId)
        await this.saveOverrides()
    }

    private async loadOverrides() {
        try {
            const localData = StorageService.get<Record<string, string>>(LOCAL_STORAGE_KEY)
            if (localData) {
                const parsed = localData
                this.overrides = new Map(Object.entries(parsed))
                api.settings.set('keybindings', parsed).catch(() => { })
                return
            }
        } catch (e) {
            // StorageService 读取失败
        }

        try {
            const saved = await api.settings.get('keybindings') as Record<string, string>
            if (saved) {
                this.overrides = new Map(Object.entries(saved))
                StorageService.set(LOCAL_STORAGE_KEY, saved)
            }
        } catch (e) {
            logger.system.error('[ScenarioKeybindingEngine] Failed to load keybindings:', e)
        }
    }

    private async saveOverrides() {
        const obj = Object.fromEntries(this.overrides)
        try {
            StorageService.set(LOCAL_STORAGE_KEY, obj)
        } catch (e) {
            logger.system.error('[ScenarioKeybindingEngine] Failed to save keybindings to localStorage:', e)
        }
        try {
            await api.settings.set('keybindings', obj)
        } catch (e) {
            logger.system.error('[ScenarioKeybindingEngine] Failed to save keybindings:', e)
        }
    }
}

export const keybindingService = new ScenarioKeybindingEngine()

export function renderPlatformShortcut(shortcut: string): string {
    if (!isMac) return shortcut
    return shortcut
        .replace(/Ctrl\+/gi, '⌘')
        .replace(/Alt\+/gi, '⌥')
        .replace(/Shift\+/gi, '⇧')
}

export function splitPlatformKeys(keys: string[]): string[] {
    if (!isMac) return keys
    return keys.map(k => {
        const lower = k.toLowerCase()
        if (lower === 'ctrl') return '⌘'
        if (lower === 'alt') return '⌥'
        if (lower === 'shift') return '⇧'
        return k
    })
}

export function checkModifierState(
    e: KeyboardEvent | React.KeyboardEvent,
    expected: { meta: boolean; ctrl: boolean; shift: boolean; alt: boolean }
): boolean {
    return (
        (e.metaKey === expected.meta) &&
        (e.ctrlKey === expected.ctrl) &&
        (e.shiftKey === expected.shift) &&
        (e.altKey === expected.alt)
    )
}

export { isMac }
export { ScenarioKeybindingEngine }

export const formatShortcut = renderPlatformShortcut
export const formatShortcutKeys = splitPlatformKeys
export const modifiersMatch = checkModifierState
