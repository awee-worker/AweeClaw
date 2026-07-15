/**
 * 剪贴板服务 — 读取原生剪贴板中的文件路径
 *
 * 跨平台实现：
 * - macOS：通过 osascript 调用 AppleScript 的 «class furl» 读取文件 alias
 *          （Electron clipboard.readBuffer('public.file-url') 返回 NSKeyedArchiver
 *           编码的 binary plist，无法直接 toString 解析）
 * - Windows：解析 CF_HDROP 格式（支持多文件），解析 DROPFILES 结构
 * - Linux：读取 text/uri-list 格式（支持多文件），解析 file:// URI 列表
 *
 * 用途：在聊天输入框粘贴从 Finder/Explorer 复制的文件时，
 * 浏览器 clipboardData 仅暴露图片 File 对象，非图片文件需通过
 * 本服务读取原生剪贴板获取完整文件路径。
 */

import { ipcMain, clipboard } from 'electron'
import * as fs from 'fs'
import { promises as fsPromises } from 'fs'
import { execSync } from 'child_process'
import { logger } from '@shared/toolkit/LogEngine'

/** 文件扩展名 → MIME 类型映射 */
const MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  json: 'application/json',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  rar: 'application/x-rar-compressed',
  '7z': 'application/x-7z-compressed',
  tar: 'application/x-tar',
  gz: 'application/gzip',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  wav: 'audio/wav',
  avi: 'video/x-msvideo',
  mov: 'video/quicktime',
}

/** 图片扩展名集合 */
const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico',
])

/** 最大文件大小：50MB（与 file:readBinary 一致） */
const MAX_FILE_SIZE = 50 * 1024 * 1024

/** 剪贴板文件附件数据结构 */
export interface ClipboardFileAttachment {
  path: string
  name: string
  ext: string
  mimeType: string
  base64: string
  isImage: boolean
  size: number
}

/** 是否有文件在剪贴板中（快速判断，不解析路径） */
function hasFilesInClipboard(): boolean {
  try {
    const formats = clipboard.availableFormats()
    logger.system.info('[Clipboard] availableFormats:', formats)

    if (process.platform === 'darwin') {
      return formats.includes('public.file-url') || formats.includes('public.file-urls')
    }
    if (process.platform === 'win32') {
      return formats.includes('CF_HDROP')
    }
    if (process.platform === 'linux') {
      return formats.includes('text/uri-list')
    }
  } catch (err) {
    logger.system.error('[Clipboard] hasFilesInClipboard error:', err)
  }
  return false
}

/**
 * macOS：通过 osascript 读取剪贴板中的文件路径
 *
 * Electron 的 clipboard.readBuffer('public.file-url') 返回的是 NSKeyedArchiver
 * 编码的二进制 plist，无法直接 toString 解析。使用 AppleScript 的 «class furl»
 * 可以可靠地获取文件 alias 并转换为 POSIX path。
 *
 * AppleScript 中 «class furl» 对应 NSFileUrlPboardType，读取后得到 alias，
 * 通过 `POSIX path of` 转换为 POSIX 路径字符串。
 *
 * @returns 文件绝对路径数组；无文件或出错时返回空数组
 */
function readFilePathsMacOS(): string[] {
  const filePaths: string[] = []

  // AppleScript：读取剪贴板中的 «class furl»（文件 URL），转换为 POSIX path
  // 支持单文件和多文件（结果可能是 alias 或 list of alias）
  const script = `try
	set fileAliases to (the clipboard as «class furl»)
	set pathList to {}
	if (class of fileAliases) is list then
		repeat with f in fileAliases
			set end of pathList to (POSIX path of f)
		end repeat
	else
		set end of pathList to (POSIX path of fileAliases)
	end if
	set {oldTID, AppleScript's text item delimiters} to {AppleScript's text item delimiters, linefeed}
	set pathString to pathList as text
	set AppleScript's text item delimiters to oldTID
	return pathString
on error errMsg
	return ""
end try`

  try {
    // 通过 stdin 传递脚本，避免 shell 转义问题
    const result = execSync('osascript -', {
      input: script,
      encoding: 'utf8',
      timeout: 3000,
    }).trim()

    logger.system.info('[Clipboard] macOS osascript result:', JSON.stringify(result))

    if (result) {
      const paths = result.split('\n').filter(Boolean)
      for (const p of paths) {
        const trimmed = p.trim()
        if (trimmed && fs.existsSync(trimmed)) {
          filePaths.push(trimmed)
        } else {
          logger.system.warn('[Clipboard] Path does not exist:', trimmed)
        }
      }
    }
  } catch (err) {
    logger.system.error('[Clipboard] macOS osascript failed:', err)
  }

  return filePaths
}

/**
 * Windows：解析 CF_HDROP 格式读取文件路径
 */
function readFilePathsWindows(): string[] {
  const filePaths: string[] = []

  try {
    const formats = clipboard.availableFormats()
    if (formats.includes('CF_HDROP')) {
      const buffer = clipboard.readBuffer('CF_HDROP')
      const parsed = parseDropFiles(buffer)
      for (const f of parsed) {
        if (fs.existsSync(f)) {
          filePaths.push(f)
        }
      }
    }
    // 兜底：部分 Windows 场景下文件路径以纯文本存在
    if (filePaths.length === 0) {
      const text = clipboard.readText().trim()
      if (text && !text.includes('\n') && fs.existsSync(text)) {
        filePaths.push(text)
      }
    }
  } catch (err) {
    logger.system.error('[Clipboard] Windows read failed:', err)
  }

  return filePaths
}

/**
 * Linux：读取 text/uri-list 格式
 */
function readFilePathsLinux(): string[] {
  const filePaths: string[] = []

  try {
    const formats = clipboard.availableFormats()
    if (formats.includes('text/uri-list')) {
      const buffer = clipboard.readBuffer('text/uri-list')
      const text = buffer.toString('utf8')
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.startsWith('file://'))
      for (const line of lines) {
        const parsed = parseFileUri(line)
        if (parsed && fs.existsSync(parsed)) {
          filePaths.push(parsed)
        }
      }
    }
  } catch (err) {
    logger.system.error('[Clipboard] Linux read failed:', err)
  }

  return filePaths
}

/**
 * 从剪贴板读取文件路径列表
 * @returns 文件绝对路径数组；无文件时返回空数组
 */
function readFilePathsFromClipboard(): string[] {
  try {
    if (process.platform === 'darwin') {
      return readFilePathsMacOS()
    }
    if (process.platform === 'win32') {
      return readFilePathsWindows()
    }
    if (process.platform === 'linux') {
      return readFilePathsLinux()
    }
  } catch (err) {
    logger.system.error('[Clipboard] readFilePathsFromClipboard error:', err)
  }

  return []
}

/** 解析 file:// URI 为本地路径 */
function parseFileUri(uri: string): string | null {
  if (!uri) return null
  // file:///Users/foo → /Users/foo
  // file://localhost/Users/foo → /Users/foo
  const match = uri.match(/^file:\/\/(?:localhost)?\/(.+)$/i)
  if (!match) return null
  // 解码 URL 编码（%20 → 空格等）
  let filePath = decodeURIComponent(match[1])
  // Windows 路径修复：file:///C:/Users → C:\Users
  if (process.platform === 'win32') {
    filePath = filePath.replace(/\//g, '\\')
    // 去除前导的盘符前可能多余的反斜杠
    filePath = filePath.replace(/^\\+([a-zA-Z]:)/, '$1')
  }
  return filePath
}

/**
 * 解析 Windows CF_HDROP 格式
 *
 * DROPFILES 结构：
 * - offset (4 bytes)：文件路径列表相对于结构开头的偏移量
 * - pt.x  (4 bytes)：放置点 X 坐标（未使用）
 * - pt.y  (4 bytes)：放置点 Y 坐标（未使用）
 * - fNC   (4 bytes)：是否使用客户区坐标（未使用）
 * - fWide (4 bytes)：是否为 Unicode（UTF-16LE）
 * - 随后是文件路径列表，以 \0 分隔，以 \0\0 结尾
 */
function parseDropFiles(buffer: Buffer): string[] {
  let files: string[] = []
  if (buffer.length < 20) return []

  try {
    const offset = buffer.readUInt32LE(0)
    const fWide = buffer.readUInt32LE(16)

    if (fWide) {
      // UTF-16LE 编码
      const str = buffer.toString('utf16le', offset)
      files = str.split('\0').filter(s => s.length > 0)
    } else {
      // ANSI 编码
      const str = buffer.toString('latin1', offset)
      files = str.split('\0').filter(s => s.length > 0)
    }
  } catch (err) {
    logger.system.error('[Clipboard] Failed to parse CF_HDROP:', err)
    return []
  }

  return files
}

/**
 * 注册剪贴板相关 IPC 处理器
 */
export function registerClipboardHandlers(): void {
  // 读取剪贴板中的文件路径列表
  ipcMain.handle('clipboard:getFilePaths', async (): Promise<string[]> => {
    const paths = readFilePathsFromClipboard()
    logger.system.info('[Clipboard] getFilePaths returning:', paths)
    return paths
  })

  // 快速检测剪贴板是否包含文件（用于渲染进程决定是否 preventDefault）
  ipcMain.handle('clipboard:hasFiles', async (): Promise<boolean> => {
    const has = hasFilesInClipboard()
    logger.system.info('[Clipboard] hasFiles returning:', has)
    return has
  })

  // 读取剪贴板中的文件并返回完整附件数据（base64 + 元信息）
  // 绕过工作区安全检查，因为用户主动粘贴是明确意图
  // 仍保留文件大小限制（50MB）和存在性检查
  ipcMain.handle('clipboard:getFileAttachments', async (): Promise<ClipboardFileAttachment[]> => {
    const filePaths = readFilePathsFromClipboard()
    logger.system.info('[Clipboard] getFileAttachments, filePaths:', filePaths)
    if (filePaths.length === 0) return []

    const attachments: ClipboardFileAttachment[] = []
    for (const filePath of filePaths) {
      try {
        const stats = await fsPromises.stat(filePath)
        if (stats.size > MAX_FILE_SIZE) {
          logger.system.warn(`[Clipboard] File too large, skipping: ${filePath} (${stats.size} bytes)`)
          continue
        }

        const fileName = filePath.split(/[/\\]/).pop() || 'file'
        const ext = (fileName.split('.').pop() || '').toLowerCase()
        const isImage = IMAGE_EXTENSIONS.has(ext)
        const mimeType = MIME_TYPES[ext] || 'application/octet-stream'

        const buffer = await fsPromises.readFile(filePath)
        const base64 = buffer.toString('base64')

        attachments.push({
          path: filePath,
          name: fileName,
          ext,
          mimeType,
          base64,
          isImage,
          size: stats.size,
        })
      } catch (err) {
        logger.system.error(`[Clipboard] Failed to read file ${filePath}:`, err)
      }
    }

    logger.system.info('[Clipboard] getFileAttachments returning:', attachments.map(a => ({ name: a.name, size: a.size, isImage: a.isImage })))
    return attachments
  })

  logger.system.info('[Clipboard] Clipboard handlers registered')
}
