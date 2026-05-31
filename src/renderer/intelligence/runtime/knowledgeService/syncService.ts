import { backendApi, isAuthenticated } from '../../../adapters/backendApi'
import { logger } from '@toolkit/LogEngine'
import { knowledgeService } from './index'
import { globalEventBus } from '@intelligence/engine/EventBus'
import type { KnowledgeEntry, KnowledgeEntryInput } from '@intelligence/providerTypes'
import { useStore } from '@store'

function getPrivacySettings() {
  try {
    return useStore.getState().privacySettings
  } catch {
    return null
  }
}

function isSyncAllowed(): boolean {
  const privacy = getPrivacySettings()
  if (!privacy) return true
  return privacy.knowledgeSyncMode !== 'local-only'
}

interface ServerKnowledgeEntry {
  id: string
  userId: string
  baseId: string | null
  title: string
  content: string
  category: string
  tags: string[]
  source: string
  sourceDetail: string | null
  confidence: number
  starred: boolean
  enabled: boolean
  accessCount: number
  localId: string | null
  syncVersion: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

interface SyncEntryPayload {
  localId?: string
  serverId?: string
  title: string
  content: string
  category?: string
  tags?: string[]
  source?: string
  sourceDetail?: string
  confidence?: number
  starred?: boolean
  enabled?: boolean
  accessCount?: number
  baseId?: string
  syncVersion?: number
  localUpdatedAt?: string
  localCreatedAt?: string
  isDeleted?: boolean
}

interface SyncConflict {
  localId: string
  serverId: string
  reason: string
  serverUpdatedAt: string
  localTitle?: string
  serverTitle?: string
  localUpdatedAt?: string
}

type ConflictResolution = 'keep_local' | 'keep_server' | 'keep_both'

interface ResolvedConflict {
  conflict: SyncConflict
  resolution: ConflictResolution
}

interface SyncResult {
  synced: number
  created: number
  updated: number
  deleted: number
  conflicts: SyncConflict[]
  serverEntries: ServerKnowledgeEntry[]
}

interface LocalSyncMeta {
  lastSyncAt: string | null
  serverIdMap: Record<string, string>
}

const SYNC_META_KEY = 'knowledge_sync_meta'
const SYNC_INTERVAL_MS = 5 * 60 * 1000
const MAX_PENDING_CONFLICTS = 50

class KnowledgeSyncService {
  private syncTimer: ReturnType<typeof setInterval> | null = null
  private isSyncing = false
  private pendingConflicts: SyncConflict[] = []

  startAutoSync(): void {
    if (this.syncTimer) return
    if (!isSyncAllowed()) {
      logger.agent.info('[KnowledgeSync] Sync disabled by privacy settings (local-only mode)')
      return
    }
    this.syncTimer = setInterval(() => {
      if (!isSyncAllowed()) return
      this.syncToServer().catch((err) => {
        logger.agent.warn('[KnowledgeSync] Auto sync failed:', err)
      })
    }, SYNC_INTERVAL_MS)
    logger.agent.info('[KnowledgeSync] Auto sync started')
  }

  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer)
      this.syncTimer = null
      logger.agent.info('[KnowledgeSync] Auto sync stopped')
    }
  }

  async syncToServer(): Promise<SyncResult | null> {
    if (this.isSyncing) return null
    if (!isAuthenticated()) return null
    if (!isSyncAllowed()) {
      logger.agent.debug('[KnowledgeSync] Sync skipped - privacy settings: local-only mode')
      return null
    }

    this.isSyncing = true
    try {
      const meta = this.loadSyncMeta()
      const entries = await knowledgeService.getEntries()

      const syncPayload: SyncEntryPayload[] = entries.map((entry) => {
        const serverId = meta.serverIdMap[entry.id]
        return {
          localId: entry.id,
          serverId: serverId || undefined,
          title: entry.title,
          content: entry.content,
          category: entry.category,
          tags: entry.tags,
          source: entry.source,
          sourceDetail: entry.sourceDetail,
          confidence: entry.confidence,
          starred: entry.starred,
          enabled: entry.enabled,
          accessCount: entry.accessCount,
          localUpdatedAt: new Date(entry.updatedAt).toISOString(),
          localCreatedAt: new Date(entry.createdAt).toISOString(),
        }
      })

      const result = await backendApi.post<SyncResult>('/api/v1/knowledge/sync', {
        entries: syncPayload,
        lastSyncAt: meta.lastSyncAt,
      })

      await this.applyServerChanges(result, meta)

      if (result.conflicts.length > 0) {
        await this.handleConflicts(result.conflicts, meta, entries)
      }

      meta.lastSyncAt = new Date().toISOString()
      this.saveSyncMeta(meta)

      logger.agent.info(
        `[KnowledgeSync] Sync completed: created=${result.created}, updated=${result.updated}, deleted=${result.deleted}, conflicts=${result.conflicts.length}`,
      )

      return result
    } catch (err) {
      logger.agent.warn('[KnowledgeSync] Sync failed:', err)
      return null
    } finally {
      this.isSyncing = false
    }
  }

  async pullFromServer(): Promise<number> {
    if (!isAuthenticated()) return 0
    if (!isSyncAllowed()) return 0

    try {
      const serverEntries = await backendApi.get<ServerKnowledgeEntry[]>(
        '/api/v1/knowledge/entries',
      )

      if (!serverEntries || serverEntries.length === 0) return 0

      const localEntries = await knowledgeService.getEntries()
      const localMap = new Map(localEntries.map((e) => [e.id, e]))
      const meta = this.loadSyncMeta()
      const reverseMap = new Map<string, string>()
      for (const [localId, serverId] of Object.entries(meta.serverIdMap)) {
        reverseMap.set(serverId, localId)
      }

      let pulled = 0
      for (const serverEntry of serverEntries) {
        if (serverEntry.deletedAt) continue

        const existingLocalId = reverseMap.get(serverEntry.id)
        if (existingLocalId && localMap.has(existingLocalId)) {
          const local = localMap.get(existingLocalId)!
          if (new Date(serverEntry.updatedAt).getTime() > local.updatedAt) {
            await knowledgeService.updateEntry(existingLocalId, {
              title: serverEntry.title,
              content: serverEntry.content,
              category: serverEntry.category as any,
              tags: serverEntry.tags,
              starred: serverEntry.starred,
              enabled: serverEntry.enabled,
            })
            pulled++
          }
        } else {
          const input: KnowledgeEntryInput = {
            title: serverEntry.title,
            content: serverEntry.content,
            category: serverEntry.category as any,
            tags: serverEntry.tags,
            source: serverEntry.source as any,
            sourceDetail: serverEntry.sourceDetail || undefined,
            confidence: serverEntry.confidence,
            starred: serverEntry.starred,
            enabled: serverEntry.enabled,
          }
          const newEntry = await knowledgeService.addEntry(input)
          meta.serverIdMap[newEntry.id] = serverEntry.id
          pulled++
        }
      }

      if (pulled > 0) {
        this.saveSyncMeta(meta)
      }

      logger.agent.info(`[KnowledgeSync] Pulled ${pulled} entries from server`)
      return pulled
    } catch (err) {
      logger.agent.warn('[KnowledgeSync] Pull failed:', err)
      return 0
    }
  }

  async pushEntry(entry: KnowledgeEntry): Promise<string | null> {
    if (!isAuthenticated()) return null
    if (!isSyncAllowed()) return null

    try {
      const meta = this.loadSyncMeta()
      const serverId = meta.serverIdMap[entry.id]

      if (serverId) {
        const result = await backendApi.put<ServerKnowledgeEntry>(
          `/api/v1/knowledge/entries/${serverId}`,
          {
            title: entry.title,
            content: entry.content,
            category: entry.category,
            tags: entry.tags,
            source: entry.source,
            sourceDetail: entry.sourceDetail,
            confidence: entry.confidence,
            starred: entry.starred,
            enabled: entry.enabled,
            accessCount: entry.accessCount,
          },
        )
        return result.id
      } else {
        const result = await backendApi.post<ServerKnowledgeEntry>(
          '/api/v1/knowledge/entries',
          {
            title: entry.title,
            content: entry.content,
            category: entry.category,
            tags: entry.tags,
            source: entry.source,
            sourceDetail: entry.sourceDetail,
            confidence: entry.confidence,
            starred: entry.starred,
            enabled: entry.enabled,
            localId: entry.id,
          },
        )
        meta.serverIdMap[entry.id] = result.id
        this.saveSyncMeta(meta)
        return result.id
      }
    } catch (err) {
      logger.agent.warn('[KnowledgeSync] Push entry failed:', err)
      return null
    }
  }

  async deleteEntryFromServer(entryId: string): Promise<boolean> {
    if (!isAuthenticated()) return false

    try {
      const meta = this.loadSyncMeta()
      const serverId = meta.serverIdMap[entryId]
      if (!serverId) return true

      await backendApi.delete(`/api/v1/knowledge/entries/${serverId}`)
      delete meta.serverIdMap[entryId]
      this.saveSyncMeta(meta)
      return true
    } catch (err) {
      logger.agent.warn('[KnowledgeSync] Delete entry from server failed:', err)
      return false
    }
  }

  getPendingConflicts(): SyncConflict[] {
    return [...this.pendingConflicts]
  }

  async resolveConflict(
    conflict: SyncConflict,
    resolution: ConflictResolution,
  ): Promise<void> {
    const meta = this.loadSyncMeta()

    switch (resolution) {
      case 'keep_local': {
        const localEntry = await knowledgeService.getEntry(conflict.localId)
        if (localEntry) {
          await this.pushEntry(localEntry)
        }
        break
      }
      case 'keep_server': {
        try {
          const serverEntry = await backendApi.get<ServerKnowledgeEntry>(
            `/api/v1/knowledge/entries/${conflict.serverId}`,
          )
          if (serverEntry) {
            await knowledgeService.updateEntry(conflict.localId, {
              title: serverEntry.title,
              content: serverEntry.content,
              category: serverEntry.category as any,
              tags: serverEntry.tags,
              starred: serverEntry.starred,
              enabled: serverEntry.enabled,
            })
          }
        } catch (err) {
          logger.agent.warn('[KnowledgeSync] Failed to fetch server entry for conflict resolution:', err)
        }
        break
      }
      case 'keep_both': {
        try {
          const serverEntry = await backendApi.get<ServerKnowledgeEntry>(
            `/api/v1/knowledge/entries/${conflict.serverId}`,
          )
          if (serverEntry) {
            const input: KnowledgeEntryInput = {
              title: `${serverEntry.title} (server)`,
              content: serverEntry.content,
              category: serverEntry.category as any,
              tags: serverEntry.tags,
              source: serverEntry.source as any,
              sourceDetail: serverEntry.sourceDetail || undefined,
              confidence: serverEntry.confidence,
              starred: serverEntry.starred,
              enabled: serverEntry.enabled,
            }
            const newEntry = await knowledgeService.addEntry(input)
            meta.serverIdMap[newEntry.id] = conflict.serverId
            delete meta.serverIdMap[conflict.localId]
            this.saveSyncMeta(meta)
          }
        } catch (err) {
          logger.agent.warn('[KnowledgeSync] Failed to create duplicate for conflict resolution:', err)
        }
        break
      }
    }

    this.pendingConflicts = this.pendingConflicts.filter(
      (c) => !(c.localId === conflict.localId && c.serverId === conflict.serverId),
    )

    globalEventBus.emit('knowledge:conflict_resolved', {
      localId: conflict.localId,
      serverId: conflict.serverId,
      resolution,
    })
  }

  async resolveAllConflicts(resolution: ConflictResolution): Promise<void> {
    const conflicts = [...this.pendingConflicts]
    for (const conflict of conflicts) {
      await this.resolveConflict(conflict, resolution)
    }
  }

  private async handleConflicts(
    conflicts: SyncConflict[],
    meta: LocalSyncMeta,
    localEntries: KnowledgeEntry[],
  ): Promise<void> {
    const enrichedConflicts: SyncConflict[] = conflicts.map((conflict) => {
      const local = localEntries.find((e) => e.id === conflict.localId)
      return {
        ...conflict,
        localTitle: local?.title,
        localUpdatedAt: local ? new Date(local.updatedAt).toISOString() : undefined,
        serverTitle: undefined,
      }
    })

    this.pendingConflicts = [
      ...this.pendingConflicts,
      ...enrichedConflicts,
    ].slice(-MAX_PENDING_CONFLICTS)

    globalEventBus.emit('knowledge:sync_conflicts', {
      count: enrichedConflicts.length,
      conflicts: enrichedConflicts,
    })

    logger.agent.warn(
      `[KnowledgeSync] ${enrichedConflicts.length} conflicts detected, pending user resolution`,
    )
  }

  private async applyServerChanges(
    result: SyncResult,
    meta: LocalSyncMeta,
  ): Promise<void> {
    for (const serverEntry of result.serverEntries) {
      if (serverEntry.deletedAt) continue

      const existingLocalId = Object.entries(meta.serverIdMap).find(
        ([, sid]) => sid === serverEntry.id,
      )?.[0]

      if (!existingLocalId) {
        const localEntries = await knowledgeService.getEntries()
        const duplicate = localEntries.find(
          (e) => e.content.trim() === serverEntry.content.trim(),
        )
        if (duplicate) {
          meta.serverIdMap[duplicate.id] = serverEntry.id
        } else {
          const input: KnowledgeEntryInput = {
            title: serverEntry.title,
            content: serverEntry.content,
            category: serverEntry.category as any,
            tags: serverEntry.tags,
            source: serverEntry.source as any,
            sourceDetail: serverEntry.sourceDetail || undefined,
            confidence: serverEntry.confidence,
            starred: serverEntry.starred,
            enabled: serverEntry.enabled,
          }
          const newEntry = await knowledgeService.addEntry(input)
          meta.serverIdMap[newEntry.id] = serverEntry.id
        }
      }
    }
  }

  private loadSyncMeta(): LocalSyncMeta {
    try {
      const raw = localStorage.getItem(SYNC_META_KEY)
      if (raw) return JSON.parse(raw)
    } catch {
      // parse error, start fresh
    }
    return { lastSyncAt: null, serverIdMap: {} }
  }

  private saveSyncMeta(meta: LocalSyncMeta): void {
    try {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta))
    } catch (err) {
      logger.agent.warn('[KnowledgeSync] Failed to save sync meta:', err)
    }
  }

  getSyncStatus(): { isSyncing: boolean; lastSyncAt: string | null; pendingConflicts: number } {
    const meta = this.loadSyncMeta()
    return {
      isSyncing: this.isSyncing,
      lastSyncAt: meta.lastSyncAt,
      pendingConflicts: this.pendingConflicts.length,
    }
  }
}

export const knowledgeSyncService = new KnowledgeSyncService()
export type { SyncConflict, ConflictResolution, ResolvedConflict }
