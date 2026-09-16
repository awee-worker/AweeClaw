/**
 * 模型文件内容校验（纯函数，无 Electron / 文件系统依赖，便于单元测试）
 *
 * 背景：
 * HuggingFace / ModelScope 在文件不存在、限流或需要登录时，常以 HTTP 200
 * 返回一张 HTML 错误页或一段错误 JSON。若不拦截，错误页会被写进模型目录，
 * 让「下载成功」的判定失真，后续加载模型时报出难以定位的解析错误。
 *
 * 判定必须精确，不能只看首字符是否为 "<"：
 * SenseVoice 的 tokens.txt 首行是 `<unk> 0`，以 "<" 开头却是完全合法的词表文件。
 * 早期实现用 `head.startsWith('<')` 把它误杀，表现为「下载内容不是有效文件
 * （315894 字节）」，并且每次重试都会重新下载 200MB+ 的权重文件。
 *
 * @module local-voice/modelFileValidator
 */

/** 明确的 HTML 文档特征（不会匹配 "<unk>"、"<blank>" 这类纯文本词表） */
const HTML_DOCUMENT_HINTS = [
  '<!doctype html',
  '<html',
  '<head>',
  '<head ',
  '<body',
  '<title>',
]

/** 判定 JSON 错误页时允许的最大体积 */
const JSON_ERROR_MAX_BYTES = 64 * 1024

/**
 * 判断响应体是否为平台返回的错误页（而非真实模型文件）
 *
 * @param buffer 已下载完成的响应体
 * @param contentType 响应头 `content-type`（可能为空字符串）
 */
export function isErrorPageContent(buffer: Buffer, contentType: string): boolean {
  // 空响应体一律视为无效
  if (buffer.length === 0) return true

  const head = buffer
    .toString('utf8', 0, Math.min(1024, buffer.length))
    .trimStart()
    .toLowerCase()

  // 1) 正文以 HTML 文档特征开头
  if (HTML_DOCUMENT_HINTS.some((hint) => head.startsWith(hint))) return true

  // 2) Content-Type 声明为 HTML 且正文含 HTML 标签
  if (/text\/html/i.test(contentType) && HTML_DOCUMENT_HINTS.some((hint) => head.includes(hint))) {
    return true
  }

  // 3) 平台错误 JSON，如 ModelScope 的 {"Code": 10990101007, "Message": "..."}
  //    限定体积，避免误伤 manifest.json 之类的合法大 JSON
  const jsonLike = /application\/json|text\/json/i.test(contentType) || buffer.length < 4096
  if (jsonLike && buffer.length < JSON_ERROR_MAX_BYTES && /^\{\s*"/.test(head)) {
    const hasCodeField = /"(code|error)"\s*:/.test(head)
    const hasMessageField = /"(message|msg|error_description)"\s*:/.test(head)
    if (hasCodeField && hasMessageField) return true
  }

  // 4) HuggingFace / 镜像返回的纯文本错误
  if (head.includes('entry not found') || head.includes('404: not found')) return true

  return false
}
