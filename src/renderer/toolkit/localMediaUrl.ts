/**
 * 本地媒体文件 → 渲染进程可加载的 URL
 *
 * 渲染进程的 webSecurity 为 true，<img>/<video> 不能直接读 file://；
 * 主进程注册的 local-preview:// 协议专门负责这类访问：它按扩展名返回正确的
 * Content-Type，并支持 HTTP Range —— 视频拖动进度条必需，否则 <video> 直接 onError。
 *
 * @module utils/localMediaUrl
 */

/** 产物大类 */
export type MediaKind = 'image' | 'video' | 'audio' | 'document' | 'other'

/** 扩展名 → 大类。文档类只收「值得单独成卡」的格式，代码文件不算产物 */
const EXT_KIND: Record<string, MediaKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image',
  bmp: 'image', svg: 'image', ico: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video', m4v: 'video',
  ogv: 'video', avi: 'video', '3gp': 'video',
  mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio', m4a: 'audio',
  aac: 'audio', opus: 'audio',
  pdf: 'document', docx: 'document', doc: 'document', xlsx: 'document',
  xls: 'document', pptx: 'document', ppt: 'document', csv: 'document',
  md: 'document', txt: 'document', html: 'document', htm: 'document',
}

/** 取扩展名（小写，不含点） */
export function getExtension(filePath: string): string {
  const cleaned = filePath.split(/[?#]/)[0]
  const dot = cleaned.lastIndexOf('.')
  if (dot <= 0 || dot === cleaned.length - 1) return ''
  return cleaned.slice(dot + 1).toLowerCase()
}

/** 按扩展名判断产物大类 */
export function detectMediaKind(filePath: string): MediaKind {
  return EXT_KIND[getExtension(filePath)] ?? 'other'
}

/** 是否为可渲染的媒体（图片 / 视频 / 音频） */
export function isRenderableMediaKind(kind: MediaKind): boolean {
  return kind === 'image' || kind === 'video' || kind === 'audio'
}

/** `file://` URL 转本地路径（兼容 Windows 的 file:///C:/x 形式） */
export function fileUrlToPath(value: string): string {
  if (!value.startsWith('file://')) return value
  const raw = value.slice('file://'.length)
  // file:///a/b → /a/b；file:///C:/a → C:/a
  const withoutLeading = raw.startsWith('/') && /^\/[A-Za-z]:/.test(raw) ? raw.slice(1) : raw
  try {
    return decodeURIComponent(withoutLeading)
  } catch {
    return withoutLeading
  }
}

/**
 * 是否为文件系统绝对路径
 *
 * 只认 Unix 绝对路径与 Windows 盘符路径：相对路径无法在这里解析成绝对位置
 * （渲染进程不知道工作目录），误判会把普通文本当成文件路径。
 */
export function isAbsoluteFilePath(value: string): boolean {
  if (!value) return false
  if (/^[A-Za-z]:[\\/]/.test(value)) return true
  return value.startsWith('/')
}

/** 本地路径 → local-preview:// URL（协议处理器会解码 pathname 后读文件） */
export function toLocalPreviewUrl(filePath: string): string {
  return `local-preview:///${encodeURIComponent(filePath).replace(/%2F/g, '/')}`
}

/**
 * 任意来源的媒体地址 → 可直接放进 src 的 URL
 *
 * - data: / blob: / http(s): / local-preview: 原样返回
 * - file:// 与本地绝对路径 → local-preview://
 * - 其它（相对路径、纯文本）返回 null，交由调用方降级处理
 */
export function toRenderableMediaUrl(raw: string | undefined | null): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (/^(data:|blob:|https?:|local-preview:)/i.test(value)) return value
  const localPath = fileUrlToPath(value)
  if (isAbsoluteFilePath(localPath)) return toLocalPreviewUrl(localPath)
  return null
}
