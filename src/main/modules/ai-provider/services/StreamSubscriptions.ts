/**
 * 流式请求订阅表 — 解耦「一路 LLM 流」与「观察它的窗口」
 *
 * 改造前每个窗口各自持有一个 LLMService，服务在构造时绑定 BrowserWindow，
 * 因此流式事件只能回发给创建请求的那个窗口，abort 也只能整服务取消。
 * 这个一对一绑定把「窗口」和「会话」混为一谈：同一个会话一旦要在多个
 * 窗口里同时呈现（子窗口投影主窗口正在跑的对话、侧栏观察、后续把编排
 * 下沉到主进程后按 session 复用），就必须为每个窗口重复发起一次请求。
 *
 * 这里把关系反转成两层：
 * - owner：发起这次请求的窗口，用于鉴权（谁能 abort 谁）
 * - subscribers：当前观察这次请求的窗口集合，事件按集合逐个投递
 *
 * 窗口销毁只把自己从集合里摘掉，不再连带销毁服务实例。
 */

import { webContents } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'

/** 累计快照的字符上限。超过后停止追加并标记 truncated。 */
const MAX_SNAPSHOT_CHARS = 256 * 1024

/**
 * 主进程自身的虚拟订阅者 ID。
 *
 * 编排下沉到主进程后，发起请求的不再是某个窗口，但主进程仍需按 requestId
 * 观察自己发起的流（收集工具调用、判断是否该继续消费）。用一个不可能与
 * 真实 webContents.id 冲突的 0 表示，投递时跳过它。
 */
export const SYSTEM_SUBSCRIBER = 0

/** 一路流当前已产出的内容，供中途订阅者补看前文 */
export interface StreamSnapshot {
  text: string
  reasoning: string
  toolCalls: Array<{ id: string; name: string; arguments?: unknown }>
  /** 正文超限被截断（只保留尾部），订阅方应知道看到的不是全文 */
  truncated: boolean
  updatedAt: number
}

/** 可订阅流的概览信息 */
export interface ActiveStreamInfo {
  requestId: string
  /** 发起方 webContents ID */
  owner: number
  /** 业务标签（如会话/助手名），供订阅方展示 */
  label?: string
  startedAt: number
  updatedAt: number
  /** 已产出正文字符数，订阅方据此判断是否需要回放 */
  textLength: number
}

/** 一条流式请求的订阅关系 */
interface Subscription {
  /** 发起请求的窗口，abort 鉴权以此为准 */
  owner: number
  /** 正在观察这次请求的窗口集合（含 owner） */
  subscribers: Set<number>
  /** 业务标签 */
  label?: string
  startedAt: number
  snapshot: StreamSnapshot
}

/**
 * 窗口是否仍然可投递。
 *
 * windowManager 先关窗口再触发 cleanup 是常态，所以这里不能只看订阅表
 * 有没有记录，必须回到 Electron 的窗口注册表确认实例还在。
 */
function isWindowAlive(webContentsId: number): boolean {
  // 主进程不是真实窗口，但它的订阅同样代表「有人在等这段输出」
  if (webContentsId === SYSTEM_SUBSCRIBER) return true
  const instance = webContents.fromId(webContentsId)
  return Boolean(instance && !instance.isDestroyed())
}

class StreamSubscriptions {
  private readonly entries = new Map<string, Subscription>()

  /**
   * 登记一条请求的发起窗口。
   *
   * 必须在请求真正开始之前调用：事件按 requestId 投递，若登记晚于
   * 首个分片，首屏增量会因「无订阅者」被丢弃。
   *
   * @param requestId 请求 ID
   * @param webContentsId 发起方窗口
   * @param label 业务标签，供订阅方在列表中识别这条流
   */
  bindOwner(requestId: string, webContentsId: number, label?: string): void {
    const existing = this.entries.get(requestId)
    if (existing) {
      existing.owner = webContentsId
      existing.subscribers.add(webContentsId)
      if (label) existing.label = label
      return
    }
    const now = Date.now()
    this.entries.set(requestId, {
      owner: webContentsId,
      subscribers: new Set([webContentsId]),
      label,
      startedAt: now,
      snapshot: { text: '', reasoning: '', toolCalls: [], truncated: false, updatedAt: now },
    })
  }

  /**
   * 记录一条流式事件到快照。
   *
   * 由分发器在投递**之前**调用，且不受「有没有订阅者」影响 ——
   * 否则一段先跑起来、后来才被观察的流就没有前文可回放。
   */
  appendSnapshot(
    requestId: string,
    event: { type: string; content?: unknown; id?: unknown; name?: unknown; arguments?: unknown },
  ): void {
    const entry = this.entries.get(requestId)
    if (!entry) return

    const snap = entry.snapshot
    snap.updatedAt = Date.now()

    switch (event.type) {
      case 'text':
        this.appendCapped(snap, 'text', String(event.content ?? ''))
        break
      case 'reasoning':
        this.appendCapped(snap, 'reasoning', String(event.content ?? ''))
        break
      case 'tool-call-start': {
        const id = String(event.id ?? '')
        if (id && !snap.toolCalls.some((t) => t.id === id)) {
          snap.toolCalls.push({ id, name: String(event.name ?? '') })
        }
        break
      }
      case 'tool-call-available': {
        const id = String(event.id ?? '')
        const existing = snap.toolCalls.find((t) => t.id === id)
        if (existing) {
          existing.name = String(event.name ?? existing.name)
          existing.arguments = event.arguments
        } else if (id) {
          snap.toolCalls.push({ id, name: String(event.name ?? ''), arguments: event.arguments })
        }
        break
      }
      default:
        break
    }
  }

  /** 追加文本并按上限截断（只保留尾部，保留最新内容更有用） */
  private appendCapped(
    snap: StreamSnapshot,
    field: 'text' | 'reasoning',
    chunk: string,
  ): void {
    if (!chunk) return
    if (snap.truncated) return
    const next = snap[field] + chunk
    if (next.length <= MAX_SNAPSHOT_CHARS) {
      snap[field] = next
      return
    }
    snap[field] = next.slice(-MAX_SNAPSHOT_CHARS)
    snap.truncated = true
    logger.llm.warn('[StreamSubscriptions] 快照超出上限，已截断并停止累积', {
      field,
      limit: MAX_SNAPSHOT_CHARS,
    })
  }

  /** 取一路流的快照（不存在返回 null） */
  snapshotOf(requestId: string): StreamSnapshot | null {
    return this.entries.get(requestId)?.snapshot ?? null
  }

  /** 列出当前可订阅的流 */
  listActive(): ActiveStreamInfo[] {
    const list: ActiveStreamInfo[] = []
    for (const [requestId, entry] of this.entries) {
      list.push({
        requestId,
        owner: entry.owner,
        label: entry.label,
        startedAt: entry.startedAt,
        updatedAt: entry.snapshot.updatedAt,
        textLength: entry.snapshot.text.length,
      })
    }
    return list.sort((a, b) => a.startedAt - b.startedAt)
  }


  /**
   * 追加一个观察者。
   *
   * 返回解除函数，供调用方在自身生命周期结束时主动解绑；窗口销毁
   * 另有 dropWindow 兜底，即使没调解除函数也不会残留。
   */
  addSubscriber(requestId: string, webContentsId: number): () => void {
    const entry = this.entries.get(requestId)
    if (!entry) {
      logger.llm.warn('[StreamSubscriptions] 订阅了未登记的请求', { requestId })
      return () => { /* 请求不在，无需解除 */ }
    }
    entry.subscribers.add(webContentsId)
    return () => this.removeSubscriber(requestId, webContentsId)
  }

  removeSubscriber(requestId: string, webContentsId: number): void {
    this.entries.get(requestId)?.subscribers.delete(webContentsId)
  }

  /** 当前应收到这次请求事件的窗口列表 */
  subscribersOf(requestId: string): number[] {
    const entry = this.entries.get(requestId)
    return entry ? [...entry.subscribers] : []
  }

  /**
   * 是否还有存活的观察者。
   *
   * 流式循环用它判断「继续消费还有没有意义」：全部观察者都关闭后，
   * 接着读上游只会白耗 token 与网络，应尽早停止。
   */
  hasLiveSubscriber(requestId: string): boolean {
    const entry = this.entries.get(requestId)
    if (!entry) return false
    for (const id of entry.subscribers) {
      if (isWindowAlive(id)) return true
    }
    return false
  }

  /**
   * 是否还有真实窗口在观察这次请求。
   *
   * 与 hasLiveSubscriber 的区别在于不计主进程虚拟订阅者：编排层自己发起的流
   * 永远「有订阅者」，但没有任何窗口可投递，此时不该再攒批次、发 IPC。
   */
  hasWindowSubscriber(requestId: string): boolean {
    const entry = this.entries.get(requestId)
    if (!entry) return false
    for (const id of entry.subscribers) {
      if (id === SYSTEM_SUBSCRIBER) continue
      if (isWindowAlive(id)) return true
    }
    return false
  }

  /** 校验调用方是否有权中止这次请求 */
  isOwner(requestId: string, webContentsId: number): boolean {
    return this.entries.get(requestId)?.owner === webContentsId
  }

  /**
   * 移交发起权。
   *
   * 发起窗口关闭、但仍有其它窗口在观察这条路时，把 owner 交给下一个
   * 观察者 —— 否则这条流既没人有权中止，也没法在后续清理时被正确回收。
   */
  transferOwner(requestId: string, webContentsId: number): void {
    const entry = this.entries.get(requestId)
    if (!entry) return
    entry.owner = webContentsId
    entry.subscribers.add(webContentsId)
  }

  /** 某窗口发起的全部请求（用于「不带 requestId 的批量中止」） */
  requestsOfWindow(webContentsId: number): string[] {
    const owned: string[] = []
    for (const [requestId, entry] of this.entries) {
      if (entry.owner === webContentsId) owned.push(requestId)
    }
    return owned
  }

  /** 请求结束后释放全部关系 */
  release(requestId: string): void {
    this.entries.delete(requestId)
  }

  /** 窗口销毁时摘除它的全部订阅关系，返回受影响的请求 */
  dropWindow(webContentsId: number): string[] {
    const affected: string[] = []
    for (const [requestId, entry] of this.entries) {
      entry.subscribers.delete(webContentsId)
      affected.push(requestId)
    }
    return affected
  }

  /** 清空（应用退出） */
  clear(): void {
    this.entries.clear()
  }

  /** 当前登记的请求数，仅用于诊断日志 */
  get size(): number {
    return this.entries.size
  }
}

/** 全局共享的订阅表 */
export const streamSubscriptions = new StreamSubscriptions()
export { StreamSubscriptions, isWindowAlive }
