/**
 * 设置 / 持久化存储 API
 *
 * 覆盖 IPC 频道：
 * - settings:*    通用配置读写 / 白名单 / 路径
 * - settings-db:* SQLite 设置库（provider / 行为 / 应用配置）
 * - session-db:*  SQLite 会话库（消息 / 线程元数据）
 * - memory-db:*   SQLite 记忆库（条目 / 关系 / 同步）
 */
import { invoke, on } from '../ipcHelpers'

export function createStorageApi() {
  return {
    // ── 通用设置 ──
    getSetting: (key: string) => invoke('settings:get')(key),
    setSetting: (key: string, value: unknown) => invoke('settings:set')(key, value),
    getConfigPath: invoke('settings:getConfigPath'),
    setConfigPath: (path: string) => invoke('settings:setConfigPath')(path),
    onSettingsChanged: on<{ key: string; value: unknown }>('settings:changed'),
    getWhitelist: invoke('settings:getWhitelist'),
    resetWhitelist: invoke('settings:resetWhitelist'),
    getUserDataPath: invoke('settings:getUserDataPath'),
    getAppConfig: invoke('settings:getAppConfig'),
    getRecentLogs: invoke('settings:getRecentLogs'),

    // ── Settings DB ──
    settingsDbInitialize: invoke('settings-db:initialize'),
    settingsDbLoadAll: invoke('settings-db:loadAll'),
    settingsDbSaveAll: (params: unknown) => invoke('settings-db:saveAll')(params),
    settingsDbGetProvider: (providerId: string) =>
      invoke('settings-db:getProvider')(providerId),
    settingsDbDeleteProvider: (providerId: string) =>
      invoke('settings-db:deleteProvider')(providerId),
    settingsDbGetPath: invoke('settings-db:getPath'),
    // 视觉模型配置（自定义模式）
    settingsDbGetVisionModelConfig: invoke('settings-db:getVisionModelConfig'),
    settingsDbSaveVisionModelConfig: (config: unknown) =>
      invoke('settings-db:saveVisionModelConfig')(config),
    settingsDbSetVisionModelEnabled: (enabled: boolean) =>
      invoke('settings-db:setVisionModelEnabled')(enabled),

    // ── Session DB ──
    sessionDbInitialize: (params?: { sessionsDir?: string }) =>
      invoke('session-db:initialize')(params),
    sessionDbGetAllSessionMeta: invoke('session-db:getAllSessionMeta'),
    sessionDbUpsertSessionMeta: (key: string, value: unknown) =>
      invoke('session-db:upsertSessionMeta')(key, value),
    sessionDbBatchUpsertSessionMeta: (meta: Record<string, unknown>) =>
      invoke('session-db:batchUpsertSessionMeta')(meta),
    sessionDbDeleteSessionMeta: (key: string) => invoke('session-db:deleteSessionMeta')(key),
    sessionDbGetAllThreadSummaries: (userId?: string | null) =>
      invoke('session-db:getAllThreadSummaries')(userId),
    sessionDbGetThreadMeta: (threadId: string) => invoke('session-db:getThreadMeta')(threadId),
    sessionDbBatchGetThreadMeta: (threadIds: string[]) =>
      invoke('session-db:batchGetThreadMeta')(threadIds),
    sessionDbUpsertThreadMeta: (threadId: string, data: unknown) =>
      invoke('session-db:upsertThreadMeta')(threadId, data),
    sessionDbDeleteThreadMeta: (threadId: string) =>
      invoke('session-db:deleteThreadMeta')(threadId),
    sessionDbClaimOrphanThreads: (userId: string) =>
      invoke('session-db:claimOrphanThreads')(userId),
    sessionDbRepairMissingTitles: invoke('session-db:repairMissingTitles'),
    sessionDbGetThreadMessages: (threadId: string) =>
      invoke('session-db:getThreadMessages')(threadId),
    sessionDbBatchUpsertThreadMessages: (threadId: string, messages: unknown[]) =>
      invoke('session-db:batchUpsertThreadMessages')(threadId, messages),
    sessionDbAppendThreadMessage: (threadId: string, message: unknown) =>
      invoke('session-db:appendThreadMessage')(threadId, message),
    sessionDbDeleteThreadMessages: (threadId: string) =>
      invoke('session-db:deleteThreadMessages')(threadId),
    sessionDbGetThreadMessageCount: (threadId: string) =>
      invoke('session-db:getThreadMessageCount')(threadId),
    sessionDbDeleteThread: (threadId: string) => invoke('session-db:deleteThread')(threadId),
    sessionDbClearAll: invoke('session-db:clearAll'),
    sessionDbGetPath: invoke('session-db:getPath'),

    // ── Memory DB ──
    memoryDbInitialize: invoke('memory-db:initialize'),
    memoryDbUpsertEntry: (entry: unknown) => invoke('memory-db:upsertEntry')(entry),
    memoryDbBatchUpsertEntries: (entries: unknown[]) =>
      invoke('memory-db:batchUpsertEntries')(entries),
    memoryDbGetEntryById: (id: string) => invoke('memory-db:getEntryById')(id),
    memoryDbQueryEntries: (options?: unknown) => invoke('memory-db:queryEntries')(options),
    memoryDbUpdateEntry: (id: string, updates: unknown) =>
      invoke('memory-db:updateEntry')(id, updates),
    memoryDbDeleteEntry: (id: string) => invoke('memory-db:deleteEntry')(id),
    memoryDbSoftDeleteEntry: (id: string) => invoke('memory-db:softDeleteEntry')(id),
    memoryDbClearAll: (userId?: string | null) => invoke('memory-db:clearAll')(userId),
    memoryDbGetStats: (userId?: string | null) => invoke('memory-db:getStats')(userId),
    memoryDbGetOverview: (userId?: string | null) => invoke('memory-db:getOverview')(userId),
    memoryDbGetVisualizationData: (options?: unknown) =>
      invoke('memory-db:getVisualizationData')(options),
    memoryDbGetTimeline: (options?: unknown) => invoke('memory-db:getTimeline')(options),
    memoryDbGetTimelineByMonth: (options?: unknown) =>
      invoke('memory-db:getTimelineByMonth')(options),
    memoryDbGetTimelineMonths: (options?: unknown) =>
      invoke('memory-db:getTimelineMonths')(options),
    memoryDbUpsertRelation: (rel: unknown) => invoke('memory-db:upsertRelation')(rel),
    memoryDbGetRelations: (memoryId: string) => invoke('memory-db:getRelations')(memoryId),
    memoryDbDeleteRelation: (id: string) => invoke('memory-db:deleteRelation')(id),
    memoryDbGetSyncState: (key: string) => invoke('memory-db:getSyncState')(key),
    memoryDbSetSyncState: (key: string, value: string) =>
      invoke('memory-db:setSyncState')(key, value),
    memoryDbGetPendingPush: (limit?: number) => invoke('memory-db:getPendingPush')(limit),
    memoryDbMarkAsSynced: (id: string, remoteId: string) =>
      invoke('memory-db:markAsSynced')(id, remoteId),
    memoryDbMigrateFromJsonStore: (store: unknown) =>
      invoke('memory-db:migrateFromJsonStore')(store),
    memoryDbGetPath: invoke('memory-db:getPath'),
  }
}
