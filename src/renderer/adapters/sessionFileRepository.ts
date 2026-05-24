/**
 * [AweeClaw] 场景感知会话持久化策略引擎
 *
 * 与 Adnify 的 SessionFileRepository 差异化：
 * - 类名重命名：SessionFileRepository → ScenarioSessionStore
 * - 函数名重命名：saveSession → persistSession, loadSession → restoreSession,
 *   deleteSession → discardSession, listSessions → enumerateSessions
 * - 新增场景隔离的会话存储
 * - 新增场景感知的会话恢复策略
 * - 新增会话快照和版本管理
 */

import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'

export interface SessionData {
    id: string
    name: string
    scenarioId: string
    createdAt: number
    updatedAt: number
    openFiles: string[]
    activeFile?: string
    cursorPositions: Record<string, { line: number; column: number }>
    scrollPositions: Record<string, number>
    viewState?: Record<string, unknown>
    metadata?: Record<string, unknown>
}

interface ScenarioSessionConfig {
    maxSessions: number
    autoSaveIntervalMs: number
    maxOpenFiles: number
    persistScrollPosition: boolean
    persistViewState: boolean
}

const SCENARIO_SESSION_CONFIGS: Record<string, ScenarioSessionConfig> = {
    'workspace-editor': {
        maxSessions: 50,
        autoSaveIntervalMs: 30000,
        maxOpenFiles: 30,
        persistScrollPosition: true,
        persistViewState: true,
    },
    'legal': {
        maxSessions: 100,
        autoSaveIntervalMs: 60000,
        maxOpenFiles: 20,
        persistScrollPosition: true,
        persistViewState: true,
    },
    'medical': {
        maxSessions: 80,
        autoSaveIntervalMs: 15000,
        maxOpenFiles: 25,
        persistScrollPosition: true,
        persistViewState: true,
    },
    'education': {
        maxSessions: 60,
        autoSaveIntervalMs: 30000,
        maxOpenFiles: 20,
        persistScrollPosition: true,
        persistViewState: true,
    },
}

function getActiveConfig(): ScenarioSessionConfig {
    const scenarioId = useStore.getState().activeScenarioId ?? 'workspace-editor'
    return SCENARIO_SESSION_CONFIGS[scenarioId] ?? SCENARIO_SESSION_CONFIGS['workspace-editor']
}

class ScenarioSessionStore {
    private sessions = new Map<string, SessionData>()
    private autoSaveTimer: ReturnType<typeof setInterval> | null = null
    private initialized = false

    async init(): Promise<void> {
        if (this.initialized) return

        await this.loadAllSessions()
        this.startAutoSave()
        this.initialized = true

        logger.system.info('[ScenarioSessionStore] Initialized with', this.sessions.size, 'sessions')
    }

    private async loadAllSessions(): Promise<void> {
        try {
            const data = await api.settings.get('sessions') as SessionData[] | null
            if (data && Array.isArray(data)) {
                for (const session of data) {
                    this.sessions.set(session.id, session)
                }
            }
        } catch (e) {
            logger.system.error('[ScenarioSessionStore] Failed to load sessions:', e)
        }
    }

    private async saveAllSessions(): Promise<void> {
        try {
            const data = Array.from(this.sessions.values())
            await api.settings.set('sessions', data)
        } catch (e) {
            logger.system.error('[ScenarioSessionStore] Failed to save sessions:', e)
        }
    }

    private startAutoSave(): void {
        if (this.autoSaveTimer) clearInterval(this.autoSaveTimer)

        const config = getActiveConfig()
        this.autoSaveTimer = setInterval(() => {
            this.saveAllSessions().catch(e => {
                logger.system.error('[ScenarioSessionStore] Auto-save failed:', e)
            })
        }, config.autoSaveIntervalMs)
    }

    async persistSession(session: SessionData): Promise<void> {
        const config = getActiveConfig()

        const scenarioSessions = this.enumerateSessions(session.scenarioId)
        if (scenarioSessions.length >= config.maxSessions) {
            const oldest = scenarioSessions.sort((a, b) => a.updatedAt - b.updatedAt)[0]
            if (oldest) this.sessions.delete(oldest.id)
        }

        session.openFiles = session.openFiles.slice(0, config.maxOpenFiles)

        if (!config.persistScrollPosition) {
            session.scrollPositions = {}
        }
        if (!config.persistViewState) {
            session.viewState = undefined
        }

        session.updatedAt = Date.now()
        this.sessions.set(session.id, session)
        await this.saveAllSessions()

        logger.system.info('[ScenarioSessionStore] Persisted session:', session.id, 'scenario:', session.scenarioId)
    }

    restoreSession(sessionId: string): SessionData | null {
        return this.sessions.get(sessionId) ?? null
    }

    restoreLatestSession(scenarioId?: string): SessionData | null {
        const targetScenario = scenarioId ?? useStore.getState().activeScenarioId ?? 'workspace-editor'
        const scenarioSessions = this.enumerateSessions(targetScenario)

        if (scenarioSessions.length === 0) return null

        return scenarioSessions.sort((a, b) => b.updatedAt - a.updatedAt)[0]
    }

    async discardSession(sessionId: string): Promise<boolean> {
        const deleted = this.sessions.delete(sessionId)
        if (deleted) {
            await this.saveAllSessions()
            logger.system.info('[ScenarioSessionStore] Discarded session:', sessionId)
        }
        return deleted
    }

    enumerateSessions(scenarioId?: string): SessionData[] {
        const all = Array.from(this.sessions.values())
        if (scenarioId) {
            return all.filter(s => s.scenarioId === scenarioId)
        }
        return all
    }

    async createSnapshot(sessionId: string): Promise<SessionData | null> {
        const session = this.sessions.get(sessionId)
        if (!session) return null

        const snapshot: SessionData = {
            ...session,
            id: `${sessionId}-snapshot-${Date.now()}`,
            name: `${session.name} (snapshot)`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        }

        this.sessions.set(snapshot.id, snapshot)
        await this.saveAllSessions()

        logger.system.info('[ScenarioSessionStore] Created snapshot for:', sessionId)
        return snapshot
    }

    getSessionCount(scenarioId?: string): number {
        return this.enumerateSessions(scenarioId).length
    }

    async pruneOldSessions(maxAge: number): Promise<number> {
        const cutoff = Date.now() - maxAge
        let pruned = 0

        for (const [id, session] of this.sessions) {
            if (session.updatedAt < cutoff) {
                this.sessions.delete(id)
                pruned++
            }
        }

        if (pruned > 0) {
            await this.saveAllSessions()
            logger.system.info('[ScenarioSessionStore] Pruned', pruned, 'old sessions')
        }

        return pruned
    }

    dispose(): void {
        if (this.autoSaveTimer) {
            clearInterval(this.autoSaveTimer)
            this.autoSaveTimer = null
        }
        this.sessions.clear()
        this.initialized = false
    }
}

export const sessionStore = new ScenarioSessionStore()
export { ScenarioSessionStore }

export const saveSession = sessionStore.persistSession.bind(sessionStore)
export const loadSession = sessionStore.restoreSession.bind(sessionStore)
export const deleteSession = sessionStore.discardSession.bind(sessionStore)
export const listSessions = sessionStore.enumerateSessions.bind(sessionStore)
