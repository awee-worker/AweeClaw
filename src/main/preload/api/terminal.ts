/**
 * 终端 / Shell / 远程会话 / Git API
 *
 * 覆盖 IPC 频道：
 * - terminal:*  交互式终端（pty/pipe）
 * - shell:*     一次性命令执行 / 后台进程
 * - remote:*    远程 SSH 文件操作
 * - git:*       Git 安全执行
 */
import { invoke, send, on } from '../ipcHelpers'
import type { RemoteShellServer } from '../types'

export function createTerminalApi() {
  return {
    // ── 交互式终端 ──
    createTerminal: (options: {
      id: string
      cwd?: string
      shell?: string
      backend?: 'pty' | 'pipe'
      remote?: RemoteShellServer
    }) => invoke('terminal:interactive')(options),
    writeTerminal: (id: string, data: string) => invoke('terminal:input')({ id, data }),
    resizeTerminal: (id: string, cols: number, rows: number) =>
      invoke('terminal:resize')({ id, cols, rows }),
    killTerminal: (id?: string) => send('terminal:kill')(id),
    getAvailableShells: invoke<string[]>('shell:getAvailableShells'),

    // ── 后台命令执行 ──
    executeBackground: (params: {
      command: string
      cwd?: string
      timeout?: number
      shell?: string
    }) => invoke('shell:executeBackground')(params),
    onShellOutput: on<{
      command: string
      type: 'stdout' | 'stderr'
      data: string
      timestamp: number
    }>('shell:output'),

    // ── 终端事件推送 ──
    onTerminalData: on<{
      id: string
      data: string
      seq: number
      occurredAt: number
    }>('terminal:data'),
    onTerminalExit: on<{
      id: string
      exitCode: number
      signal?: number
      seq: number
      occurredAt: number
      reason: 'process_exit' | 'killed_by_user' | 'remote_close'
    }>('terminal:exit'),
    onTerminalError: on<{
      id: string
      error: string
      seq: number
      occurredAt: number
      fatal?: boolean
      reason: 'process_error' | 'spawn_error' | 'unknown'
    }>('terminal:error'),

    // ── 远程 SSH 文件操作 ──
    remoteShellList: (server: RemoteShellServer, remotePath?: string) =>
      invoke('remote:list')(server, remotePath),
    remoteShellReadText: (server: RemoteShellServer, remotePath: string) =>
      invoke('remote:readText')(server, remotePath),
    remoteShellWriteText: (server: RemoteShellServer, remotePath: string, content: string) =>
      invoke('remote:writeText')(server, remotePath, content),
    remoteShellMkdir: (server: RemoteShellServer, remotePath: string) =>
      invoke('remote:mkdir')(server, remotePath),
    remoteShellRename: (server: RemoteShellServer, oldPath: string, newPath: string) =>
      invoke('remote:rename')(server, oldPath, newPath),
    remoteShellDelete: (server: RemoteShellServer, remotePath: string) =>
      invoke('remote:delete')(server, remotePath),
    remoteShellTestConnection: (server: RemoteShellServer) =>
      invoke('remote:testConnection')(server),
    remoteShellUpload: (server: RemoteShellServer, remoteDirectory: string) =>
      invoke('remote:upload')(server, remoteDirectory),
    remoteShellDownload: (server: RemoteShellServer, remotePath: string) =>
      invoke('remote:download')(server, remotePath),
    remoteShellConnectionStatus: (server: RemoteShellServer) =>
      invoke('remote:connectionStatus')(server),

    // ── 安全命令执行 ──
    executeSecureCommand: (request: {
      command: string
      args?: string[]
      cwd?: string
      timeout?: number
      requireConfirm?: boolean
    }) => invoke('shell:executeSecure')(request),

    // ── Git ──
    gitExecSecure: (args: string[], cwd: string) => invoke('git:execSecure')(args, cwd),
  }
}
