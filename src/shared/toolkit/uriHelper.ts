/**
 * LSP URI 工具 — 基于 URL 解析的路径与 URI 互转
 *
 * 使用标准 URL 对象解析 file:// 协议，支持跨平台路径处理
 */

/** 协议常量 */
const FILE_PROTOCOL = 'file://'
const FILE_PROTOCOL_SLASHED = 'file:///'
/** Windows 盘符正则（如 C:） */
const WINDOWS_DRIVE_REGEX = /^[a-zA-Z]:/

/** URI 解析结果 */
interface ParsedFileUri {
  /** 是否为 file:// 协议 */
  readonly isFile: boolean
  /** 解码后的路径部分（不含协议） */
  readonly path: string
  /** 是否为 Windows 盘符路径 */
  readonly isWindows: boolean
}

/** 使用 URL 对象解析 file URI */
function parseFileUri(uri: string): ParsedFileUri {
  if (!uri.startsWith(FILE_PROTOCOL)) {
    return { isFile: false, path: uri, isWindows: false }
  }

  try {
    const url = new URL(uri)
    const decoded = decodeURIComponent(url.pathname)
    const isWindows = WINDOWS_DRIVE_REGEX.test(decoded)
    return { isFile: true, path: decoded, isWindows }
  } catch {
    // URL 解析失败时回退到字符串切片
    let path = uri
    if (path.startsWith(FILE_PROTOCOL_SLASHED)) {
      path = path.slice(FILE_PROTOCOL_SLASHED.length)
      if (!WINDOWS_DRIVE_REGEX.test(path)) {
        path = `/${path}`
      }
    } else {
      path = path.slice(FILE_PROTOCOL.length)
    }
    try {
      path = decodeURIComponent(path)
    } catch {
      /* 保留原值 */
    }
    return { isFile: true, path, isWindows: WINDOWS_DRIVE_REGEX.test(path) }
  }
}

/** 将文件路径转换为 LSP URI */
export function pathToLspUri(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/')
  if (WINDOWS_DRIVE_REGEX.test(normalized)) {
    return `${FILE_PROTOCOL_SLASHED}${normalized}`
  }
  return `${FILE_PROTOCOL}${normalized}`
}

/** 将 LSP URI 转换为文件路径 */
export function lspUriToPath(uri: string): string {
  const parsed = parseFileUri(uri)
  if (!parsed.isFile) return uri
  return parsed.isWindows ? parsed.path.replace(/\//g, '\\') : parsed.path
}

/** 规范化 LSP URI — 统一协议格式与盘符大小写 */
export function normalizeLspUri(uri: string): string {
  if (!uri) return uri

  try {
    const decoded = decodeURIComponent(uri)
    if (decoded.startsWith(FILE_PROTOCOL_SLASHED)) {
      const segment = decoded.slice(FILE_PROTOCOL_SLASHED.length)
      // Windows 盘符统一大写
      if (/^[a-z]:/.test(segment)) {
        return `${FILE_PROTOCOL_SLASHED}${segment[0].toUpperCase()}${segment.slice(1)}`
      }
      return `${FILE_PROTOCOL_SLASHED}${segment}`
    }
    if (decoded.startsWith(FILE_PROTOCOL)) {
      return `${FILE_PROTOCOL_SLASHED}${decoded.slice(FILE_PROTOCOL.length)}`
    }
    return decoded
  } catch {
    return uri
  }
}

/** 判断是否为 file:// URI */
export function isFileUri(uri: string): boolean {
  return uri.startsWith(FILE_PROTOCOL)
}

/** 从 URI 中提取 authority 部分 */
export function extractAuthority(uri: string): string | null {
  const match = uri.match(/^(\w+):\/\/([^/]+)/)
  return match ? match[2] : null
}

/** 根据路径片段构建 file URI */
export function buildFileUri(segments: string[]): string {
  const joined = segments.join('/').replace(/\\/g, '/')
  return pathToLspUri(joined)
}
