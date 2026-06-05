/**
 * [AweeClaw] 场景感知目录管理引擎
 *
 * 会话数据使用 SQLite 数据库存储（替代原有的 JSONL 文件方案）：
 * - 会话元数据、线程元数据、线程消息均存储在 sessions.db 中
 * - 首次启动时自动从 JSONL 文件迁移历史数据
 * - 工作区状态、项目设置等仍使用 JSON 文件存储
 *
 * 目录结构：
 *   ├── index/               # 代码库向量索引
 *   ├── sessions/            # [遗留] 旧版 JSONL 会话文件（迁移后可清理）
 *   ├── audit/               # [法律/医疗] 审计日志目录
 *   ├── compliance/          # [医疗] 合规记录目录
 *   ├── assets/              # [教育] 素材资源目录
 *   ├── settings.json        # 项目级设置
 *   ├── workspace-state.json # 工作区状态（打开的文件等）
 *   └── rules.md             # 项目 AI 规则
 *
 * SQLite 数据库位置：
 *   {userDataPath}/.aweeclaw/db/sessions.db
 */

import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import { getEditorConfig } from '@shared/configuration/preferenceSync'
import type { OpenPreviewMetadata } from '@shared/protocols/previewProtocol'
import { BRAND } from '@shared/brand'
import { useStore } from '@store'
import {
  fromPersistedChatThread,
  toPersistedChatThread,
  type ChatThread,
  type PersistedChatThread,
} from '@intelligence/providerTypes'
import {
  buildEffectiveSessionMeta,
  DEFAULT_SESSION_META,
  isPlainRecord,
  normalizeLegacyThreadRecord,
  normalizeSessionExtraState,
  serializeSessionExtraState,
  stableStringify,
  toSessionIndexMeta,
  type AgentSessionSnapshot,
  type LegacyAgentStoreEnvelope,
  type SessionCatalog,
  type SessionIndexMeta,
  type SessionMeta,
  type PersistedThreadSummary,
} from './sessionStorageAdapter'

/**
 * 基于 SQLite 的会话数据存储
 *
 * 通过 IPC 调用主进程的 SessionDb 模块，替代原有的 JSONL 文件读写。
 * 保留与 SessionFileStore 相同的接口签名，确保 ScenarioDirectoryManager 无缝切换。
 */
class SessionDbStore {
  private dbInitialized = false

  /** 初始化数据库（含自动迁移） */
  async initialize(sessionsDir?: string): Promise<void> {
    if (this.dbInitialized) return
    try {
      const result = await api.sessionDb.initialize(sessionsDir ? { sessionsDir } : undefined)
      if (result.success) {
        this.dbInitialized = true
        logger.system.info('[SessionDbStore] Database initialized at', result.dbPath)
      } else {
        logger.system.error('[SessionDbStore] Database initialization failed:', result.error)
      }
    } catch (err) {
      logger.system.error('[SessionDbStore] Database initialization error:', err)
    }
  }

  /** 写入会话元数据（替代 writeSessionFile('_meta.json', ...)） */
  async writeSessionMeta(meta: SessionIndexMeta): Promise<void> {
    await api.sessionDb.batchUpsertSessionMeta({
      currentThreadId: meta.currentThreadId,
      threadIds: meta.threadIds,
      version: meta.version,
    })
  }

  /** 写入扩展状态（替代 writeSessionFile('_extra.json', ...)） */
  async writeSessionExtra(extra: Record<string, unknown>): Promise<void> {
    await api.sessionDb.upsertSessionMeta('extra', extra)
  }

  /** 删除扩展状态（替代 deleteSessionFile('_extra.json')） */
  async deleteSessionExtra(): Promise<void> {
    await api.sessionDb.deleteSessionMeta('extra')
  }

  /** 读取会话元数据和扩展状态（一次 IPC 调用） */
  async readSessionCatalog(): Promise<{ indexMeta: SessionIndexMeta | null; extra: Record<string, unknown> | null }> {
    const allMeta = await api.sessionDb.getAllSessionMeta()
    if (!allMeta || Object.keys(allMeta).length === 0) {
      return { indexMeta: null, extra: null }
    }
    const { extra, ...indexFields } = allMeta
    const indexMeta: SessionIndexMeta = {
      currentThreadId: indexFields.currentThreadId ?? null,
      threadIds: indexFields.threadIds ?? [],
      version: indexFields.version ?? 0,
    }
    return { indexMeta, extra: (extra as Record<string, unknown> | undefined) ?? null }
  }

  /** 写入线程元数据（替代 writeSessionFile(`${threadId}.json`, data)） */
  async writeThreadMeta(threadId: string, data: PersistedChatThread): Promise<void> {
    // 分离消息和元数据：元数据存 thread_meta 表，消息存 thread_message 表
    const messages = data.messages ?? []
    const metaToSave = { ...data, messages: [] } // 元数据不包含消息
    const metaResult = await api.sessionDb.upsertThreadMeta(threadId, metaToSave)
    if (metaResult && typeof metaResult === 'object' && 'success' in metaResult && !metaResult.success) {
      logger.system.error('[SessionDbStore] upsertThreadMeta failed:', metaResult.error)
    }
    // 同步保存消息（仅在线程有消息时写入）
    if (messages.length > 0) {
      const msgResult = await api.sessionDb.batchUpsertThreadMessages(threadId, messages)
      if (msgResult && typeof msgResult === 'object' && 'success' in msgResult && !msgResult.success) {
        logger.system.error('[SessionDbStore] batchUpsertThreadMessages failed:', msgResult.error)
      }
    }
  }

  /** 写入线程元数据（替代 writeSessionFile(`${threadId}.json`, data)）
   *  @param includeMessages 是否包含消息数据，默认 false（消息通过 loadThreadMessages 按需加载）
   */
  async readThreadMeta(threadId: string, includeMessages = false): Promise<PersistedChatThread | null> {
    const meta = await api.sessionDb.getThreadMeta(threadId)
    if (!meta) return null
    if (includeMessages) {
      const messages = await api.sessionDb.getThreadMessages(threadId)
      return { ...meta, messages }
    }
    return { ...meta, messages: [] }
  }

  /** 删除线程元数据（替代 deleteSessionFile(`${threadId}.json`)） */
  async deleteThreadMeta(threadId: string): Promise<void> {
    await api.sessionDb.deleteThreadMeta(threadId)
  }

  /** 将未关联用户的线程归属到指定用户（登录后调用） */
  async claimOrphanThreads(userId: string): Promise<number> {
    const result = await api.sessionDb.claimOrphanThreads(userId)
    return result.count ?? 0
  }

  /** 获取所有线程摘要（替代 listPersistedThreadSummaries）
   *  @param userId 用户 ID。字符串=按用户过滤；null=未登录用户；undefined=所有线程
   */
  async listPersistedThreadSummaries(userId?: string | null): Promise<PersistedThreadSummary[]> {
    const summaries = await api.sessionDb.getAllThreadSummaries(userId)
    return summaries.map(s => ({
      id: s.id,
      title: s.title ?? undefined,
      lastModified: s.lastModified,
      messageCount: s.messageCount,
      userId: s.userId ?? undefined,
    }))
  }

  /** 加载线程消息（替代 loadThreadMessages） */
  async loadThreadMessages(threadId: string): Promise<any[]> {
    return await api.sessionDb.getThreadMessages(threadId)
  }

  /** 批量保存线程消息 */
  async batchUpsertThreadMessages(threadId: string, messages: any[]): Promise<void> {
    await api.sessionDb.batchUpsertThreadMessages(threadId, messages)
  }

  /** 删除线程（含消息） */
  async deleteThread(threadId: string): Promise<void> {
    await api.sessionDb.deleteThread(threadId)
  }

  /** 清空所有会话数据 */
  async clearAll(): Promise<void> {
    await api.sessionDb.clearAll()
  }
}

export const ADNIFY_DIR_NAME = BRAND.dirName

export const ADNIFY_FILES = {
  INDEX_DIR: 'index',
  SESSIONS_DIR: 'sessions',
  SETTINGS: 'settings.json',
  WORKSPACE_STATE: 'workspace-state.json',
  RULES: 'rules.md',
} as const

type AweeClawFile = typeof ADNIFY_FILES[keyof typeof ADNIFY_FILES]

export interface WorkspaceStateData {
  openFiles: Array<string | {
    path: string
    kind?: 'file' | 'diff' | 'preview'
    preview?: OpenPreviewMetadata
  }>
  activeFile: string | null
  expandedFolders: string[]
  scrollPositions: Record<string, number>
  cursorPositions: Record<string, { line: number; column: number }>
  layout?: {
    sidebarWidth: number
    chatWidth: number
    terminalVisible: boolean
    terminalLayout: 'tabs' | 'split'
  }
}

export interface ProjectSettingsData {
  checkpointRetention: {
    maxCount: number
    maxAgeDays: number
    maxFileSizeKB: number
  }
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error'
    saveToFile: boolean
  }
  agent: {
    autoApproveReadOnly: boolean
    maxToolCallsPerTurn: number
  }
}

const DEFAULT_WORKSPACE_STATE: WorkspaceStateData = {
  openFiles: [],
  activeFile: null,
  expandedFolders: [],
  scrollPositions: {},
  cursorPositions: {},
}

const DEFAULT_PROJECT_SETTINGS: ProjectSettingsData = {
  checkpointRetention: {
    maxCount: 50,
    maxAgeDays: 7,
    maxFileSizeKB: 100,
  },
  logging: {
    level: 'info',
    saveToFile: false,
  },
  agent: {
    autoApproveReadOnly: true,
    maxToolCallsPerTurn: 150,
  },
}

class ScenarioDirectoryManager {
  private primaryRoot: string | null = null
  private initializedRoots: Set<string> = new Set()
  private initialized = false
  private readonly sessionDb: SessionDbStore

  private cache: {
    sessionMeta: SessionMeta | null
    threads: Map<string, PersistedChatThread>
    workspaceState: WorkspaceStateData | null
    settings: ProjectSettingsData | null
  } = {
      sessionMeta: null,
      threads: new Map(),
      workspaceState: null,
      settings: null,
    }

  private dirty: {
    sessionMeta: boolean
    dirtyThreads: Set<string>
    workspaceState: boolean
    settings: boolean
  } = {
      sessionMeta: false,
      dirtyThreads: new Set(),
      workspaceState: false,
      settings: false,
    }

  private flushTimer: ReturnType<typeof setTimeout> | null = null
  private threadHashes: Map<string, string> = new Map()
  private metaHash: string | null = null
  private metaWriteRevision = 0

  constructor() {
    this.sessionDb = new SessionDbStore()
  }

  async initialize(rootPath: string): Promise<boolean> {
    if (this.initializedRoots.has(rootPath)) return true

    try {
      const aweeclawPath = `${rootPath}/${ADNIFY_DIR_NAME}`
      if (!await api.file.exists(aweeclawPath)) {
        await api.file.ensureDir(aweeclawPath)
      }

      const requiredDirs = [
        `${aweeclawPath}/${ADNIFY_FILES.INDEX_DIR}`,
        `${aweeclawPath}/${ADNIFY_FILES.SESSIONS_DIR}`,
      ]

      const scenarioId = useStore.getState().activeScenarioId ?? 'workspace-editor'
      const scenarioDirs = this.getScenarioDirs(aweeclawPath, scenarioId)
      requiredDirs.push(...scenarioDirs)

      await Promise.all(requiredDirs.map(async dirPath => {
        if (!await api.file.exists(dirPath)) {
          await api.file.ensureDir(dirPath)
        }
      }))

      this.initializedRoots.add(rootPath)
      logger.system.info('[ScenarioDirManager] Root initialized:', rootPath, 'scenario:', scenarioId)
      return true
    } catch (error) {
      logger.system.error('[ScenarioDirManager] Root initialization failed:', rootPath, error)
      return false
    }
  }

  private getScenarioDirs(basePath: string, scenarioId: string): string[] {
    const dirs: string[] = []

    switch (scenarioId) {
      case 'legal':
        dirs.push(`${basePath}/audit`)
        break
      case 'medical':
        dirs.push(`${basePath}/audit`, `${basePath}/compliance`)
        break
      case 'education':
        dirs.push(`${basePath}/assets`)
        break
    }

    return dirs
  }

  async setPrimaryRoot(rootPath: string): Promise<void> {
    logger.system.info('[AweeClawDir] setPrimaryRoot called with:', rootPath)
    logger.system.info('[AweeClawDir] Current primaryRoot:', this.primaryRoot)

    if (this.primaryRoot === rootPath) {
      logger.system.info('[AweeClawDir] Primary root already set, skipping initialization')
      return
    }

    if (this.primaryRoot) {
      await this.flush()
    }

    this.primaryRoot = rootPath
    await this.initialize(rootPath)
    this.cache = { sessionMeta: null, threads: new Map(), workspaceState: null, settings: null }
    this.dirty = { sessionMeta: false, dirtyThreads: new Set(), workspaceState: false, settings: false }
    this.threadHashes.clear()
    this.metaHash = null
    // 初始化 SQLite 数据库（含自动迁移 JSONL 数据）
    await this.sessionDb.initialize(this.getSessionsDirPath())
    await this.migrateLegacySessionsIfNeeded()
    await this.loadAllData()
    this.initialized = true
    logger.system.info('[AweeClawDir] Primary root set:', rootPath)
  }

  reset(): void {
    this.primaryRoot = null
    this.initializedRoots.clear()
    this.initialized = false
    this.cache = { sessionMeta: null, threads: new Map(), workspaceState: null, settings: null }
    this.dirty = { sessionMeta: false, dirtyThreads: new Set(), workspaceState: false, settings: false }
    this.threadHashes.clear()
    this.metaHash = null
    this.metaWriteRevision = 0
    logger.system.info('[AweeClawDir] Reset')
  }

  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }

    if (!this.initialized || !this.primaryRoot) return

    const metaToWrite = this.dirty.sessionMeta && this.cache.sessionMeta
      ? {
        index: toSessionIndexMeta(this.cache.sessionMeta),
        extra: serializeSessionExtraState(this.cache.sessionMeta.extra),
      }
      : null
    const metaRevision = metaToWrite ? ++this.metaWriteRevision : 0

    const promises: Promise<void>[] = []

    if (metaToWrite) {
      promises.push(this.sessionDb.writeSessionMeta(metaToWrite.index))
      if (Object.keys(metaToWrite.extra).length > 0) {
        promises.push(this.sessionDb.writeSessionExtra(metaToWrite.extra))
      } else {
        promises.push(this.sessionDb.deleteSessionExtra())
      }
    }

    const flushedThreadIds = [...this.dirty.dirtyThreads]
    for (const threadId of flushedThreadIds) {
      const data = this.cache.threads.get(threadId)
      if (data !== undefined) {
        promises.push(this.sessionDb.writeThreadMeta(threadId, data))
        this.threadHashes.set(threadId, stableStringify(data))
      }
    }

    if (this.dirty.workspaceState && this.cache.workspaceState) {
      promises.push(this.writeJsonFile(ADNIFY_FILES.WORKSPACE_STATE, this.cache.workspaceState))
    }

    if (this.dirty.settings && this.cache.settings) {
      promises.push(this.writeJsonFile(ADNIFY_FILES.SETTINGS, this.cache.settings))
    }

    if (promises.length > 0) {
      await Promise.all(promises)
      if (metaToWrite && this.metaWriteRevision === metaRevision) {
        this.dirty.sessionMeta = false
        this.metaHash = stableStringify({ ...metaToWrite.index, extra: metaToWrite.extra })
      }
      for (const threadId of flushedThreadIds) {
        this.dirty.dirtyThreads.delete(threadId)
      }
      if (this.dirty.workspaceState && this.cache.workspaceState) {
        this.dirty.workspaceState = false
      }
      if (this.dirty.settings && this.cache.settings) {
        this.dirty.settings = false
      }
      logger.system.info('[AweeClawDir] Flushed all dirty data')
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null
      this.flush().catch(err => logger.system.error('[AweeClawDir] Flush error:', err))
    }, getEditorConfig().performance.flushIntervalMs)
  }

  isInitialized(): boolean {
    return this.initialized && this.primaryRoot !== null
  }

  getPrimaryRoot(): string | null {
    return this.primaryRoot
  }

  getDirPath(rootPath?: string): string {
    const targetRoot = rootPath || this.primaryRoot
    if (!targetRoot) {
      throw new Error('[AweeClawDir] Not initialized')
    }
    return `${targetRoot}/${ADNIFY_DIR_NAME}`
  }

  getFilePath(file: AweeClawFile | string, rootPath?: string): string {
    return `${this.getDirPath(rootPath)}/${file}`
  }

  private getSessionsDirPath(): string {
    return `${this.getDirPath()}/${ADNIFY_FILES.SESSIONS_DIR}`
  }

  private getLegacySessionsFilePath(): string {
    return this.getFilePath('sessions.json')
  }

  /** 获取当前登录用户的 ID（未登录返回 undefined） */
  private getCurrentUserId(): string | undefined {
    return useStore.getState().cloudUser?.id
  }

  private async buildSessionCatalog(): Promise<SessionCatalog> {
    const userId = this.getCurrentUserId() ?? null  // 未登录时传 null，只查 user_id IS NULL 的线程
    const [{ indexMeta, extra }, summaries] = await Promise.all([
      this.sessionDb.readSessionCatalog(),
      this.sessionDb.listPersistedThreadSummaries(userId),
    ])

    const hydratedMeta: SessionMeta = {
      currentThreadId: indexMeta?.currentThreadId ?? null,
      threadIds: indexMeta?.threadIds ?? [],
      version: indexMeta?.version ?? 0,
      extra: normalizeSessionExtraState(extra),
    }

    return {
      meta: buildEffectiveSessionMeta(hydratedMeta, summaries),
      summaries,
    }
  }

  private async reconcileSessionMeta(meta: SessionMeta): Promise<SessionMeta> {
    const userId = this.getCurrentUserId() ?? null
    const summaries = await this.sessionDb.listPersistedThreadSummaries(userId)
    const reconciledMeta = buildEffectiveSessionMeta(meta, summaries)
    const indexedThreadIds = [...meta.threadIds].sort()
    const actualThreadIds = [...reconciledMeta.threadIds].sort()
    const hasThreadSetDrift =
      actualThreadIds.length !== indexedThreadIds.length ||
      actualThreadIds.some((threadId, index) => threadId !== indexedThreadIds[index])
    const hasCurrentThreadDrift = reconciledMeta.currentThreadId !== meta.currentThreadId

    if (!hasThreadSetDrift && !hasCurrentThreadDrift) {
      return meta
    }

    await this.sessionDb.writeSessionMeta(toSessionIndexMeta(reconciledMeta))
    this.cache.sessionMeta = reconciledMeta
    this.metaHash = stableStringify(reconciledMeta)
    this.dirty.sessionMeta = false
    logger.system.warn('[AweeClawDir] Reconciled session meta from persisted thread files:', {
      indexedCount: meta.threadIds.length,
      actualCount: actualThreadIds.length,
      currentThreadId: reconciledMeta.currentThreadId,
    })

    return reconciledMeta
  }

  async getSessionMeta(): Promise<SessionMeta> {
    if (this.cache.sessionMeta) return this.cache.sessionMeta
    if (!this.isInitialized()) return { ...DEFAULT_SESSION_META }

    const { meta } = await this.buildSessionCatalog()
    const reconciledMeta = await this.reconcileSessionMeta(meta)

    this.cache.sessionMeta = reconciledMeta
    this.metaHash = stableStringify(reconciledMeta)
    return reconciledMeta
  }

  private parseLegacyAgentSessionSnapshot(content: string): AgentSessionSnapshot | null {
    try {
      const parsed = JSON.parse(content) as Record<string, unknown>
      const envelope = isPlainRecord(parsed?.['aweeclaw-agent-store'])
        ? parsed['aweeclaw-agent-store'] as LegacyAgentStoreEnvelope
        : parsed as LegacyAgentStoreEnvelope

      const rawState = isPlainRecord(envelope.state) ? envelope.state : {}
      const rawThreads = isPlainRecord(rawState.threads) ? rawState.threads : {}
      const threads: Record<string, ChatThread> = {}

      for (const [threadId, threadValue] of Object.entries(rawThreads)) {
        const thread = normalizeLegacyThreadRecord(threadId, threadValue)
        if (thread) {
          threads[threadId] = thread
        }
      }

      const threadIds = Object.keys(threads)
      const currentThreadId = typeof rawState.currentThreadId === 'string' && threads[rawState.currentThreadId]
        ? rawState.currentThreadId
        : (threadIds[0] || null)

      if (threadIds.length === 0 && !currentThreadId) {
        return null
      }

      return {
        threads,
        currentThreadId,
        branches: isPlainRecord(rawState.branches) ? rawState.branches : {},
        activeBranchId: isPlainRecord(rawState.activeBranchId) ? rawState.activeBranchId : {},
        version: typeof envelope.version === 'number' ? envelope.version : 0,
      }
    } catch (error) {
      logger.system.error('[AweeClawDir] Failed to parse legacy sessions.json:', error)
      return null
    }
  }

  private async writeAgentSessionSnapshot(snapshot: AgentSessionSnapshot): Promise<void> {
    const normalizedExtra = normalizeSessionExtraState({
      branches: snapshot.branches,
      activeBranchId: snapshot.activeBranchId,
    })
    const threadIds = Object.keys(snapshot.threads)

    await this.sessionDb.writeSessionMeta({
      currentThreadId: snapshot.currentThreadId,
      threadIds,
      version: snapshot.version,
    })

    if (Object.keys(serializeSessionExtraState(normalizedExtra)).length > 0) {
      await this.sessionDb.writeSessionExtra(serializeSessionExtraState(normalizedExtra))
    } else {
      await this.sessionDb.deleteSessionExtra()
    }

    await Promise.all(
      threadIds.map(async threadId => {
        await this.sessionDb.writeThreadMeta(threadId, toPersistedChatThread(snapshot.threads[threadId]))
      })
    )
  }

  private async migrateLegacySessionsIfNeeded(): Promise<void> {
    if (!this.primaryRoot) return

    const legacySessionsPath = this.getLegacySessionsFilePath()
    const legacyExists = await api.file.exists(legacySessionsPath)
    if (!legacyExists) return

    // 检查数据库中是否已有数据（迁移时不过滤 userId）
    const existingSummaries = await this.sessionDb.listPersistedThreadSummaries(undefined)
    if (existingSummaries.length > 0) return

    const legacyContent = await api.file.read(legacySessionsPath)
    if (!legacyContent) {
      return
    }

    const snapshot = this.parseLegacyAgentSessionSnapshot(legacyContent)
    if (!snapshot) {
      logger.system.warn('[AweeClawDir] Legacy sessions.json exists but no valid session snapshot was found')
      return
    }

    await this.writeAgentSessionSnapshot(snapshot)
    await api.file.delete(legacySessionsPath).catch(() => { /* ignore */ })
    logger.system.info(`[AweeClawDir] Migrated legacy sessions.json to thread storage (${Object.keys(snapshot.threads).length} threads)`)
  }

  async getThreadData(threadId: string): Promise<PersistedChatThread | null> {
    if (this.cache.threads.has(threadId)) return this.cache.threads.get(threadId)!
    if (!this.isInitialized()) return null
    const data = await this.sessionDb.readThreadMeta(threadId)
    if (data !== null) {
      this.cache.threads.set(threadId, data)
      this.threadHashes.set(threadId, stableStringify(data))
    }
    return data
  }

  /**
   * 按需加载线程消息（懒加载）
   * 从 .jsonl 文件读取消息，不影响缓存的元数据
   */
  async loadThreadMessages(threadId: string): Promise<any[]> {
    if (!this.isInitialized()) return []
    return this.sessionDb.loadThreadMessages(threadId)
  }

  setThreadDirty(threadId: string, data: PersistedChatThread): void {
    const nextHash = stableStringify(data)
    const prevHash = this.threadHashes.get(threadId)
    this.cache.threads.set(threadId, data)
    if (prevHash === nextHash) return
    this.dirty.dirtyThreads.add(threadId)
    this.threadHashes.set(threadId, nextHash)
    this.scheduleFlush()
  }

  setSessionMetaDirty(meta: SessionMeta): void {
    const nextHash = stableStringify(meta)
    this.cache.sessionMeta = meta
    if (this.metaHash === nextHash) return
    this.metaHash = nextHash
    this.dirty.sessionMeta = true
    this.scheduleFlush()
  }

  async deleteThreadData(threadId: string): Promise<void> {
    this.cache.threads.delete(threadId)
    this.dirty.dirtyThreads.delete(threadId)
    this.threadHashes.delete(threadId)

    const meta = await this.getSessionMeta()
    const nextThreadIds = meta.threadIds.filter(id => id !== threadId)
    this.setSessionMetaDirty({
      ...meta,
      threadIds: nextThreadIds,
      currentThreadId: meta.currentThreadId === threadId ? (nextThreadIds[0] || null) : meta.currentThreadId,
    })

    if (this.isInitialized()) {
      try {
        await this.sessionDb.deleteThread(threadId)
      } catch {
        // ignore
      }
    }
  }

  async clearAllSessions(): Promise<void> {
    const meta = await this.getSessionMeta()
    for (const threadId of meta.threadIds) {
      this.cache.threads.delete(threadId)
      this.threadHashes.delete(threadId)
    }
    this.cache.sessionMeta = { ...DEFAULT_SESSION_META }
    this.metaHash = stableStringify(this.cache.sessionMeta)
    this.dirty.sessionMeta = false
    this.dirty.dirtyThreads.clear()
    await this.sessionDb.clearAll()
  }

  async getHydratedAgentSessionSnapshot(): Promise<AgentSessionSnapshot | null> {
    const { meta, summaries } = await this.buildSessionCatalog()
    const reconciledMeta = await this.reconcileSessionMeta(meta)

    if (reconciledMeta.threadIds.length === 0 && !reconciledMeta.currentThreadId) {
      this.cache.sessionMeta = reconciledMeta
      this.metaHash = stableStringify(reconciledMeta)
      return null
    }

    this.cache.sessionMeta = reconciledMeta
    this.metaHash = stableStringify(reconciledMeta)

    const effectiveMeta = buildEffectiveSessionMeta(reconciledMeta, summaries)

    const threadEntries = await Promise.all(
      effectiveMeta.threadIds.map(async threadId => [threadId, await this.getThreadData(threadId)] as const)
    )

    const threads: Record<string, ChatThread> = {}
    for (const [threadId, data] of threadEntries) {
      if (data !== null) {
        threads[threadId] = fromPersistedChatThread(data)
      }
    }

    // 立即加载当前线程的消息（阻塞加载，确保 UI 渲染前消息已就绪）
    const currentThreadId = effectiveMeta.currentThreadId
    if (currentThreadId && threads[currentThreadId]) {
      const threadData = threads[currentThreadId] as ChatThread
      // 只有当消息为空时才加载（避免重复加载）
      if (!threadData.messages || threadData.messages.length === 0) {
        const messages = await this.loadThreadMessages(currentThreadId)
        threadData.messages = messages
        threadData.messageCount = messages.length
        threadData.messagesHydrated = true
      }
    }

    return {
      threads,
      currentThreadId: effectiveMeta.currentThreadId,
      branches: effectiveMeta.extra.branches,
      activeBranchId: effectiveMeta.extra.activeBranchId,
      version: effectiveMeta.version,
    }
  }

  async getAgentSessionSnapshot(): Promise<AgentSessionSnapshot | null> {
    const { meta, summaries } = await this.buildSessionCatalog()
    const reconciledMeta = await this.reconcileSessionMeta(meta)

    if (reconciledMeta.threadIds.length === 0 && !reconciledMeta.currentThreadId) {
      this.cache.sessionMeta = reconciledMeta
      this.metaHash = stableStringify(reconciledMeta)
      return null
    }

    this.cache.sessionMeta = reconciledMeta
    this.metaHash = stableStringify(reconciledMeta)

    const effectiveMeta = buildEffectiveSessionMeta(reconciledMeta, summaries)
    const threadEntries = await Promise.all(
      effectiveMeta.threadIds.map(async threadId => [threadId, await this.getThreadData(threadId)] as const)
    )

    const threads: Record<string, ChatThread> = {}
    for (const [threadId, data] of threadEntries) {
      if (data !== null) {
        threads[threadId] = fromPersistedChatThread(data)
      }
    }

    return {
      threads,
      currentThreadId: effectiveMeta.currentThreadId,
      branches: effectiveMeta.extra.branches,
      activeBranchId: effectiveMeta.extra.activeBranchId,
      version: effectiveMeta.version,
    }
  }

  stageAgentSessionSnapshot(snapshot: AgentSessionSnapshot): void {
    const threads = snapshot.threads || {}
    const currentThreadId = snapshot.currentThreadId
    const extra = normalizeSessionExtraState({
      branches: snapshot.branches,
      activeBranchId: snapshot.activeBranchId,
    })

    this.setSessionMetaDirty({
      currentThreadId,
      threadIds: Object.keys(threads),
      extra,
      version: snapshot.version || 0,
    })

    for (const [threadId, data] of Object.entries(threads)) {
      const threadData = toPersistedChatThread(data)
      // Messages still loading from disk should not be marked dirty yet.
      // Otherwise shutdown can flush the placeholder thread and wipe the real JSONL payload.
      if (data.messagesHydrated === false) {
        this.cache.threads.set(threadId, threadData)
        continue
      }
      this.setThreadDirty(threadId, threadData)
    }

    // 注意：不删除不在 snapshot 中的线程，因为数据库是全局的（多项目共享），
    // snapshot 只包含当前项目的线程。线程删除由 deleteThreadData 单独处理。
  }

  async getWorkspaceState(): Promise<WorkspaceStateData> {
    if (this.cache.workspaceState) return this.cache.workspaceState
    if (!this.isInitialized()) return { ...DEFAULT_WORKSPACE_STATE }
    const data = await this.readJsonFile<WorkspaceStateData>(ADNIFY_FILES.WORKSPACE_STATE)
    this.cache.workspaceState = data || { ...DEFAULT_WORKSPACE_STATE }
    return this.cache.workspaceState
  }

  async saveWorkspaceState(data: WorkspaceStateData): Promise<void> {
    this.cache.workspaceState = data
    this.dirty.workspaceState = true
  }

  async getSettings(): Promise<ProjectSettingsData> {
    if (this.cache.settings) return this.cache.settings
    if (!this.isInitialized()) return { ...DEFAULT_PROJECT_SETTINGS }
    const data = await this.readJsonFile<ProjectSettingsData>(ADNIFY_FILES.SETTINGS)
    this.cache.settings = data ? { ...DEFAULT_PROJECT_SETTINGS, ...data } : { ...DEFAULT_PROJECT_SETTINGS }
    return this.cache.settings
  }

  async saveSettings(data: ProjectSettingsData): Promise<void> {
    this.cache.settings = data
    this.dirty.settings = true
    if (this.isInitialized()) {
      await this.writeJsonFile(ADNIFY_FILES.SETTINGS, data)
      this.dirty.settings = false
    }
  }

  async readText(file: AweeClawFile | string, rootPath?: string): Promise<string | null> {
    try {
      return await api.file.read(this.getFilePath(file, rootPath))
    } catch {
      return null
    }
  }

  async writeText(file: AweeClawFile | string, content: string, rootPath?: string): Promise<boolean> {
    try {
      return await api.file.write(this.getFilePath(file, rootPath), content)
    } catch (error) {
      logger.system.error(`[AweeClawDir] Failed to write ${file}:`, error)
      return false
    }
  }

  async readJson<T>(file: AweeClawFile | string, rootPath?: string): Promise<T | null> {
    try {
      const content = await api.file.read(this.getFilePath(file, rootPath))
      if (!content) return null
      return JSON.parse(content) as T
    } catch {
      return null
    }
  }

  async writeJson<T>(file: AweeClawFile | string, data: T, rootPath?: string): Promise<boolean> {
    try {
      const content = JSON.stringify(data, null, 2)
      return await api.file.write(this.getFilePath(file, rootPath), content)
    } catch (error) {
      logger.system.error(`[AweeClawDir] Failed to write ${file}:`, error)
      return false
    }
  }

  async fileExists(file: AweeClawFile | string, rootPath?: string): Promise<boolean> {
    try {
      return await api.file.exists(this.getFilePath(file, rootPath))
    } catch {
      return false
    }
  }

  async deleteFile(file: AweeClawFile | string, rootPath?: string): Promise<boolean> {
    try {
      return await api.file.delete(this.getFilePath(file, rootPath))
    } catch {
      return false
    }
  }

  private async loadAllData(): Promise<void> {
    const [sessionMeta, workspaceState, settings] = await Promise.all([
      this.getSessionMeta(),
      this.readJsonFile<WorkspaceStateData>(ADNIFY_FILES.WORKSPACE_STATE),
      this.readJsonFile<ProjectSettingsData>(ADNIFY_FILES.SETTINGS),
    ])
    this.cache.sessionMeta = sessionMeta || { ...DEFAULT_SESSION_META }
    this.metaHash = stableStringify(this.cache.sessionMeta)
    this.cache.workspaceState = workspaceState || { ...DEFAULT_WORKSPACE_STATE }
    this.cache.settings = settings ? { ...DEFAULT_PROJECT_SETTINGS, ...settings } : { ...DEFAULT_PROJECT_SETTINGS }
    logger.system.info('[AweeClawDir] Loaded all data from disk')
  }

  private async readJsonFile<T>(file: AweeClawFile): Promise<T | null> {
    return this.readJson<T>(file)
  }

  private async writeJsonFile<T>(file: AweeClawFile, data: T): Promise<void> {
    await this.writeJson(file, data)
  }
}

export const aweeclawDir = new ScenarioDirectoryManager()
export { DEFAULT_PROJECT_SETTINGS, DEFAULT_WORKSPACE_STATE }
export type { AgentSessionSnapshot } from './sessionStorageAdapter'
