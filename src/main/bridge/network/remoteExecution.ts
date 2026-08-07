/**
 * 远程执行桥接 — SSH / SFTP 远程操作的 IPC 处理器
 *
 * 职责：
 * - 暴露 SSH 连接管理、远程命令执行、SFTP 文件传输等 IPC 接口
 * - 支持基于 ssh2 的密钥 / 密码认证
 * - 提供远程文件浏览、上传、下载能力
 */

import { BrowserWindow, dialog } from 'electron'
import { safeIpcHandle } from '../core/ipcGuard'
import fs from 'fs'
import path from 'path'
import { pipeline } from 'stream/promises'
import type { Client as Ssh2Client, ConnectConfig, FileEntry, SFTPWrapper, Stats } from 'ssh2'
import { logger } from '@shared/toolkit/LogEngine'

interface SshEndpoint {
  host: string
  port?: number
  username?: string
  password?: string
  privateKeyPath?: string
  remotePath?: string
}

interface RemoteNode {
  name: string
  path: string
  isDirectory: boolean
  size: number
  modifyTime?: number
}

interface TransferUploadOutcome {
  canceled: boolean
  uploaded: string[]
}

interface TransferDownloadOutcome {
  canceled: boolean
  localPath?: string
}

interface ConnectionHealth {
  connected: boolean
  latencyMs?: number
  error?: string
}

let cachedSshClient: typeof Ssh2Client | null = null
const activeConnections = new Map<string, { client: any; lastUsed: number }>()
const CONNECTION_IDLE_TIMEOUT_MS = 5 * 60 * 1000

function loadSshClient(): typeof Ssh2Client {
  if (cachedSshClient) return cachedSshClient

  try {
    const cpuFeaturesPath = require.resolve('cpu-features')
    require.cache[cpuFeaturesPath] = {
      id: cpuFeaturesPath,
      filename: cpuFeaturesPath,
      loaded: true,
      exports: () => null,
      children: [],
      paths: [],
    } as unknown as NodeJS.Module
  } catch { /* cpu-features optional */ }

  const ssh2 = require('ssh2') as { Client: typeof Ssh2Client }
  cachedSshClient = ssh2.Client
  return cachedSshClient
}

function sanitizeRemotePath(target?: string): string {
  const raw = (target || '.').trim()
  if (!raw || raw === '/') return '/'
  if (raw === '.') return '.'
  return path.posix.normalize(raw) || '.'
}

function combineRemotePath(base: string, segment: string): string {
  if (!base || base === '.') return sanitizeRemotePath(segment)
  if (base === '/') return path.posix.join('/', segment)
  return path.posix.join(base, segment)
}

function checkIsDirectory(attrs: { mode?: number; isDirectory?: (() => boolean) | boolean } | undefined): boolean {
  if (!attrs) return false
  if (typeof attrs.isDirectory === 'function') return attrs.isDirectory()
  if (typeof attrs.isDirectory === 'boolean') return attrs.isDirectory
  return ((attrs.mode || 0) & 0o170000) === 0o040000
}

function buildSshConfig(endpoint: SshEndpoint): ConnectConfig {
  const config: ConnectConfig = {
    host: endpoint.host.trim(),
    port: endpoint.port && endpoint.port > 0 ? endpoint.port : 22,
    username: endpoint.username?.trim() || 'root',
    readyTimeout: 15000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 3,
    tryKeyboard: Boolean(endpoint.password),
    algorithms: {
      kex: [
        'ecdh-sha2-nistp256',
        'ecdh-sha2-nistp384',
        'ecdh-sha2-nistp521',
        'diffie-hellman-group-exchange-sha256',
        'diffie-hellman-group14-sha256',
        'diffie-hellman-group14-sha1',
      ],
    },
  }

  if (endpoint.privateKeyPath?.trim()) {
    try {
      config.privateKey = fs.readFileSync(endpoint.privateKeyPath.trim(), 'utf8')
    } catch (err) {
      logger.ipc.error('[RemoteExecution] Failed to read private key:', err)
    }
  }

  if (endpoint.password?.trim()) {
    config.password = endpoint.password
  }

  return config
}

function getEndpointKey(endpoint: SshEndpoint): string {
  return `${endpoint.username || 'root'}@${endpoint.host.trim()}:${endpoint.port || 22}`
}

async function withSftpSession<T>(endpoint: SshEndpoint, handler: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
  const Client = loadSshClient()
  const connection = new Client()
  const endpointKey = getEndpointKey(endpoint)

  return await new Promise<T>((resolve, reject) => {
    let settled = false

    const finalize = (error: unknown, result?: T) => {
      if (settled) return
      settled = true
      connection.end()
      activeConnections.delete(endpointKey)
      if (error) reject(error)
      else resolve(result as T)
    }

    connection
      .on('ready', () => {
        logger.ipc.info(`[RemoteExecution] Connected to ${endpointKey}`)
        activeConnections.set(endpointKey, { client: connection, lastUsed: Date.now() })

        connection.sftp(async (err: Error | undefined, sftp: SFTPWrapper | undefined) => {
          if (err || !sftp) {
            finalize(err || new Error('SFTP session initialization failed'))
            return
          }
          try {
            const result = await handler(sftp)
            finalize(null, result)
          } catch (handlerError) {
            finalize(handlerError)
          }
        })
      })
      .on('keyboard-interactive', (_name: string, _instructions: string, _lang: string, _prompts: Array<unknown>, finish: (responses: string[]) => void) => {
        finish([endpoint.password || ''])
      })
      .on('error', (err) => {
        logger.ipc.error(`[RemoteExecution] Connection error for ${endpointKey}:`, err.message)
        finalize(err)
      })
      .connect(buildSshConfig(endpoint))
  })
}

function sftpReaddir(sftp: SFTPWrapper, remotePath: string): Promise<FileEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remotePath, (err: Error | undefined, list: FileEntry[] | undefined) => {
      if (err) reject(err)
      else resolve(list || [])
    })
  })
}

function sftpStat(sftp: SFTPWrapper, remotePath: string): Promise<Stats> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err: Error | undefined, attrs: Stats | undefined) => {
      if (err || !attrs) reject(err || new Error('stat operation failed'))
      else resolve(attrs)
    })
  })
}

function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err: Error | null | undefined) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function sftpRmdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remotePath, (err: Error | null | undefined) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function sftpUnlink(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (err: Error | null | undefined) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function sftpRename(sftp: SFTPWrapper, oldPath: string, newPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(oldPath, newPath, (err: Error | null | undefined) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

async function ensureRemoteDirectory(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const normalized = sanitizeRemotePath(remotePath)
  if (normalized === '.' || normalized === '/') return

  const segments = normalized.split('/').filter(Boolean)
  let current = normalized.startsWith('/') ? '/' : ''

  for (const segment of segments) {
    current = current === '/' ? `/${segment}` : current ? `${current}/${segment}` : segment
    try {
      await sftpStat(sftp, current)
    } catch {
      await sftpMkdir(sftp, current)
    }
  }
}

async function removeRemoteRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  const attrs = await sftpStat(sftp, remotePath)
  if (attrs.isDirectory()) {
    const children = await sftpReaddir(sftp, remotePath)
    for (const child of children) {
      await removeRemoteRecursive(sftp, combineRemotePath(remotePath, child.filename))
    }
    await sftpRmdir(sftp, remotePath)
    return
  }
  await sftpUnlink(sftp, remotePath)
}

async function fetchRemoteTextFile(sftp: SFTPWrapper, remotePath: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let totalBytes = 0
    const MAX_TEXT_FILE_SIZE = 2 * 1024 * 1024
    const stream = sftp.createReadStream(remotePath, { encoding: undefined })

    stream.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      totalBytes += buffer.length
      if (totalBytes > MAX_TEXT_FILE_SIZE) {
        stream.destroy(new Error(`File exceeds ${MAX_TEXT_FILE_SIZE / 1024 / 1024}MB limit for text editing`))
        return
      }
      chunks.push(buffer)
    })
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

async function persistRemoteTextFile(sftp: SFTPWrapper, remotePath: string, content: string): Promise<void> {
  const parentDir = path.posix.dirname(remotePath)
  await ensureRemoteDirectory(sftp, parentDir)

  await new Promise<void>((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath, { encoding: 'utf8' })
    stream.on('error', reject)
    stream.on('finish', () => resolve())
    stream.end(content)
  })
}

async function transferLocalToRemote(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  await ensureRemoteDirectory(sftp, path.posix.dirname(remotePath))
  await pipeline(fs.createReadStream(localPath), sftp.createWriteStream(remotePath))
}

async function transferRemoteToLocal(sftp: SFTPWrapper, remotePath: string, localPath: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(localPath), { recursive: true })
  await pipeline(sftp.createReadStream(remotePath), fs.createWriteStream(localPath))
}

function pruneIdleConnections(): void {
  const now = Date.now()
  for (const [key, entry] of activeConnections) {
    if (now - entry.lastUsed > CONNECTION_IDLE_TIMEOUT_MS) {
      try { entry.client.end() } catch { /* ignore */ }
      activeConnections.delete(key)
      logger.ipc.info(`[RemoteExecution] Pruned idle connection: ${key}`)
    }
  }
}

setInterval(pruneIdleConnections, 60000)

export function registerRemoteExecutionHandlers(): void {
  safeIpcHandle('remote:list', async (_, endpoint: SshEndpoint, remotePath?: string): Promise<RemoteNode[]> => {
    return await withSftpSession(endpoint, async (sftp) => {
      const targetPath = sanitizeRemotePath(remotePath || endpoint.remotePath || '.')
      const entries = await sftpReaddir(sftp, targetPath)
      return entries
        .filter((entry) => entry.filename !== '.' && entry.filename !== '..')
        .map((entry) => ({
          name: entry.filename,
          path: combineRemotePath(targetPath, entry.filename),
          isDirectory: checkIsDirectory(entry.attrs),
          size: entry.attrs.size,
          modifyTime: entry.attrs.mtime ? entry.attrs.mtime * 1000 : undefined,
        }))
        .sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
          return a.name.localeCompare(b.name)
        })
    })
  })

  safeIpcHandle('remote:readText', async (_, endpoint: SshEndpoint, remotePath: string): Promise<string | null> => {
    return await withSftpSession(endpoint, async (sftp) => fetchRemoteTextFile(sftp, sanitizeRemotePath(remotePath)))
  })

  safeIpcHandle('remote:writeText', async (_, endpoint: SshEndpoint, remotePath: string, content: string): Promise<boolean> => {
    await withSftpSession(endpoint, async (sftp) => {
      await persistRemoteTextFile(sftp, sanitizeRemotePath(remotePath), content)
    })
    return true
  })

  safeIpcHandle('remote:mkdir', async (_, endpoint: SshEndpoint, remotePath: string): Promise<boolean> => {
    await withSftpSession(endpoint, async (sftp) => {
      await ensureRemoteDirectory(sftp, sanitizeRemotePath(remotePath))
    })
    return true
  })

  safeIpcHandle('remote:rename', async (_, endpoint: SshEndpoint, oldPath: string, newPath: string): Promise<boolean> => {
    await withSftpSession(endpoint, async (sftp) => {
      await sftpRename(sftp, sanitizeRemotePath(oldPath), sanitizeRemotePath(newPath))
    })
    return true
  })

  safeIpcHandle('remote:delete', async (_, endpoint: SshEndpoint, remotePath: string): Promise<boolean> => {
    await withSftpSession(endpoint, async (sftp) => {
      await removeRemoteRecursive(sftp, sanitizeRemotePath(remotePath))
    })
    return true
  })

  safeIpcHandle('remote:testConnection', async (_, endpoint: SshEndpoint): Promise<ConnectionHealth> => {
    const startMs = Date.now()
    try {
      await withSftpSession(endpoint, async (sftp) => {
        await sftpReaddir(sftp, sanitizeRemotePath(endpoint.remotePath || '.'))
      })
      return { connected: true, latencyMs: Date.now() - startMs }
    } catch (error) {
      return { connected: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  safeIpcHandle('remote:upload', async (event, endpoint: SshEndpoint, remoteDirectory: string): Promise<TransferUploadOutcome> => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const selection = await dialog.showOpenDialog(window as BrowserWindow, {
      title: 'Upload files to remote server',
      properties: ['openFile', 'multiSelections'],
    })

    if (selection.canceled || selection.filePaths.length === 0) {
      return { canceled: true, uploaded: [] }
    }

    const targetDirectory = sanitizeRemotePath(remoteDirectory || endpoint.remotePath || '.')
    const uploaded = await withSftpSession(endpoint, async (sftp) => {
      const completed: string[] = []
      for (const localPath of selection.filePaths) {
        const remotePath = combineRemotePath(targetDirectory, path.basename(localPath))
        await transferLocalToRemote(sftp, localPath, remotePath)
        completed.push(remotePath)
      }
      return completed
    })

    return { canceled: false, uploaded }
  })

  safeIpcHandle('remote:download', async (event, endpoint: SshEndpoint, remotePath: string): Promise<TransferDownloadOutcome> => {
    const normalizedRemotePath = sanitizeRemotePath(remotePath)
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined
    const saveResult = await dialog.showSaveDialog(window as BrowserWindow, {
      title: 'Download remote file',
      defaultPath: path.basename(normalizedRemotePath),
    })

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true }
    }

    await withSftpSession(endpoint, async (sftp) => {
      const attrs = await sftpStat(sftp, normalizedRemotePath)
      if (attrs.isDirectory()) {
        throw new Error('Directory download is not supported yet — please select a file')
      }
      await transferRemoteToLocal(sftp, normalizedRemotePath, saveResult.filePath)
    })

    return { canceled: false, localPath: saveResult.filePath }
  })

  safeIpcHandle('remote:connectionStatus', async (_, endpoint: SshEndpoint): Promise<ConnectionHealth> => {
    const key = getEndpointKey(endpoint)
    const entry = activeConnections.get(key)
    if (entry) {
      return { connected: true, latencyMs: Date.now() - entry.lastUsed }
    }
    return { connected: false }
  })

  // ============ Phase 5: 远程桌面控制 ============

  /** 远程桌面操作类型 */
  type RemoteDesktopAction =
    | 'screenshot'
    | 'mouse_click'
    | 'mouse_move'
    | 'key_type'
    | 'key_press'
    | 'app_launch'
    | 'app_quit'
    | 'window_list'
    | 'window_focus'

  /** 远程桌面操作参数 */
  interface RemoteDesktopParams {
    action: RemoteDesktopAction
    x?: number
    y?: number
    button?: 'left' | 'right' | 'middle'
    text?: string
    keys?: string
    appName?: string
    windowId?: string
  }

  /** 远程桌面操作结果 */
  interface RemoteDesktopResult {
    success: boolean
    output?: string
    error?: string
    data?: unknown
  }

  /** 在远程主机上执行命令并返回输出 */
  async function executeRemoteCommand(endpoint: SshEndpoint, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const Client = loadSshClient()
    const connection = new Client()

    return await new Promise((resolve, reject) => {
      let settled = false
      const finalize = (error: unknown, result?: { stdout: string; stderr: string; exitCode: number }) => {
        if (settled) return
        settled = true
        connection.end()
        if (error) reject(error)
        else resolve(result as { stdout: string; stderr: string; exitCode: number })
      }

      connection
        .on('ready', () => {
          connection.exec(command, (err, stream) => {
            if (err || !stream) {
              finalize(err || new Error('Failed to execute command'))
              return
            }

            let stdout = ''
            let stderr = ''

            stream
              .on('close', (code: number) => {
                finalize(null, { stdout, stderr, exitCode: code ?? 0 })
              })
              .on('data', (data: Buffer) => {
                stdout += data.toString()
              })
              .stderr.on('data', (data: Buffer) => {
                stderr += data.toString()
              })
          })
        })
        .on('error', (err: Error) => finalize(err))
        .connect(buildSshConfig(endpoint))
    })
  }

  /** 检测远程主机操作系统 */
  async function detectRemoteOS(endpoint: SshEndpoint): Promise<'darwin' | 'linux' | 'unknown'> {
    try {
      const result = await executeRemoteCommand(endpoint, 'uname -s')
      if (result.stdout.trim() === 'Darwin') return 'darwin'
      if (result.stdout.trim() === 'Linux') return 'linux'
      return 'unknown'
    } catch {
      return 'unknown'
    }
  }

  safeIpcHandle('remote:desktopAction', async (_, endpoint: SshEndpoint, params: RemoteDesktopParams): Promise<RemoteDesktopResult> => {
    try {
      const remoteOS = await detectRemoteOS(endpoint)

      if (remoteOS === 'unknown') {
        return { success: false, error: 'Unable to detect remote OS or unsupported platform' }
      }

      switch (params.action) {
        case 'screenshot': {
          // macOS: screencapture, Linux: import/scrot
          const cmd = remoteOS === 'darwin'
            ? 'screencapture -x /tmp/aweeclaw_screenshot.png && base64 -i /tmp/aweeclaw_screenshot.png && rm /tmp/aweeclaw_screenshot.png'
            : 'import -window root /tmp/aweeclaw_screenshot.png && base64 /tmp/aweeclaw_screenshot.png && rm /tmp/aweeclaw_screenshot.png'

          const result = await executeRemoteCommand(endpoint, cmd)
          if (result.exitCode !== 0) {
            return { success: false, error: result.stderr || 'Screenshot failed' }
          }
          return { success: true, output: result.stdout.trim(), data: { base64: result.stdout.trim() } }
        }

        case 'mouse_click': {
          if (params.x === undefined || params.y === undefined) {
            return { success: false, error: 'x and y coordinates required' }
          }
          const button = params.button || 'left'
          const cmd = remoteOS === 'darwin'
            ? `osascript -e 'tell application "System Events" to click at {${params.x}, ${params.y}}'`
            : `xdotool mousemove ${params.x} ${params.y} && xdotool click ${button === 'left' ? 1 : button === 'right' ? 3 : 2}`

          const result = await executeRemoteCommand(endpoint, cmd)
          return { success: result.exitCode === 0, output: result.stdout, error: result.exitCode !== 0 ? result.stderr : undefined }
        }

        case 'mouse_move': {
          if (params.x === undefined || params.y === undefined) {
            return { success: false, error: 'x and y coordinates required' }
          }
          const cmd = remoteOS === 'darwin'
            ? `osascript -e 'tell application "System Events" to set position of the mouse to {${params.x}, ${params.y}}'`
            : `xdotool mousemove ${params.x} ${params.y}`

          const result = await executeRemoteCommand(endpoint, cmd)
          return { success: result.exitCode === 0, output: result.stdout, error: result.exitCode !== 0 ? result.stderr : undefined }
        }

        case 'key_type': {
          if (!params.text) {
            return { success: false, error: 'text required' }
          }
          const escapedText = params.text.replace(/'/g, "'\\''")
          const cmd = remoteOS === 'darwin'
            ? `osascript -e 'tell application "System Events" to keystroke "${escapedText}"'`
            : `xdotool type -- "${escapedText}"`

          const result = await executeRemoteCommand(endpoint, cmd)
          return { success: result.exitCode === 0, output: result.stdout, error: result.exitCode !== 0 ? result.stderr : undefined }
        }

        case 'key_press': {
          if (!params.keys) {
            return { success: false, error: 'keys required' }
          }
          const cmd = remoteOS === 'darwin'
            ? `osascript -e 'tell application "System Events" to key code "${params.keys}"'`
            : `xdotool key ${params.keys}`

          const result = await executeRemoteCommand(endpoint, cmd)
          return { success: result.exitCode === 0, output: result.stdout, error: result.exitCode !== 0 ? result.stderr : undefined }
        }

        case 'app_launch': {
          if (!params.appName) {
            return { success: false, error: 'appName required' }
          }
          const cmd = remoteOS === 'darwin'
            ? `open -a "${params.appName}"`
            : `${params.appName} &`

          const result = await executeRemoteCommand(endpoint, cmd)
          return { success: result.exitCode === 0, output: result.stdout, error: result.exitCode !== 0 ? result.stderr : undefined }
        }

        case 'app_quit': {
          if (!params.appName) {
            return { success: false, error: 'appName required' }
          }
          const cmd = remoteOS === 'darwin'
            ? `osascript -e 'quit app "${params.appName}"'`
            : `pkill -f "${params.appName}"`

          const result = await executeRemoteCommand(endpoint, cmd)
          return { success: result.exitCode === 0, output: result.stdout, error: result.exitCode !== 0 ? result.stderr : undefined }
        }

        case 'window_list': {
          const cmd = remoteOS === 'darwin'
            ? `osascript -e 'tell application "System Events" to get name of every window of every process whose background only is false'`
            : 'wmctrl -l 2>/dev/null || xdotool search "" 2>/dev/null'

          const result = await executeRemoteCommand(endpoint, cmd)
          return { success: result.exitCode === 0, output: result.stdout, data: { windows: result.stdout.trim().split('\n').filter(Boolean) } }
        }

        case 'window_focus': {
          if (!params.windowId && !params.appName) {
            return { success: false, error: 'windowId or appName required' }
          }
          const cmd = remoteOS === 'darwin'
            ? `osascript -e 'tell application "${params.appName}" to activate'`
            : `wmctrl -a "${params.windowId}" 2>/dev/null || xdotool windowactivate ${params.windowId}`

          const result = await executeRemoteCommand(endpoint, cmd)
          return { success: result.exitCode === 0, output: result.stdout, error: result.exitCode !== 0 ? result.stderr : undefined }
        }

        default:
          return { success: false, error: `Unknown action: ${params.action}` }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** 远程执行工作流（将工作流 JSON 传输到远程主机并执行） */
  safeIpcHandle('remote:executeWorkflow', async (_, endpoint: SshEndpoint, workflowJson: string): Promise<RemoteDesktopResult> => {
    try {
      // 将工作流 JSON 写入远程临时文件
      const remotePath = '/tmp/aweeclaw_workflow.json'
      await withSftpSession(endpoint, async (sftp) => {
        await persistRemoteTextFile(sftp, remotePath, workflowJson)
      })

      // 在远程主机上执行（假设远程主机安装了 aweeclaw CLI）
      const cmd = `aweeclaw workflow run --file ${remotePath} 2>&1 || echo "aweeclaw CLI not found on remote host"`
      const result = await executeRemoteCommand(endpoint, cmd)

      // 清理临时文件
      await executeRemoteCommand(endpoint, `rm -f ${remotePath}`)

      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.exitCode !== 0 ? result.stderr : undefined,
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  /** 检测远程主机桌面控制能力 */
  safeIpcHandle('remote:detectCapabilities', async (_, endpoint: SshEndpoint): Promise<{ os: string; hasXdtool: boolean; hasWmctrl: boolean; hasScrot: boolean; hasAweeclaw: boolean }> => {
    try {
      const osResult = await executeRemoteCommand(endpoint, 'uname -s')
      const remoteOS = osResult.stdout.trim()

      const [xdotoolResult, wmctrlResult, scrotResult, aweeclawResult] = await Promise.all([
        executeRemoteCommand(endpoint, 'which xdotool 2>/dev/null'),
        executeRemoteCommand(endpoint, 'which wmctrl 2>/dev/null'),
        executeRemoteCommand(endpoint, 'which scrot 2>/dev/null || which import 2>/dev/null'),
        executeRemoteCommand(endpoint, 'which aweeclaw 2>/dev/null'),
      ])

      return {
        os: remoteOS,
        hasXdtool: xdotoolResult.exitCode === 0,
        hasWmctrl: wmctrlResult.exitCode === 0,
        hasScrot: scrotResult.exitCode === 0,
        hasAweeclaw: aweeclawResult.exitCode === 0,
      }
    } catch (err) {
      return { os: 'unknown', hasXdtool: false, hasWmctrl: false, hasScrot: false, hasAweeclaw: false }
    }
  })
}
