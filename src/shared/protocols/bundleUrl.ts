/**
 * 自定义协议下指向本地文件的 URL 构造
 *
 * scenario-bundle:// 与 plugin-bundle:// 都注册为 standard 协议，解析时按标准
 * URL 规则拆分 host 与 pathname。host 固定为 localhost，文件绝对路径必须落在
 * pathname 上，也就是要以 / 开头。
 *
 * Windows 的绝对路径形如 C:/Users/...，不以 / 开头，直接拼接会得到
 * `scenario-bundle://localhostC:/Users/...`：host 被解析成 localhostC，pathname
 * 丢掉盘符，协议处理器据此读不到文件并返回 404。
 * macOS 与 Linux 的路径自带前导斜杠，所以同样的拼法在那边不会暴露问题。
 */

/**
 * 把绝对路径编码进 URL 的 pathname
 *
 * 保留分隔符 / 与盘符冒号，空格、中文等按需转义。
 * # 与 ? 必须单独转义：encodeURI 不处理它们，原样留在 URL 里会被解析成
 * fragment / query 开头，路径从那里被截断。
 */
function encodePathname(absPath: string): string {
  const normalized = absPath.replace(/\\/g, '/')
  const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return encodeURI(withLeadingSlash).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

/** 编码相对入口路径，保留子目录分隔符 */
function encodeEntry(entry: string): string {
  return encodeURI(entry.replace(/\\/g, '/')).replace(/#/g, '%23').replace(/\?/g, '%3F')
}

/**
 * 构造指向本地文件的协议 URL
 *
 * @param scheme 协议名，不含冒号，如 'scenario-bundle'
 * @param absDir 文件所在绝对目录
 * @param entry 相对目录的入口文件，可含子目录，如 'dist/index.js'
 */
export function buildLocalFileUrl(scheme: string, absDir: string, entry: string): string {
  // 入口可能写成 ./dist/index.js 或以 / 开头，先去掉相对前缀，
  // 否则拼出的路径会多出分隔符，日志与缓存键也对不上
  const normalizedEntry = entry.replace(/\\/g, '/').replace(/^\.?\/*/, '')
  return `${scheme}://localhost${encodePathname(absDir)}/${encodeEntry(normalizedEntry)}`
}
