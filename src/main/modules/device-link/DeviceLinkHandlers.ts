/**
 * 桌面端 RPC 请求处理器
 *
 * 接收后端转发的 RPC 请求（来自移动端），调用本地能力执行后返回结果。
 *
 * 复用桌面端已有能力：
 * - 文件浏览：fs + 工作空间根（workspaceGuard 持久化的 lastWorkspaceSession）
 * - 命令执行：secureTerminal / shell:executeSecure（通过 IPC 反向调用 renderer 不可行，
 *             直接复用 SecureCommandExecutor 主进程模块）
 * - 剪贴板：Electron 全局 clipboard 对象
 * - 截图：DesktopControlManager.captureScreen()
 * - 电源：powerShell/caffeinate 等（跨平台）
 *
 * 安全要点：
 * - 所有 path 参数必须先调用 assertSafePath，防止穿越工作空间根
 * - run-command 默认拒绝，需用户在 settings 中开启 deviceLink.allowRemoteCommand
 * - 所有操作记录到 audit 日志
 */
import { app, clipboard, dialog, ipcMain, nativeImage, type BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { logger } from '@shared/toolkit/LogEngine'
import { getDesktopControlManager } from '../desktop-control'
import type { ScreenshotResult } from '../desktop-control/types/actions'
import { SessionDb } from '../../modules/session-db'

const execAsync = promisify(exec)

/** 工作空间根路径解析器：返回当前活动工作空间的根目录 */
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
  /**
   * 允许远程鼠标键盘注入（远程控制）
   *
   * 默认关闭。开启后等于把整台机器的操作权交给已登录的移动端，
   * 因此权限中心把它单列一个范围，不与「远程执行命令」合并。
   */
  allowRemoteInput?: boolean
}

/**
 * 电源控制结果
 *
 * 唤醒与休眠的结论不同：休眠只有「已执行」一种可能，而唤醒要区分
 * 「显示器已点亮」与「系统仍在睡眠、软件无法拉起」——后者只能由用户
 * 到机器前按电源键或依赖网络唤醒，移动端必须能据此给出正确引导。
 */
export interface PowerControlResult {
  applied: boolean
  /** 显示器是否被点亮（系统深度睡眠时为 false） */
  displayWake?: boolean
  /** 未生效原因 */
  reason?: 'failed'
  /** 失败细节，仅用于日志与排障，不作为界面文案 */
  detail?: string
}

export interface DeviceHandlerContext {
  resolveWorkspaceRoot: WorkspaceRootResolver
  preferences: () => DeviceLinkPreferences
  /** 获取主窗口（用于向 renderer 发送 IPC） */
  getMainWindow: () => BrowserWindow | null
  /** 某权限范围的临时授权剩余毫秒（无临时授权返回 0） */
  tempGrantRemaining?: (scope: PermissionScope) => number
  /** 落地权限决策：temp = 10 分钟临时授权，always = 永久开启 */
  applyPermission?: (scope: PermissionScope, mode: 'temp' | 'always') => void
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
 * - 拒绝绝对路径（必须相对工作空间根）
 * - 拒绝 `..` 穿越
 * - 返回拼接后的绝对路径
 */
function assertSafePath(workspaceRoot: string | null, relativePath: string): string {
  if (!relativePath) {
    if (!workspaceRoot) throw new Error('no_workspace')
    return workspaceRoot
  }
  if (!workspaceRoot) throw new Error('no_workspace')
  // 移动端可能对含中文的路径做了 URL 编码，统一解码后再拼接
  let decoded = relativePath
  try {
    if (relativePath.includes('%')) {
      decoded = decodeURIComponent(relativePath)
    }
  } catch {
    // decode 失败则使用原值
  }
  if (path.isAbsolute(decoded)) throw new Error('absolute_path_forbidden')
  if (decoded.includes('..')) throw new Error('path_traversal_forbidden')
  const abs = path.resolve(workspaceRoot, decoded)
  // 防御性：再次确认结果仍位于工作空间内
  const rel = path.relative(workspaceRoot, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('path_escape_forbidden')
  }
  return abs
}

// ============================================================================
// 工作空间 RPC
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
    // Office 文档（docx/xlsx/pptx）需要通过提取器获取文本
    const officeExts = new Set(['.docx', '.doc', '.xlsx', '.xls', '.csv', '.ppt', '.pptx'])
    if (officeExts.has(path.extname(name).toLowerCase())) {
      try {
        const { extractDocument } = await import('../../guard/documentExtractor')
        const result = await extractDocument(abs)
        if (result.success && result.content) {
          return {
            name,
            path: payload.path,
            size: stat.size,
            mimeType,
            encoding: 'utf-8' as const,
            text: result.content,
          }
        }
      } catch (err) {
        logger.deviceLink.warn('[handleWorkspaceFile] Office 文档提取失败:', err)
      }
    }
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

/** workspace.search.req → 在工作空间内按文件名搜索 */
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
  // 大文件：返回工作空间相对路径，由移动端通过分块传输（暂不实现）
  return {
    url: `local://${payload.path}`,
    fileName: name,
    size: stat.size,
    mimeType,
  }
}

/** workspace.upload.req → 从临时 URL 下载并写入工作空间 */
export async function handleWorkspaceUpload(
  ctx: DeviceHandlerContext,
  payload: { uploadUrl: string; targetDir: string; fileName: string; overwrite?: boolean },
) {
  const root = ctx.resolveWorkspaceRoot()
  if (!root) throw new Error('no_workspace')
  const dir = assertSafePath(root, payload.targetDir || '')
  const target = path.join(dir, payload.fileName)
  // 二次校验目标路径仍在工作空间内（防止 fileName 含 ../）
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
    /** 服务端任务 id（任务中心下发时带上，执行期按它回挂控制消息） */
    taskId?: string
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
            // Windows 上 exec 经 cmd.exe 执行，不隐藏会弹出控制台窗口
            windowsHide: true,
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
          // 服务端任务 id：renderer 用它登记 requestId → taskId 对照，
          // 执行期才能取到移动端发来的 steer 与接管处置
          taskId: cmd.taskId,
        }, 60000)
      }
      case 'ai-task': {
        // AI 任务通过 renderer 调用 LLM 执行
        return await invokeRenderer(ctx, 'device-link:ai-task', {
          prompt: cmd.prompt,
          scenarioId: cmd.scenarioId,
          needResult: cmd.needResult,
          taskId: cmd.taskId,
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

/** 唤醒后维持「有用户活动」的秒数：够移动端拉到首帧即可，不长期压制屏幕节能 */
const WAKE_HOLD_SECONDS = 10

/** Windows 唤醒脚本的线程执行状态标志：ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED */
const WIN_ES_ALL = 0x80000003
/** 只保留 ES_CONTINUOUS，用于结束上面那段临时断言 */
const WIN_ES_CONTINUOUS = 0x80000000

/**
 * 点亮显示器并重置空闲计时。
 *
 * 能走到这里的请求说明桌面进程仍在运行（系统真睡眠时进程被挂起，RPC 根本
 * 到不了），因此这里要解决的是「显示器已熄 / 屏幕已锁」，而不是把机器从
 * 系统睡眠里拉起——后者属于硬件与网络唤醒（WoL）的范畴，软件无法保证。
 *
 *   macOS   `caffeinate -u`  声明用户活动，立刻点亮已熄灭的显示器
 *   Windows `SetThreadExecutionState` + 一次无害按键，显示器已关闭时只有输入事件能可靠唤醒
 *   Linux   DPMS 强制开，并顺带重置屏保
 */
async function wakeDisplay(): Promise<{ displayWake: boolean; note: string }> {
  try {
    if (process.platform === 'darwin') {
      await execAsync(`/usr/bin/caffeinate -u -t ${WAKE_HOLD_SECONDS}`, { windowsHide: true })
      return { displayWake: true, note: '' }
    }

    if (process.platform === 'win32') {
      // 用 -EncodedCommand（UTF-16LE + Base64）传递，避开 -Command 里引号与换行的转义问题
      const script = [
        "$ErrorActionPreference='Stop'",
        `$src='using System;using System.Runtime.InteropServices;public static class AweeClawWakeHost{[DllImport("kernel32.dll",SetLastError=true)]public static extern uint SetThreadExecutionState(uint esFlags);}'`,
        'Add-Type -TypeDefinition $src -Language CSharp',
        `[AweeClawWakeHost]::SetThreadExecutionState([uint32]${WIN_ES_ALL}) > $null`,
        "(New-Object -ComObject WScript.Shell).SendKeys('{F15}')",
        `Start-Sleep -Seconds ${WAKE_HOLD_SECONDS}`,
        `[AweeClawWakeHost]::SetThreadExecutionState([uint32]${WIN_ES_CONTINUOUS}) > $null`,
      ].join('\r\n')
      const encoded = Buffer.from(script, 'utf16le').toString('base64')
      await execAsync(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`, {
        windowsHide: true,
        timeout: (WAKE_HOLD_SECONDS + 10) * 1000,
      })
      return { displayWake: true, note: '' }
    }

    await execAsync('xset dpms force on', { windowsHide: true })
    // 屏保不一定会被 DPMS 指令解除，失败也不影响显示器已点亮这一结果
    await execAsync('xdg-screensaver reset', { windowsHide: true }).catch(() => undefined)
    return { displayWake: true, note: '' }
  } catch (err) {
    return { displayWake: false, note: err instanceof Error ? err.message : String(err) }
  }
}

export async function handlePowerControl(
  ctx: DeviceHandlerContext,
  payload: { action: 'sleep' | 'wake' },
): Promise<PowerControlResult> {
  if (!ctx.preferences().allowPowerControl) throw new Error('forbidden_by_policy')
  switch (payload.action) {
    case 'sleep': {
      // 跨平台休眠命令
      const cmd = process.platform === 'win32'
        ? 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
        : process.platform === 'darwin'
        ? 'pmset sleepnow'
        : 'systemctl suspend'
      await execAsync(cmd, { windowsHide: true }).catch(() => { throw new Error('sleep_failed') })
      return { applied: true }
    }
    case 'wake': {
      const { displayWake, note } = await wakeDisplay()
      if (!displayWake) {
        // 不抛错：调用方需要拿到「没成功 + 为什么」，抛错只会退化成一句笼统的失败
        logger.deviceLink.warn(`[Handlers] 唤醒显示器失败：${note}`)
        return { applied: false, displayWake: false, reason: 'failed', detail: note }
      }
      return { applied: true, displayWake: true }
    }
    default:
      throw new Error('unknown_action')
  }
}

// ============================================================================
// 远程输入注入（远程控制）
// ============================================================================

/**
 * 输入注入的统一准入检查
 *
 * 与截图、剪贴板不同，输入注入等于把整台机器的操作权交出去，因此要求：
 * - 用户已显式开启 allowRemoteInput（默认关闭，需在权限中心单独授权）
 * - 每次操作前都查一次急停开关，用户按下急停后立即失效
 *
 * 这里不依赖 DesktopControlManager 的 ASK 确认：人在远程时 PC 前的确认框
 * 无人会点，靠弹窗反而会把操作全部拖到超时。安全边界放在开关与急停上。
 */
function assertRemoteInputAllowed(ctx: DeviceHandlerContext): void {
  if (!ctx.preferences().allowRemoteInput) throw new Error('forbidden_by_policy')
  getDesktopControlManager().emergencyStop.check()
}

/** 坐标合法性校验：否定值、NaN、Infinity 一律拒绝，避免把异常值喂进注入层 */
function assertPoint(x: unknown, y: unknown): { x: number; y: number } {
  const px = Number(x)
  const py = Number(y)
  if (!Number.isFinite(px) || !Number.isFinite(py) || px < 0 || py < 0) {
    throw new Error('invalid_coordinates')
  }
  return { x: Math.round(px), y: Math.round(py) }
}

/** 归一化鼠标按键，非法值退回左键 */
function normalizeButton(raw: unknown): 'left' | 'right' | 'middle' {
  return ['left', 'right', 'middle'].includes(String(raw))
    ? (String(raw) as 'left' | 'right' | 'middle')
    : 'left'
}

/**
 * 输入注入结果校验
 *
 * 平台层（尤其 macOS 的 cliclick / CoreGraphics 通道）执行失败时只返回
 * success:false 而不抛错。若这里直接忽略，调用方拿到的永远是 applied:true，
 * 移动端就表现为「点了没反应」且没有任何错误可查。
 *
 * 点按、滚轮、按键这类低频且意图明确的操作用抛错透出失败；
 * 鼠标移动属于持续动作，失败由下一次移动自然覆盖，不抛错以免刷屏。
 */
function assertApplied(
  result: { success?: boolean; error?: string } | null | undefined,
  action: string,
): void {
  if (!result || result.success) return
  throw new Error(`${action}_failed${result.error ? `: ${result.error}` : ''}`)
}

// ---------------------------------------------------------------------------
// 鼠标输入串行化
// ---------------------------------------------------------------------------

/**
 * 鼠标输入串行队列
 *
 * 每条 RPC 都是独立异步处理的，两条移动请求会同时进入注入层。平台层每次要
 * spawn 一个系统进程，完成顺序与发出顺序无关——迟到的旧移动会把指针拖回旧
 * 位置，用户表现就是「滑到位了，点下去却点偏」。
 *
 * 这里把鼠标操作串成一条链：移动在链上合并（只执行最新位置），点击与拖拽
 * 按到达顺序排队，因此「点击一定发生在它之前所有移动之后」。
 */
let mouseChain: Promise<void> = Promise.resolve()
/** 已排队但尚未执行的移动目标；同一时刻只保留最新一个 */
let pendingMove: { x: number; y: number } | null = null
/** 移动执行器；非空表示链上已有一段移动任务在跑 */
let moveRunner: Promise<void> | null = null

/** 把一个任务追加到鼠标链尾部；前一个任务失败不影响后续执行 */
function serializeMouse<T>(task: () => Promise<T>): Promise<T> {
  const run = mouseChain.then(task, task)
  mouseChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 执行一次真实移动；失败静默，下一次移动会带新位置覆盖 */
async function applyMove(x: number, y: number): Promise<void> {
  try {
    await getDesktopControlManager().mouseMove({ x, y })
  } catch {
    // 移动失败静默：它是持续动作，下一次移动会带新位置覆盖
  }
}

/**
 * 请求移动：合并高频位移
 *
 * 链上已有移动任务时只更新目标点，任务在循环里取最新位置执行。
 * 手指滑 20 帧，桌面端只会真正落到链上能跟上的次数，不会排成一队。
 */
function requestMove(x: number, y: number): Promise<void> {
  pendingMove = { x, y }
  if (!moveRunner) {
    moveRunner = serializeMouse(async () => {
      while (pendingMove) {
        const target = pendingMove
        pendingMove = null
        await applyMove(target.x, target.y)
      }
    }).then(() => {
      moveRunner = null
      // 循环退出到置空之间可能又进来一个位置，补一次，避免丢末尾那一帧
      const leftover = pendingMove
      if (leftover) void requestMove(leftover.x, leftover.y)
    })
  }
  return moveRunner
}

/** 等待已排队的移动全部落地 */
async function settleMoves(): Promise<void> {
  while (moveRunner) await moveRunner
}

/** input.click.req → 鼠标点击 */
export async function handleInputClick(
  ctx: DeviceHandlerContext,
  payload: { x?: unknown; y?: unknown; button?: unknown; clickType?: unknown },
): Promise<{ applied: boolean }> {
  assertRemoteInputAllowed(ctx)
  const { x, y } = assertPoint(payload.x, payload.y)
  const clickType = String(payload.clickType) === 'double' ? 'double' : 'single'
  const button = normalizeButton(payload.button)
  // 先让已排队的移动落地再点击：否则点击可能先于最后一帧移动执行，
  // 桌面端指针还停在旧位置，用户看到的就是「点偏了」。
  await settleMoves()
  const result = await serializeMouse(() =>
    getDesktopControlManager().mouseClick({ x, y, button, clickType }),
  )
  assertApplied(result, 'mouse_click')
  return { applied: true }
}

/** input.move.req → 鼠标移动 */
export async function handleInputMove(
  ctx: DeviceHandlerContext,
  payload: { x?: unknown; y?: unknown },
): Promise<{ applied: boolean }> {
  assertRemoteInputAllowed(ctx)
  const { x, y } = assertPoint(payload.x, payload.y)
  // 不等执行结果：等一次就退回串行 RPC，帧率会被单次注入耗时锁死。
  // 移动是持续动作，合并后只执行最新位置，个别帧失败会被下一帧覆盖。
  void requestMove(x, y)
  return { applied: true }
}

/** input.scroll.req → 鼠标滚轮 */
export async function handleInputScroll(
  ctx: DeviceHandlerContext,
  payload: { x?: unknown; y?: unknown; amount?: unknown },
): Promise<{ applied: boolean }> {
  assertRemoteInputAllowed(ctx)
  const { x, y } = assertPoint(payload.x, payload.y)
  const amount = Number(payload.amount)
  if (!Number.isFinite(amount) || amount === 0) throw new Error('invalid_scroll_amount')
  // 滚动依赖光标所在位置，必须等排队中的移动落地，否则会在旧位置滚
  await settleMoves()
  const result = await serializeMouse(() =>
    getDesktopControlManager().mouseScroll({ x, y, amount: Math.round(amount) }),
  )
  assertApplied(result, 'mouse_scroll')
  return { applied: true }
}

/** input.drag.req → 鼠标拖拽 */
export async function handleInputDrag(
  ctx: DeviceHandlerContext,
  payload: {
    fromX?: unknown
    fromY?: unknown
    toX?: unknown
    toY?: unknown
    button?: unknown
    duration?: unknown
  },
): Promise<{ applied: boolean }> {
  assertRemoteInputAllowed(ctx)
  const from = assertPoint(payload.fromX, payload.fromY)
  const to = assertPoint(payload.toX, payload.toY)
  const duration = Number(payload.duration)
  // 拖拽每段都要执行，不能合并（合并会丢掉轨迹），但必须与前后的移动、点击同序
  const result = await serializeMouse(() =>
    getDesktopControlManager().mouseDrag({
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      button: normalizeButton(payload.button),
      duration: Number.isFinite(duration) && duration > 0 ? Math.min(duration, 5000) : undefined,
    }),
  )
  assertApplied(result, 'mouse_drag')
  return { applied: true }
}

/** input.type.req → 键入文本 */
export async function handleInputType(
  ctx: DeviceHandlerContext,
  payload: { text?: unknown; delayMs?: unknown },
): Promise<{ applied: boolean; length: number }> {
  assertRemoteInputAllowed(ctx)
  const text = String(payload.text ?? '')
  if (!text) throw new Error('empty_text')
  // 单次上限：防止一条消息灌进超长文本把注入层卡住
  if (text.length > 2000) throw new Error('text_too_long')
  const delay = Number(payload.delayMs)
  const result = await getDesktopControlManager().typeText(
    text,
    Number.isFinite(delay) && delay >= 0 ? Math.min(delay, 100) : undefined,
  )
  assertApplied(result, 'type_text')
  return { applied: true, length: text.length }
}

/** input.key.req → 单键或组合键 */
export async function handleInputKey(
  ctx: DeviceHandlerContext,
  payload: { key?: unknown; keys?: unknown },
): Promise<{ applied: boolean }> {
  assertRemoteInputAllowed(ctx)
  const keys = Array.isArray(payload.keys) ? payload.keys.map((k) => String(k)).filter(Boolean) : []
  const single = typeof payload.key === 'string' ? payload.key : ''
  let result: { success?: boolean; error?: string } | undefined
  if (keys.length > 1) {
    result = await getDesktopControlManager().keyCombo(keys)
  } else if (keys.length === 1) {
    result = await getDesktopControlManager().pressKey(keys[0])
  } else if (single) {
    result = await getDesktopControlManager().pressKey(single)
  } else {
    throw new Error('empty_key')
  }
  assertApplied(result, 'input_key')
  return { applied: true }
}

/**
 * input.emergency-stop.req → 远程急停 / 解除急停 / 读取急停状态
 *
 * 与其它输入操作的准入差异（刻意为之）：
 * - trigger 不做 allowRemoteInput 检查。急停是"刹车"，不是"油门"：
 *   一旦发现远程操作不受控，移动端必须能立即断开，哪怕权限已被撤销。
 * - reset 也不做 allowRemoteInput 检查，但要求急停确实处于触发态才有意义
 *   （未触发时 reset 是幂等的空操作）。谁解除、何时解除由审计与事件上报留痕。
 * - state 只读，供移动端进入控制页时同步按钮状态，避免重复触发或误解除。
 */
export async function handleInputEmergencyStop(
  _ctx: DeviceHandlerContext,
  payload: { action?: unknown; reason?: unknown } = {},
): Promise<{
  applied: boolean
  stopped: boolean
  triggeredAt: number | null
  source: string | null
  reason: string | null
  triggerCount: number
}> {
  const controller = getDesktopControlManager().emergencyStop
  const action = String(payload.action ?? 'trigger')

  switch (action) {
    case 'trigger': {
      const reason = typeof payload.reason === 'string' && payload.reason
        ? payload.reason.slice(0, 200)
        : 'remote_control_requested'
      controller.trigger({ source: 'remote', reason })
      const state = controller.getState()
      return {
        applied: true,
        stopped: state.stopped,
        triggeredAt: state.triggeredAt ?? null,
        source: state.source ?? null,
        reason: state.reason ?? null,
        triggerCount: state.triggerCount,
      }
    }
    case 'reset': {
      const before = controller.isStopped()
      controller.reset()
      const state = controller.getState()
      return {
        applied: before,
        stopped: state.stopped,
        triggeredAt: state.triggeredAt ?? null,
        source: state.source ?? null,
        reason: state.reason ?? null,
        triggerCount: state.triggerCount,
      }
    }
    case 'state': {
      const state = controller.getState()
      return {
        applied: false,
        stopped: state.stopped,
        triggeredAt: state.triggeredAt ?? null,
        source: state.source ?? null,
        reason: state.reason ?? null,
        triggerCount: state.triggerCount,
      }
    }
    default:
      throw new Error('unknown_emergency_stop_action')
  }
}

// ============================================================================
// 控制画面拉帧（远程控制）
// ============================================================================

/**
 * screen.frame.req → 按需拉取一帧画面
 *
 * 与 screenshot.req 的分工：
 * - screenshot.req 是"看一眼"，输出原始截图，用于单次查看
 * - screen.frame.req 是"连续看"，按调用方给的宽度与质量压缩，服务远程控制的高频拉流
 *
 * 返回值必须同时给出两套尺寸：
 * - imageWidth / imageHeight 是这一帧图片的像素尺寸（移动端据此把触摸点换算成图上位置）
 * - screenWidth / screenHeight 是桌面逻辑坐标尺寸（clicks 注入使用的坐标系）
 * 两者只有在缩放比一致时才等价，所以分开传，由移动端各自换算，不做隐式假设。
 */
export async function handleScreenFrame(
  ctx: DeviceHandlerContext,
  payload: { maxWidth?: unknown; quality?: unknown } = {},
): Promise<{
  url: string
  imageWidth: number
  imageHeight: number
  screenWidth: number
  screenHeight: number
  takenAt: number
}> {
  if (!ctx.preferences().allowScreenshot) throw new Error('forbidden_by_policy')

  const maxWidthRaw = Number(payload.maxWidth)
  const qualityRaw = Number(payload.quality)
  const maxWidth = Number.isFinite(maxWidthRaw)
    ? Math.max(320, Math.min(2560, Math.round(maxWidthRaw)))
    : 1280
  const quality = Number.isFinite(qualityRaw)
    ? Math.max(30, Math.min(90, Math.round(qualityRaw)))
    : 60

  const captured: ScreenshotResult = await getDesktopControlManager().captureScreen(0)
  if (!captured.success || !captured.dataUrl) {
    throw new Error(captured.error || 'capture_failed')
  }

  let image = nativeImage.createFromDataURL(captured.dataUrl)
  if (image.isEmpty()) throw new Error('empty_image')

  const origin = image.getSize()
  if (origin.width > maxWidth) {
    const ratio = maxWidth / origin.width
    image = image.resize({ width: maxWidth, height: Math.round(origin.height * ratio) })
  }
  const size = image.getSize()

  return {
    url: `data:image/jpeg;base64,${image.toJPEG(quality).toString('base64')}`,
    imageWidth: size.width,
    imageHeight: size.height,
    screenWidth: captured.region?.width || origin.width,
    screenHeight: captured.region?.height || origin.height,
    takenAt: Date.now(),
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
// 聊天记录导出
// ============================================================================

/** chat.export.req → 读取本地 SQLite 会话数据库，返回线程及其消息列表 */
export async function handleChatExport(
  _ctx: DeviceHandlerContext,
): Promise<{
  items: Array<{
    id: string
    title: string
    messages: Array<{ role: string; content: string; createdAt?: number }>
    createdAt?: number
    lastModified?: number
  }>
  count: number
}> {
  try {
    const db = SessionDb.getInstance()
    // 确保数据库已初始化（若 renderer 未触发初始化，此处兜底）
    await db.initialize()

    // 取所有线程摘要（不按 userId 过滤，导出本机全部会话）
    const summaries = db.getAllThreadSummaries()
    // 限制导出数量，避免数据过大：最近 50 个线程
    const limited = summaries.slice(0, 50)

    const items = limited.map((s) => {
      const rawMessages = db.getThreadMessages(s.id) || []
      // 限制每个线程最多 100 条消息
      const msgs = rawMessages.slice(-100).map((m: any) => ({
        role: String(m?.role || 'user'),
        content: String(m?.content || ''),
        createdAt: typeof m?.createdAt === 'number' ? m.createdAt : undefined,
      })).filter((m: any) => m.content)

      return {
        id: String(s.id),
        title: String(s.title || '').trim() || (msgs[0]?.content?.slice(0, 30) || 'Untitled'),
        messages: msgs,
        createdAt: undefined,
        lastModified: typeof s.lastModified === 'number' ? s.lastModified : undefined,
      }
    }).filter((i: any) => i.messages.length > 0)

    return { items, count: items.length }
  } catch (err: any) {
    logger.deviceLink.error('[ChatExport] Failed to export chats:', err?.message)
    throw new Error('chat_export_failed')
  }
}

// ============================================================================
// 远程权限（权限中心）
// ============================================================================

/** 可由移动端申请的远程权限范围 */
export type PermissionScope = 'shell' | 'screenshot' | 'clipboard' | 'power' | 'input'

export const PERMISSION_SCOPES: PermissionScope[] = [
  'shell',
  'screenshot',
  'clipboard',
  'power',
  'input',
]

const SCOPE_LABELS: Record<PermissionScope, string> = {
  shell: '远程执行命令',
  screenshot: '远程截屏',
  clipboard: '远程剪贴板推送',
  power: '远程休眠/唤醒',
  input: '远程鼠标键盘控制',
}

const SCOPE_PREFERENCE_KEYS: Record<PermissionScope, keyof DeviceLinkPreferences> = {
  shell: 'allowRemoteCommand',
  screenshot: 'allowScreenshot',
  clipboard: 'allowClipboardPush',
  power: 'allowPowerControl',
  input: 'allowRemoteInput',
}

/** 临时授权时长 */
const TEMP_GRANT_MS = 10 * 60 * 1000

function toScope(raw: string): PermissionScope {
  return (PERMISSION_SCOPES as string[]).includes(raw) ? (raw as PermissionScope) : 'shell'
}

export interface PermissionSnapshot {
  allowRemoteCommand: boolean
  allowClipboardPush: boolean
  allowScreenshot: boolean
  allowPowerControl: boolean
  /** 是否允许远程鼠标键盘注入 */
  allowRemoteInput: boolean
  /** 各范围临时授权剩余毫秒（0 = 无） */
  tempRemaining: Partial<Record<PermissionScope, number>>
}

/** permission.state.req → 桌面端当前开关快照 */
export function handlePermissionState(ctx: DeviceHandlerContext): PermissionSnapshot {
  const prefs = ctx.preferences()
  return {
    allowRemoteCommand: !!prefs.allowRemoteCommand,
    allowClipboardPush: prefs.allowClipboardPush ?? true,
    allowScreenshot: prefs.allowScreenshot ?? true,
    allowPowerControl: !!prefs.allowPowerControl,
    allowRemoteInput: !!prefs.allowRemoteInput,
    tempRemaining: Object.fromEntries(
      PERMISSION_SCOPES.map((s) => [s, ctx.tempGrantRemaining?.(s) ?? 0]),
    ) as Partial<Record<PermissionScope, number>>,
  }
}

export type PermissionDecisionMode = 'denied' | 'temp' | 'always'

export interface PermissionDecision {
  scope: PermissionScope
  granted: boolean
  mode: PermissionDecisionMode
}

/**
 * 弹框前把主窗口带到前台
 *
 * macOS 上 dialog.showMessageBox(win, options) 是附着在窗口上的 sheet。当窗口被隐藏
 * （悬浮头像模式下 close 会转成 hide）、最小化或停在后台时，sheet 既不显示也不抢焦点，
 * 用户完全看不到确认框；请求会一路挂到 RPC 超时（30s）才失败，移动端只能报「请到电脑前」。
 * 所以弹框前必须显式唤醒窗口，并用 app.focus 抢一次焦点。
 */
function bringMainWindowToFront(win: BrowserWindow | null): void {
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  }
  // 仅 win.focus() 在窗口隐藏/后台时不足以把 sheet 顶到最前
  if (process.platform === 'darwin') app.focus({ steal: true })
}

/** permission.request → 弹系统确认框，同意后写入开关或 10 分钟临时授权 */
export async function handlePermissionRequest(
  ctx: DeviceHandlerContext,
  payload: { scope?: string; reason?: string },
): Promise<PermissionDecision> {
  const scope = toScope(payload.scope || 'shell')
  const reason = (payload.reason || '').trim()
  const options = {
    type: 'warning' as const,
    title: '移动端申请远程权限',
    message: `允许移动端「${SCOPE_LABELS[scope]}」？`,
    detail: [
      reason || '来自已登录的移动端设备申请。',
      '选择「允许 10 分钟」到期后自动关闭，选择「始终允许」写入本机设置。',
    ].join('\n'),
    buttons: ['拒绝', '允许 10 分钟', '始终允许'],
    defaultId: 1,
    cancelId: 0,
    noLink: true,
  }
  const win = ctx.getMainWindow()
  logger.deviceLink.info(`[Client] permission.request scope=${scope} reason=${reason || '-'}`)
  bringMainWindowToFront(win)

  const { response } = win && !win.isDestroyed()
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)

  if (response === 1) {
    ctx.applyPermission?.(scope, 'temp')
    return { scope, granted: true, mode: 'temp' }
  }
  if (response === 2) {
    ctx.applyPermission?.(scope, 'always')
    return { scope, granted: true, mode: 'always' }
  }
  return { scope, granted: false, mode: 'denied' }
}

/** 由权限决策反查对应的偏好开关名（供上层写入设置） */
export function preferenceKeyForScope(scope: PermissionScope): keyof DeviceLinkPreferences {
  return SCOPE_PREFERENCE_KEYS[scope]
}

/** 本次临时授权的时长（ms） */
export function tempGrantDurationMs(): number {
  return TEMP_GRANT_MS
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
