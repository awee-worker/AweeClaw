import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'

const createMock = vi.fn()
const writeMock = vi.fn()
const resizeMock = vi.fn()
const killMock = vi.fn()
let dataHandler: ((event: { id: string; data: string; seq: number; occurredAt: number }) => void) | null = null
let exitHandler: ((event: { id: string; exitCode: number; signal?: number; seq: number; occurredAt: number; reason: 'process_exit' | 'killed_by_user' | 'remote_close' }) => void) | null = null

// TerminalAdapter 实际 import 的是 `@services/electronBridge`，
// 之前 mock 的 '@services/electronAPI' 模块不存在，mock 从未生效 ——
// 断言里的 create/write 一直是 0 次调用（真实调用走了 setup 的全局 mock）。
//
// 这里只替换 api.terminal，其余 api 保持真实实现：electronBridge 的其它命名空间
// （llm / system / deviceLink）在 store 初始化期就会被调用，整体替换会让它们变 undefined。
vi.mock('@services/electronBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@services/electronBridge')>()

  // 注意：真实模块导出的 `api` 是 Proxy（按需 getAPI()），对象展开只会得到空对象，
  // 所以不能 `{...actual.api}` —— 必须用同样的 Proxy 形态透传未覆盖的命名空间。
  let patchedTerminal: Record<string, unknown> | null = null
  const getPatchedTerminal = () => {
    if (!patchedTerminal) {
      patchedTerminal = {
        ...(actual.api as any).terminal,
        create: createMock,
        write: writeMock,
        resize: resizeMock,
        kill: killMock,
        onData: vi.fn((handler) => {
          dataHandler = handler
          return () => { dataHandler = null }
        }),
        onExit: vi.fn((handler) => {
          exitHandler = handler
          return () => { exitHandler = null }
        }),
        onError: vi.fn(() => {
          return () => {}
        }),
      }
    }
    return patchedTerminal
  }

  return {
    ...actual,
    api: new Proxy({} as typeof actual.api, {
      get(_target, prop) {
        if (prop === 'terminal') return getPatchedTerminal()
        return (actual.api as any)[prop]
      },
    }),
  }
})

vi.mock('@renderer/settings', () => ({
  getEditorConfig: () => ({
    performance: { terminalBufferSize: 1000 },
    terminal: {
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize: 14,
      lineHeight: 1.4,
      scrollback: 1000,
    },
  }),
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: class MockTerminal {
    options: Record<string, unknown> = {}
    write = vi.fn()
    focus = vi.fn()
    loadAddon = vi.fn()
    open = vi.fn()
    dispose = vi.fn()
    onData = vi.fn()
    attachCustomKeyEventHandler = vi.fn()
    getSelection = vi.fn(() => '')
    clear = vi.fn()
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn()
    dispose = vi.fn()
    proposeDimensions = vi.fn(() => ({ cols: 120, rows: 30 }))
  },
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class MockWebLinksAddon {},
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class MockWebglAddon {
    dispose = vi.fn()
    onContextLoss = vi.fn()
  },
}))

// LogEngine 是终端适配层唯一的日志入口；mock 必须覆盖所有命名空间，
// 否则 import 图里其它模块（SceneModeRegistry 等）写日志时会取到 undefined。
vi.mock('@toolkit/LogEngine', () => {
  const noop = () => {}
  const ns = () => ({ info: noop, warn: noop, error: noop, debug: noop, trace: noop })
  return {
    logger: {
      system: ns(),
      agent: ns(),
      security: ns(),
      mcp: ns(),
      perception: ns(),
      ui: ns(),
      renderer: ns(),
      main: ns(),
      plugin: ns(),
      utils: ns(),
    },
  }
})

vi.mock('@services/keybindingService', () => ({
  isMac: true,
}))

vi.mock('@intelligence/toolkit/commandRuntime', () => ({
  getInteractiveTerminalBackend: vi.fn(() => 'pipe'),
}))

describe('TerminalManager command sessions', () => {
  beforeEach(() => {
    vi.resetModules()
    createMock.mockReset()
    createMock.mockResolvedValue({ success: true })
    writeMock.mockReset()
    resizeMock.mockReset()
    killMock.mockReset()
    dataHandler = null
    exitHandler = null
    vi.useFakeTimers()
    vi.stubGlobal('crypto', { randomUUID: vi.fn(() => 'session-uuid') })
    vi.stubGlobal('navigator', { userAgent: 'Macintosh' })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('tracks detached background commands as last session state', async () => {
    const { terminalManager } = await import('@services/TerminalManager')

    try {
      const termId = await terminalManager.getOrCreateAgentTerminal('/tmp/aweeclaw-agent')
      const session = terminalManager.recordDetachedCommand(termId, 'npm run dev', '/tmp/aweeclaw-agent', 'agent')
      const state = terminalManager.getTerminalCommandState(termId)

      expect(session.status).toBe('detached')
      expect(state.current).toBeNull()
      expect(state.last?.status).toBe('detached')
      expect(state.last?.command).toBe('npm run dev')
    } finally {
      terminalManager.cleanup()
    }
  })

  it('finalizes command when terminal exits before sentinel matches', async () => {
    const { terminalManager } = await import('@services/TerminalManager')

    try {
      const termId = await terminalManager.getOrCreateAgentTerminal('/tmp/aweeclaw-agent')
      const resultPromise = terminalManager.executeCommandWithOutput(termId, 'npm test', 5000, '/tmp/aweeclaw-agent')

      expect(writeMock).toHaveBeenCalledTimes(1)
      dataHandler?.({ id: termId, data: 'partial output\n', seq: 1, occurredAt: Date.now() })
      exitHandler?.({ id: termId, exitCode: 7, seq: 2, occurredAt: Date.now(), reason: 'process_exit' })

      const result = await resultPromise
      const state = terminalManager.getTerminalCommandState(termId)

      expect(result.finalStatus).toBe('shell_exited')
      expect(result.exitCode).toBe(7)
      expect(result.success).toBe(false)
      expect(state.current).toBeNull()
      expect(state.last?.status).toBe('shell_exited')
      expect(state.last?.terminationReason).toBe('terminal_exit')
    } finally {
      terminalManager.cleanup()
    }
  })
})
