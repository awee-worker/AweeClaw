/**
 * 调试 / 更新 / 审计 / 资源 / 菜单 API
 *
 * 覆盖 IPC 频道：
 * - debug:*      DAP 调试适配器协议代理
 * - updater:*    应用自动更新
 * - audit:*      操作审计日志
 * - resources:*  打包内静态资源读取
 * - workbench:*  命令面板命令执行
 * - menu:*       场景菜单同步
 */
import { invoke, send, on, onArgs } from '../ipcHelpers'

export function createDebugMiscApi() {
  return {
    // ── DAP 调试 ──
    debugCreateSession: (config: unknown) => invoke('debug:createSession')(config),
    debugLaunch: (sessionId: string) => invoke('debug:launch')(sessionId),
    debugAttach: (sessionId: string) => invoke('debug:attach')(sessionId),
    debugStop: (sessionId: string) => invoke('debug:stop')(sessionId),
    debugContinue: (sessionId: string) => invoke('debug:continue')(sessionId),
    debugStepOver: (sessionId: string) => invoke('debug:stepOver')(sessionId),
    debugStepInto: (sessionId: string) => invoke('debug:stepInto')(sessionId),
    debugStepOut: (sessionId: string) => invoke('debug:stepOut')(sessionId),
    debugPause: (sessionId: string) => invoke('debug:pause')(sessionId),
    debugSetBreakpoints: (sessionId: string, file: string, breakpoints: unknown[]) =>
      invoke('debug:setBreakpoints')(sessionId, file, breakpoints),
    debugGetStackTrace: (sessionId: string, threadId: number) =>
      invoke('debug:getStackTrace')(sessionId, threadId),
    debugGetScopes: (sessionId: string, frameId: number) =>
      invoke('debug:getScopes')(sessionId, frameId),
    debugGetVariables: (sessionId: string, variablesReference: number) =>
      invoke('debug:getVariables')(sessionId, variablesReference),
    debugEvaluate: (sessionId: string, expression: string, frameId?: number) =>
      invoke('debug:evaluate')(sessionId, expression, frameId),
    debugGetSessionState: (sessionId: string) =>
      invoke('debug:getSessionState')(sessionId),
    debugGetAllSessions: invoke('debug:getAllSessions'),
    debugGetSupportedTypes: invoke('debug:getSupportedTypes'),
    debugGetConfigSnippets: (type: string) => invoke('debug:getConfigSnippets')(type),
    debugConfigurationDone: (sessionId: string) =>
      invoke('debug:configurationDone')(sessionId),
    debugGetThreads: (sessionId: string) => invoke('debug:getThreads')(sessionId),
    debugGetCapabilities: (sessionId: string) =>
      invoke('debug:getCapabilities')(sessionId),
    onDebugEvent: on<{ sessionId: string; event: unknown }>('debug:event'),

    // ── 自动更新 ──
    updaterCheck: invoke('updater:check'),
    updaterGetStatus: invoke('updater:getStatus'),
    updaterDownload: invoke('updater:download'),
    updaterInstall: invoke('updater:install'),
    updaterOpenDownloadPage: (url?: string) => invoke('updater:openDownloadPage')(url),
    onUpdaterStatus: on<unknown>('updater:status'),

    // ── 审计日志 ──
    auditAppend: (entries: unknown) => invoke('audit:append')(entries),
    auditQuery: (filter?: unknown) => invoke('audit:query')(filter),
    auditFlush: invoke('audit:flush'),

    // ── 静态资源 ──
    resourcesReadJson: (relativePath: string) =>
      invoke('resources:readJson')(relativePath),
    resourcesReadText: (relativePath: string) =>
      invoke('resources:readText')(relativePath),
    resourcesExists: (relativePath: string) => invoke('resources:exists')(relativePath),
    resourcesClearCache: (prefix?: string) => invoke('resources:clearCache')(prefix),

    // ── 命令面板 / 菜单 ──
    onExecuteCommand: onArgs<[string, unknown?]>('workbench:execute-command'),
    syncScenarios: (data: {
      scenarios: Array<{
        id: string
        name: string
        description?: string
        category?: string
      }>
      activeId: string | null
    }) => send('menu:syncScenarios')(data),
    onScenarioRequest: on<void>('menu:requestScenarios'),

    // ── HTTP API ──
    httpReadUrl: (url: string, timeout?: number) =>
      invoke('http:readUrl')(url, timeout),
    httpWebSearch: (query: string, maxResults?: number, timeout?: number) =>
      invoke('http:webSearch')(query, maxResults, timeout),
    httpSetSearchEngineState: (state: unknown) =>
      invoke('http:setSearchEngineState')(state),
  }
}
