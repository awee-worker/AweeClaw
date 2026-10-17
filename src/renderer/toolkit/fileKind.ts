/**
 * 文件类型分类
 *
 * 编辑器 Tab 靠扩展名决定用哪个预览器（文本 / 图片 / PDF / Office / 3D 模型 …），
 * 因此「这个路径属于哪一类」是所有打开入口的共同前提：文件树、聊天里的文件引用、
 * 消息正文里的链接都读同一张表，避免某一处新增了预览类型、另一处仍当作文本读取，
 * 结果把几十 MB 的二进制读成字符串塞进编辑器。
 */

/** 图片扩展名（svg 也归此类：按文本渲染会丢掉矢量效果） */
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']
/** 视频扩展名 */
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv', '3gp']
/** Markdown 扩展名 */
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx']
/** HTML 扩展名 */
const HTML_EXTENSIONS = ['html', 'htm']
/** PDF 扩展名 */
const PDF_EXTENSIONS = ['pdf']
/** Word（OOXML）扩展名 */
const DOCX_EXTENSIONS = ['docx']
/** Word（旧版二进制）扩展名 */
const DOC_EXTENSIONS = ['doc']
/** PowerPoint（OOXML）扩展名 */
const PPTX_EXTENSIONS = ['pptx']
/** PowerPoint（旧版二进制）扩展名 */
const PPT_EXTENSIONS = ['ppt']
/** Excel 扩展名 */
const XLSX_EXTENSIONS = ['xlsx', 'xls']
/** 表格文本扩展名 */
const CSV_EXTENSIONS = ['csv', 'tsv']
/** 不可解读的二进制扩展名 */
const BINARY_EXTENSIONS = [
  'exe', 'dll', 'so', 'dylib', 'bin', 'zip', 'tar', 'gz', 'rar', '7z',
  'mp3', 'wav', 'flac', 'psd', 'ai', 'sketch',
]
/** 3D 模型扩展名（GLB 自包含纹理，glTF 需要外部 .bin/.png） */
const MODEL_3D_EXTENSIONS = ['glb', 'gltf']

/** 文件类型 */
export type FileType =
  | 'text'
  | 'markdown'
  | 'image'
  | 'video'
  | 'html'
  | 'pdf'
  | 'docx'
  | 'doc'
  | 'pptx'
  | 'ppt'
  | 'xlsx'
  | 'csv'
  | 'binary'
  | 'model3d'
  | 'unknown'

/** 按扩展名推断文件类型 */
export function getFileType(path: string): FileType {
  const ext = path.split('.').pop()?.toLowerCase() || ''

  if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
  if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
  if (MARKDOWN_EXTENSIONS.includes(ext)) return 'markdown'
  if (HTML_EXTENSIONS.includes(ext)) return 'html'
  if (PDF_EXTENSIONS.includes(ext)) return 'pdf'
  if (DOCX_EXTENSIONS.includes(ext)) return 'docx'
  if (DOC_EXTENSIONS.includes(ext)) return 'doc'
  if (PPTX_EXTENSIONS.includes(ext)) return 'pptx'
  if (PPT_EXTENSIONS.includes(ext)) return 'ppt'
  if (XLSX_EXTENSIONS.includes(ext)) return 'xlsx'
  if (CSV_EXTENSIONS.includes(ext)) return 'csv'
  if (MODEL_3D_EXTENSIONS.includes(ext)) return 'model3d'
  if (BINARY_EXTENSIONS.includes(ext)) return 'binary'

  return 'text'
}

/** 是否有专门的预览器（不需要用户「以文本方式打开」） */
export function isPreviewableFile(path: string): boolean {
  const type = getFileType(path)
  return type === 'markdown' || type === 'image' || type === 'video' || type === 'pdf'
    || type === 'docx' || type === 'doc' || type === 'pptx' || type === 'ppt'
    || type === 'xlsx' || type === 'csv' || type === 'model3d'
}

/** 是否为不可解读的二进制文件 */
export function isBinaryFile(path: string): boolean {
  return getFileType(path) === 'binary'
}

/**
 * 打开该文件时是否需要预先读取文本内容
 *
 * 图片 / 视频 / PDF / Office / 3D 模型的预览器都按路径自行取数据（视频还走 Range
 * 流式读取），把内容提前 read 一遍不仅无用，还会让整份二进制以字符串形式过一遍
 * 内存与 IPC —— 几十 MB 的 PDF 就是这么把渲染进程顶高的。
 */
export function needsTextContent(path: string): boolean {
  const type = getFileType(path)
  return !(
    type === 'image'
    || type === 'video'
    || type === 'pdf'
    || type === 'docx'
    || type === 'doc'
    || type === 'pptx'
    || type === 'ppt'
    || type === 'xlsx'
    || type === 'model3d'
    || type === 'binary'
  )
}
