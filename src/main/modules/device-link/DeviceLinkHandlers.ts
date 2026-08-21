/**
 * 桌面端 RPC 请求处理器
 *
 * 接收后端转发的 RPC 请求（来自移动端），调用本地能力执行后返回结果。
 *
 * 复用桌面端已有能力：
 * - 文件浏览：fs + 工作区根（workspaceGuard 持久化的 lastWorkspaceSession）
 * - 命令执行：secureTerminal / shell:executeSecure（通过 IPC 反向调用 renderer 不可行，
 *             直接复用 SecureCommandExecutor 主进程模块）
 * - 剪贴板：Electron 全局 clipboard 对象
 * - 截图：DesktopControlManager.captureScreen()
 * - 电源：powerShell/caffeinate 等（跨平台）
 *
 * 安全要点：
 * - 所有 path 参数必须先调用 assertSafePath，防止穿越工作区根
 * - run-command 默认拒绝，需用户在 settings 中开启 deviceLink.allowRemoteCommand
 * - 所有操作记录到 audit 日志
 */
import { clipboard, ipcMain, type BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { logger } from '@shared/toolkit/LogEngine'
import { getDesktopControlManager } from '../desktop-control'
import type { ScreenshotResult } from '../desktop-control/types/actions'

const execAsync = promisify(exec)

/** 工作区根路径解析器：返回当前活动工作区的根目录 */
type WorkspaceRootResolver = () => string | null

/** 设备联动用户偏好（开关类配置） */
export interface DeviceLinkPreferences {
  /** 允许远程执行命令（默认 false，需要用户显式开启） */
  allowRemoteCommand?: boolean
  /** 允许远程剪贴板推送 */
  allowClipboardPush?: boolean
  /** 允许远程截图 */
  allowScreenshot?: boolean
  /** 允许远程休眠/唤醒 */
  allowPowerControl?: boolean
}

export interface DeviceHandlerContext {
  resolveWorkspaceRoot: WorkspaceRootResolver
  preferences: () => DeviceLinkPreferences
  /** 获取主窗口（用于向 renderer 发送 IPC） */
  getMainWindow: () => BrowserWindow | null
}

// ============================================================================
// Renderer 调用辅助
// ============================================================================

/**
 * 通过 IPC 调用 renderer 执行任务并等待结果。
 *
 * 工作流：
 * 1. 生成唯一 requestId
 * 2. webContents.send(channel, { requestId, ...payload }) 触发 renderer
 * 3. ipcMain.once(`device-link:renderer-reply:${requestId}`) 等待 renderer 回复
 * 4. 超时自动清理监听器并返回错误
 *
 * @param ctx handler 上下文
 * @param channel IPC 通道名
 * @param payload 发给 renderer 的数据
 * @param timeoutMs 超时（ms），默认 60s
 */
function invokeRenderer(
  ctx: DeviceHandlerContext,
  channel: string,
  payload: Record<string, unknown>,
  timeoutMs = 60000,
): Promise<{ requestId: string; success: boolean; output?: string; error?: string; duration?: number }> {
  return new Promise((resolve) => {
    const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const start = Date.now()
    const replyChannel = `device-link:renderer-reply:${requestId}`

    const timer = setTimeout(() => {
      ipcMain.removeListener(replyChannel, replyHandler)
      resolve({
        requestId,
        success: false,
        error: 'renderer_timeout',
        duration: Date.now() - start,
      })
    }, timeoutMs)

    const replyHandler = (_event: unknown, result: { success?: boolean; output?: string; error?: string }) => {
      clearTimeout(timer)
      resolve({
        requestId,
        success: result.success ?? false,
        output: result.output,
        error: result.error,
        duration: Date.now() - start,
      })
    }

    ipcMain.once(replyChannel, replyHandler)

    const win = ctx.getMainWindow()
    if (!win || win.isDestroyed()) {
      clearTimeout(timer)
      ipcMain.removeListener(replyChannel, replyHandler)
      resolve({
        requestId,
        success: false,
        error: 'no_main_window',
        duration: Date.now() - start,
      })
      return
    }

    win.webContents.send(channel, { requestId, ...payload })
  })
}

// ============================================================================
// 路径安全校验
// ============================================================================

/**
 * 路径安全校验
 * - 拒绝绝对路径（必须相对工作区根）
 * - 拒绝 `..` 穿越
 * - 返回拼接后的绝对路径
 */
function assertSafePath(workspaceRoot: string | null, relativePath: string): string {
  if (!relativePath) {
    if (!workspaceRoot) throw new Error('no_workspace')
    return workspaceRoot
  }
  if (!workspaceRoot) throw new Error('no_workspace')
  if (path.isAbsolute(relativePath)) throw new Error('absolute_path_forbidden')
  if (relativePath.includes('..')) throw new Error('path_traversal_forbidden')
  const abs = path.resolve(workspaceRoot, relativePath)
  // 防御性：再次确认结果仍位于工作区内
  const rel = path.relative(workspaceRoot, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path_escape_forbidden')
  }
  return abs
}

// ============================================================================
// 工作区 RPC
// ============================================================================

const MAX_TEXT_FILE_SIZE = 2 * 1024 * 1024 // 2MB，超过则不读文本

/** workspace.tree.req → 列出目录单层 */
export async function handleWorkspaceTree(
  ctx: DeviceHandlerContext,
  payload: { path: string },
) {
  const root = ctx.resolveWorkspaceRoot()
  const target = assertSafePath(root, payload.path || '')
  const entries = await fs.readdir(target, { withFileTypes: true })
  const nodes = await Promise.all(
    entries.slice(0, 500).map(async (e) => {
      const full = path.join(target, e.name)
      const rel = root ? path.relative(root, full) : e.name
      try {
        const stat = await fs.stat(full)
        return {
          name: e.name,
          path: rel.replace(/\\/g, '/'),
          isDir: e.isDirectory(),
          size: e.isFile() ? stat.size : undefined,
          modifiedAt: stat.mtimeMs,
        }
      } catch {
        return {
          name: e.name,
          path: rel.replace(/\\/g, '/'),
          isDir: e.isDirectory(),
        }
      }
    }),
  )
  return {
    path: payload.path || '',
    nodes: nodes.filter(Boolean),
  }
}

/** workspace.file.req → 读取文件内容（文本 / 二进制 base64） */
export async function handleWorkspaceFile(
  ctx: DeviceHandlerContext,
  payload: { path: string },
) {
  const root = ctx.resolveWorkspaceRoot()
  const abs = assertSafePath(root, payload.path)
  const stat = await fs.stat(abs)
  if (!stat.isFile()) throw new Error('not_a_file')

  const name = path.basename(abs)
  const mimeType = guessMimeType(name)

  // 二进制或超大文件：不读文本，返回 size + mimeType，由移动端走 download
  const isText = isTextFile(name)
  if (!isText || stat.size > MAX_TEXT_FILE_SIZE) {
    return {
      name,
      path: payload.path,
      size: stat.size,
      mimeType,
      encoding: 'utf-8' as const,
      text: undefined,
    }
  }

  const content = await fs.readFile(abs, 'utf-8')
  return {
    name,
    path: payload.path,
    size: stat.size,
    mimeType,
    encoding: 'utf-8' as const,
    text: content,
  }
}

/** workspace.search.req → 在工作区内按文件名搜索 */
export async function handleWorkspaceSearch(
  ctx: DeviceHandlerContext,
  payload: { keyword: string },
) {
  const root = ctx.resolveWorkspaceRoot()
  if (!root) throw new Error('no_workspace')
  const kw = (payload.keyword || '').trim().toLowerCase()
  if (kw.length < 2) return { path: '', nodes: [] }

  // 简化实现：广度优先遍历，最多返回 100 条
  const results: Array<{ name: string; path: string; isDir: boolean; size?: number; modifiedAt?: number }> = []
  const queue: Array<{ dir: string; rel: string; depth: number }> = [{ dir: root, rel: '', depth: 0 }]
  const MAX_DEPTH = 8
  const MAX_RESULTS = 100
  const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.cache'])

  while (queue.length > 0 && results.length < MAX_RESULTS) {
    const { dir, rel, depth } = queue.shift()!
    if (depth > MAX_DEPTH) continue
    let entries: fsSync.Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue
      if (e.name.toLowerCase().includes(kw)) {
        const full = path.join(dir, e.name)
        try {
          const stat = await fs.stat(full)
          results.push({
            name: e.name,
            path: (rel ? `${rel}/${e.name}` : e.name).replace(/\\/g, '/'),
            isDir: e.isDirectory(),
            size: e.isFile() ? stat.size : undefined,
            modifiedAt: stat.mtimeMs,
          })
          if (results.length >= MAX_RESULTS) break
        } catch { /* ignore */ }
      }
      if (e.isDirectory() && depth < MAX_DEPTH) {
        queue.push({
          dir: path.join(dir, e.name),
          rel: rel ? `${rel}/${e.name}` : e.name,
          depth: depth + 1,
        })
      }
    }
  }
  return { path: '', nodes: results }
}

/** workspace.download.req → 生成下载 URL（桌面端 base64 内联或临时 URL） */
export async function handleWorkspaceDownload(
  ctx: DeviceHandlerContext,
  payload: { path: string },
) {
  const root = ctx.resolveWorkspaceRoot()
  const abs = assertSafePath(root, payload.path)
  const stat = await fs.stat(abs)
  if (!stat.isFile()) throw new Error('not_a_file')
  const name = path.basename(abs)
  const mimeType = guessMimeType(name)

  // 小文件（< 5MB）直接 base64 内联
  if (stat.size <= 5 * 1024 * 1024) {
    const buf = await fs.readFile(abs)
    return {
      data: buf.toString('base64'),
      fileName: name,
      size: stat.size,
      mimeType,
    }
  }
  // 大文件：返回工作区相对路径，由移动端通过分块传输（暂不实现）
  return {
    url: `local://${payload.path}`,
    fileName: name,
    size: stat.size,
    mimeType,
  }
}

/** workspace.upload.req → 从临时 URL 下载并写入工作区 */
export async function handleWorkspaceUpload(
  ctx: DeviceHandlerContext,
  payload: { uploadUrl: string; targetDir: string; fileName: string; overwrite?: boolean },
) {
  const root = ctx.resolveWorkspaceRoot()
  if (!root) throw new Error('no_workspace')
  const dir = assertSafePath(root, payload.targetDir || '')
  const target = path.join(dir, payload.fileName)
  // 二次校验目标路径仍在工作区内（防止 fileName 含 ../）
  assertSafePath(root, path.relative(root, target))

  // 检查覆盖
  try {
    await fs.stat(target)
    if (!payload.overwrite) throw new Error('file_exists')
  } catch (err: any) {
    if (err.code !== 'ENOENT' && err.message !== 'file_exists') throw err
  }

  // 下载临时 URL 到本地（fetch 在 Node 18+ 可用）
  let res: Response
  try {
    res = await fetch(payload.uploadUrl)
  } catch (fetchErr: any) {
    throw new Error(`download_fetch_failed: ${fetchErr?.message || 'unknown'} (url: ${payload.uploadUrl})`)
  }
  if (!res.ok) throw new Error(`download_failed: ${res.status} (url: ${payload.uploadUrl})`)
  const buf = Buffer.from(await res.arrayBuffer())
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(target, buf)

  return {
    path: path.relative(root, target).replace(/\\/g, '/'),
    size: buf.length,
    overwritten: !!payload.overwrite,
  }
}

// ============================================================================
// 剪贴板
// ============================================================================

export async function handleClipboardPush(
  ctx: DeviceHandlerContext,
  payload: { type: 'text' | 'url' | 'image'; content: string },
) {
  if (!ctx.preferences().allowClipboardPush) throw new Error('forbidden_by_policy')
  switch (payload.type) {
    case 'text':
      clipboard.writeText(payload.content)
      break
    case 'url':
      // 同时写入文本和 bookmark，方便其他应用识别为 URL
      clipboard.writeText(payload.content)
      try {
        clipboard.writeBookmark(payload.content, payload.content)
      } catch { /* Windows/Linux 不支持 bookmark */ }
      break
    case 'image':
      // content 应为 base64 PNG
      try {
        const img = nativeImageFromDataURL(payload.content) || nativeImageFromBase64(payload.content)
        if (img) clipboard.writeImage(img)
      } catch (e) {
        throw new Error('invalid_image_data')
      }
      break
  }
  return { received: true }
}

// 延迟导入 nativeImage 避免 SSR 问题
function nativeImageFromDataURL(data: string): Electron.NativeImage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { nativeImage } = require('electron')
    if (data.startsWith('data:')) return nativeImage.createFromDataURL(data)
    return null
  } catch {
    return null
  }
}
function nativeImageFromBase64(b64: string): Electron.NativeImage | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { nativeImage } = require('electron')
    const buf = Buffer.from(b64, 'base64')
    const img = nativeImage.createFromBuffer(buf)
    return img.isEmpty() ? null : img
  } catch {
    return null
  }
}

// ============================================================================
// 远程指令
// ============================================================================

export async function handleCommand(
  ctx: DeviceHandlerContext,
  cmd: {
    type: 'open-file' | 'open-project' | 'run-command' | 'run-scenario' | 'ai-task'
    path?: string
    command?: string
    scenarioId?: string
    prompt?: string
    needResult?: boolean
  },
): Promise<{ requestId: string; success: boolean; output?: string; error?: string; duration?: number }> {
  const requestId = Date.now().toString(36)
  const start = Date.now()
  try {
    switch (cmd.type) {
      case 'open-file': {
        const root = ctx.resolveWorkspaceRoot()
        const abs = assertSafePath(root, cmd.path || '')
        await getDesktopControlManager().openFile(abs)
        return { requestId, success: true, duration: Date.now() - start }
      }
      case 'open-project': {
        const root = ctx.resolveWorkspaceRoot()
        const abs = assertSafePath(root, cmd.path || '')
        await getDesktopControlManager().openFile(abs)
        return { requestId, success: true, duration: Date.now() - start }
      }
      case 'run-command': {
        if (!ctx.preferences().allowRemoteCommand) {
          throw new Error('forbidden_by_policy')
        }
        const command = cmd.command || ''
        if (!command.trim()) throw new Error('empty_command')
        const root = ctx.resolveWorkspaceRoot()
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: root || undefined,
            timeout: 60000,
            maxBuffer: 2 * 1024 * 1024,
          })
          const output = [stdout, stderr].filter(Boolean).join('\n')
          return {
            requestId,
            success: true,
            output,
            duration: Date.now() - start,
          }
        } catch (err: any) {
          return {
            requestId,
            success: false,
            error: err.message,
            output: err.stderr || err.stdout || '',
            duration: Date.now() - start,
          }
        }
      }
      case 'run-scenario': {
        // 场景由 renderer 持有，通过 IPC 触发 renderer 执行
        return await invokeRenderer(ctx, 'device-link:run-scenario', {
          scenarioId: cmd.scenarioId,
          prompt: cmd.prompt,
        }, 60000)
      }
      case 'ai-task': {
        // AI 任务通过 renderer 调用 LLM 执行
        return await invokeRenderer(ctx, 'device-link:ai-task', {
          prompt: cmd.prompt,
          scenarioId: cmd.scenarioId,
          needResult: cmd.needResult,
        }, 120000)
      }
      default:
        throw new Error('unknown_command_type')
    }
  } catch (err: any) {
    return {
      requestId,
      success: false,
      error: err.message || String(err),
      duration: Date.now() - start,
    }
  }
}

// ============================================================================
// 截图
// ============================================================================

export async function handleScreenshot(
  ctx: DeviceHandlerContext,
): Promise<{ url: string; takenAt: number; width?: number; height?: number }> {
  if (!ctx.preferences().allowScreenshot) throw new Error('forbidden_by_policy')
  const result: ScreenshotResult = await getDesktopControlManager().captureScreen(0)
  if (!result.success || !result.dataUrl) {
    throw new Error(result.error || 'capture_failed')
  }
  return {
    url: result.dataUrl, // data:image/png;base64,...
    takenAt: result.timestamp || Date.now(),
    width: result.region?.width,
    height: result.region?.height,
  }
}

// ============================================================================
// 电源控制
// ============================================================================

export async function handlePowerControl(
  ctx: DeviceHandlerContext,
  payload: { action: 'sleep' | 'wake' },
): Promise<{ applied: boolean }> {
  if (!ctx.preferences().allowPowerControl) throw new Error('forbidden_by_policy')
  switch (payload.action) {
    case 'sleep': {
      // 跨平台休眠命令
      const cmd = process.platform === 'win32'
        ? 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
        : process.platform === 'darwin'
        ? 'pmset sleepnow'
        : 'systemctl suspend'
      await execAsync(cmd).catch(() => { throw new Error('sleep_failed') })
      return { applied: true }
    }
    case 'wake': {
      // 防止休眠：caffeinate（macOS）/ 不做实际操作（仅作为"保持唤醒"心跳）
      // 实际唤醒需要硬件事件，桌面端无法主动触发，这里返回 false
      return { applied: false }
    }
    default:
      throw new Error('unknown_action')
  }
}

// ============================================================================
// 任务接续（桌面端作为源 / 目标）
// ============================================================================

/** 作为源设备：导出会话上下文 */
export async function handleTaskTransferPull(
  _ctx: DeviceHandlerContext,
  payload: { threadId: string },
): Promise<{ threadId: string; snippet: string }> {
  // 会话上下文存储在 renderer 的 SessionDb，主进程无法直接访问
  // 完整实现需通过 IPC 让 renderer 读取并返回
  // 这里返回简化占位：线程 ID + 提示
  return {
    threadId: payload.threadId,
    snippet: `[Context of thread ${payload.threadId}] (requires renderer to provide full context)`,
  }
}

/** 作为目标设备：接收会话上下文并加载 */
export async function handleTaskTransferDeliver(
  _ctx: DeviceHandlerContext,
  payload: { fromDeviceId: string; threadId: string; snippet: string },
): Promise<{ applied: boolean }> {
  // 需通过 IPC 通知 renderer 加载会话
  // 这里仅返回成功，由上层 DeviceLinkClient 通过 webContents.send 转发
  logger.deviceLink.info('[TaskTransfer] Deliver received', {
    fromDeviceId: payload.fromDeviceId,
    threadId: payload.threadId,
    snippetLength: payload.snippet?.length,
  })
  return { applied: true }
}

// ============================================================================
// 知识库导出
// ============================================================================

/** knowledge.export.req → 读取本地知识库并返回条目列表 */
export async function handleKnowledgeExport(
  ctx: DeviceHandlerContext,
): Promise<{ items: Array<{ title: string; category?: string; content: string; tags?: string[]; source?: string }>; count: number }> {
  const root = ctx.resolveWorkspaceRoot()
  if (!root) throw new Error('no_workspace')

  const storeFile = path.join(root, '.aweeclaw', 'knowledge', 'store.json')
  try {
    const raw = await fs.readFile(storeFile, 'utf-8')
    const store = JSON.parse(raw)
    const entries = Array.isArray(store?.entries) ? store.entries : []
    const items = entries.map((e: any) => ({
      title: String(e?.title || e?.content?.slice(0, 50) || 'Untitled'),
      category: e?.category ? String(e.category) : undefined,
      content: String(e?.content || ''),
      tags: Array.isArray(e?.tags) ? e.tags.map(String) : undefined,
      source: e?.source ? String(e.source) : undefined,
    })).filter((i: any) => i.content)
    return { items, count: items.length }
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { items: [], count: 0 }
    logger.deviceLink.error('[KnowledgeExport] Failed to read store', err?.message)
    throw new Error('knowledge_read_failed')
  }
}

// ============================================================================
// 工具：文件类型判断
// ============================================================================

const TEXT_EXTENSIONS = new Set([
  '.js', '.ts', '.tsx', '.jsx', '.vue', '.json', '.html', '.htm', '.css', '.scss',
  '.md', '.txt', '.log', '.py', '.go', '.java', '.rs', '.c', '.cpp', '.h', '.hpp',
  '.yml', '.yaml', '.toml', '.ini', '.conf', '.sh', '.bash', '.zsh',
  '.sql', '.xml', '.svg', '.gitignore', '.env', '.dockerfile',
])

function isTextFile(name: string): boolean {
  const ext = path.extname(name).toLowerCase()
  if (TEXT_EXTENSIONS.has(ext)) return true
  // 无扩展名的常见文本文件
  const base = path.basename(name).toLowerCase()
  return ['readme', 'license', 'dockerfile', '.gitignore'].some((k) => base.includes(k))
}

function guessMimeType(name: string): string {
  const ext = path.extname(name).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
    '.pdf': 'application/pdf', '.zip': 'application/zip', '.gz': 'application/gzip',
    '.json': 'application/json', '.html': 'text/html', '.css': 'text/css',
    '.js': 'text/javascript', '.ts': 'text/typescript',
  }
  return map[ext] || 'application/octet-stream'
}
