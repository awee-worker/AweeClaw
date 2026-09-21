/**
 * 预览历史
 *
 * 记下最近预览过的地址：重启后想回到刚才那个页面，不必再翻终端里滚过去的那行 URL，
 * 空状态里点一下就能回来。
 *
 * 存在 localStorage：历史是「这台机器上的使用痕迹」，不需要跨设备同步，也不该混进
 * 工作区元数据（那些会跟着项目一起走）。
 */

import type { PreviewServerSource } from '@shared/protocols/previewProtocol'

const STORAGE_KEY = 'aweeclaw:preview-history'
/** 保留条数上限 */
const MAX_ENTRIES = 20
/** 空状态里展示的条数 */
export const VISIBLE_ENTRIES = 6

export interface PreviewHistoryEntry {
  url: string
  title: string
  source: PreviewServerSource
  /** 上次打开时间 */
  openedAt: number
  /**
   * 本地文件预览的根目录
   *
   * 本地预览的地址是一次性的（静态服务每次启动都换端口、根目录登记也会清空），
   * 重开时必须凭目录重新解析，所以这里要把它一起记下来。
   */
  previewRoot?: string
}

/** 去重键：本地预览按目录合并，服务预览按地址合并 */
function keyOf(entry: { url: string; previewRoot?: string }): string {
  return entry.previewRoot ? `root:${entry.previewRoot}` : `url:${entry.url}`
}

function readAll(): PreviewHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []

    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []

    return parsed.filter(
      (item): item is PreviewHistoryEntry =>
        Boolean(item) &&
        typeof item === 'object' &&
        typeof (item as PreviewHistoryEntry).url === 'string' &&
        typeof (item as PreviewHistoryEntry).title === 'string',
    )
  } catch {
    // 存储损坏时按「没有历史」处理，不能让它影响预览本身
    return []
  }
}

function writeAll(entries: PreviewHistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // 配额不足或隐私模式下静默失败：历史只是便利功能
  }
}

/** 记录一次打开；同一目标只保留最近一条 */
export function recordPreview(entry: Omit<PreviewHistoryEntry, 'openedAt'>): void {
  if (!entry.url) return

  const key = keyOf(entry)
  const rest = readAll().filter((item) => keyOf(item) !== key)

  writeAll([{ ...entry, openedAt: Date.now() }, ...rest])
}

/** 读取最近的预览记录 */
export function getRecentPreviews(limit: number = VISIBLE_ENTRIES): PreviewHistoryEntry[] {
  return readAll().slice(0, limit)
}

/** 清空历史 */
export function clearPreviewHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // 忽略
  }
}
