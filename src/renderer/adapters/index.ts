/**
 * 服务层统一导出
 * 按功能分组，便于按需导入
 */

// ===== 核心 API =====
export { api, getAPI, type GroupedElectronAPI } from './electronBridge'

// ===== 初始化 =====
export { initializeApp, registerSettingsSync, type InitResult } from './appInitializer'

// ===== 工作区管理 =====
export { workspaceManager } from './WorkspaceAdapter'
export { loadWorkspace } from './workspaceLoader'
export { resetWorkspaceRuntimeState } from './workspaceResetAdapter'
export { aweeclawDir } from './appDirService'
export { saveWorkspaceState, restoreWorkspaceState, scheduleStateSave, initWorkspaceStateSync } from './workspaceStateAdapter'
export { directoryCacheService } from './dirCacheAdapter'
export { ignoreService } from './ignoreRuleAdapter'

// ===== 编辑器相关 =====
export { completionService } from './codeCompletionAdapter'
export { pathLinkService } from './pathLinkAdapter'
export { getFileInfo, getLargeFileEditorOptions, getLargeFileWarning, isLargeFile, isVeryLargeFile } from './largeFileAdapter'
export type { LargeFileInfo, FileChunk } from './largeFileAdapter'

// ===== LSP 服务 =====
export {
  startLspServer,
  stopLspServer,
  didOpenDocument,
  didChangeDocument,
  goToDefinition,
  getHoverInfo,
  getCompletions,
  getSignatureHelp,
  getIncomingCalls,
  getOutgoingCalls,
  onDiagnostics,
  getDocumentSymbols,
} from './languageServerAdapter'
export { registerLspProviders } from './languageServerProviders'
export { initMonacoTypeService } from './monacoTypeAdapter'

// ===== 诊断 =====
export { useDiagnosticsStore, initDiagnosticsListener, getFileStats } from './diagnosticRepository'

// ===== 终端 =====
export { terminalManager } from './TerminalAdapter'

// ===== 快捷键 =====
export { keybindingService } from './keybindingAdapter'
export type { Command, Keybinding } from './keybindingAdapter'

// ===== MCP =====
export { mcpService } from './toolProtocolAdapter'

// ===== 其他 =====
export { slashCommandService } from './slashCommandAdapter'
export type { SlashCommand, SlashCommandResult } from './slashCommandAdapter'
export { checkProviderHealth, clearHealthCache } from './providerHealthAdapter'
export { indexWorkerService } from './indexWorkerAdapter'
export { snippetService } from './snippetAdapter'
export type { CodeSnippet, SnippetGroup } from './snippetAdapter'
export { workerService } from './workerAdapter'
