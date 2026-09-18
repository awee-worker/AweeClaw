import { EventEmitter } from 'events'
import * as fs from 'fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = new Map<string, Function>()
const childSpawnMock = vi.fn()

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
}))

vi.mock('electron', () => ({
  BrowserWindow: class MockBrowserWindow {},
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
  },
  app: {
    getPath: vi.fn((name: string) => {
      if (name === 'userData') return '/tmp/test-user-data'
      if (name === 'home') return '/tmp/test-home'
      return '/tmp/test-path'
    }),
    getVersion: vi.fn(() => '1.0.0'),
    isPackaged: false,
  },
}))

vi.mock('child_process', () => ({
  spawn: childSpawnMock,
  execSync: vi.fn(),
  execFile: vi.fn(),
}))

vi.mock('@shared/toolkit/Logger', () => ({
  logger: {
    security: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  },
}))

vi.mock('@shared/toolkit/errorHandler', () => ({
  toAppError: (err: unknown) => err instanceof Error ? err : new Error(String(err)),
}))

// 模块路径必须与 terminalSandbox 实际 import 的一致：
// 它用的是 '../bridge/core/ipcGuard'，之前 mock 的 '@bridge/safeHandle' 已不存在，
// 于是 safeIpcHandle 从未被替换，handlers 表始终为空 → 断言恒失败。
vi.mock('@bridge/core/ipcGuard', () => ({
  safeIpcHandle: vi.fn((channel: string, handler: Function) => {
    handlers.set(channel, handler)
  }),
}))

vi.mock('@guard/securityModule', () => ({
  OperationType: {
    TERMINAL_INTERACTIVE: 'terminal:interactive',
    SHELL_EXECUTE: 'shell:execute',
    GIT_EXEC: 'git:execute',
  },
  securityManager: {
    validateWorkspacePath: vi.fn(() => true),
    logOperation: vi.fn(),
    checkPermission: vi.fn(async () => true),
  },
}))

vi.mock('@guard/terminalInput', () => ({
  normalizePipeTerminalInput: vi.fn((input: string) => input),
}))

vi.mock('@shared/constants', () => ({
  SECURITY_DEFAULTS: {
    SHELL_COMMANDS: [
      'npm', 'yarn', 'pnpm', 'bun', 'node', 'npx', 'deno', 'git',
      'python', 'python3', 'pip', 'pip3', 'uv',
      'pwd', 'ls', 'cat', 'echo', 'mkdir', 'rm', 'mv', 'cp',
    ],
    GIT_SUBCOMMANDS: [
      'status', 'log', 'diff', 'show', 'add', 'commit', 'push', 'pull',
      'branch', 'checkout', 'merge', 'rebase', 'clone', 'init', 'stash', 'tag',
    ],
  },
}))

vi.mock('@modules/python-runtime', () => ({
  pythonManager: {
    getExecutable: vi.fn(() => 'python3'),
    isReady: vi.fn(() => true),
    status: {
      installed: true,
      venvDir: '/tmp/test-venv',
      version: '3.11.0',
    },
  },
}))

describe('secureTerminal', () => {
  beforeEach(() => {
    handlers.clear()
    childSpawnMock.mockReset()
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
  })

  afterEach(async () => {
    const module = await import('@guard/secureTerminal')
    module.cleanupTerminals()
    vi.restoreAllMocks()
  })

  it('uses pipe on macOS when backend is pipe', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const workspaceRoot = process.cwd()

    const stdout = new EventEmitter()
    const stderr = new EventEmitter()
    const stdin = { destroyed: false, write: vi.fn() }
    const child = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter
      stderr: EventEmitter
      stdin: typeof stdin
      killed: boolean
      pid?: number
      kill: ReturnType<typeof vi.fn>
    }
    child.stdout = stdout
    child.stderr = stderr
    child.stdin = stdin
    child.killed = false
    child.pid = 12345
    child.kill = vi.fn(() => {
      child.killed = true
      return true
    })

    childSpawnMock.mockReturnValue(child)

    const module = await import('@guard/secureTerminal')
    module.registerSecureTerminalHandlers(
      () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any,
      () => ({ roots: [workspaceRoot] }),
    )

    const handler = handlers.get('terminal:interactive')
    expect(handler).toBeTypeOf('function')

    const result = await handler?.({}, {
      id: 'agent-test',
      cwd: workspaceRoot,
      shell: 'bash',
      backend: 'pipe',
    })

    expect(result).toEqual({ success: true })
    expect(childSpawnMock).toHaveBeenCalledTimes(1)
  })
})

