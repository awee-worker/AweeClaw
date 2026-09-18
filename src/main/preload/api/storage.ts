/**
 * 设置 / 持久化存储 API
 *
 * 覆盖 IPC 频道：
 * - settings:*    通用配置读写 / 白名单 / 黑名单 / 路径
 * - settings-db:* SQLite 设置库（provider / 行为 / 应用配置）
 * - session-db:*  SQLite 会话库（消息 / 线程元数据）
 * - memory-db:*   SQLite 记忆库（条目 / 关系 / 同步）
 * - attachment:*  项目附件本地存储（本地优先，后端兜底）
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
    getBlacklist: invoke('settings:getBlacklist'),
    resetBlacklist: invoke('settings:resetBlacklist'),
    getUserDataPath: invoke('settings:getUserDataPath'),
    getAppDataRoots: invoke('settings:getAppDataRoots'),
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
    // 语音模型配置（自定义模式，STT + TTS 合并存储但分别启用）
    settingsDbGetVoiceModelConfig: invoke('settings-db:getVoiceModelConfig'),
    settingsDbSaveVoiceModelConfig: (config: unknown) =>
      invoke('settings-db:saveVoiceModelConfig')(config),
    settingsDbSetVoiceModelEnabled: (payload: { sttEnabled: boolean; ttsEnabled: boolean }) =>
      invoke('settings-db:setVoiceModelEnabled')(payload),
    // 语音唤醒配置（唤醒开关 + 唤醒词 + 灵敏度 + 冷却）
    settingsDbGetWakeWordConfig: invoke('settings-db:getWakeWordConfig'),
    settingsDbSaveWakeWordConfig: (config: unknown) =>
      invoke('settings-db:saveWakeWordConfig')(config),
    settingsDbSetWakeWordEnabled: (enabled: boolean) =>
      invoke('settings-db:setWakeWordEnabled')(enabled),

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

    // ── Group Memory（P1-3 群聊长期记忆） ──
    groupMemoryGetConfig: invoke('group-memory:get-config'),
    groupMemoryUpdateConfig: (config: unknown) => invoke('group-memory:update-config')(config),
    groupMemoryResetConfig: invoke('group-memory:reset-config'),
    groupMemoryExtract: (request: unknown) => invoke('group-memory:extract')(request),
    groupMemoryGetContext: (groupId: string, groupName: string, queryText: string) =>
      invoke('group-memory:get-context')(groupId, groupName, queryText),
    groupMemoryGetMemories: (groupId: string, options?: unknown) =>
      invoke('group-memory:get-memories')(groupId, options),
    groupMemorySupersede: (id: string) => invoke('group-memory:supersede')(id),
    groupMemoryClearGroup: (groupId: string) => invoke('group-memory:clear-group')(groupId),
    groupMemoryClearAll: invoke('group-memory:clear-all'),
    groupMemoryDeleteBySource: (sourceChatId: string) =>
      invoke('group-memory:delete-by-source')(sourceChatId),
    groupMemoryGetStats: (groupId?: string) => invoke('group-memory:get-stats')(groupId),

    // ── Audiobook（P1-7 长文播报） ──
    audiobookCreateTask: (filePath: string, config?: unknown) =>
      invoke('audiobook:create-task')(filePath, config),
    audiobookGetTask: (taskId: string) =>
      invoke('audiobook:get-task')(taskId),
    audiobookGetAllTasks: invoke('audiobook:get-all-tasks'),
    audiobookDeleteTask: (taskId: string) =>
      invoke('audiobook:delete-task')(taskId),
    audiobookExecuteTask: (taskId: string) =>
      invoke('audiobook:execute-task')(taskId),
    audiobookPauseTask: (taskId: string) =>
      invoke('audiobook:pause-task')(taskId),
    audiobookCancelTask: (taskId: string) =>
      invoke('audiobook:cancel-task')(taskId),
    audiobookResumeTask: (taskId: string) =>
      invoke('audiobook:resume-task')(taskId),
    audiobookGetTaskProgress: (taskId: string) =>
      invoke('audiobook:get-task-progress')(taskId),
    audiobookEstimateTask: (filePath: string) =>
      invoke('audiobook:estimate-task')(filePath),
    audiobookGetOutputPath: (taskId: string, filename: string) =>
      invoke('audiobook:get-output-path')(taskId, filename),
    onAudiobookTaskProgress: on<{
      taskId: string
      phase: string
      progress: number
      message?: string
      error?: string
    }>('audiobook:task-progress'),

    // ── Scene Tools DB（场景工具 SQLite 持久化） ──
    sceneToolsDbInitialize: invoke('scene-tools-db:initialize'),
    sceneToolsDbGet: (key: string) => invoke('scene-tools-db:get')(key),
    sceneToolsDbSet: (key: string, value: string) =>
      invoke('scene-tools-db:set')(key, value),
    sceneToolsDbRemove: (key: string) => invoke('scene-tools-db:remove')(key),
    sceneToolsDbLoadAll: invoke('scene-tools-db:loadAll'),
    sceneToolsDbGetPath: invoke('scene-tools-db:getPath'),

    // ── 项目附件本地存储（本地优先） ──
    attachmentSave: (params: { projectId: string; fileName: string; base64Data: string; mimeType?: string }) =>
      invoke('attachment:save')(params),
    attachmentList: (projectId: string) =>
      invoke('attachment:list')(projectId),
    attachmentDelete: (params: { projectId: string; attachmentId: string }) =>
      invoke('attachment:delete')(params),
    attachmentReadText: (params: { projectId: string; attachmentId: string }) =>
      invoke('attachment:readText')(params),
  }
}
