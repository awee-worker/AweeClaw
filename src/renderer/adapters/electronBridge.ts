/**
 * Electron API 适配器
 * 将扁平的 window.electronAPI 包装成分组的 API 结构
 */

import type {
  ElectronAPI,
  RemoteShellEntry,
  RemoteShellServer,
  RemoteShellUploadResult,
  RemoteShellDownloadResult,
} from '@renderer/types/electronBridge'

type ElectronAPIWithRemoteShell = ElectronAPI & {
  remoteShellList: (server: RemoteShellServer, remotePath?: string) => Promise<RemoteShellEntry[]>
  remoteShellReadText: (server: RemoteShellServer, remotePath: string) => Promise<string | null>
  remoteShellWriteText: (server: RemoteShellServer, remotePath: string, content: string) => Promise<boolean>
  remoteShellMkdir: (server: RemoteShellServer, remotePath: string) => Promise<boolean>
  remoteShellRename: (server: RemoteShellServer, oldPath: string, newPath: string) => Promise<boolean>
  remoteShellDelete: (server: RemoteShellServer, remotePath: string) => Promise<boolean>
  remoteShellTestConnection: (server: RemoteShellServer) => Promise<{ success: boolean; error?: string }>
  remoteShellUpload: (server: RemoteShellServer, remoteDirectory: string) => Promise<RemoteShellUploadResult>
  remoteShellDownload: (server: RemoteShellServer, remotePath: string) => Promise<RemoteShellDownloadResult>
  pythonGetStatus: () => Promise<{
    ready: boolean
    pythonPath: string | null
    uvPath: string | null
    source: 'system' | 'managed' | 'none'
    version: string | null
    venvDir: string | null
    installedPackages: string[]
    error?: string
  }>
  pythonGetPath: () => Promise<string | null>
  pythonGetUvPath: () => Promise<string | null>
  pythonEnsureReady: () => Promise<{
    ready: boolean
    pythonPath: string | null
    uvPath: string | null
    source: 'system' | 'managed' | 'none'
    version: string | null
    venvDir: string | null
    installedPackages: string[]
    error?: string
  }>
  pythonReinstall: () => Promise<{
    ready: boolean
    pythonPath: string | null
    uvPath: string | null
    source: 'system' | 'managed' | 'none'
    version: string | null
    venvDir: string | null
    installedPackages: string[]
    error?: string
  }>
  pythonInstallPkg: (pkg: string) => Promise<{ success: boolean; error?: string }>
  pythonSetCustomPath: (customPath: string | null) => Promise<{ success: boolean; error?: string }>
  pythonExecuteScript: (params: {
    scriptPath: string
    args?: string[]
    cwd?: string
    timeout?: number
  }) => Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string }>
  pythonExecuteInlineScript: (params: {
    script: string
    dependencies?: string[]
    args?: string[]
    cwd?: string
    timeout?: number
  }) => Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string; tempFile?: string }>

  dataExecuteQuery: (params: { query: string; connectionId: string; limit: number }) => Promise<{
    success: boolean
    columns?: string[]
    rows?: Record<string, unknown>[]
    rowCount?: number
    error?: string
    executionTime?: number
  }>
  dataTransform: (params: { operation: string; source: string; config: Record<string, unknown>; output?: string }) => Promise<{
    success: boolean
    rowCount?: number
    data?: unknown
    error?: string
  }>
  dataAnalyzeCsv: (params: { path: string; analysisType: string; sampleSize: number }) => Promise<{
    success: boolean
    data?: Record<string, unknown>
    error?: string
  }>
  dataGenerateChart: (params: { chartType: string; data: Record<string, unknown>; title?: string; xLabel?: string; yLabel?: string; format?: string }) => Promise<{
    success: boolean
    html?: string
    path?: string
    error?: string
  }>
  dataStatisticalTest: (params: { testType: string; data: Record<string, unknown>; alpha: number; hypothesis?: string }) => Promise<{
    success: boolean
    result?: { statistic: number; pValue: number; significant: boolean; conclusion: string }
    error?: string
  }>
  dataRestApiCall: (params: { url: string; method: string; headers: Record<string, string>; body?: string; authType: string; authToken?: string; authHeaderName?: string }) => Promise<{
    success: boolean
    status?: number
    data?: unknown
    error?: string
  }>
  dataConnectDatabase: (config: { id: string; driver: string; host?: string; port?: number; database?: string; username?: string; password?: string; filePath?: string }) => Promise<{ success: boolean; error?: string }>
  dataDisconnectDatabase: (connectionId: string) => Promise<{ success: boolean }>
  dataGetConnections: () => Promise<Array<{ id: string; driver: string; host?: string; port?: number; database?: string; filePath?: string }>>
  dataClearCache: () => Promise<{ success: boolean }>
  dataEda: (params: { path: string; targetColumns?: string[]; sampleSize?: number }) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>
  dataCleanData: (params: { source: string; operations: Array<{ type: string; config: Record<string, unknown> }>; output?: string }) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>
  dataBrowseSchema: (params: { connectionId: string; filter?: string }) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>
  dataSaveQuery: (params: { query: string; connectionId: string; executionTime?: number; rowCount?: number; success: boolean }) => Promise<{ success: boolean }>
  dataGetQueryHistory: (params?: { limit?: number; connectionId?: string }) => Promise<{ success: boolean; data?: Array<Record<string, unknown>> }>
  dataExportReport: (params: { title: string; sections: Array<{ type: string; title: string; content: string }>; format: string; outputPath?: string }) => Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }>

  scenarioDbInitialize: (params: { scenarioId: string; installScripts: Array<{ id: string; description?: string; sql: string }> }) => Promise<{
    success: boolean
    dbPath?: string
    results?: Array<{ scriptId: string; success: boolean; error?: string }>
    error?: string
  }>
  scenarioDbExecuteSql: (params: { scenarioId: string; sql: string }) => Promise<{
    success: boolean
    rowsAffected?: number
    rows?: Record<string, unknown>[]
    columns?: string[]
    error?: string
    executionTime?: number
  }>
  scenarioDbDrop: (params: { scenarioId: string; uninstallScripts: Array<{ id: string; description?: string; sql: string }> }) => Promise<{
    success: boolean
    error?: string
  }>
  scenarioDbGetPath: (scenarioId: string) => Promise<string>

  scenarioGetScenariosDir: () => Promise<string>
  scenarioSelectScenarioDir: () => Promise<string | null>
  scenarioReadScenarioConfig: (sourceDir: string) => Promise<{ success: boolean; config?: Record<string, unknown>; error?: string }>
  scenarioInstallFromLocal: (sourceDir: string) => Promise<{ success: boolean; scenarioId?: string; targetDir?: string; config?: Record<string, unknown>; error?: string }>
  scenarioGetInstalledScenarioDirs: () => Promise<Array<{ scenarioId: string; dir: string; config: Record<string, unknown> | null }>>
  scenarioDeleteScenarioDir: (scenarioId: string) => Promise<{ success: boolean; error?: string }>
  scenarioDeleteBuiltinSourceDir: (scenarioId: string) => Promise<{ success: boolean; error?: string }>
  scenarioLoadScenarioFiles: (scenarioId: string) => Promise<{ success: boolean; error?: string; files: Record<string, string>; config: Record<string, unknown> | null }>
  scenarioMarketplaceSearch: (query: string, page?: number, pageSize?: number) => Promise<{ total: number; page: number; pageSize: number; scenarios: unknown[] }>
  scenarioMarketplaceFeatured: () => Promise<unknown[]>
  scenarioMarketplaceDetails: (scenarioId: string) => Promise<unknown | null>
  scenarioMarketplaceCategories: () => Promise<unknown[]>
  scenarioMarketplaceDownload: (scenarioId: string) => Promise<{ success: boolean; error?: string; path?: string }>
  scenarioMarketplaceInstall: (params: { scenarioId: string; downloadUrl: string; checksum: string; signature?: string; version: string; fileSize: number; packageType: string }) => Promise<{ success: boolean; scenarioId?: string; version?: string; targetDir?: string; config?: Record<string, unknown>; packageType?: string; error?: string }>
  scenarioMarketplaceCheckUpdates: (installedScenarios: Array<{ id: string; version: string }>, backendUrl?: string) => Promise<Array<{ scenarioId: string; currentVersion: string; latestVersion?: string; changelog?: string; needsUpdate: boolean }>>
  scenarioMarketplaceUpdate: (params: { scenarioId: string; downloadUrl: string; checksum: string; signature?: string; version: string; fileSize: number; packageType: string }) => Promise<{ success: boolean; scenarioId?: string; version?: string; targetDir?: string; config?: Record<string, unknown>; packageType?: string; error?: string }>
  scenarioGetRollbackInfo: (scenarioId: string) => Promise<{ available: boolean; previousVersion?: string; backedUpAt?: string }>
  scenarioRollbackScenario: (scenarioId: string) => Promise<{ success: boolean; scenarioId?: string; version?: string; targetDir?: string; config?: Record<string, unknown>; error?: string }>
  scenarioClearRollbackData: (scenarioId?: string) => Promise<{ success: boolean; error?: string }>
  onScenarioInstallProgress: (callback: (data: { scenarioId: string; phase: string; bytesDownloaded: number; bytesTotal: number; percent: number }) => void) => () => void

  // Session DB
  sessionDbInitialize: (params?: { sessionsDir?: string }) => Promise<{ success: boolean; dbPath?: string; error?: string }>
  sessionDbGetAllSessionMeta: () => Promise<Record<string, any>>
  sessionDbUpsertSessionMeta: (key: string, value: any) => Promise<{ success: boolean; error?: string }>
  sessionDbBatchUpsertSessionMeta: (meta: Record<string, any>) => Promise<{ success: boolean; error?: string }>
  sessionDbDeleteSessionMeta: (key: string) => Promise<{ success: boolean; error?: string }>
  sessionDbGetAllThreadSummaries: (userId?: string | null) => Promise<Array<{ id: string; title: string | null; lastModified: number; messageCount: number; userId: string | null }>>
  sessionDbGetThreadMeta: (threadId: string) => Promise<any | null>
  sessionDbBatchGetThreadMeta: (threadIds: string[]) => Promise<Record<string, any>>
  sessionDbUpsertThreadMeta: (threadId: string, data: any) => Promise<{ success: boolean; error?: string }>
  sessionDbDeleteThreadMeta: (threadId: string) => Promise<{ success: boolean; error?: string }>
  sessionDbClaimOrphanThreads: (userId: string) => Promise<{ success: boolean; count?: number; error?: string }>
  sessionDbRepairMissingTitles: () => Promise<{ success: boolean; count?: number; error?: string }>
  sessionDbGetThreadMessages: (threadId: string) => Promise<any[]>
  sessionDbBatchUpsertThreadMessages: (threadId: string, messages: any[]) => Promise<{ success: boolean; error?: string }>
  sessionDbAppendThreadMessage: (threadId: string, message: any) => Promise<{ success: boolean; error?: string }>
  sessionDbDeleteThreadMessages: (threadId: string) => Promise<{ success: boolean; error?: string }>
  sessionDbGetThreadMessageCount: (threadId: string) => Promise<number>
  sessionDbDeleteThread: (threadId: string) => Promise<{ success: boolean; error?: string }>
  sessionDbClearAll: () => Promise<{ success: boolean; error?: string }>
  sessionDbGetPath: () => Promise<string>

  // Memory DB (SQLite) - 客户端本地记忆数据库
  memoryDbInitialize: () => Promise<{ success: boolean; dbPath?: string; error?: string }>
  memoryDbUpsertEntry: (entry: any) => Promise<{ success: boolean; error?: string }>
  memoryDbBatchUpsertEntries: (entries: any[]) => Promise<{ success: boolean; error?: string }>
  memoryDbGetEntryById: (id: string) => Promise<any | null>
  memoryDbQueryEntries: (options?: any) => Promise<{ items: any[]; total: number }>
  memoryDbUpdateEntry: (id: string, updates: any) => Promise<{ success: boolean; error?: string }>
  memoryDbDeleteEntry: (id: string) => Promise<{ success: boolean; error?: string }>
  memoryDbSoftDeleteEntry: (id: string) => Promise<{ success: boolean; error?: string }>
  memoryDbClearAll: (userId?: string | null) => Promise<{ success: boolean; count?: number; error?: string }>
  memoryDbGetStats: (userId?: string | null) => Promise<{ total: number; enabled: number; byTier: Record<string, number>; byCategory: Record<string, number> }>
  memoryDbGetOverview: (userId?: string | null) => Promise<any>
  memoryDbGetVisualizationData: (options?: any) => Promise<any>
  memoryDbGetTimeline: (options?: any) => Promise<any[]>
  memoryDbGetTimelineByMonth: (options?: any) => Promise<any>
  memoryDbGetTimelineMonths: (options?: any) => Promise<Array<{ year: number; month: number; count: number }>>
  memoryDbUpsertRelation: (rel: any) => Promise<{ success: boolean; error?: string }>
  memoryDbGetRelations: (memoryId: string) => Promise<any[]>
  memoryDbDeleteRelation: (id: string) => Promise<{ success: boolean; error?: string }>
  memoryDbGetSyncState: (key: string) => Promise<string | null>
  memoryDbSetSyncState: (key: string, value: string) => Promise<{ success: boolean; error?: string }>
  memoryDbGetPendingPush: (limit?: number) => Promise<any[]>
  memoryDbMarkAsSynced: (id: string, remoteId: string) => Promise<{ success: boolean; error?: string }>
  memoryDbMigrateFromJsonStore: (store: any) => Promise<{ success: boolean; migrated: number; skipped: number; error?: string }>
  memoryDbGetPath: () => Promise<string>

  // Security (SecureToolExecutor + ToolApproval + Sandbox)
  securityPreCheckTool: (request: {
    toolName: string
    toolArgs: Record<string, unknown>
    agentId: string
    isCommandTool?: boolean
    command?: string
  }) => Promise<{ success: boolean; allowed: boolean; reason?: string }>
  securityValidateFilePath: (filePath: string, agentId?: string) => Promise<{ success: boolean; allowed: boolean; reason?: string }>
  securityRequestApproval: (agentId: string, toolName: string, toolArgs: Record<string, unknown>) => Promise<{ success: boolean; decision: string; reason?: string }>
  securityRespondApproval: (requestId: string, approved: boolean, reason?: string) => Promise<{ success: boolean }>
  securityGetPendingRequests: () => Promise<{ success: boolean; requests: unknown[] }>
  securitySandboxExecute: (command: string, cwd: string, agentId?: string) => Promise<{
    success: boolean
    stdout: string
    stderr: string
    exitCode: number
    timedOut: boolean
    duration: number
  }>
}

// 创建分组 API 适配器
function createGroupedAPI() {
  const raw = window.electronAPI as ElectronAPIWithRemoteShell

  return {
    // 应用生命周期
    appReady: () => raw.appReady(),
    getAppVersion: () => raw.getAppVersion(),

    // 窗口控制
    window: {
      minimize: () => raw.minimize(),
      maximize: () => raw.maximize(),
      close: () => raw.close(),
      toggleDevTools: () => raw.toggleDevTools(),
      new: () => raw.newWindow(),
      getId: () => raw.getWindowId(),
      resize: (width: number, height: number, minWidth?: number, minHeight?: number) =>
        raw.resizeWindow(width, height, minWidth, minHeight),
      setTheme: (theme: 'light' | 'dark' | 'system', bgColor?: string) => raw.setTheme(theme, bgColor),
    },

    // 文件操作
    file: {
      open: () => raw.openFile(),
      openKnowledgeFiles: () => raw.openKnowledgeFiles(),
      readKnowledgeFile: (path: string) => raw.readKnowledgeFile(path),
      extractKnowledgeDocxText: (path: string) => raw.extractKnowledgeDocxText(path),
      extractKnowledgeDocText: (path: string) => raw.extractKnowledgeDocText(path),
      extractKnowledgeXlsxText: (path: string) => raw.extractKnowledgeXlsxText(path),
      extractKnowledgePptText: (path: string) => raw.extractKnowledgePptText(path),
      extractKnowledgePdfText: (path: string) => raw.extractKnowledgePdfText(path),
      openFolder: () => raw.openFolder(),
      selectFolder: () => raw.selectFolder(),
      selectForImport: (options: { title?: string; allowFiles?: boolean; allowDirs?: boolean; multiSelection?: boolean }) => raw.selectForImport(options),
      selectForExport: (options: { title?: string; defaultPath?: string }) => raw.selectForExport(options),
      importIntoWorkspace: (sourcePaths: string[], targetDir: string) => raw.importIntoWorkspace(sourcePaths, targetDir),
      exportFromWorkspace: (sourcePath: string, targetDir: string) => raw.exportFromWorkspace(sourcePath, targetDir),
      shareItem: (filePaths: string[]) => raw.shareItem(filePaths),
      readDir: (path: string) => raw.readDir(path),
      getTree: (path: string, maxDepth?: number) => raw.getFileTree(path, maxDepth),
      read: (path: string) => raw.readFile(path),
      readBinary: (path: string) => raw.readBinaryFile(path),
      extractDocText: (path: string) => raw.extractDocText(path),
      extractPptText: (path: string) => raw.extractPptText(path),
      extractDocxText: (path: string) => raw.extractDocxText(path),
      extractXlsxText: (path: string) => raw.extractXlsxText(path),
      extractPdfText: (path: string) => raw.extractPdfText(path),
      write: (path: string, content: string) => raw.writeFile(path, content),
      writeBinary: (path: string, base64Data: string) => raw.writeBinaryFile(path, base64Data),
      save: (content: string, path?: string) => raw.saveFile(content, path),
      exists: (path: string) => raw.fileExists(path),
      mkdir: (path: string) => raw.mkdir(path),
      ensureDir: (path: string) => raw.ensureDir(path),
      delete: (path: string) => raw.deleteFile(path),
      copy: (sourcePath: string, destinationPath: string) => raw.copyFile(sourcePath, destinationPath),
      rename: (oldPath: string, newPath: string) => raw.renameFile(oldPath, newPath),
      showInFolder: (path: string) => raw.showItemInFolder(path),
      openInBrowser: (path: string) => raw.openInBrowser(path),
      openExternalUrl: (url: string) => raw.openExternalUrl(url),
      search: (query: string, rootPath: string | string[], options?: Parameters<typeof raw.searchFiles>[2]) =>
        raw.searchFiles(query, rootPath, options),
      /** 流式搜索 — 结果通过事件增量推送 */
      searchStream: (query: string, rootPath: string | string[], options: Parameters<typeof raw.searchFiles>[2], searchId: string) =>
        raw.searchStream(query, rootPath, options!, searchId),
      onSearchResults: (callback: Parameters<typeof raw.onSearchResults>[0]) => raw.onSearchResults(callback),
      onSearchDone: (callback: Parameters<typeof raw.onSearchDone>[0]) => raw.onSearchDone(callback),
      onChanged: (callback: Parameters<typeof raw.onFileChanged>[0]) => raw.onFileChanged(callback),
    },

    // 工作区
    workspace: {
      open: () => raw.openWorkspace(),
      addFolder: () => raw.addFolderToWorkspace(),
      save: (configPath: string, roots: string[]) => raw.saveWorkspace(configPath, roots),
      restore: () => raw.restoreWorkspace(),
      setActive: (roots: string[]) => raw.setActiveWorkspace(roots),
      getRecent: () => raw.getRecentWorkspaces(),
      exists: (path: string) => raw.workspaceExists(path),
      clearRecent: () => raw.clearRecentWorkspaces(),
      removeFromRecent: (path: string) => raw.removeFromRecentWorkspaces(path),
    },

    // 设置
    settings: {
      get: (key: string) => raw.getSetting(key),
      set: (key: string, value: unknown) => raw.setSetting(key, value),
      getConfigPath: () => raw.getConfigPath(),
      setConfigPath: (path: string) => raw.setConfigPath(path),
      getWhitelist: () => raw.getWhitelist(),
      resetWhitelist: () => raw.resetWhitelist(),
      getUserDataPath: () => raw.getUserDataPath(),
      getAppConfig: () => raw.getAppConfig(),
      getRecentLogs: () => raw.getRecentLogs(),
      onChanged: (callback: Parameters<typeof raw.onSettingsChanged>[0]) => raw.onSettingsChanged(callback),
      // SQLite 设置数据库
      dbInitialize: () => raw.settingsDbInitialize(),
      dbLoadAll: () => raw.settingsDbLoadAll(),
      dbSaveAll: (params: any) => raw.settingsDbSaveAll(params),
      dbGetProvider: (providerId: string) => raw.settingsDbGetProvider(providerId),
      dbDeleteProvider: (providerId: string) => raw.settingsDbDeleteProvider(providerId),
      dbGetPath: () => raw.settingsDbGetPath(),
    },

    // 会话数据库 (SQLite)
    sessionDb: {
      initialize: (params?: { sessionsDir?: string }) => raw.sessionDbInitialize(params),
      getAllSessionMeta: () => raw.sessionDbGetAllSessionMeta(),
      upsertSessionMeta: (key: string, value: any) => raw.sessionDbUpsertSessionMeta(key, value),
      batchUpsertSessionMeta: (meta: Record<string, any>) => raw.sessionDbBatchUpsertSessionMeta(meta),
      deleteSessionMeta: (key: string) => raw.sessionDbDeleteSessionMeta(key),
      getAllThreadSummaries: (userId?: string | null) => raw.sessionDbGetAllThreadSummaries(userId),
      getThreadMeta: (threadId: string) => raw.sessionDbGetThreadMeta(threadId),
      batchGetThreadMeta: (threadIds: string[]) => raw.sessionDbBatchGetThreadMeta(threadIds),
      upsertThreadMeta: (threadId: string, data: any) => raw.sessionDbUpsertThreadMeta(threadId, data),
      deleteThreadMeta: (threadId: string) => raw.sessionDbDeleteThreadMeta(threadId),
      claimOrphanThreads: (userId: string) => raw.sessionDbClaimOrphanThreads(userId),
      repairMissingTitles: () => raw.sessionDbRepairMissingTitles(),
      getThreadMessages: (threadId: string) => raw.sessionDbGetThreadMessages(threadId),
      batchUpsertThreadMessages: (threadId: string, messages: any[]) => raw.sessionDbBatchUpsertThreadMessages(threadId, messages),
      appendThreadMessage: (threadId: string, message: any) => raw.sessionDbAppendThreadMessage(threadId, message),
      deleteThreadMessages: (threadId: string) => raw.sessionDbDeleteThreadMessages(threadId),
      getThreadMessageCount: (threadId: string) => raw.sessionDbGetThreadMessageCount(threadId),
      deleteThread: (threadId: string) => raw.sessionDbDeleteThread(threadId),
      clearAll: () => raw.sessionDbClearAll(),
      getPath: () => raw.sessionDbGetPath(),
    },

    // 记忆数据库 (SQLite) - 客户端本地记忆存储
    memoryDb: {
      initialize: () => raw.memoryDbInitialize(),
      upsertEntry: (entry: any) => raw.memoryDbUpsertEntry(entry),
      batchUpsertEntries: (entries: any[]) => raw.memoryDbBatchUpsertEntries(entries),
      getEntryById: (id: string) => raw.memoryDbGetEntryById(id),
      queryEntries: (options?: any) => raw.memoryDbQueryEntries(options),
      updateEntry: (id: string, updates: any) => raw.memoryDbUpdateEntry(id, updates),
      deleteEntry: (id: string) => raw.memoryDbDeleteEntry(id),
      softDeleteEntry: (id: string) => raw.memoryDbSoftDeleteEntry(id),
      clearAll: (userId?: string | null) => raw.memoryDbClearAll(userId),
      getStats: (userId?: string | null) => raw.memoryDbGetStats(userId),
      getOverview: (userId?: string | null) => raw.memoryDbGetOverview(userId),
      getVisualizationData: (options?: any) => raw.memoryDbGetVisualizationData(options),
      getTimeline: (options?: any) => raw.memoryDbGetTimeline(options),
      getTimelineByMonth: (options?: any) => raw.memoryDbGetTimelineByMonth(options),
      getTimelineMonths: (options?: any) => raw.memoryDbGetTimelineMonths(options),
      upsertRelation: (rel: any) => raw.memoryDbUpsertRelation(rel),
      getRelations: (memoryId: string) => raw.memoryDbGetRelations(memoryId),
      deleteRelation: (id: string) => raw.memoryDbDeleteRelation(id),
      getSyncState: (key: string) => raw.memoryDbGetSyncState(key),
      setSyncState: (key: string, value: string) => raw.memoryDbSetSyncState(key, value),
      getPendingPush: (limit?: number) => raw.memoryDbGetPendingPush(limit),
      markAsSynced: (id: string, remoteId: string) => raw.memoryDbMarkAsSynced(id, remoteId),
      migrateFromJsonStore: (store: any) => raw.memoryDbMigrateFromJsonStore(store),
      getPath: () => raw.memoryDbGetPath(),
    },

    // LLM
    llm: {
      send: (params: Parameters<typeof raw.sendMessage>[0]) => raw.sendMessage(params),
      compactContext: (params: Parameters<typeof raw.compactContext>[0]) => raw.compactContext(params),
      abort: () => raw.abortMessage(),
      // LLM 事件订阅（使用动态 IPC 频道实现请求隔离）
      onStream: (requestId: string, callback: (data: {
        type: string
        content?: string
        id?: string
        name?: string
        arguments?: unknown
        argumentsDelta?: string
        source?: {
          id: string
          sourceType: 'url' | 'document'
          url?: string
          title?: string
          mediaType?: string
          filename?: string
        }
      }) => void) =>
        raw.onLLMStream(requestId, callback),
      onError: (requestId: string, callback: (error: { message: string; code: string; retryable: boolean }) => void) =>
        raw.onLLMError(requestId, callback),
      onDone: (requestId: string, callback: (data: { reasoning?: string; usage?: unknown }) => void) =>
        raw.onLLMDone(requestId, callback),
      onCloudTokenRefreshed: (callback: (data: { accessToken: string; refreshToken?: string }) => void) =>
        raw.onCloudTokenRefreshed(callback),
      onCloudAuthFailed: (callback: () => void) =>
        raw.onCloudAuthFailed(callback),
      // Structured Output
      analyzeCode: (params: Parameters<typeof raw.analyzeCode>[0]) => raw.analyzeCode(params),
      analyzeCodeStream: (params: Parameters<typeof raw.analyzeCodeStream>[0]) => raw.analyzeCodeStream(params),
      suggestRefactoring: (params: Parameters<typeof raw.suggestRefactoring>[0]) => raw.suggestRefactoring(params),
      suggestFixes: (params: Parameters<typeof raw.suggestFixes>[0]) => raw.suggestFixes(params),
      generateTests: (params: Parameters<typeof raw.generateTests>[0]) => raw.generateTests(params),
      generateObject: (params: Parameters<typeof raw.generateObject>[0]) => raw.generateObject(params),
      // Embeddings
      embedText: (params: Parameters<typeof raw.embedText>[0]) => raw.embedText(params),
      embedMany: (params: Parameters<typeof raw.embedMany>[0]) => raw.embedMany(params),
      findSimilar: (params: Parameters<typeof raw.findSimilar>[0]) => raw.findSimilar(params),
    },

    // 终端
    terminal: {
      create: (options: { id: string; cwd?: string; shell?: string; backend?: 'pty' | 'pipe'; remote?: RemoteShellServer }) => raw.createTerminal(options),
      write: (id: string, data: string) => raw.writeTerminal(id, data),
      resize: (id: string, cols: number, rows: number) => raw.resizeTerminal(id, cols, rows),
      kill: (id?: string) => raw.killTerminal(id),
      getShells: () => raw.getAvailableShells(),
      onData: (callback: Parameters<typeof raw.onTerminalData>[0]) => raw.onTerminalData(callback),
      onExit: (callback: Parameters<typeof raw.onTerminalExit>[0]) => raw.onTerminalExit(callback),
      onError: (callback: Parameters<typeof raw.onTerminalError>[0]) => raw.onTerminalError(callback),
    },

    // 远程 Shell / SFTP
    remoteShell: {
      list: (server: RemoteShellServer, remotePath?: string) => raw.remoteShellList(server, remotePath),
      readText: (server: RemoteShellServer, remotePath: string) => raw.remoteShellReadText(server, remotePath),
      writeText: (server: RemoteShellServer, remotePath: string, content: string) => raw.remoteShellWriteText(server, remotePath, content),
      mkdir: (server: RemoteShellServer, remotePath: string) => raw.remoteShellMkdir(server, remotePath),
      rename: (server: RemoteShellServer, oldPath: string, newPath: string) => raw.remoteShellRename(server, oldPath, newPath),
      delete: (server: RemoteShellServer, remotePath: string) => raw.remoteShellDelete(server, remotePath),
      testConnection: (server: RemoteShellServer) => raw.remoteShellTestConnection(server),
      upload: (server: RemoteShellServer, remoteDirectory: string) => raw.remoteShellUpload(server, remoteDirectory),
      download: (server: RemoteShellServer, remotePath: string) => raw.remoteShellDownload(server, remotePath),
    },

    // Shell 执行
    shell: {
      executeSecure: (request: Parameters<typeof raw.executeSecureCommand>[0]) => raw.executeSecureCommand(request),
      executeBackground: (params: Parameters<typeof raw.executeBackground>[0]) => raw.executeBackground(params),
      onOutput: (callback: Parameters<typeof raw.onShellOutput>[0]) => raw.onShellOutput(callback),
    },

    // Git
    git: {
      execSecure: (args: string[], cwd: string) => raw.gitExecSecure(args, cwd),
    },

    // 安全管理
    security: {
      getPermissions: () => raw.getPermissions(),
      resetPermissions: () => raw.resetPermissions(),
      preCheckTool: (request: any) => raw.securityPreCheckTool(request),
      validateFilePath: (filePath: string, agentId?: string) => raw.securityValidateFilePath(filePath, agentId),
      requestApproval: (agentId: string, toolName: string, toolArgs: Record<string, unknown>) => raw.securityRequestApproval(agentId, toolName, toolArgs),
      respondApproval: (requestId: string, approved: boolean, reason?: string) => raw.securityRespondApproval(requestId, approved, reason),
      getPendingApprovals: () => raw.securityGetPendingRequests(),
      sandboxExecute: (command: string, cwd: string, agentId?: string) => raw.securitySandboxExecute(command, cwd, agentId),
    },

    // 索引
    index: {
      initialize: (workspacePath: string) => raw.indexInitialize(workspacePath),
      start: (workspacePath: string) => raw.indexStart(workspacePath),
      status: (workspacePath: string) => raw.indexStatus(workspacePath),
      hasIndex: (workspacePath: string) => raw.indexHasIndex(workspacePath),
      search: (workspacePath: string, query: string, topK?: number) => raw.indexSearch(workspacePath, query, topK),
      hybridSearch: (workspacePath: string, query: string, topK?: number) => raw.indexHybridSearch(workspacePath, query, topK),
      searchSymbols: (workspacePath: string, query: string, topK?: number) => raw.indexSearchSymbols(workspacePath, query, topK),
      getProjectSummary: (workspacePath: string) => raw.indexGetProjectSummary(workspacePath),
      getProjectSummaryText: (workspacePath: string) => raw.indexGetProjectSummaryText(workspacePath),
      setMode: (workspacePath: string, mode: 'structural' | 'semantic') => raw.indexSetMode(workspacePath, mode),
      updateFile: (workspacePath: string, filePath: string) => raw.indexUpdateFile(workspacePath, filePath),
      clear: (workspacePath: string) => raw.indexClear(workspacePath),
      updateEmbeddingConfig: (workspacePath: string, config: Parameters<typeof raw.indexUpdateEmbeddingConfig>[1]) =>
        raw.indexUpdateEmbeddingConfig(workspacePath, config),
      testConnection: (workspacePath: string) => raw.indexTestConnection(workspacePath),
      getProviders: () => raw.indexGetProviders(),
      parseCallGraph: (filePath: string, content: string) => raw.indexParseCallGraph(filePath, content),
      onProgress: (callback: Parameters<typeof raw.onIndexProgress>[0]) => raw.onIndexProgress(callback),
    },

    // HTTP
    http: {
      readUrl: (url: string, timeout?: number) => raw.httpReadUrl(url, timeout),
      webSearch: (query: string, maxResults?: number, timeout?: number) => raw.httpWebSearch(query, maxResults, timeout),
      setSearchEngineState: (state: unknown) => raw.httpSetSearchEngineState(state),
    },

    // 资源
    resources: {
      readJson: <T = unknown>(relativePath: string) => raw.resourcesReadJson<T>(relativePath),
      readText: (relativePath: string) => raw.resourcesReadText(relativePath),
      exists: (relativePath: string) => raw.resourcesExists(relativePath),
      clearCache: (prefix?: string) => raw.resourcesClearCache(prefix),
    },

    // MCP
    mcp: {
      initialize: (workspaceRoots: string[]) => raw.mcpInitialize(workspaceRoots),
      getServersState: () => raw.mcpGetServersState(),
      getAllTools: () => raw.mcpGetAllTools(),
      connectServer: (serverId: string) => raw.mcpConnectServer(serverId),
      disconnectServer: (serverId: string) => raw.mcpDisconnectServer(serverId),
      reconnectServer: (serverId: string) => raw.mcpReconnectServer(serverId),
      callTool: (request: Parameters<typeof raw.mcpCallTool>[0]) => raw.mcpCallTool(request),
      readResource: (request: Parameters<typeof raw.mcpReadResource>[0]) => raw.mcpReadResource(request),
      getPrompt: (request: Parameters<typeof raw.mcpGetPrompt>[0]) => raw.mcpGetPrompt(request),
      refreshCapabilities: (serverId: string) => raw.mcpRefreshCapabilities(serverId),
      getConfigPaths: () => raw.mcpGetConfigPaths(),
      reloadConfig: () => raw.mcpReloadConfig(),
      addServer: (config: Parameters<typeof raw.mcpAddServer>[0], level?: 'user' | 'workspace') => raw.mcpAddServer(config, level),
      removeServer: (serverId: string, level?: 'user' | 'workspace') => raw.mcpRemoveServer(serverId, level),
      toggleServer: (serverId: string, disabled: boolean, level?: 'user' | 'workspace') => raw.mcpToggleServer(serverId, disabled, level),
      setAutoConnect: (enabled: boolean) => raw.mcpSetAutoConnect(enabled),
      startOAuth: (serverId: string) => raw.mcpStartOAuth(serverId),
      finishOAuth: (serverId: string, authorizationCode: string) => raw.mcpFinishOAuth(serverId, authorizationCode),
      refreshOAuthToken: (serverId: string) => raw.mcpRefreshOAuthToken(serverId),
      onServerStatus: (callback: Parameters<typeof raw.onMcpServerStatus>[0]) => raw.onMcpServerStatus(callback),
      onToolsUpdated: (callback: Parameters<typeof raw.onMcpToolsUpdated>[0]) => raw.onMcpToolsUpdated(callback),
      onResourcesUpdated: (callback: Parameters<typeof raw.onMcpResourcesUpdated>[0]) => raw.onMcpResourcesUpdated(callback),
      onStateChanged: (callback: Parameters<typeof raw.onMcpStateChanged>[0]) => raw.onMcpStateChanged(callback),
      registrySearch: (query?: string) => raw.mcpRegistrySearch(query),
      registryGetDetails: (serverName: string) => raw.mcpRegistryGetDetails(serverName),
    },

    // Email
    email: {
      testConnection: (config: Parameters<typeof raw.emailTestConnection>[0]) => raw.emailTestConnection(config),
      send: (params: Parameters<typeof raw.emailSend>[0]) => raw.emailSend(params),
    },

    // Skills
    skills: {
      getGlobalDir: () => raw.skillsGetGlobalDir(),
    },

    // LSP
    lsp: {
      start: (workspacePath: string) => raw.lspStart(workspacePath),
      stop: () => raw.lspStop(),
      didOpen: (params: Parameters<typeof raw.lspDidOpen>[0]) => raw.lspDidOpen(params),
      didChange: (params: Parameters<typeof raw.lspDidChange>[0]) => raw.lspDidChange(params),
      didClose: (params: Parameters<typeof raw.lspDidClose>[0]) => raw.lspDidClose(params),
      didSave: (params: Parameters<typeof raw.lspDidSave>[0]) => raw.lspDidSave(params),
      definition: (params: Parameters<typeof raw.lspDefinition>[0]) => raw.lspDefinition(params),
      typeDefinition: (params: Parameters<typeof raw.lspTypeDefinition>[0]) => raw.lspTypeDefinition(params),
      implementation: (params: Parameters<typeof raw.lspImplementation>[0]) => raw.lspImplementation(params),
      references: (params: Parameters<typeof raw.lspReferences>[0]) => raw.lspReferences(params),
      hover: (params: Parameters<typeof raw.lspHover>[0]) => raw.lspHover(params),
      completion: (params: Parameters<typeof raw.lspCompletion>[0]) => raw.lspCompletion(params),
      completionResolve: (item: Parameters<typeof raw.lspCompletionResolve>[0]) => raw.lspCompletionResolve(item),
      signatureHelp: (params: Parameters<typeof raw.lspSignatureHelp>[0]) => raw.lspSignatureHelp(params),
      rename: (params: Parameters<typeof raw.lspRename>[0]) => raw.lspRename(params),
      prepareRename: (params: Parameters<typeof raw.lspPrepareRename>[0]) => raw.lspPrepareRename(params),
      documentSymbol: (params: Parameters<typeof raw.lspDocumentSymbol>[0]) => raw.lspDocumentSymbol(params),
      workspaceSymbol: (params: Parameters<typeof raw.lspWorkspaceSymbol>[0]) => raw.lspWorkspaceSymbol(params),
      codeAction: (params: Parameters<typeof raw.lspCodeAction>[0]) => raw.lspCodeAction(params),
      formatting: (params: Parameters<typeof raw.lspFormatting>[0]) => raw.lspFormatting(params),
      rangeFormatting: (params: Parameters<typeof raw.lspRangeFormatting>[0]) => raw.lspRangeFormatting(params),
      documentHighlight: (params: Parameters<typeof raw.lspDocumentHighlight>[0]) => raw.lspDocumentHighlight(params),
      foldingRange: (params: Parameters<typeof raw.lspFoldingRange>[0]) => raw.lspFoldingRange(params),
      inlayHint: (params: Parameters<typeof raw.lspInlayHint>[0]) => raw.lspInlayHint(params),
      getDiagnostics: (filePath: string) => raw.getLspDiagnostics(filePath),
      onDiagnostics: (callback: Parameters<typeof raw.onLspDiagnostics>[0]) => raw.onLspDiagnostics(callback),
      // 新增 LSP 功能
      prepareCallHierarchy: (params: Parameters<typeof raw.lspPrepareCallHierarchy>[0]) => raw.lspPrepareCallHierarchy(params),
      incomingCalls: (params: Parameters<typeof raw.lspIncomingCalls>[0]) => raw.lspIncomingCalls(params),
      outgoingCalls: (params: Parameters<typeof raw.lspOutgoingCalls>[0]) => raw.lspOutgoingCalls(params),
      waitForDiagnostics: (params: Parameters<typeof raw.lspWaitForDiagnostics>[0]) => raw.lspWaitForDiagnostics(params),
      findBestRoot: (params: Parameters<typeof raw.lspFindBestRoot>[0]) => raw.lspFindBestRoot(params),
      ensureServerForFile: (params: Parameters<typeof raw.lspEnsureServerForFile>[0]) => raw.lspEnsureServerForFile(params),
      didChangeWatchedFiles: (params: Parameters<typeof raw.lspDidChangeWatchedFiles>[0]) => raw.lspDidChangeWatchedFiles(params),
      getSupportedLanguages: () => raw.lspGetSupportedLanguages(),
      // LSP 服务器安装管理
      getServerStatus: () => raw.lspGetServerStatus(),
      getBinDir: () => raw.lspGetBinDir(),
      getDefaultBinDir: () => raw.lspGetDefaultBinDir(),
      setCustomBinDir: (customPath: string | null) => raw.lspSetCustomBinDir(customPath),
      installServer: (serverType: string) => raw.lspInstallServer(serverType),
      installBasicServers: () => raw.lspInstallBasicServers(),
    },

    // Debug
    debug: {
      createSession: (config: Parameters<typeof raw.debugCreateSession>[0]) => raw.debugCreateSession(config),
      launch: (sessionId: string) => raw.debugLaunch(sessionId),
      attach: (sessionId: string) => raw.debugAttach(sessionId),
      stop: (sessionId: string) => raw.debugStop(sessionId),
      continue: (sessionId: string) => raw.debugContinue(sessionId),
      stepOver: (sessionId: string) => raw.debugStepOver(sessionId),
      stepInto: (sessionId: string) => raw.debugStepInto(sessionId),
      stepOut: (sessionId: string) => raw.debugStepOut(sessionId),
      pause: (sessionId: string) => raw.debugPause(sessionId),
      setBreakpoints: (sessionId: string, file: string, breakpoints: Parameters<typeof raw.debugSetBreakpoints>[2]) =>
        raw.debugSetBreakpoints(sessionId, file, breakpoints),
      getStackTrace: (sessionId: string, threadId: number) => raw.debugGetStackTrace(sessionId, threadId),
      getScopes: (sessionId: string, frameId: number) => raw.debugGetScopes(sessionId, frameId),
      getVariables: (sessionId: string, variablesReference: number) => raw.debugGetVariables(sessionId, variablesReference),
      evaluate: (sessionId: string, expression: string, frameId?: number) => raw.debugEvaluate(sessionId, expression, frameId),
      getSessionState: (sessionId: string) => raw.debugGetSessionState(sessionId),
      getAllSessions: () => raw.debugGetAllSessions(),
      getSupportedTypes: () => raw.debugGetSupportedTypes(),
      getConfigSnippets: (type: string) => raw.debugGetConfigSnippets(type),
      configurationDone: (sessionId: string) => raw.debugConfigurationDone(sessionId),
      getThreads: (sessionId: string) => raw.debugGetThreads(sessionId),
      getCapabilities: (sessionId: string) => raw.debugGetCapabilities(sessionId),
      onEvent: (callback: Parameters<typeof raw.onDebugEvent>[0]) => raw.onDebugEvent(callback),
    },

    // 更新服务
    updater: {
      check: () => raw.updaterCheck(),
      getStatus: () => raw.updaterGetStatus(),
      download: () => raw.updaterDownload(),
      install: () => raw.updaterInstall(),
      openDownloadPage: (url?: string) => raw.updaterOpenDownloadPage(url),
      onStatus: (callback: Parameters<typeof raw.onUpdaterStatus>[0]) => raw.onUpdaterStatus(callback),
    },

    // 应用错误（来自主进程）
    app: {
      onError: (callback: Parameters<typeof raw.onAppError>[0]) => raw.onAppError(callback),
      respondToShutdownRequest: (requestId: string, success: boolean) => raw.respondToShutdownRequest(requestId, success),
      onShutdownRequested: (callback: Parameters<typeof raw.onShutdownRequested>[0]) => raw.onShutdownRequested(callback),
    },

    // 多渠道
    channel: {
      initialize: () => raw.channelInitialize(),
      shutdown: () => raw.channelShutdown(),
      getRegisteredChannels: () => raw.channelGetRegisteredChannels(),
      getSecretSchema: (channelId: string) => raw.channelGetSecretSchema(channelId),
      validateCredentials: (channelId: string, credentials: Record<string, string>) => raw.channelValidateCredentials(channelId, credentials),
      addAccount: (channelId: string, account: any) => raw.channelAddAccount(channelId, account),
      removeAccount: (channelId: string, accountId: string) => raw.channelRemoveAccount(channelId, accountId),
      updateAccount: (channelId: string, account: any) => raw.channelUpdateAccount(channelId, account),
      connectAccount: (channelId: string, accountId: string) => raw.channelConnectAccount(channelId, accountId),
      disconnectAccount: (channelId: string, accountId: string) => raw.channelDisconnectAccount(channelId, accountId),
      sendMessage: (message: any) => raw.channelSendMessage(message),
      getAccountStatus: (channelId: string, accountId: string) => raw.channelGetAccountStatus(channelId, accountId),
      getAllAccountStatuses: () => raw.channelGetAllAccountStatuses(),
      getConfig: (channelId: string) => raw.channelGetConfig(channelId),
      getAllConfigs: () => raw.channelGetAllConfigs(),
      setChannelEnabled: (channelId: string, enabled: boolean) => raw.channelSetChannelEnabled(channelId, enabled),
      getWebhookInfo: () => raw.channelGetWebhookInfo(),
      weixinFetchQRCode: () => raw.channelWeixinFetchQRCode(),
      weixinPollQRStatus: (qrcode: string) => raw.channelWeixinPollQRStatus(qrcode),
      sendReply: (conversationKey: string, text: string, replyToId?: string) => raw.channelSendReply(conversationKey, text, replyToId),
      sendFile: (conversationKey: string, filePath: string, fileName?: string, mediaType?: 'file' | 'image' | 'audio' | 'video', replyToId?: string) => raw.channelSendFile(conversationKey, filePath, fileName, mediaType, replyToId),
      updateReaction: (accountId: string, messageId: string, status: string) => raw.channelUpdateReaction(accountId, messageId, status),
      streamReply: (accountId: string, to: string, fullText: string, replyToId?: string) => raw.channelStreamReply(accountId, to, fullText, replyToId),
      rendererReply: (messageId: string, replyText: string) => raw.channelRendererReply(messageId, replyText),
      onMessage: (callback: (message: any) => void) => raw.onChannelMessage(callback),
      onInboundMessage: (callback: (message: any) => void) => raw.onChannelInboundMessage(callback),
      onStatusChange: (callback: (snapshot: any) => void) => raw.onChannelStatusChange(callback),
      onImProcessingStatus: (callback: (status: any) => void) => raw.onChannelImProcessingStatus(callback),
    },

    // 命令执行
    onExecuteCommand: (callback: Parameters<typeof raw.onExecuteCommand>[0]) => raw.onExecuteCommand(callback),

    // Python 环境
    python: {
      getStatus: () => raw.pythonGetStatus(),
      getPath: () => raw.pythonGetPath(),
      getUvPath: () => raw.pythonGetUvPath(),
      ensureReady: () => raw.pythonEnsureReady(),
      reinstall: () => raw.pythonReinstall(),
      installPkg: (pkg: string) => raw.pythonInstallPkg(pkg),
      setCustomPath: (customPath: string | null) => raw.pythonSetCustomPath(customPath),
      executeScript: (params: Parameters<typeof raw.pythonExecuteScript>[0]) => raw.pythonExecuteScript(params),
      executeInlineScript: (params: Parameters<typeof raw.pythonExecuteInlineScript>[0]) => raw.pythonExecuteInlineScript(params),
    },

    data: {
      executeQuery: (params: Parameters<typeof raw.dataExecuteQuery>[0]) => raw.dataExecuteQuery(params),
      transform: (params: Parameters<typeof raw.dataTransform>[0]) => raw.dataTransform(params),
      analyzeCsv: (params: Parameters<typeof raw.dataAnalyzeCsv>[0]) => raw.dataAnalyzeCsv(params),
      generateChart: (params: Parameters<typeof raw.dataGenerateChart>[0]) => raw.dataGenerateChart(params),
      statisticalTest: (params: Parameters<typeof raw.dataStatisticalTest>[0]) => raw.dataStatisticalTest(params),
      restApiCall: (params: Parameters<typeof raw.dataRestApiCall>[0]) => raw.dataRestApiCall(params),
      connectDatabase: (config: Parameters<typeof raw.dataConnectDatabase>[0]) => raw.dataConnectDatabase(config),
      disconnectDatabase: (connectionId: string) => raw.dataDisconnectDatabase(connectionId),
      getConnections: () => raw.dataGetConnections(),
      clearCache: () => raw.dataClearCache(),
      eda: (params: Parameters<typeof raw.dataEda>[0]) => raw.dataEda(params),
      cleanData: (params: Parameters<typeof raw.dataCleanData>[0]) => raw.dataCleanData(params),
      browseSchema: (params: Parameters<typeof raw.dataBrowseSchema>[0]) => raw.dataBrowseSchema(params),
      saveQuery: (params: Parameters<typeof raw.dataSaveQuery>[0]) => raw.dataSaveQuery(params),
      getQueryHistory: (params?: Parameters<typeof raw.dataGetQueryHistory>[0]) => raw.dataGetQueryHistory(params),
      exportReport: (params: Parameters<typeof raw.dataExportReport>[0]) => raw.dataExportReport(params),
    },

    scenarioDb: {
      initialize: (params: Parameters<typeof raw.scenarioDbInitialize>[0]) => raw.scenarioDbInitialize(params),
      executeSql: (params: Parameters<typeof raw.scenarioDbExecuteSql>[0]) => raw.scenarioDbExecuteSql(params),
      drop: (params: Parameters<typeof raw.scenarioDbDrop>[0]) => raw.scenarioDbDrop(params),
      getPath: (scenarioId: string) => raw.scenarioDbGetPath(scenarioId),
    },

    cron: {
      register: (config: any) => raw.cronRegister(config),
      update: (taskId: string, updates: any) => raw.cronUpdate(taskId, updates),
      unregister: (taskId: string) => raw.cronUnregister(taskId),
      pause: (taskId: string) => raw.cronPause(taskId),
      resume: (taskId: string) => raw.cronResume(taskId),
      getAllTasks: () => raw.cronGetAllTasks(),
      getTasksForAgent: (agentId: string) => raw.cronGetTasksForAgent(agentId),
      start: () => raw.cronStart(),
      stop: () => raw.cronStop(),
      onTaskStateChanged: (callback: (taskData: any) => void) => raw.onCronTaskStateChanged(callback),
      onTaskExecute: (callback: (event: any) => void) => raw.onCronTaskExecute(callback),
    },

    scenarioInstall: {
      getScenariosDir: () => raw.scenarioGetScenariosDir(),
      selectScenarioDir: () => raw.scenarioSelectScenarioDir(),
      readScenarioConfig: (sourceDir: string) => raw.scenarioReadScenarioConfig(sourceDir),
      installFromLocal: (sourceDir: string) => raw.scenarioInstallFromLocal(sourceDir),
      getInstalledScenarioDirs: () => raw.scenarioGetInstalledScenarioDirs(),
      deleteScenarioDir: (scenarioId: string) => raw.scenarioDeleteScenarioDir(scenarioId),
      deleteBuiltinSourceDir: (scenarioId: string) => raw.scenarioDeleteBuiltinSourceDir(scenarioId),
      loadScenarioFiles: (scenarioId: string) => raw.scenarioLoadScenarioFiles(scenarioId),
    },
    scenarioMarketplace: {
      search: (query: string, page?: number, pageSize?: number) => raw.scenarioMarketplaceSearch(query, page, pageSize),
      getFeatured: () => raw.scenarioMarketplaceFeatured(),
      getDetails: (scenarioId: string) => raw.scenarioMarketplaceDetails(scenarioId),
      getCategories: () => raw.scenarioMarketplaceCategories(),
      download: (scenarioId: string) => raw.scenarioMarketplaceDownload(scenarioId),
      install: (params: { scenarioId: string; downloadUrl: string; checksum: string; signature?: string; version: string; fileSize: number; packageType: string }) => raw.scenarioMarketplaceInstall(params),
      checkUpdates: (installedScenarios: Array<{ id: string; version: string }>, backendUrl?: string) => raw.scenarioMarketplaceCheckUpdates(installedScenarios, backendUrl),
      update: (params: { scenarioId: string; downloadUrl: string; checksum: string; signature?: string; version: string; fileSize: number; packageType: string }) => raw.scenarioMarketplaceUpdate(params),
    },

    scenarioRollback: {
      getInfo: (scenarioId: string) => raw.scenarioGetRollbackInfo(scenarioId),
      rollback: (scenarioId: string) => raw.scenarioRollbackScenario(scenarioId),
      clearData: (scenarioId?: string) => raw.scenarioClearRollbackData(scenarioId),
    },

    system: {
      onResume: (callback: () => void) => raw.onSystemResume(callback),
    },

    onScenarioInstallProgress: (callback: (data: { scenarioId: string; phase: string; bytesDownloaded: number; bytesTotal: number; percent: number }) => void) => {
      return raw.onScenarioInstallProgress(callback)
    },
  }
}

// 延迟初始化
let _api: ReturnType<typeof createGroupedAPI> | null = null

/**
 * 获取分组的 Electron API
 */
export function getAPI() {
  if (!_api) {
    _api = createGroupedAPI()
  }
  return _api
}

// 类型从实现推断
export type GroupedElectronAPI = ReturnType<typeof createGroupedAPI>

// 便捷访问
export const api = new Proxy({} as GroupedElectronAPI, {
  get(_, prop) {
    return getAPI()[prop as keyof GroupedElectronAPI]
  },
})
