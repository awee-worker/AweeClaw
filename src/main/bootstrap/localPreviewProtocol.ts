/**
 * local-preview 自定义协议
 *
 * 用于在渲染进程安全地访问本地文件（如 AI 生成的图片/视频预览、知识库附件等），
 * 相比直接 file:// 协议，本协议：
 * 1. 显式注册为 privileged，支持 fetch API 与流式响应
 * 2. 拦截敏感系统目录的访问请求
 * 3. 支持 HTTP Range 请求（视频播放必需，返回 206 Partial Content）
 * 4. 根据文件扩展名设置正确的 Content-Type
 *
 * 必须在 app.whenReady() 之前调用 registerScheme()，
 * 在 whenReady() 之后调用 registerHandler()。
 */
import { app, protocol } from 'electron'
import * as path from 'node:path'
import { statSync, createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

const SCHEME = 'local-preview'

/** 禁止访问的敏感系统目录 */
const SENSITIVE_PATHS = ['/etc', '/proc', '/sys', '/dev', 'C:\\Windows\\System32']

/**
 * 文件扩展名 → MIME 类型映射
 *
 * net.fetch('file://...') 对部分扩展名（尤其视频）可能不设置正确的 Content-Type，
 * 导致 <video> 元素无法识别视频格式。这里手动补充常见类型。
 */
const MIME_TYPES: Record<string, string> = {
  // 视频
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/x-m4v',
  '.ogv': 'video/ogg',
  '.3gp': 'video/3gpp',
  // 音频
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  // 图片
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  // 文本/代码
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  // 文档
  '.pdf': 'application/pdf',
}

/** 根据文件扩展名获取 MIME 类型 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

/** 注册协议为 privileged（必须在 app ready 之前调用） */
export function registerLocalPreviewScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        bypassCSP: true,
        allowServiceWorkers: false,
        supportFetchAPI: true,
        stream: true,
        standard: false,
        secure: true,
        corsEnabled: false,
      },
    },
  ])
}

/**
 * 注册协议处理器（必须在 app ready 之后调用）
 *
 * 处理逻辑：
 * 1. 解析 URL 中的文件路径
 * 2. 校验敏感目录
 * 3. 如果请求带 Range 头（视频/音频播放），返回 206 Partial Content
 * 4. 否则返回完整文件（200 OK）
 *
 * 手动处理 Range 请求的原因：
 *   net.fetch('file://...') 不会自动处理 Range 请求，总是返回 200 OK。
 *   <video> 元素播放视频时需要 206 Partial Content 响应来支持流式播放和 seek。
 *   不处理 Range 请求会导致 <video> onError 触发，视频无法加载。
 */
export function registerLocalPreviewHandler(): void {
  protocol.handle(SCHEME, async (request) => {
    const url = new URL(request.url)
    let filePath = decodeURIComponent(url.pathname)

    // Windows 路径以 / 开头需剥离前导斜杠
    if (process.platform === 'win32' && filePath.startsWith('/')) {
      filePath = filePath.slice(1)
    }

    if (!filePath) {
      return new Response('Bad Request', { status: 400 })
    }

    const normalized = path.resolve(filePath)
    if (SENSITIVE_PATHS.some((s) => normalized.startsWith(s))) {
      return new Response('Forbidden', { status: 403 })
    }

    // 获取文件信息
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(normalized)
    } catch {
      return new Response('Not Found', { status: 404 })
    }

    if (!stats.isFile()) {
      return new Response('Not a file', { status: 404 })
    }

    const fileSize = stats.size
    const contentType = getMimeType(normalized)
    const rangeHeader = request.headers.get('range')

    // 处理 Range 请求（视频/音频播放）
    if (rangeHeader) {
      const match = /bytes=(\d+)-(\d*)/.exec(rangeHeader)
      if (match) {
        const start = parseInt(match[1], 10)
        const end = match[2] ? Math.min(parseInt(match[2], 10), fileSize - 1) : fileSize - 1

        // 越界检查
        if (start >= fileSize || end < start) {
          return new Response('Range Not Satisfiable', {
            status: 416,
            headers: {
              'Content-Range': `bytes */${fileSize}`,
            },
          })
        }

        const chunkSize = end - start + 1
        const stream = createReadStream(normalized, { start, end })
        const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>

        return new Response(webStream, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize.toString(),
            'Content-Type': contentType,
          },
        })
      }
    }

    // 无 Range 请求：返回完整文件
    // 对于小文件（图片、HTML 等），用 net.fetch 即可
    // 对于大文件，也用 createReadStream 流式返回，避免一次性读入内存
    const stream = createReadStream(normalized)
    const webStream = Readable.toWeb(stream) as ReadableStream<Uint8Array>

    return new Response(webStream, {
      status: 200,
      headers: {
        'Accept-Ranges': 'bytes',
        'Content-Length': fileSize.toString(),
        'Content-Type': contentType,
      },
    })
  })
}

/** 当前应用是否已就绪（用于在 registerHandler 调用前的防御性检查） */
export function isAppReady(): boolean {
  return app.isReady()
}
