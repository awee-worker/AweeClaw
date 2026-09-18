/**
 * Vitest 测试环境设置
 * 为所有测试提供全局 mock 和配置
 */

import { vi, beforeEach } from 'vitest'
import { installFakeIndexedDB, resetFakeIndexedDB } from './helpers/fakeIndexedDB'

declare global {
  var mainWindow: any
}

// Mock browser globals for xterm and other browser-only packages
if (typeof (globalThis as any).self === 'undefined') {
  ;(globalThis as any).self = globalThis
}
if (typeof (globalThis as any).window === 'undefined') {
  ;(globalThis as any).window = globalThis
}

/* ------------------------------------------------------------------ */
/* 浏览器 API 兜底（environment 是 node，没有 DOM）                    */
/* ------------------------------------------------------------------ */

/** 内存版 Storage，行为对齐 localStorage/sessionStorage 的常用子集 */
function createMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value))
    },
    removeItem: (key: string) => {
      map.delete(key)
    },
    clear: () => {
      map.clear()
    },
  } as Storage
}

/**
 * OfflineModeService 等模块在 import 期就会读 navigator.onLine / 注册 window 事件，
 * 缺失时整个模块图加载失败（表现为一批测试文件 "Failed Suites"）。
 */
function ensureNavigatorOnline(): void {
  const g = globalThis as any
  try {
    if (g.navigator && typeof g.navigator === 'object') {
      g.navigator.onLine = true
      return
    }
  } catch {
    /* 只读属性，走下面的 defineProperty 兜底 */
  }
  try {
    Object.defineProperty(g, 'navigator', {
      value: { onLine: true, userAgent: 'vitest', language: 'zh-CN' },
      writable: true,
      configurable: true,
    })
  } catch {
    /* 无法覆盖则忽略：相关断言会给出更明确的失败信息 */
  }
}

/** CustomEvent / Event 兜底：authSlice 等模块会构造 CustomEvent 派发跨模块消息 */
function ensureEventConstructors(): void {
  const g = globalThis as any
  if (typeof g.CustomEvent !== 'function') {
    g.CustomEvent = class CustomEvent {
      type: string
      detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    }
  }
  if (typeof g.Event !== 'function') {
    g.Event = class Event {
      type: string
      constructor(type: string) {
        this.type = type
      }
    }
  }
}

/** 恢复被 node 环境缺失的 performance 子集（不覆盖已有实现） */
function ensurePerformanceApi(): void {
  const g = globalThis as any
  if (!g.performance || typeof g.performance.now !== 'function') {
    g.performance = { now: () => Date.now() } as any
  }
  const perf = g.performance
  // undici（Node 内置 fetch）在响应结束时调用，缺失会抛 uncaught exception，
  // 导致 vitest 退出码为 1 —— 断言其实全过。
  if (typeof perf.markResourceTiming !== 'function') perf.markResourceTiming = () => {}
  if (typeof perf.mark !== 'function') perf.mark = () => {}
  if (typeof perf.measure !== 'function') perf.measure = () => {}
  if (typeof perf.getEntriesByName !== 'function') perf.getEntriesByName = () => []
  if (typeof perf.clearMarks !== 'function') perf.clearMarks = () => {}
  if (typeof perf.clearMeasures !== 'function') perf.clearMeasures = () => {}
}

const mockLocalStorage = createMemoryStorage()
const mockSessionStorage = createMemoryStorage()

ensureNavigatorOnline()
ensurePerformanceApi()
ensureEventConstructors()
installFakeIndexedDB()

// 这些全局都是进程级共享的，每个用例前清空，避免用例之间互相污染
;(globalThis as any).localStorage = mockLocalStorage
;(globalThis as any).sessionStorage = mockSessionStorage

beforeEach(() => {
  resetFakeIndexedDB()
  mockLocalStorage.clear()
  mockSessionStorage.clear()
})

// Mock xterm modules that require browser environment
vi.mock('@xterm/xterm', () => ({
  Terminal: class Terminal {
    open() {}
    write() {}
    writeln() {}
    resize() {}
    dispose() {}
    onData() { return { dispose() {} } }
    onResize() { return { dispose() {} } }
    onKey() { return { dispose() {} } }
    onCursorMove() { return { dispose() {} } }
    registerLinkProvider() { return { dispose() {} } }
    registerDecoration() { return { dispose() {} } }
    buffer = { active: { lines: [], length: 0, cursorX: 0, cursorY: 0 } }
    cols = 80
    rows = 24
    element = null
  },
}))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class FitAddon {
    fit() {}
    proposeDimensions() { return { cols: 80, rows: 24 } }
    activate() {}
    dispose() {}
  },
}))
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class WebLinksAddon {
    activate() {}
    dispose() {}
  },
}))
vi.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: class CanvasAddon {
    activate() {}
    dispose() {}
  },
}))

// Mock window.electronAPI
const mockElectronAPI = {
  file: {
    read: vi.fn(),
    write: vi.fn(),
    exists: vi.fn(),
    readDir: vi.fn(),
    delete: vi.fn(),
    rename: vi.fn(),
    copy: vi.fn(),
    createDir: vi.fn(),
  },
  llm: {
    send: vi.fn(),
    compactContext: vi.fn(),
  },
  workspace: {
    setActive: vi.fn(),
    getRecent: vi.fn(),
    removeFromRecent: vi.fn(),
  },
  window: {
    close: vi.fn(),
    resize: vi.fn(),
    minimize: vi.fn(),
    maximize: vi.fn(),
  },
  mcp: {
    initialize: vi.fn(),
    getServersState: vi.fn(),
    connectServer: vi.fn(),
    disconnectServer: vi.fn(),
    reconnectServer: vi.fn(),
    callTool: vi.fn(),
    readResource: vi.fn(),
    getPrompt: vi.fn(),
    refreshCapabilities: vi.fn(),
    getConfigPaths: vi.fn(),
    reloadConfig: vi.fn(),
    addServer: vi.fn(),
    removeServer: vi.fn(),
    toggleServer: vi.fn(),
    startOAuth: vi.fn(),
    finishOAuth: vi.fn(),
    refreshOAuthToken: vi.fn(),
    onServerStatus: vi.fn(() => vi.fn()),
    onToolsUpdated: vi.fn(() => vi.fn()),
    onResourcesUpdated: vi.fn(() => vi.fn()),
    onStateChanged: vi.fn(() => vi.fn()),
    onMcpServerStatus: vi.fn(() => vi.fn()),
    onMcpToolsUpdated: vi.fn(() => vi.fn()),
    onMcpResourcesUpdated: vi.fn(() => vi.fn()),
  },
  index: {
    hybridSearch: vi.fn(),
    getIndexStatus: vi.fn(),
    rebuildIndex: vi.fn(),
  },
  settings: {
    get: vi.fn(),
    set: vi.fn(),
    onChanged: vi.fn(() => vi.fn()),
  },
  terminal: {
    create: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: vi.fn(() => vi.fn()),
    onExit: vi.fn(() => vi.fn()),
  },
  lsp: {
    request: vi.fn(),
    onDiagnostics: vi.fn(() => vi.fn()),
    getDiagnostics: vi.fn(),
    hover: vi.fn(),
    completion: vi.fn(),
    signatureHelp: vi.fn(),
    definition: vi.fn(),
    references: vi.fn(),
    codeAction: vi.fn(),
    format: vi.fn(),
    formatRange: vi.fn(),
    documentSymbol: vi.fn(),
    prepareRename: vi.fn(),
    rename: vi.fn(),
    typeDefinition: vi.fn(),
    implementation: vi.fn(),
    inlayHint: vi.fn(),
    prepareCallHierarchy: vi.fn(),
    callHierarchyIncoming: vi.fn(),
    callHierarchyOutgoing: vi.fn(),
    onLspDiagnostics: vi.fn(() => vi.fn()),
    getLspDiagnostics: vi.fn(),
  },
  git: {
    status: vi.fn(),
    diff: vi.fn(),
    log: vi.fn(),
    commit: vi.fn(),
    push: vi.fn(),
    pull: vi.fn(),
  },
  system: {
    onResume: vi.fn(() => vi.fn()),
    onSuspend: vi.fn(() => vi.fn()),
  },
  debug: {
    startSession: vi.fn(),
    stopSession: vi.fn(),
    stepOver: vi.fn(),
    stepInto: vi.fn(),
    stepOut: vi.fn(),
    continue: vi.fn(),
    getThreads: vi.fn(),
    getStackTrace: vi.fn(),
    getVariables: vi.fn(),
    evaluate: vi.fn(),
    onSessionEvent: vi.fn(() => vi.fn()),
  },
  clipboard: {
    readText: vi.fn(),
    writeText: vi.fn(),
  },
  dialog: {
    openFile: vi.fn(),
    saveFile: vi.fn(),
    openFolder: vi.fn(),
    showMessageBox: vi.fn(),
  },
  shell: {
    openExternal: vi.fn(),
    openPath: vi.fn(),
  },
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPlatform: vi.fn(() => 'darwin'),
    quit: vi.fn(),
    relaunch: vi.fn(),
  },
  notification: {
    show: vi.fn(),
    onClick: vi.fn(() => vi.fn()),
  },
  autoUpdater: {
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    onUpdateAvailable: vi.fn(() => vi.fn()),
    onUpdateDownloaded: vi.fn(() => vi.fn()),
    onError: vi.fn(() => vi.fn()),
  },
}

/**
 * 渲染层里的 `window` 就是 `globalThis`，所以 preload 暴露的 electronAPI 两种写法
 * （`window.electronAPI` / `globalThis.electronAPI`）在生产环境是同一个对象。
 * node 环境下二者是两个对象，若只挂 window，读 globalThis 的适配层（如 mcpService）
 * 会拿到 undefined。这里把别名补上，保持与运行时一致。
 */
function aliasElectronAPI(): void {
  const api = (globalThis as any).window?.electronAPI
  if (api) (globalThis as any).electronAPI = api
}

// 设置全局 window 对象
// 注意：environment 是 node，这里必须补齐 DOM 常用子集。
// 之前只挂了 electronAPI，导致 `typeof window !== 'undefined'` 后调用
// window.addEventListener 的模块（OfflineModeService 等）在 import 期直接崩掉，
// 牵连一整批测试文件 "Failed Suites"。
const windowMock: any = {
  electronAPI: mockElectronAPI,
  localStorage: mockLocalStorage,
  sessionStorage: mockSessionStorage,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(() => true),
  matchMedia: vi.fn(() => ({
    matches: false,
    media: '',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    onchange: null,
    dispatchEvent: vi.fn(() => true),
  })),
  location: {
    href: 'http://localhost:3000',
    origin: 'http://localhost:3000',
    protocol: 'http:',
    host: 'localhost:3000',
    pathname: '/',
    search: '',
    hash: '',
  },
  navigator: { onLine: true, userAgent: 'vitest', language: 'zh-CN' },
  // authSlice 在模块加载期注册 visibilitychange，缺 document 会让整个 store 初始化失败
  document: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(() => true),
    visibilityState: 'visible',
    hidden: false,
    cookie: '',
    createElement: vi.fn(() => ({ style: {}, setAttribute: vi.fn(), appendChild: vi.fn() })),
    querySelector: vi.fn(() => null),
    querySelectorAll: vi.fn(() => []),
    body: { appendChild: vi.fn(), removeChild: vi.fn(), style: {} },
  },
}
global.window = windowMock as any
// 渲染层里 document/location 等价于全局对象（window === globalThis），
// node 环境下必须显式挂到 globalThis，否则裸用 document 的模块会 ReferenceError
;(globalThis as any).document = windowMock.document
;(globalThis as any).location = windowMock.location

  // Mock the raw electronAPI that's accessed by the wrapper
  ; (global.window as any).electronAPI = {
    ...mockElectronAPI,
    // Add raw function names that are wrapped
    mcpInitialize: vi.fn(),
    mcpGetServersState: vi.fn(),
    mcpGetAllTools: vi.fn(),
    mcpConnectServer: vi.fn(),
    mcpDisconnectServer: vi.fn(),
    mcpReconnectServer: vi.fn(),
    mcpCallTool: vi.fn(),
    mcpReadResource: vi.fn(),
    mcpGetPrompt: vi.fn(),
    mcpRefreshCapabilities: vi.fn(),
    mcpGetConfigPaths: vi.fn(),
    mcpReloadConfig: vi.fn(),
    mcpAddServer: vi.fn(),
    mcpRemoveServer: vi.fn(),
    mcpToggleServer: vi.fn(),
    mcpStartOAuth: vi.fn(),
    mcpFinishOAuth: vi.fn(),
    mcpRefreshOAuthToken: vi.fn(),
    onMcpServerStatus: vi.fn(() => vi.fn()),
    onMcpToolsUpdated: vi.fn(() => vi.fn()),
    onMcpResourcesUpdated: vi.fn(() => vi.fn()),
    onMcpStateChanged: vi.fn(() => vi.fn()),
    onLspDiagnostics: vi.fn(() => vi.fn()),
    getLspDiagnostics: vi.fn(),
    // File operations
    fileExists: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    saveFile: vi.fn(),
    mkdir: vi.fn(),
    // System events
    onSystemResume: vi.fn(() => vi.fn()),
    onSystemSuspend: vi.fn(() => vi.fn()),
    // 设备联动：authSlice 在模块加载期就会订阅设备任务事件
    deviceLink: {
      pushCredentials: vi.fn(),
      clearCredentials: vi.fn(async () => true),
      setPreferences: vi.fn(),
      getStatus: vi.fn(),
      getDeviceId: vi.fn(() => 'test-device'),
      onTaskTransfer: vi.fn(() => vi.fn()),
      onAiTask: vi.fn(() => vi.fn()),
      onRunScenario: vi.fn(() => vi.fn()),
      replyResult: vi.fn(),
      pushSceneMode: vi.fn(),
      onSceneModeSync: vi.fn(() => vi.fn()),
    },
    // App operations
    appReady: vi.fn(),
    getAppVersion: vi.fn(() => '1.0.0'),
    minimize: vi.fn(),
    maximize: vi.fn(),
    close: vi.fn(),
    toggleDevTools: vi.fn(),
    getWindowId: vi.fn(() => 1),
    isPrimaryWindow: vi.fn(() => true),
    onPrimaryChanged: vi.fn(() => vi.fn()),
    resizeWindow: vi.fn(),
    setTheme: vi.fn(),
    // File dialog operations
    openFile: vi.fn(),
    openKnowledgeFiles: vi.fn(),
    readKnowledgeFile: vi.fn(),
    extractKnowledgeDocxText: vi.fn(),
    extractKnowledgeDocText: vi.fn(),
    extractKnowledgeXlsxText: vi.fn(),
    extractKnowledgePptText: vi.fn(),
    extractKnowledgePdfText: vi.fn(),
    openFolder: vi.fn(),
    selectFolder: vi.fn(),
    selectForImport: vi.fn(),
    selectForExport: vi.fn(),
    importIntoWorkspace: vi.fn(),
    exportFromWorkspace: vi.fn(),
    shareItem: vi.fn(),
    readDir: vi.fn(),
    getFileTree: vi.fn(),
    readBinaryFile: vi.fn(),
    extractDocText: vi.fn(),
    extractPptText: vi.fn(),
    extractDocxText: vi.fn(),
    extractXlsxText: vi.fn(),
    extractPdfText: vi.fn(),
    writeBinaryFile: vi.fn(),
    ensureDir: vi.fn(),
    deleteFile: vi.fn(),
    copyFile: vi.fn(),
    renameFile: vi.fn(),
    showItemInFolder: vi.fn(),
    openInBrowser: vi.fn(),
    openExternalUrl: vi.fn(),
    searchFiles: vi.fn(),
    searchStream: vi.fn(),
    onSearchResults: vi.fn(() => vi.fn()),
    onSearchDone: vi.fn(() => vi.fn()),
    onFileChanged: vi.fn(() => vi.fn()),
    // Workspace
    openWorkspace: vi.fn(),
    addFolderToWorkspace: vi.fn(),
    saveWorkspace: vi.fn(),
    restoreWorkspace: vi.fn(),
    setActiveWorkspace: vi.fn(),
    getRecentWorkspaces: vi.fn(() => []),
    workspaceExists: vi.fn(),
    clearRecentWorkspaces: vi.fn(),
    removeFromRecentWorkspaces: vi.fn(),
    // Settings
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    getConfigPath: vi.fn(),
    setConfigPath: vi.fn(),
    getWhitelist: vi.fn(),
    resetWhitelist: vi.fn(),
    getUserDataPath: vi.fn(),
    getAppDataRoots: vi.fn(() => []),
    getRecentLogs: vi.fn(() => []),
    onSettingsChanged: vi.fn(() => vi.fn()),
    // LLM
    sendMessage: vi.fn(),
    compactContext: vi.fn(),
    abortMessage: vi.fn(),
    onLLMStream: vi.fn(() => vi.fn()),
    onLLMError: vi.fn(() => vi.fn()),
    onLLMDone: vi.fn(() => vi.fn()),
    // authSlice 在模块加载期就会注册这两个监听，缺失会让整个 store 初始化失败
    // （表现是一批测试文件的 Failed Suites）
    onCloudTokenRefreshed: vi.fn(() => vi.fn()),
    onCloudAuthFailed: vi.fn(() => vi.fn()),
    analyzeCode: vi.fn(),
    analyzeCodeStream: vi.fn(),
    suggestRefactoring: vi.fn(),
    suggestFixes: vi.fn(),
    generateTests: vi.fn(),
    generateObject: vi.fn(),
    embedText: vi.fn(),
    embedMany: vi.fn(),
    findSimilar: vi.fn(),
    // Terminal
    createTerminal: vi.fn(),
    writeTerminal: vi.fn(),
    resizeTerminal: vi.fn(),
    killTerminal: vi.fn(),
    getAvailableShells: vi.fn(() => []),
    onTerminalData: vi.fn(() => vi.fn()),
    onTerminalExit: vi.fn(() => vi.fn()),
    onTerminalError: vi.fn(() => vi.fn()),
    // Remote shell
    remoteShellList: vi.fn(),
    remoteShellReadText: vi.fn(),
    remoteShellWriteText: vi.fn(),
    remoteShellMkdir: vi.fn(),
    remoteShellRename: vi.fn(),
    remoteShellDelete: vi.fn(),
    remoteShellUpload: vi.fn(),
    remoteShellDownload: vi.fn(),
    // Index
    hybridSearch: vi.fn(),
    getIndexStatus: vi.fn(),
    rebuildIndex: vi.fn(),
    // Git
    gitStatus: vi.fn(),
    gitDiff: vi.fn(),
    gitLog: vi.fn(),
    gitCommit: vi.fn(),
    gitPush: vi.fn(),
    gitPull: vi.fn(),
    gitInit: vi.fn(),
    gitAdd: vi.fn(),
    gitCheckout: vi.fn(),
    gitBranch: vi.fn(),
    gitStash: vi.fn(),
    gitMerge: vi.fn(),
    gitRebase: vi.fn(),
    gitRemote: vi.fn(),
    onGitStatusChanged: vi.fn(() => vi.fn()),
    onGitIndexChanged: vi.fn(() => vi.fn()),
    // Debug
    startDebugSession: vi.fn(),
    stopDebugSession: vi.fn(),
    debugStepOver: vi.fn(),
    debugStepInto: vi.fn(),
    debugStepOut: vi.fn(),
    debugContinue: vi.fn(),
    getDebugThreads: vi.fn(),
    getDebugStackTrace: vi.fn(),
    getDebugVariables: vi.fn(),
    debugEvaluate: vi.fn(),
    onDebugSessionEvent: vi.fn(() => vi.fn()),
    // Clipboard
    clipboardReadText: vi.fn(),
    clipboardWriteText: vi.fn(),
    // Dialog
    dialogOpenFile: vi.fn(),
    dialogSaveFile: vi.fn(),
    dialogOpenFolder: vi.fn(),
    showMessageBox: vi.fn(),
    // Shell
    shellOpenExternal: vi.fn(),
    shellOpenPath: vi.fn(),
  }

// 让 globalThis.electronAPI 与 window.electronAPI 指向同一对象（对齐渲染层语义）
aliasElectronAPI()

// performance API：由 ensurePerformanceApi() 补齐（勿整体覆盖，
// 覆盖掉 markResourceTiming 会让 undici 在每次 fetch 结束时抛 uncaught exception）

// Mock crypto.randomUUID if not available
if (!global.crypto?.randomUUID) {
  Object.defineProperty(global, 'crypto', {
    value: {
      randomUUID: () => Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15),
    },
    writable: true,
    configurable: true,
  })
}

// Mock mainWindow for monaco-editor
global.mainWindow = {
  location: {
    href: 'http://localhost:3000',
  },
} as any

// Mock monaco-editor module
vi.mock('monaco-editor', () => {
  return {
    editor: {
      create: vi.fn(),
      createModel: vi.fn(),
      setTheme: vi.fn(),
      defineTheme: vi.fn(),
    },
    languages: {
      typescript: {
        typescriptDefaults: {
          setCompilerOptions: vi.fn(),
          addExtraLib: vi.fn(),
        },
        javascriptDefaults: {
          setCompilerOptions: vi.fn(),
          addExtraLib: vi.fn(),
        },
      },
    },
    Uri: { parse: vi.fn(), file: vi.fn() },
    Emitter: class { event = vi.fn(); fire = vi.fn(); dispose = vi.fn() },
    KeyMod: { CtrlCmd: 2048, Shift: 1024, Alt: 512 },
    KeyCode: { KeyS: 39, KeyZ: 44 },
    Range: class { constructor(public s: number, public sc: number, public e: number, public ec: number) {} },
    Selection: class { constructor(public s: number, public sc: number, public e: number, public ec: number) {} },
    MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
    MarkerTag: { Unnecessary: 1, Deprecated: 2 },
  }
})

// Mock monacoTypeService
vi.mock('@renderer/services/monacoTypeService', () => ({
  clearExtraLibs: vi.fn(),
  addExtraLib: vi.fn(),
}))

// Mock monaco-editor sub-path imports
vi.mock('monaco-editor/esm/vs/editor/editor.api', () => ({
  editor: { create: vi.fn(), createModel: vi.fn(), setTheme: vi.fn(), defineTheme: vi.fn() },
  languages: { typescript: { typescriptDefaults: { setCompilerOptions: vi.fn(), addExtraLib: vi.fn() } } },
  Uri: { parse: vi.fn(), file: vi.fn() },
}))

vi.mock('monaco-editor/esm/vs/language/typescript/monaco.contribution', () => ({
  typescriptDefaults: { setCompilerOptions: vi.fn(), addExtraLib: vi.fn() },
  javascriptDefaults: { setCompilerOptions: vi.fn(), addExtraLib: vi.fn() },
}))

vi.mock('monaco-editor/esm/vs/base/browser/ui/aria/aria', () => ({}))
vi.mock('monaco-editor/esm/vs/editor/browser/coreCommands', () => ({}))
vi.mock('monaco-editor/esm/vs/base/browser/dom', () => ({
  addDisposableListener: vi.fn(() => ({ dispose: vi.fn() })),
  getComputedStyle: vi.fn(() => ({})),
  Dimension: class { constructor(public width: number, public height: number) {} },
}))

// Mock services that depend on monaco
vi.mock('@services/monacoTypeService', () => ({
  clearExtraLibs: vi.fn(),
  addExtraLib: vi.fn(),
  getMonacoInstance: vi.fn(() => null),
}))

vi.mock('@services/pathLinkService', () => ({
  pathLinkService: { register: vi.fn(), dispose: vi.fn() },
}))

vi.mock('@services/lspProviders', () => ({
  registerLspProviders: vi.fn(),
}))

vi.mock('@services/snippetService', () => ({
  snippetService: { register: vi.fn(), dispose: vi.fn() },
}))

// 导出 mock 以便测试中使用
export { mockElectronAPI }
