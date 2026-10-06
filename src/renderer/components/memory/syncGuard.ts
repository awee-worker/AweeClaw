/**
 * 记忆云端同步的敏感过滤（同步侧）
 *
 * 敏感记忆在本地以密文落库，但密文密钥只存在本机安全存储里，云端与其他设备都解不开，
 * 因此同步时既不推送密文，更不能推送明文——命中敏感规则的记忆一律留在本机。
 *
 * 过滤发生在发送之前，保证明文不经过网络；未命中的记忆照常备份与跨设备同步。
 */
import { detectSensitiveContent, hasSensitiveTag } from '@shared/memory/sensitiveContent'

/** 参与同步判定所需的最小字段集合 */
export interface SyncEntryLike {
  id: string
  content?: string | null
  summary?: string | null
  tags?: string | string[] | null
}

export interface SyncPartition<T extends SyncEntryLike> {
  /** 可推送云端的条目 */
  syncable: T[]
  /** 命中敏感规则、仅保留在本机的条目 */
  blocked: T[]
  /** 被拦截条目的 id → 命中原因 */
  reasons: Record<string, string>
}

/**
 * 判定单条记忆能否外发。
 * 正文、摘要、标签任一命中敏感规则即拦截。
 *
 * @returns 命中原因，可外发返回 null
 */
export function describeSyncBlock(entry: SyncEntryLike): string | null {
  if (hasSensitiveTag(entry.tags)) return '标记为敏感'
  const inContent = detectSensitiveContent(entry.content)
  if (inContent) return `正文含${inContent}`
  const inSummary = detectSensitiveContent(entry.summary)
  if (inSummary) return `摘要含${inSummary}`
  return null
}

/** 把待推送条目拆成「可同步」与「仅本地」两部分 */
export function partitionEntriesForSync<T extends SyncEntryLike>(entries: T[]): SyncPartition<T> {
  const syncable: T[] = []
  const blocked: T[] = []
  const reasons: Record<string, string> = {}

  for (const entry of entries) {
    const reason = describeSyncBlock(entry)
    if (reason) {
      blocked.push(entry)
      reasons[entry.id] = reason
    } else {
      syncable.push(entry)
    }
  }

  return { syncable, blocked, reasons }
}
