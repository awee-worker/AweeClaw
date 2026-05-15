import { BrowserWindow, dialog, ipcMain } from 'electron'
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
  ipcMain.handle('remote:list', async (_, endpoint: SshEndpoint, remotePath?: string): Promise<RemoteNode[]> => {
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

  ipcMain.handle('remote:readText', async (_, endpoint: SshEndpoint, remotePath: string): Promise<string | null> => {
    return await withSftpSession(endpoint, async (sftp) => fetchRemoteTextFile(sftp, sanitizeRemotePath(remotePath)))
  })

  ipcMain.handle('remote:writeText', async (_, endpoint: SshEndpoint, remotePath: string, content: string): Promise<boolean> => {
    await withSftpSession(endpoint, async (sftp) => {
      await persistRemoteTextFile(sftp, sanitizeRemotePath(remotePath), content)
    })
    return true
  })

  ipcMain.handle('remote:mkdir', async (_, endpoint: SshEndpoint, remotePath: string): Promise<boolean> => {
    await withSftpSession(endpoint, async (sftp) => {
      await ensureRemoteDirectory(sftp, sanitizeRemotePath(remotePath))
    })
    return true
  })

  ipcMain.handle('remote:rename', async (_, endpoint: SshEndpoint, oldPath: string, newPath: string): Promise<boolean> => {
    await withSftpSession(endpoint, async (sftp) => {
      await sftpRename(sftp, sanitizeRemotePath(oldPath), sanitizeRemotePath(newPath))
    })
    return true
  })

  ipcMain.handle('remote:delete', async (_, endpoint: SshEndpoint, remotePath: string): Promise<boolean> => {
    await withSftpSession(endpoint, async (sftp) => {
      await removeRemoteRecursive(sftp, sanitizeRemotePath(remotePath))
    })
    return true
  })

  ipcMain.handle('remote:testConnection', async (_, endpoint: SshEndpoint): Promise<ConnectionHealth> => {
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

  ipcMain.handle('remote:upload', async (event, endpoint: SshEndpoint, remoteDirectory: string): Promise<TransferUploadOutcome> => {
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

  ipcMain.handle('remote:download', async (event, endpoint: SshEndpoint, remotePath: string): Promise<TransferDownloadOutcome> => {
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

  ipcMain.handle('remote:connectionStatus', async (_, endpoint: SshEndpoint): Promise<ConnectionHealth> => {
    const key = getEndpointKey(endpoint)
    const entry = activeConnections.get(key)
    if (entry) {
      return { connected: true, latencyMs: Date.now() - entry.lastUsed }
    }
    return { connected: false }
  })
}
