import { logger } from '@toolkit/LogEngine'
import { backendApi, isAuthenticated } from '@services/backendApi'
import { e2eEncryption, type EncryptedPayload } from './e2eEncryption'
import { useStore } from '@store'
import type { KnowledgeEntry, KnowledgeEntryInput } from '@intelligence/providerTypes'
import { knowledgeService } from './index'

const DELTA_SYNC_DB_NAME = 'aweeclaw_delta_sync'
const DELTA_SYNC_DB_VERSION = 1
const DELTA_META_STORE = 'delta_meta'
const DELTA_META_KEY = 'sync_state'

interface SyncState {
  lastSyncAt: string | null
  localVersion: number
  serverVersion: number
  deviceId: string
  pendingChanges: string[]
  lastFullSyncAt: string | null
}

interface ServerDeltaEntry {
  id: string
  userId: string
  title: string
  content: string
  category: string
  tags: string[]
  source: string
  starred: boolean
  enabled: boolean
  confidence: number
  syncVersion: number
  deletedAt: string | null
  updatedAt: string
  createdAt: string
  encryptedPayload?: EncryptedPayload
}

interface DeltaSyncResult {
  pushed: number
  pulled: number
  conflicts: number
  deleted: number
}

class DeltaSyncService {
  private db: IDBDatabase | null = null
  private initPromise: Promise<IDBDatabase> | null = null

  private async getDB(): Promise<IDBDatabase> {
    if (this.db) return this.db
    if (this.initPromise) return this.initPromise

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DELTA_SYNC_DB_NAME, DELTA_SYNC_DB_VERSION)

      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(DELTA_META_STORE)) {
          db.createObjectStore(DELTA_META_STORE)
        }
      }

      request.onsuccess = () => {
        this.db = request.result
        resolve(this.db)
      }

      request.onerror = () => {
        this.initPromise = null
        reject(request.error)
      }
    })

    return this.initPromise
  }

  private async loadSyncState(): Promise<SyncState> {
    try {
      const db = await this.getDB()
      return new Promise((resolve) => {
        const tx = db.transaction(DELTA_META_STORE, 'readonly')
        const store = tx.objectStore(DELTA_META_STORE)
        const request = store.get(DELTA_META_KEY)

        request.onsuccess = () => {
          resolve(request.result ?? {
            lastSyncAt: null,
            localVersion: 0,
            serverVersion: 0,
            deviceId: crypto.randomUUID(),
            pendingChanges: [],
            lastFullSyncAt: null,
          })
        }

        request.onerror = () => {
          resolve({
            lastSyncAt: null,
            localVersion: 0,
            serverVersion: 0,
            deviceId: crypto.randomUUID(),
            pendingChanges: [],
            lastFullSyncAt: null,
          })
        }
      })
    } catch {
      return {
        lastSyncAt: null,
        localVersion: 0,
        serverVersion: 0,
        deviceId: crypto.randomUUID(),
        pendingChanges: [],
        lastFullSyncAt: null,
      }
    }
  }

  private async saveSyncState(state: SyncState): Promise<void> {
    try {
      const db = await this.getDB()
      const tx = db.transaction(DELTA_META_STORE, 'readwrite')
      const store = tx.objectStore(DELTA_META_STORE)
      store.put(state, DELTA_META_KEY)
    } catch (err) {
      logger.agent.warn('[DeltaSync] Failed to save sync state:', err)
    }
  }

  async sync(): Promise<DeltaSyncResult> {
    if (!isAuthenticated()) {
      return { pushed: 0, pulled: 0, conflicts: 0, deleted: 0 }
    }

    const privacy = useStore.getState().privacySettings
    if (privacy.knowledgeSyncMode === 'local-only') {
      logger.agent.debug('[DeltaSync] Skipped - local-only mode')
      return { pushed: 0, pulled: 0, conflicts: 0, deleted: 0 }
    }

    const useEncryption = privacy.knowledgeSyncMode === 'sync-with-encryption'

    const state = await this.loadSyncState()
    const result: DeltaSyncResult = { pushed: 0, pulled: 0, conflicts: 0, deleted: 0 }

    try {
      const localEntries = await knowledgeService.getEntries()
      const changedEntries = localEntries.filter(e => {
        if (!state.lastSyncAt) return true
        return e.updatedAt > new Date(state.lastSyncAt).getTime()
      })

      if (changedEntries.length > 0) {
        const pushPayload = await this.buildPushPayload(changedEntries, useEncryption)
        const pushResult = await backendApi.post<{
          synced: number
          conflicts: number
          serverVersion: number
        }>('/api/v1/knowledge/delta-sync/push', {
          entries: pushPayload,
          deviceId: state.deviceId,
          sinceVersion: state.serverVersion,
        })

        result.pushed = pushResult.synced
        result.conflicts = pushResult.conflicts
        state.serverVersion = pushResult.serverVersion
      }

      const pullResult = await backendApi.post<{
        entries: ServerDeltaEntry[]
        serverVersion: number
        deletedIds: string[]
      }>('/api/v1/knowledge/delta-sync/pull', {
        sinceVersion: state.localVersion,
        deviceId: state.deviceId,
      })

      for (const serverEntry of pullResult.entries) {
        if (serverEntry.deletedAt) continue

        let content = serverEntry.content
        let title = serverEntry.title

        if (useEncryption && serverEntry.encryptedPayload) {
          try {
            const decrypted = await e2eEncryption.decrypt(serverEntry.encryptedPayload)
            const parsed = JSON.parse(decrypted)
            content = parsed.content ?? content
            title = parsed.title ?? title
          } catch (err) {
            logger.agent.warn('[DeltaSync] Failed to decrypt entry:', err)
            continue
          }
        }

        const existing = localEntries.find(e =>
          e.title === title && e.content === content,
        )
        if (!existing) {
          const input: KnowledgeEntryInput = {
            title,
            content,
            category: serverEntry.category as KnowledgeEntryInput['category'],
            tags: serverEntry.tags,
            source: serverEntry.source as KnowledgeEntryInput['source'],
            confidence: serverEntry.confidence,
            starred: serverEntry.starred,
            enabled: serverEntry.enabled,
          }
          await knowledgeService.addEntry(input)
          result.pulled++
        } else if (new Date(serverEntry.updatedAt).getTime() > existing.updatedAt) {
          await knowledgeService.updateEntry(existing.id, {
            title,
            content,
            category: serverEntry.category as KnowledgeEntryInput['category'],
            tags: serverEntry.tags,
            starred: serverEntry.starred,
            enabled: serverEntry.enabled,
          })
          result.pulled++
        }
      }

      for (const deletedId of pullResult.deletedIds ?? []) {
        const localEntries2 = await knowledgeService.getEntries()
        const match = localEntries2.find(e => e.id === deletedId)
        if (match) {
          await knowledgeService.deleteEntry(match.id)
          result.deleted++
        }
      }

      state.localVersion = pullResult.serverVersion
      state.serverVersion = pullResult.serverVersion
      state.lastSyncAt = new Date().toISOString()
      state.pendingChanges = []

      await this.saveSyncState(state)

      logger.agent.info(
        `[DeltaSync] Completed: pushed=${result.pushed}, pulled=${result.pulled}, conflicts=${result.conflicts}, deleted=${result.deleted}`,
      )
    } catch (err) {
      logger.agent.warn('[DeltaSync] Sync failed:', err)
    }

    return result
  }

  private async buildPushPayload(
    entries: KnowledgeEntry[],
    useEncryption: boolean,
  ): Promise<Array<Record<string, unknown>>> {
    const payload: Array<Record<string, unknown>> = []

    for (const entry of entries) {
      const item: Record<string, unknown> = {
        localId: entry.id,
        category: entry.category,
        tags: entry.tags,
        source: entry.source,
        sourceDetail: entry.sourceDetail,
        confidence: entry.confidence,
        starred: entry.starred,
        enabled: entry.enabled,
        accessCount: entry.accessCount,
        updatedAt: new Date(entry.updatedAt).toISOString(),
      }

      if (useEncryption) {
        try {
          const plainData = JSON.stringify({
            title: entry.title,
            content: entry.content,
          })
          const encrypted = await e2eEncryption.encrypt(plainData)
          item.encryptedPayload = encrypted
          item.hasEncryption = true
        } catch (err) {
          logger.agent.warn('[DeltaSync] Encryption failed, sending as plain:', err)
          item.title = entry.title
          item.content = entry.content
        }
      } else {
        item.title = entry.title
        item.content = entry.content
      }

      payload.push(item)
    }

    return payload
  }

  async getSyncStatus(): Promise<{
    lastSyncAt: string | null
    localVersion: number
    serverVersion: number
    deviceId: string
    pendingChanges: number
  }> {
    const state = await this.loadSyncState()
    return {
      lastSyncAt: state.lastSyncAt,
      localVersion: state.localVersion,
      serverVersion: state.serverVersion,
      deviceId: state.deviceId,
      pendingChanges: state.pendingChanges.length,
    }
  }

  async resetSyncState(): Promise<void> {
    await this.saveSyncState({
      lastSyncAt: null,
      localVersion: 0,
      serverVersion: 0,
      deviceId: crypto.randomUUID(),
      pendingChanges: [],
      lastFullSyncAt: null,
    })
    logger.agent.info('[DeltaSync] Sync state reset')
  }
}

export const deltaSyncService = new DeltaSyncService()
