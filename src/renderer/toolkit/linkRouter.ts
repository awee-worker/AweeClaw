/**
 * 消息内链接的分发
 *
 * AI 回复里的链接不只有网页：常见还有 `file://` URL、指向工作空间的相对路径、
 * Windows 盘符绝对路径，以及 `mailto:` 之类的系统协议。此前这些全部交给
 * openUrlInBrowser，而它只认 http(s)，其余一律静默返回 —— 用户点了没有任何反应，
 * 看起来就是「链接点不动」。
 *
 * 这里按目标类型分派：网页进内置或外部浏览器，文件进编辑器 Tab（由扩展名自动
 * 选用文本编辑器或对应预览器），系统协议交给壳层。
 */
import { useStore } from '@store'
import { api } from '@renderer/adapters/electronBridge'
import { toFullPath } from '@shared/toolkit/pathHelper'
import { logger } from '@shared/toolkit/LogEngine'
import { openUrlInBrowser } from '@utils/browserLauncher'
import { needsTextContent } from '@utils/fileKind'
import { toast } from '@components/foundation/NotificationProvider'
import { t } from '@renderer/i18n'

/**
 * 文本文件进入编辑器的体积上限
 *
 * 超过这个量级的内容会以整份字符串常驻 store 与编辑器，内存和渲染成本都不划算，
 * 改为交给系统默认程序打开。取值与文件服务的「大文件确认阈值」保持一致。
 */
const MAX_INLINE_TEXT_CHARS = 5 * 1024 * 1024

export type LinkTarget =
  | { kind: 'web'; value: string }
  /** 本地文件，value 可能是相对工作空间的路径 */
  | { kind: 'file'; value: string }
  /** 交给操作系统的协议（mailto: / tel: / ftp: 等） */
  | { kind: 'system'; value: string }
  /** 文档内锚点，不跳转 */
  | { kind: 'anchor'; value: string }
  | { kind: 'none'; value: string }

const WEB_SCHEME = /^https?:\/\//i
const FILE_SCHEME = /^file:\/\//i
/** Windows 盘符路径：C:\dir 或 C:/dir（要先于「协议」判断，否则 c: 会被当成 scheme） */
const WINDOWS_DRIVE = /^[a-zA-Z]:[\\/]/
/** 任意 scheme: 形式 */
const ANY_SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/
/** 看起来像域名（用于把裸域名补成 https） */
const DOMAIN_LIKE = /^[\w-]+(\.[\w-]+)+$/
/** 域名末段是字母后缀（com / io / cn …），用于把 `v1.2.3` 这类版本号目录排除在外 */
const TLD_LIKE = /\.[a-z]{2,24}$/i

/** 去掉链接两端可能被模型写进来的强调符号，以及 markdown 语法残余 */
export function cleanLinkHref(href: string): string {
  return href.replace(/[*_~`#|]+$/g, '').replace(/^[*_~`#|]+/g, '').trim()
}

/** `file://` URL 转本地路径（兼容 Windows 的 file:///C:/x 形式） */
function fileUrlToPath(url: string): string {
  let raw = url.replace(FILE_SCHEME, '').split(/[?#]/)[0]
  try {
    raw = decodeURIComponent(raw)
  } catch {
    // 非法转义序列保持原样
  }
  if (/^\/[a-zA-Z]:[\\/]/.test(raw)) raw = raw.slice(1)
  return raw
}

/**
 * 判定链接目标
 *
 * 判定顺序有意如此：盘符与路径分隔符先于 scheme —— 否则 `C:/tmp/a.txt` 会被
 * 当成协议 `c:`；带分隔符的相对路径先于域名 —— `src/main.ts` 不该被补成网址。
 */
export function classifyLink(href: string): LinkTarget {
  const value = cleanLinkHref(href)
  if (!value) return { kind: 'none', value }

  if (value.startsWith('#')) return { kind: 'anchor', value }
  if (WEB_SCHEME.test(value)) return { kind: 'web', value }
  if (FILE_SCHEME.test(value)) return { kind: 'file', value: fileUrlToPath(value) }

  if (WINDOWS_DRIVE.test(value)) return { kind: 'file', value }
  if (value.startsWith('/') || value.startsWith('\\')) return { kind: 'file', value }
  if (value.startsWith('./') || value.startsWith('../')) return { kind: 'file', value }

  if (ANY_SCHEME.test(value)) return { kind: 'system', value }

  // 含分隔符：首段是域名则补 https，其余按相对路径处理。
  // 首段必须同时满足「含点」与「末段是字母 TLD」，否则 v1.2.3/src 这类目录会被误判成网址。
  if (/[\\/]/.test(value)) {
    const firstSegment = value.split(/[\\/]/)[0]
    if (DOMAIN_LIKE.test(firstSegment) && TLD_LIKE.test(firstSegment)) {
      return { kind: 'web', value: `https://${value}` }
    }
    return { kind: 'file', value }
  }

  // 无分隔符：按文件名处理（README.md 之类）。真正需要打开的裸域名极少见，
  // 误判成网址反而会把文件点成网页，这里选择偏向文件。
  return { kind: 'file', value }
}

/**
 * 在编辑器里打开本地文件
 *
 * 文本类读取内容后交给编辑器；图片 / PDF / Office / 3D 模型只给路径 —— 它们的
 * 预览器按路径自行取数据，提前 read 会把整份二进制编码成字符串过一遍内存与 IPC。
 *
 * @returns 是否成功打开（文件不存在时为 false，调用方可据此提示）
 */
export async function openLocalFileInEditor(rawPath: string): Promise<boolean> {
  const raw = cleanLinkHref(rawPath)
  if (!raw) return false

  // 允许 "src/a.ts:12" 这种带行号的写法：路径里本来不含行号，
  // 直接拿原串去 read 必然失败，因此先试原串、再试剥掉行号的形式。
  const withoutLine = raw.replace(/:\d+$/, '')
  const candidates = withoutLine !== raw ? [raw, withoutLine] : [raw]

  for (const candidate of candidates) {
    const target = toFullPath(candidate, useStore.getState().workspacePath)
    if (!target) continue
    if (!(await fileExists(target))) continue
    return openResolvedFile(target)
  }

  // 静默失败会让用户以为「链接坏了」，这里明确提示目标不存在
  const language = useStore.getState().language as 'en' | 'zh'
  logger.ui.warn('[Link] Local file not found:', raw)
  toast.warning(t('app.filenotfound', language), raw)
  return false
}

/** 判断文件是否存在（IPC 异常一律视为不存在） */
async function fileExists(target: string): Promise<boolean> {
  try {
    return await api.file.exists(target)
  } catch {
    return false
  }
}

/** 已确认存在的文件：按类型决定是否预读内容，然后交给编辑器 Tab */
async function openResolvedFile(target: string): Promise<boolean> {
  let content = ''
  if (needsTextContent(target)) {
    try {
      const text = await api.file.read(target)
      if (text === null) return false
      // 超大文本不进编辑器：整份字符串会常驻 store，内存与渲染成本都不划算
      if (text.length > MAX_INLINE_TEXT_CHARS) {
        await api.file.openInBrowser(target)
        return true
      }
      content = text
    } catch (err) {
      logger.ui.warn('[Link] Failed to read file:', target, err)
      return false
    }
  }

  const state = useStore.getState()
  state.openFile(target, content)
  state.setActiveFile(target)
  return true
}

/**
 * 按目标类型打开链接
 *
 * 网页走浏览器（内置/外部由 browserMode 决定），本地文件走编辑器 Tab，
 * 其余协议交给壳层的白名单校验，锚点不处理。
 */
export function openLinkSmart(href: string): void {
  const target = classifyLink(href)

  switch (target.kind) {
    case 'web':
      openUrlInBrowser(target.value)
      return
    case 'file':
      void openLocalFileInEditor(target.value)
      return
    case 'system':
      api.file.openExternalUrl(target.value)
      return
    default:
      return
  }
}
