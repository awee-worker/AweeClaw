/**
 * 代码索引 / LSP API
 *
 * 覆盖 IPC 频道：
 * - index:*  项目索引（结构化 / 语义化检索）
 * - lsp:*    LSP 协议代理（定义/引用/补全/重命名/格式化/调用层次等）
 *
 * 注：LSP 参数类型与具体语言服务器耦合紧密，preload 层只透传，
 * 不引入具体的 LSP 类型定义以避免打包膨胀。renderer 侧应自行声明。
 */
import { invoke, on } from '../ipcHelpers'
import type { IndexStatusData, EmbeddingConfigInput } from '../types'

export function createCodeIntelApi() {
  return {
    // ── 项目索引 ──
    indexInitialize: (workspacePath: string) => invoke('index:initialize')(workspacePath),
    indexStart: (workspacePath: string) => invoke('index:start')(workspacePath),
    indexStatus: (workspacePath: string) => invoke('index:status')(workspacePath),
    indexHasIndex: (workspacePath: string) => invoke('index:hasIndex')(workspacePath),
    indexSearch: (workspacePath: string, query: string, topK?: number) =>
      invoke('index:search')(workspacePath, query, topK),
    indexHybridSearch: (workspacePath: string, query: string, topK?: number) =>
      invoke('index:hybridSearch')(workspacePath, query, topK),
    indexSearchSymbols: (workspacePath: string, query: string, topK?: number) =>
      invoke('index:searchSymbols')(workspacePath, query, topK),
    indexGetProjectSummary: (workspacePath: string) =>
      invoke('index:getProjectSummary')(workspacePath),
    indexGetProjectSummaryText: (workspacePath: string) =>
      invoke('index:getProjectSummaryText')(workspacePath),
    indexSetMode: (workspacePath: string, mode: 'structural' | 'semantic') =>
      invoke('index:setMode')(workspacePath, mode),
    indexUpdateFile: (workspacePath: string, filePath: string) =>
      invoke('index:updateFile')(workspacePath, filePath),
    indexClear: (workspacePath: string) => invoke('index:clear')(workspacePath),
    indexUpdateEmbeddingConfig: (workspacePath: string, config: EmbeddingConfigInput) =>
      invoke('index:updateEmbeddingConfig')(workspacePath, config),
    indexTestConnection: (workspacePath: string) => invoke('index:testConnection')(workspacePath),
    indexGetProviders: invoke('index:getProviders'),
    indexParseCallGraph: (filePath: string, content: string) =>
      invoke('index:parseCallGraph')(filePath, content),
    onIndexProgress: on<IndexStatusData>('index:progress'),

    // ── LSP 核心协议 ──
    lspStart: (workspacePath: string) => invoke('lsp:start')(workspacePath),
    lspStop: invoke('lsp:stop'),
    lspDidOpen: (params: unknown) => invoke('lsp:didOpen')(params),
    lspDidChange: (params: unknown) => invoke('lsp:didChange')(params),
    lspDidClose: (params: unknown) => invoke('lsp:didClose')(params),
    lspDidSave: (params: unknown) => invoke('lsp:didSave')(params),
    lspDefinition: (params: unknown) => invoke('lsp:definition')(params),
    lspTypeDefinition: (params: unknown) => invoke('lsp:typeDefinition')(params),
    lspImplementation: (params: unknown) => invoke('lsp:implementation')(params),
    lspReferences: (params: unknown) => invoke('lsp:references')(params),
    lspHover: (params: unknown) => invoke('lsp:hover')(params),
    lspCompletion: (params: unknown) => invoke('lsp:completion')(params),
    lspCompletionResolve: (item: unknown) => invoke('lsp:completionResolve')(item),
    lspSignatureHelp: (params: unknown) => invoke('lsp:signatureHelp')(params),
    lspRename: (params: unknown) => invoke('lsp:rename')(params),
    lspPrepareRename: (params: unknown) => invoke('lsp:prepareRename')(params),
    lspDocumentSymbol: (params: unknown) => invoke('lsp:documentSymbol')(params),
    lspWorkspaceSymbol: (params: unknown) => invoke('lsp:workspaceSymbol')(params),
    lspCodeAction: (params: unknown) => invoke('lsp:codeAction')(params),
    lspFormatting: (params: unknown) => invoke('lsp:formatting')(params),
    lspRangeFormatting: (params: unknown) => invoke('lsp:rangeFormatting')(params),
    lspDocumentHighlight: (params: unknown) => invoke('lsp:documentHighlight')(params),
    lspFoldingRange: (params: unknown) => invoke('lsp:foldingRange')(params),
    lspInlayHint: (params: unknown) => invoke('lsp:inlayHint')(params),
    getLspDiagnostics: (filePath: string) => invoke('lsp:getDiagnostics')(filePath),
    onLspDiagnostics: on<{ uri: string; diagnostics: unknown[] }>('lsp:diagnostics'),

    // ── LSP 扩展功能 ──
    lspPrepareCallHierarchy: (params: unknown) =>
      invoke('lsp:prepareCallHierarchy')(params),
    lspIncomingCalls: (params: unknown) => invoke('lsp:incomingCalls')(params),
    lspOutgoingCalls: (params: unknown) => invoke('lsp:outgoingCalls')(params),
    lspWaitForDiagnostics: (params: unknown) => invoke('lsp:waitForDiagnostics')(params),
    lspFindBestRoot: (params: unknown) => invoke('lsp:findBestRoot')(params),
    lspEnsureServerForFile: (params: unknown) => invoke('lsp:ensureServerForFile')(params),
    lspDidChangeWatchedFiles: (params: unknown) => invoke('lsp:didChangeWatchedFiles')(params),
    lspGetSupportedLanguages: invoke('lsp:getSupportedLanguages'),

    // ── LSP 服务器安装管理 ──
    lspGetServerStatus: invoke('lsp:getServerStatus'),
    lspGetBinDir: invoke('lsp:getBinDir'),
    lspGetDefaultBinDir: invoke('lsp:getDefaultBinDir'),
    lspSetCustomBinDir: (customPath: string | null) =>
      invoke('lsp:setCustomBinDir')(customPath),
    lspInstallServer: (serverType: string) => invoke('lsp:installServer')(serverType),
    lspInstallBasicServers: invoke('lsp:installBasicServers'),
  }
}
