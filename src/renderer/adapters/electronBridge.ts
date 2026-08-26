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
  AvatarModelOption,
} from '@renderer/types/electronBridge'
import { createGroup } from './autoGroup'

/** 本地附件项（本地优先架构，存储在 .aweeclaw/attachments/{projectId}/） */
export interface LocalAttachmentItem {
  id: string
  projectId: string
  fileName: string
  fileSize: number
  mimeType: string
  textContent: string | null
  textTruncated: boolean
  hasText: boolean
  createdAt: string
  localPath: string
}

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

  // Node.js 运行时
  nodeGetStatus: () => Promise<{
    ready: boolean
    nodePath: string | null
    npmPath: string | null
    npxPath: string | null
    source: 'system' | 'managed' | 'none'
    version: string | null
    nodeDir: string | null
    binDir: string | null
    installedPackages: string[]
    error?: string
  }>
  nodeGetPath: () => Promise<string | null>
  nodeGetNpmPath: () => Promise<string | null>
  nodeGetNpxPath: () => Promise<string | null>
  nodeEnsureReady: () => Promise<{
    ready: boolean
    nodePath: string | null
    npmPath: string | null
    npxPath: string | null
    source: 'system' | 'managed' | 'none'
    version: string | null
    nodeDir: string | null
    binDir: string | null
    installedPackages: string[]
    error?: string
  }>
  nodeReinstall: () => Promise<{
    ready: boolean
    nodePath: string | null
    npmPath: string | null
    npxPath: string | null
    source: 'system' | 'managed' | 'none'
    version: string | null
    nodeDir: string | null
    binDir: string | null
    installedPackages: string[]
    error?: string
  }>
  nodeInstallPkg: (pkg: string) => Promise<{ success: boolean; error?: string }>
  nodeSetCustomPath: (customPath: string | null) => Promise<{ success: boolean; error?: string }>
  nodeExecuteScript: (params: {
    scriptPath: string
    args?: string[]
    cwd?: string
    timeout?: number
  }) => Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string }>

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

  // 项目附件本地存储（本地优先，后端兜底）
  attachmentSave: (params: { projectId: string; fileName: string; base64Data: string; mimeType?: string }) => Promise<LocalAttachmentItem>
  attachmentList: (projectId: string) => Promise<LocalAttachmentItem[]>
  attachmentDelete: (params: { projectId: string; attachmentId: string }) => Promise<void>
  attachmentReadText: (params: { projectId: string; attachmentId: string }) => Promise<{ textContent: string | null; textTruncated: boolean; fileName: string }>

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

  // ============ 插件系统 ============
  pluginInstall: (params: {
    pluginId: string
    version: string
    backendUrl: string
    authToken?: string
  }) => Promise<{
    success: boolean
    pluginId: string
    pluginKey: string
    version: string
    pluginDir: string
    manifest?: unknown
    mcpServerId?: string
    error?: string
  }>
  pluginUninstall: (pluginKey: string) => Promise<{ success: boolean; error?: string }>
  pluginEnable: (pluginKey: string) => Promise<{ success: boolean; error?: string }>
  pluginDisable: (pluginKey: string) => Promise<{ success: boolean; error?: string }>
  pluginGetInstalled: () => Promise<Array<{
    pluginId: string
    pluginKey: string
    version: string
    installedAt: string
    enabled: boolean
    types: string[]
    manifest: unknown
    mcpServerId?: string
  }>>
  pluginIsInstalled: (pluginKey: string) => Promise<boolean>
  pluginCheckUpdate: (
    pluginKey: string,
    backendUrl: string,
    authToken?: string,
  ) => Promise<{
    hasUpdate: boolean
    currentVersion?: string
    latestVersion?: string
  }>
  onPluginInstallProgress: (callback: (progress: {
    pluginId: string
    phase: 'pending' | 'downloading' | 'verifying' | 'extracting' | 'registering' | 'mcp_connecting' | 'done' | 'error'
    bytesDownloaded: number
    bytesTotal: number
    percent: number
    message?: string
  }) => void) => () => void
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

    // 剪贴板
    clipboard: {
      getFilePaths: () => raw.getClipboardFilePaths(),
      hasFiles: () => raw.hasClipboardFiles(),
      getFileAttachments: () => raw.getClipboardFileAttachments(),
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
      getBlacklist: () => raw.getBlacklist(),
      resetBlacklist: () => raw.resetBlacklist(),
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
      // 视觉模型配置（自定义模式）
      dbGetVisionModelConfig: () => raw.settingsDbGetVisionModelConfig(),
      dbSaveVisionModelConfig: (config: any) => raw.settingsDbSaveVisionModelConfig(config),
      dbSetVisionModelEnabled: (enabled: boolean) => raw.settingsDbSetVisionModelEnabled(enabled),
      // 语音模型配置（自定义模式，STT + TTS 合并存储但分别启用）
      dbGetVoiceModelConfig: () => raw.settingsDbGetVoiceModelConfig(),
      dbSaveVoiceModelConfig: (config: any) =>
        raw.settingsDbSaveVoiceModelConfig(config),
      dbSetVoiceModelEnabled: (payload: { sttEnabled: boolean; ttsEnabled: boolean }) =>
        raw.settingsDbSetVoiceModelEnabled(payload),
      // 语音唤醒配置（唤醒开关 + 唤醒词 + 灵敏度 + 冷却）
      dbGetWakeWordConfig: () => raw.settingsDbGetWakeWordConfig(),
      dbSaveWakeWordConfig: (config: any) => raw.settingsDbSaveWakeWordConfig(config),
      dbSetWakeWordEnabled: (enabled: boolean) => raw.settingsDbSetWakeWordEnabled(enabled),
    },

    // 会话数据库 (SQLite)（自动分组：sessionDbXxx → sessionDb.xxx）
    sessionDb: createGroup(raw, 'sessionDb'),

    // 记忆数据库 (SQLite) - 客户端本地记忆存储（自动分组：memoryDbXxx → memoryDb.xxx）
    memoryDb: createGroup(raw, 'memoryDb'),

    // 项目附件本地存储（本地优先，后端兜底）（自动分组：attachmentXxx → attachment.xxx）
    attachment: createGroup(raw, 'attachment'),

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

    // 索引（自动分组：indexXxx → index.xxx, onIndexXxx → index.onXxx）
    index: createGroup(raw, 'index'),

    // HTTP（自动分组：httpXxx → http.xxx）
    http: createGroup(raw, 'http'),

    // 资源
    resources: {
      readJson: <T = unknown>(relativePath: string) => raw.resourcesReadJson<T>(relativePath),
      readText: (relativePath: string) => raw.resourcesReadText(relativePath),
      exists: (relativePath: string) => raw.resourcesExists(relativePath),
      clearCache: (prefix?: string) => raw.resourcesClearCache(prefix),
    },

    // MCP（自动分组：mcpXxx → mcp.xxx, onMcpXxx → mcp.onXxx）
    mcp: createGroup(raw, 'mcp'),

    // Email（自动分组：emailXxx → email.xxx）
    email: createGroup(raw, 'email'),

    // Skills（自动分组：skillsXxx → skills.xxx）
    skills: createGroup(raw, 'skills'),

    // LSP（自动分组：lspXxx → lsp.xxx, onLspXxx → lsp.onXxx）
    // getLspDiagnostics 不符合前缀约定，通过 custom 补充
    lsp: createGroup(raw, 'lsp', {
      getDiagnostics: (filePath: string) => raw.getLspDiagnostics(filePath),
    }),

    // Debug（自动分组：debugXxx → debug.xxx, onDebugXxx → debug.onXxx）
    debug: createGroup(raw, 'debug'),

    // 更新服务（自动分组：updaterXxx → updater.xxx, onUpdaterXxx → updater.onXxx）
    updater: createGroup(raw, 'updater'),

    // 应用错误（来自主进程）
    app: {
      onError: (callback: Parameters<typeof raw.onAppError>[0]) => raw.onAppError(callback),
      respondToShutdownRequest: (requestId: string, success: boolean) => raw.respondToShutdownRequest(requestId, success),
      onShutdownRequested: (callback: Parameters<typeof raw.onShutdownRequested>[0]) => raw.onShutdownRequested(callback),
    },

    // 多渠道（自动分组：channelXxx → channel.xxx, onChannelXxx → channel.onXxx）
    channel: createGroup(raw, 'channel'),

    // 命令执行
    onExecuteCommand: (callback: Parameters<typeof raw.onExecuteCommand>[0]) => raw.onExecuteCommand(callback),

    // 菜单场景同步
    syncScenarios: (data: Parameters<typeof raw.syncScenarios>[0]) => raw.syncScenarios(data),
    onScenarioRequest: (callback: Parameters<typeof raw.onScenarioRequest>[0]) => raw.onScenarioRequest(callback),

    // Python 环境（自动分组：pythonXxx → python.xxx）
    python: createGroup(raw, 'python'),

    // Node.js 运行时（自动分组：nodeXxx → node.xxx）
    node: createGroup(raw, 'node'),

    // 数据分析（自动分组：dataXxx → data.xxx）
    data: createGroup(raw, 'data'),

    // 场景数据库（自动分组：scenarioDbXxx → scenarioDb.xxx）
    scenarioDb: createGroup(raw, 'scenarioDb'),

    // 定时任务（自动分组：cronXxx → cron.xxx, onCronXxx → cron.onXxx）
    cron: createGroup(raw, 'cron'),

    // 主动式助手（preload 已暴露为嵌套对象，直接透传）
    proactive: raw.proactive,

    // 感知层（preload 已暴露为嵌套对象，直接透传）
    perception: raw.perception,

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

    // ============ 桌面控制（Phase 3） ============
    desktop: {
      // 应用启动
      launchApp: (name: string, args?: string[]) => raw.desktopLaunchApp(name, args),
      quitApp: (name: string) => raw.desktopQuitApp(name),
      listInstalledApps: () => raw.desktopListInstalledApps(),
      findApp: (name: string) => raw.desktopFindApp(name),
      openUrl: (url: string) => raw.desktopOpenUrl(url),
      openFile: (filePath: string) => raw.desktopOpenFile(filePath),

      // 系统信息
      getSystemInfo: () => raw.desktopGetSystemInfo(),
      setVolume: (volume: number) => raw.desktopSetVolume(volume),
      setBrightness: (level: number) => raw.desktopSetBrightness(level),

      // 进程管理
      listProcesses: () => raw.desktopListProcesses(),
      findProcess: (query: string | number) => raw.desktopFindProcess(query),
      killProcess: (pid: number, force?: boolean) => raw.desktopKillProcess(pid, force),
      isProcessRunning: (name: string) => raw.desktopIsProcessRunning(name),

      // 窗口控制
      listWindows: () => raw.desktopListWindows(),
      findWindow: (query: string) => raw.desktopFindWindow(query),
      focusWindow: (windowId: string) => raw.desktopFocusWindow(windowId),
      minimizeWindow: (windowId: string) => raw.desktopMinimizeWindow(windowId),
      maximizeWindow: (windowId: string) => raw.desktopMaximizeWindow(windowId),
      restoreWindow: (windowId: string) => raw.desktopRestoreWindow(windowId),
      closeWindow: (windowId: string) => raw.desktopCloseWindow(windowId),
      bringWindowToFront: (windowId: string) => raw.desktopBringWindowToFront(windowId),
      setWindowBounds: (windowId: string, bounds: { x: number; y: number; width: number; height: number }) =>
        raw.desktopSetWindowBounds(windowId, bounds),

      // 屏幕截图
      captureScreen: (displayId?: number) => raw.desktopCaptureScreen(displayId),
      captureRegion: (region: { x: number; y: number; width: number; height: number }, displayId?: number) =>
        raw.desktopCaptureRegion(region, displayId),
      captureAllScreens: () => raw.desktopCaptureAllScreens(),

      // 输入模拟
      mouseClick: (params: { x: number; y: number; button: 'left' | 'right' | 'middle'; clickType: 'single' | 'double' }) =>
        raw.desktopMouseClick(params),
      mouseMove: (params: { x: number; y: number; smooth?: boolean; duration?: number }) => raw.desktopMouseMove(params),
      mouseScroll: (params: { x: number; y: number; amount: number }) => raw.desktopMouseScroll(params),
      mouseDrag: (params: { fromX: number; fromY: number; toX: number; toY: number; button: 'left' | 'right' | 'middle'; duration?: number }) =>
        raw.desktopMouseDrag(params),
      typeText: (text: string, delayMs?: number) => raw.desktopTypeText(text, delayMs),
      pressKey: (key: string) => raw.desktopPressKey(key),
      keyCombo: (keys: string[]) => raw.desktopKeyCombo(keys),

      // 文件操作
      copyFile: (sourcePath: string, targetPath: string) => raw.desktopCopyFile(sourcePath, targetPath),
      moveFile: (sourcePath: string, targetPath: string) => raw.desktopMoveFile(sourcePath, targetPath),
      deleteFile: (targetPath: string) => raw.desktopDeleteFile(targetPath),
      renameFile: (sourcePath: string, newName: string) => raw.desktopRenameFile(sourcePath, newName),
      getFileInfo: (targetPath: string) => raw.desktopGetFileInfo(targetPath),
      fileExists: (targetPath: string) => raw.desktopFileExists(targetPath),
      createDirectory: (targetPath: string) => raw.desktopCreateDirectory(targetPath),
      listDirectory: (targetPath: string) => raw.desktopListDirectory(targetPath),

      // 紧急停止（Phase 3）
      emergencyStop: {
        getState: () => raw.desktopEmergencyStopGetState(),
        trigger: (params: { source: string; reason?: string }) => raw.desktopEmergencyStopTrigger(params),
        reset: () => raw.desktopEmergencyStopReset(),
        onStateChange: (callback: (state: any) => void) => raw.onDesktopEmergencyStopStateChange(callback),
      },

      // 辅助功能权限（Phase 3）
      accessibility: {
        check: (type?: string, forceRefresh?: boolean) => raw.desktopAccessibilityCheck(type, forceRefresh),
        checkAll: (forceRefresh?: boolean) => raw.desktopAccessibilityCheckAll(forceRefresh),
        openPreferences: (type?: string) => raw.desktopAccessibilityOpenPreferences(type),
        requestPermission: (type?: string) => raw.desktopAccessibilityRequestPermission(type),
        onPermissionChange: (callback: (type: string, status: string) => void) => raw.onDesktopAccessibilityPermissionChange(callback),
      },
    },

    onScenarioInstallProgress: (callback: (data: { scenarioId: string; phase: string; bytesDownloaded: number; bytesTotal: number; percent: number }) => void) => {
      return raw.onScenarioInstallProgress(callback)
    },

    // ============ 插件系统 ============
    plugin: {
      install: (params: {
        pluginId: string
        version: string
        backendUrl: string
        authToken?: string
        preloadedDownloadInfo?: {
          downloadUrl: string
          checksum: string
          packageSize: number
          manifest?: unknown
          configOnly?: boolean
        }
        preloadedPluginDetail?: {
          pluginId: string
          pluginKey: string
          name: string
          nameZh: string
          description: string
          descriptionZh: string
          type: string
          icon?: string
          category: string
          tags: string[]
          developerId?: string
          source: string
          isFree: boolean
          price: number
          latestVersion?: string
          totalDownloads: number
          rating: number
          ratingCount: number
          featured: boolean
          minAppVersion?: string
          platforms: string[]
          screenshotUrls: string[]
          homepage?: string
          repository?: string
          license: string
          enabled: boolean
        }
        /** 用户填写的插件配置值（覆盖 defaultValue，用于 {{config.KEY}} 模板替换） */
        userConfig?: Record<string, string>
      }) => raw.pluginInstall(params),
      uninstall: (pluginKey: string) => raw.pluginUninstall(pluginKey),
      enable: (pluginKey: string) => raw.pluginEnable(pluginKey),
      disable: (pluginKey: string) => raw.pluginDisable(pluginKey),
      getInstalled: () => raw.pluginGetInstalled(),
      isInstalled: (pluginKey: string) => raw.pluginIsInstalled(pluginKey),
      checkUpdate: (pluginKey: string, backendUrl: string, authToken?: string) =>
        raw.pluginCheckUpdate(pluginKey, backendUrl, authToken),
      /** 读取插件用户配置 */
      getConfig: (pluginKey: string) => raw.pluginGetConfig(pluginKey) as Promise<Record<string, string>>,
      /** 保存插件用户配置（并触发 MCP 重连） */
      saveConfig: (pluginKey: string, values: Record<string, string>) =>
        raw.pluginSaveConfig(pluginKey, values) as Promise<{ success: boolean; reconnected: boolean; error?: string }>,
      onInstallProgress: (callback: (progress: {
        pluginId: string
        phase: 'pending' | 'downloading' | 'verifying' | 'extracting' | 'registering' | 'mcp_connecting' | 'done' | 'error'
        bytesDownloaded: number
        bytesTotal: number
        percent: number
        message?: string
      }) => void) => raw.onPluginInstallProgress(callback),
    },

    // 悬浮头像（语音唤醒 + 系统级悬浮头像 + 托盘）
    floatingAvatar: {
      // 窗口显隐
      show: () => raw.floatingAvatar.show(),
      hide: () => raw.floatingAvatar.hide(),
      toggle: () => raw.floatingAvatar.toggle(),
      isVisible: () => raw.floatingAvatar.isVisible(),
      // 偏好配置
      getConfig: () => raw.floatingAvatar.getConfig(),
      updateConfig: (config: Parameters<typeof raw.floatingAvatar.updateConfig>[0]) =>
        raw.floatingAvatar.updateConfig(config),
      // 位置
      getPosition: () => raw.floatingAvatar.getPosition(),
      setPosition: (x: number, y: number) => raw.floatingAvatar.setPosition(x, y),
      // 语音上下文
      getVoiceContext: () => raw.floatingAvatar.getVoiceContext(),
      updateVoiceContext: (partial: Parameters<typeof raw.floatingAvatar.updateVoiceContext>[0]) =>
        raw.floatingAvatar.updateVoiceContext(partial),
      // 唤醒 / 状态 / 保存（头像→main）
      wakeWordDetected: (info: unknown) => raw.floatingAvatar.wakeWordDetected(info),
      voiceStateChanged: (payload: Parameters<typeof raw.floatingAvatar.voiceStateChanged>[0]) =>
        raw.floatingAvatar.voiceStateChanged(payload),
      saveConversation: (payload: Parameters<typeof raw.floatingAvatar.saveConversation>[0]) =>
        raw.floatingAvatar.saveConversation(payload),
      // 主窗口控制
      openMainWindow: () => raw.floatingAvatar.openMainWindow(),
      requestMicPermission: () => raw.floatingAvatar.requestMicPermission(),
      quitApp: () => raw.floatingAvatar.quitApp(),
      // 拖拽频道获取（头像窗口启动时调用一次）
      getDragChannel: () => raw.floatingAvatar.getDragChannel(),
      // 模型列表 / 模型切换（头像窗口→main→主窗口）
      getAvailableModels: () => raw.floatingAvatar.getAvailableModels(),
      selectModel: (payload: { provider: string; model: string; isCloud: boolean }) =>
        raw.floatingAvatar.selectModel(payload),
      sendModelsResponse: (requestId: string, models: AvatarModelOption[]) =>
        raw.floatingAvatar.sendModelsResponse(requestId, models),
      onRequestModels: (callback: Parameters<typeof raw.floatingAvatar.onRequestModels>[0]) =>
        raw.floatingAvatar.onRequestModels(callback),
      onSelectModel: (callback: Parameters<typeof raw.floatingAvatar.onSelectModel>[0]) =>
        raw.floatingAvatar.onSelectModel(callback),
      // 授权方式切换（头像窗口→main→主窗口）
      selectAuthorizationMode: (mode: 'every-step' | 'dangerous-only' | 'never') =>
        raw.floatingAvatar.selectAuthorizationMode(mode),
      onSelectAuthorizationMode: (
        callback: Parameters<typeof raw.floatingAvatar.onSelectAuthorizationMode>[0],
      ) => raw.floatingAvatar.onSelectAuthorizationMode(callback),
      // 工作模式切换（头像窗口→main→主窗口）
      selectWorkMode: (mode: 'chat' | 'agent' | 'plan') =>
        raw.floatingAvatar.selectWorkMode(mode),
      onSelectWorkMode: (
        callback: Parameters<typeof raw.floatingAvatar.onSelectWorkMode>[0],
      ) => raw.floatingAvatar.onSelectWorkMode(callback),
      // 自定义智能体切换（头像窗口→main→主窗口）
      selectAgent: (agentId: string | null) =>
        raw.floatingAvatar.selectAgent(agentId),
      onSelectAgent: (callback: Parameters<typeof raw.floatingAvatar.onSelectAgent>[0]) =>
        raw.floatingAvatar.onSelectAgent(callback),
      // 打开主窗口设置（迷你聊天「创建智能体」入口）
      openSettings: () => raw.floatingAvatar.openSettings(),
      // 主窗口→main→头像：推送主窗口当前对话快照
      pushMainConversation: (snapshot: Parameters<typeof raw.floatingAvatar.pushMainConversation>[0]) =>
        raw.floatingAvatar.pushMainConversation(snapshot),
      onMainConversation: (callback: Parameters<typeof raw.floatingAvatar.onMainConversation>[0]) =>
        raw.floatingAvatar.onMainConversation(callback),
      // 主题色同步（主窗口→main→头像窗口）
      updateTheme: (payload: { themeColor: string; themeMode: string }) =>
        raw.floatingAvatar.updateTheme(payload),
      onUpdateTheme: (callback: Parameters<typeof raw.floatingAvatar.onUpdateTheme>[0]) =>
        raw.floatingAvatar.onUpdateTheme(callback),
      // 窗口展开/收起（对话面板）
      expand: () => raw.floatingAvatar.expand(),
      collapse: () => raw.floatingAvatar.collapse(),
      isExpanded: () => raw.floatingAvatar.isExpanded(),
      // 主窗口→头像：通知主窗口全功能语音对话状态
      notifyMainConversationActive: (active: boolean) =>
        raw.floatingAvatar.notifyMainConversationActive(active),
      // 主窗口→头像：推送项目执行状态摘要
      pushExecutionStatus: (status: Parameters<typeof raw.floatingAvatar.pushExecutionStatus>[0]) =>
        raw.floatingAvatar.pushExecutionStatus(status),
      // 事件：项目执行状态更新（main→头像窗口）
      onExecutionStatus: (callback: Parameters<typeof raw.floatingAvatar.onExecutionStatus>[0]) =>
        raw.floatingAvatar.onExecutionStatus(callback),
      // 事件：状态栏边缘方向（main→头像窗口）
      onStatusEdge: (callback: Parameters<typeof raw.floatingAvatar.onStatusEdge>[0]) =>
        raw.floatingAvatar.onStatusEdge(callback),
      // 头像→main：扩展窗口高度以显示执行状态栏
      expandForStatus: () => raw.floatingAvatar.expandForStatus(),
      // 头像→main：收起执行状态栏
      collapseForStatus: () => raw.floatingAvatar.collapseForStatus(),
      // 头像→main：扩展窗口宽度以显示 tooltip（鼠标悬停时）
      expandForTooltip: () => raw.floatingAvatar.expandForTooltip(),
      // 头像→main：收起 tooltip 扩展（鼠标离开时恢复窗口宽度）
      collapseForTooltip: () => raw.floatingAvatar.collapseForTooltip(),
      // 事件订阅（main→渲染进程）
      onVoiceContextUpdated: (callback: Parameters<typeof raw.floatingAvatar.onVoiceContextUpdated>[0]) =>
        raw.floatingAvatar.onVoiceContextUpdated(callback),
      onMainConversationActive: (callback: Parameters<typeof raw.floatingAvatar.onMainConversationActive>[0]) =>
        raw.floatingAvatar.onMainConversationActive(callback),
      onWakeWordToggled: (callback: Parameters<typeof raw.floatingAvatar.onWakeWordToggled>[0]) =>
        raw.floatingAvatar.onWakeWordToggled(callback),
      onSaveConversation: (callback: Parameters<typeof raw.floatingAvatar.onSaveConversation>[0]) =>
        raw.floatingAvatar.onSaveConversation(callback),
      onVoiceStateChanged: (callback: Parameters<typeof raw.floatingAvatar.onVoiceStateChanged>[0]) =>
        raw.floatingAvatar.onVoiceStateChanged(callback),
      // 右键菜单/托盘「设置」点击（打开设置页指定 tab）
      onOpenSettings: (callback: Parameters<typeof raw.floatingAvatar.onOpenSettings>[0]) =>
        raw.floatingAvatar.onOpenSettings(callback),
      // 截图提问完成（main→头像窗口）
      onScreenshotResult: (callback: Parameters<typeof raw.floatingAvatar.onScreenshotResult>[0]) =>
        raw.floatingAvatar.onScreenshotResult(callback),
      // 启动截图提问（头像窗口→main，与右键菜单共用同一流程）
      startScreenshotAsk: () => raw.floatingAvatar.startScreenshotAsk(),
      // 拖拽（动态频道）：主进程在 start 时自取鼠标+窗口坐标，渲染层无需 payload
      sendDragStart: (channel: string) => raw.floatingAvatar.sendDragStart(channel),
      sendDragEnd: (channel: string) => raw.floatingAvatar.sendDragEnd(channel),
    },

    // 主窗口截图（聊天输入框截图按钮，结果作为附件添加到输入框）
    screenshot: {
      /** 启动截图：触发全屏区域选择覆盖窗口 */
      start: () => raw.screenshot.start(),
      /** 截图完成事件订阅（main→主窗口：截图 base64 + 落盘路径） */
      onResult: (callback: Parameters<typeof raw.screenshot.onResult>[0]) =>
        raw.screenshot.onResult(callback),
    },

    // 会议纪要窗口（独立常驻窗口）
    meetingNotes: {
      /** 显示/聚焦会议纪要窗口 */
      show: () => raw.meetingNotes.show(),
      /** 获取当前工作区路径 */
      getWorkspace: () => raw.meetingNotes.getWorkspace(),
      /** 保存录音原文 txt */
      saveTranscript: (payload: Parameters<typeof raw.meetingNotes.saveTranscript>[0]) =>
        raw.meetingNotes.saveTranscript(payload),
      /** 生成并保存 docx */
      generateDocx: (payload: Parameters<typeof raw.meetingNotes.generateDocx>[0]) =>
        raw.meetingNotes.generateDocx(payload),
      /** 整理进度推送订阅 */
      onOrganizeProgress: (
        callback: Parameters<typeof raw.meetingNotes.onOrganizeProgress>[0],
      ) => raw.meetingNotes.onOrganizeProgress(callback),
    },

    // PPT 预览窗口（供 mcp-pptx 插件实时预览生成过程）
    pptPreview: {
      /** 隐藏预览窗口（不销毁，便于下次快速显示） */
      close: () => raw.pptPreview.close(),
      /** 在系统文件管理器中显示已保存的 .pptx 文件 */
      export: (filePath: string) => raw.pptPreview.export(filePath),
      /** 会话打开事件订阅 */
      onOpen: (callback: Parameters<typeof raw.pptPreview.onOpen>[0]) =>
        raw.pptPreview.onOpen(callback),
      /** 幻灯片数据推送事件订阅 */
      onPushSlide: (callback: Parameters<typeof raw.pptPreview.onPushSlide>[0]) =>
        raw.pptPreview.onPushSlide(callback),
      /** 生成完成事件订阅 */
      onMarkComplete: (callback: Parameters<typeof raw.pptPreview.onMarkComplete>[0]) =>
        raw.pptPreview.onMarkComplete(callback),
    },

    // ========================================
    // 项目执行窗口（execution.html 专用 + 主窗口调用）
    // ========================================
    projectExecution: {
      /** 最小化到悬浮球（执行窗口调用） */
      minimize: () => raw.projectExecution.minimize(),
      /** 关闭窗口（执行窗口调用） */
      close: () => raw.projectExecution.close(),
      /** 获取悬浮球位置（执行窗口计算动画方向） */
      getAvatarPosition: () => raw.projectExecution.getAvatarPosition(),
      /** 获取初始任务消息（一次性消费，执行窗口调用） */
      getInitialMessage: (messageKey: string) =>
        raw.projectExecution.getInitialMessage(messageKey),
      /** 回传 threadId 给主窗口（执行窗口调用） */
      reportThreadId: (sessionId: string, threadId: string) =>
        raw.projectExecution.reportThreadId(sessionId, threadId),
      /** 监听 threadId 回传事件（主窗口调用） */
      onThreadIdReported: (callback: Parameters<typeof raw.projectExecution.onThreadIdReported>[0]) =>
        raw.projectExecution.onThreadIdReported(callback),
      /** 推送执行状态（执行窗口 → 主进程 → 主窗口/悬浮球） */
      pushStatus: (status: Parameters<typeof raw.projectExecution.pushStatus>[0]) =>
        raw.projectExecution.pushStatus(status),
      /** 请求打开执行窗口（主窗口调用） */
      open: (params: Parameters<typeof raw.projectExecution.open>[0]) =>
        raw.projectExecution.open(params),
      /** 请求恢复执行窗口（悬浮球调用） */
      restore: () => raw.projectExecution.restore(),
      /** 查询执行窗口是否存在（含最小化/隐藏状态） */
      exists: () => raw.projectExecution.exists(),
      /** 新增 Tab 事件（主进程 → 执行窗口） */
      onNewTab: (callback: Parameters<typeof raw.projectExecution.onNewTab>[0]) =>
        raw.projectExecution.onNewTab(callback),
      /** 开始最小化动画事件（主进程 → 执行窗口） */
      onStartMinimizeAnimation: (callback: Parameters<typeof raw.projectExecution.onStartMinimizeAnimation>[0]) =>
        raw.projectExecution.onStartMinimizeAnimation(callback),
      /** 开始恢复动画事件（主进程 → 执行窗口） */
      onStartRestoreAnimation: (callback: Parameters<typeof raw.projectExecution.onStartRestoreAnimation>[0]) =>
        raw.projectExecution.onStartRestoreAnimation(callback),
      /** 执行状态广播事件（主进程 → 主窗口） */
      onStatusBroadcast: (callback: Parameters<typeof raw.projectExecution.onStatusBroadcast>[0]) =>
        raw.projectExecution.onStatusBroadcast(callback),
    },

    // 视频转码（用 ffmpeg-static 转码不支持的视频编码，如 H.265 → H.264）
    videoTranscode: {
      /** 探测视频编码信息 */
      probe: (filePath: string) => raw.videoTranscode.probe(filePath),
      /** 判断编码是否被 Chromium 原生支持 */
      isSupported: (probe: Parameters<typeof raw.videoTranscode.isSupported>[0]) =>
        raw.videoTranscode.isSupported(probe),
      /** 转码为 H.264（进度通过 onProgress 订阅） */
      transcode: (filePath: string) => raw.videoTranscode.transcode(filePath),
      /** 取消正在进行的转码 */
      cancel: (filePath: string) => raw.videoTranscode.cancel(filePath),
      /** 转码进度事件订阅 */
      onProgress: (callback: Parameters<typeof raw.videoTranscode.onProgress>[0]) =>
        raw.videoTranscode.onProgress(callback),
    },

    // 运行时环境检测与安装
    environment: {
      /** 检测全部核心运行时状态（只读，秒级返回，不触发安装） */
      environmentCheck: () => raw.environment.environmentCheck(),
      /** 安装指定运行时（推送进度事件） */
      environmentInstall: (id: 'python' | 'uv' | 'node') =>
        raw.environment.environmentInstall(id),
      /** 一键安装所有缺失项（按 uv→python→node 顺序串行） */
      environmentInstallAll: () => raw.environment.environmentInstallAll(),
      /** 订阅安装进度事件（返回取消订阅函数） */
      onEnvironmentProgress: (
        callback: Parameters<typeof raw.environment.onEnvironmentProgress>[0],
      ) => raw.environment.onEnvironmentProgress(callback),
    },

    // 设备联动（移动端 ↔ 桌面端）
    deviceLink: {
      pushCredentials: (payload: Parameters<typeof raw.deviceLink.pushCredentials>[0]) =>
        raw.deviceLink.pushCredentials(payload),
      clearCredentials: () => raw.deviceLink.clearCredentials(),
      setPreferences: (patch: Parameters<typeof raw.deviceLink.setPreferences>[0]) =>
        raw.deviceLink.setPreferences(patch),
      getStatus: () => raw.deviceLink.getStatus(),
      getDeviceId: () => raw.deviceLink.getDeviceId(),
      onTaskTransfer: (callback: Parameters<typeof raw.deviceLink.onTaskTransfer>[0]) =>
        raw.deviceLink.onTaskTransfer(callback),
      onAiTask: (callback: Parameters<typeof raw.deviceLink.onAiTask>[0]) =>
        raw.deviceLink.onAiTask(callback),
      onRunScenario: (callback: Parameters<typeof raw.deviceLink.onRunScenario>[0]) =>
        raw.deviceLink.onRunScenario(callback),
      replyResult: (requestId: string, result: { success: boolean; output?: string; error?: string }) =>
        raw.deviceLink.replyResult(requestId, result),

      // 方向4：场景模式跨端协同
      pushSceneMode: (mode: string) => raw.deviceLink.pushSceneMode(mode),
      onSceneModeSync: (callback: Parameters<typeof raw.deviceLink.onSceneModeSync>[0]) =>
        raw.deviceLink.onSceneModeSync(callback),
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
