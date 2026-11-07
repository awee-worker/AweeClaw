/**
 * 证据账本
 *
 * 解决的是「同一份长内容反复进上下文」：读了一个 3000 行文件，模型引用它时
 * 不必把全文再搬一遍，只引用编号（「按证据 3」）。长列表、长文档类任务的
 * 上下文占用因此能降一个数量级。
 *
 * 三条硬规则：
 * 1. 去重：同内容只存一份（哈希相同直接返回已有 id）。
 * 2. 限长：单条超 8KB 只留头部并标记 truncated，完整内容不占内存。
 * 3. 过期必须说出来：被预算裁剪掉的证据在 resolve 时返回明确的「已过期」，
 *    绝不静默返回空 —— 模型会以为自己读到了空内容，进而编造。
 *
 * @module intelligence/runtime/evidenceLedger
 */
/** 单条证据的最大留存长度（字符） */
export const EVIDENCE_MAX_CHARS = 8 * 1024

/** 账本总量上限（字符）；超出时最旧的降级为摘要 */
export const EVIDENCE_TOTAL_CHARS = 120 * 1024

/** 一条证据 */
export interface EvidenceEntry {
  id: string
  /** 一行摘要，给模型看的索引项 */
  summary: string
  /** 来源工具（read_file / run_command …），便于排查 */
  source?: string
  /** 留存内容；被裁剪后为 null */
  content: string | null
  /** 原始长度（裁剪前） */
  originalLength: number
  /** 是否被截断 */
  truncated: boolean
  /** 是否已过期（仅存摘要） */
  expired: boolean
  createdAt: number
}

/** 记录观测的入参 */
export interface EvidenceObservation {
  content: string
  /** 不传则自动取首行 */
  summary?: string
  source?: string
}

/** 记录结果：给调用方放进工具 content 的结构 */
export interface EvidenceRef {
  evidenceId: string
  summary: string
  truncated: boolean
  /** 已存在同内容的证据时为 true，不重复占预算 */
  deduped: boolean
}

/** resolve 的结果：过期与不存在要区分开 */
export type EvidenceResolution =
  | { status: 'ok'; content: string }
  | { status: 'expired'; summary: string }
  | { status: 'missing' }

export class EvidenceLedger {
  private readonly entries = new Map<string, EvidenceEntry>()
  /** 内容哈希 → id，用于去重 */
  private readonly byHash = new Map<string, string>()
  /** 插入顺序（Map 已保序，这里显式声明语义） */
  private seq = 0

  /** 记录一条观测 */
  record(observation: EvidenceObservation): EvidenceRef {
    const raw = observation.content ?? ''
    const hash = hashOf(raw)
    const existingId = this.byHash.get(hash)
    if (existingId) {
      const existing = this.entries.get(existingId)!
      return {
        evidenceId: existing.id,
        summary: existing.summary,
        truncated: existing.truncated,
        deduped: true,
      }
    }

    this.seq += 1
    const id = `ev_${this.seq}`
    const truncated = raw.length > EVIDENCE_MAX_CHARS
    const summary = observation.summary?.trim() || firstLine(raw)

    const entry: EvidenceEntry = {
      id,
      summary: summary.slice(0, 200),
      source: observation.source,
      content: truncated ? raw.slice(0, EVIDENCE_MAX_CHARS) : raw,
      originalLength: raw.length,
      truncated,
      expired: false,
      createdAt: Date.now(),
    }

    this.entries.set(id, entry)
    this.byHash.set(hash, id)
    this.enforceBudget()

    return { evidenceId: id, summary: entry.summary, truncated, deduped: false }
  }

  /** 按 id 取回内容；过期与不存在必须区分 */
  resolve(id: string): EvidenceResolution {
    const entry = this.entries.get(id)
    if (!entry) return { status: 'missing' }
    if (entry.expired || entry.content === null) {
      return { status: 'expired', summary: entry.summary }
    }
    return { status: 'ok', content: entry.content }
  }

  /** 是否存在该 id（用于判定「过期」还是「根本不存在」） */
  has(id: string): boolean {
    return this.entries.has(id)
  }

  /** 生成给模型的证据索引（id + 一行摘要），放在上下文的一个固定位置 */
  render(): string {
    const rows = Array.from(this.entries.values()).map((e) => {
      const flag = e.expired ? '（已过期，需重新读取）' : e.truncated ? '（已截断）' : ''
      return `- ${e.id}${flag}: ${e.summary}`
    })
    if (rows.length === 0) return ''
    return ['【本次任务已读取的材料（按编号引用，避免重复搬运原文）】', ...rows].join('\n')
  }

  /** 当前留存的条目数 */
  size(): number {
    return this.entries.size
  }

  /** 已过期条目数 */
  expiredCount(): number {
    let n = 0
    for (const e of this.entries.values()) if (e.expired) n += 1
    return n
  }

  /** 新任务 / 新会话时清空 */
  reset(): void {
    this.entries.clear()
    this.byHash.clear()
    this.seq = 0
  }

  /**
   * 总量超限时把最旧的降级为摘要
   *
   * 只降级不删除：id 与摘要留着，模型仍能引用并知道「它存在但需要重新读」，
   * 直接删掉会让模型引用到不存在的编号。
   */
  private enforceBudget(): void {
    let total = 0
    for (const e of this.entries.values()) {
      if (e.content) total += e.content.length
    }
    if (total <= EVIDENCE_TOTAL_CHARS) return

    for (const entry of this.entries.values()) {
      if (total <= EVIDENCE_TOTAL_CHARS) break
      if (!entry.content) continue
      total -= entry.content.length
      entry.content = null
      entry.expired = true
    }
  }
}

/** 内容哈希：FNV-1a，纯字符串运算，不引外部依赖、不阻塞主线程 */
function hashOf(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  // 拼上长度，降低「前缀相同、长度不同」的碰撞概率
  return `${hash.toString(16)}:${text.length}`
}

/** 取首行作为摘要，并压掉多余空白 */
function firstLine(text: string): string {
  const line = text.split('\n').find((l) => l.trim().length > 0) || ''
  return line.replace(/\s+/g, ' ').trim().slice(0, 160)
}

/** 全局账本：一次任务一份，任务开始 reset */
export const evidenceLedger = new EvidenceLedger()
