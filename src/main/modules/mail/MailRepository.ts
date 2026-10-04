/**
 * 邮件本地仓储
 *
 * 职责：
 * - 邮件元数据索引：持久化于 moduleDataStore 的 MAIL_MESSAGES 键
 * - 正文/附件缓存：按 {userData}/maildata/{accountId}/{folder}/{uid}.json 分文件落盘
 * - 增量同步游标：持久化于 MAIL_SYNC_STATE 键
 *
 * 索引与正文分离，避免启动时加载大量正文导致内存与 IO 压力。
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { moduleDataStore, STORE_KEYS } from '../persistence/ModuleDataStore'
import type {
  MailBodyCache,
  MailDraft,
  MailFolderAlias,
  MailFolderCursor,
  MailFolderMap,
  MailMessageMeta,
  MailOutboxItem,
  MailSyncState,
} from './types'

/** 索引结构：accountId → 邮件元数据数组 */
type MailIndex = Record<string, MailMessageMeta[]>

class MailRepository {
  private dataRootCache: string | null = null

  /** maildata 根目录（惰性解析，确保 app 已就绪） */
  private get dataRoot(): string {
    if (!this.dataRootCache) {
      this.dataRootCache = path.join(app.getPath('userData'), 'maildata')
    }
    return this.dataRootCache
  }

  // ============================================
  // 元数据索引
  // ============================================

  private readIndex(): MailIndex {
    return moduleDataStore.get<MailIndex>(STORE_KEYS.MAIL_MESSAGES) ?? {}
  }

  private writeIndex(index: MailIndex): void {
    moduleDataStore.set(STORE_KEYS.MAIL_MESSAGES, index)
  }

  /** 列出某账户的邮件元数据（可按文件夹过滤，按时间倒序） */
  listMessages(accountId: string, folder?: string): MailMessageMeta[] {
    const all = this.readIndex()[accountId] ?? []
    const filtered = folder ? all.filter((m) => m.folder === folder) : all
    return [...filtered].sort((a, b) => b.date - a.date)
  }

  /** 读取单封邮件元数据 */
  getMessage(accountId: string, folder: string, uid: number): MailMessageMeta | undefined {
    return (this.readIndex()[accountId] ?? []).find(
      (m) => m.folder === folder && m.uid === uid,
    )
  }

  /** 统计全部账户的未读邮件数（供导航角标使用） */
  countUnread(): number {
    const index = this.readIndex()
    let count = 0
    for (const list of Object.values(index)) {
      for (const meta of list) {
        if (!meta.seen) count++
      }
    }
    return count
  }

  /**
   * 批量写入/合并邮件元数据（按 folder+uid 去重，新的覆盖旧的）
   * 返回新增数量。
   */
  upsertMessages(accountId: string, metas: MailMessageMeta[]): number {
    if (metas.length === 0) return 0
    const index = this.readIndex()
    const existing = index[accountId] ?? []
    const byKey = new Map<string, MailMessageMeta>()
    for (const m of existing) byKey.set(`${m.folder}#${m.uid}`, m)
    let added = 0
    for (const m of metas) {
      const key = `${m.folder}#${m.uid}`
      if (!byKey.has(key)) added++
      byKey.set(key, m)
    }
    index[accountId] = Array.from(byKey.values())
    this.writeIndex(index)
    return added
  }

  /** 更新单封邮件的可变字段（已读/星标/AI 结果） */
  patchMessage(
    accountId: string,
    folder: string,
    uid: number,
    patch: Partial<Pick<MailMessageMeta, 'seen' | 'flagged' | 'ai' | 'cacheRef'>>,
  ): boolean {
    const index = this.readIndex()
    const list = index[accountId]
    if (!list) return false
    const target = list.find((m) => m.folder === folder && m.uid === uid)
    if (!target) return false
    Object.assign(target, patch)
    this.writeIndex(index)
    return true
  }

  /** 清空某账户的索引与正文缓存 */
  clearAccount(accountId: string): void {
    const index = this.readIndex()
    if (index[accountId]) {
      delete index[accountId]
      this.writeIndex(index)
    }
    const dir = path.join(this.dataRoot, accountId)
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    } catch (err) {
      logger.system.warn(`[MailRepository] 清理正文缓存失败: ${String(err)}`)
    }
    // 同时清理同步游标
    const sync = this.readSyncState()
    if (sync[accountId]) {
      delete sync[accountId]
      this.writeSyncState(sync)
    }
  }

  // ============================================
  // 正文缓存
  // ============================================

  private bodyPath(accountId: string, folder: string, uid: number): string {
    const safeFolder = folder.replace(/[/\\:*?"<>|]/g, '_')
    return path.join(this.dataRoot, accountId, safeFolder, `${uid}.json`)
  }

  /** 保存正文缓存 */
  saveBody(accountId: string, folder: string, uid: number, body: MailBodyCache): void {
    const file = this.bodyPath(accountId, folder, uid)
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(body), 'utf-8')
    } catch (err) {
      logger.system.warn(`[MailRepository] 正文缓存写入失败: ${String(err)}`)
    }
  }

  /** 读取正文缓存 */
  getBody(accountId: string, folder: string, uid: number): MailBodyCache | null {
    const file = this.bodyPath(accountId, folder, uid)
    try {
      if (!fs.existsSync(file)) return null
      return JSON.parse(fs.readFileSync(file, 'utf-8')) as MailBodyCache
    } catch {
      return null
    }
  }

  // ============================================
  // 同步游标
  // ============================================

  private readSyncState(): MailSyncState {
    return moduleDataStore.get<MailSyncState>(STORE_KEYS.MAIL_SYNC_STATE) ?? {}
  }

  private writeSyncState(state: MailSyncState): void {
    moduleDataStore.set(STORE_KEYS.MAIL_SYNC_STATE, state)
  }

  /** 读取某文件夹的同步游标 */
  getCursor(accountId: string, folder: string): MailFolderCursor | undefined {
    return this.readSyncState()[accountId]?.[folder]
  }

  /** 写入某文件夹的同步游标 */
  setCursor(accountId: string, folder: string, cursor: MailFolderCursor): void {
    const state = this.readSyncState()
    if (!state[accountId]) state[accountId] = {}
    state[accountId][folder] = cursor
    this.writeSyncState(state)
  }

  // ============================================
  // 标准文件夹映射
  // ============================================

  private readFolderMaps(): Record<string, MailFolderMap> {
    return moduleDataStore.get<Record<string, MailFolderMap>>(STORE_KEYS.MAIL_FOLDER_MAP) ?? {}
  }

  /** 读取某账户的标准文件夹映射（别名 → 服务器真实路径） */
  getFolderMap(accountId: string): MailFolderMap {
    return this.readFolderMaps()[accountId] ?? {}
  }

  /** 写入某账户的标准文件夹映射 */
  setFolderMap(accountId: string, map: MailFolderMap): void {
    const all = this.readFolderMaps()
    all[accountId] = map
    moduleDataStore.set(STORE_KEYS.MAIL_FOLDER_MAP, all)
  }

  /** 按别名取实际文件夹路径（未识别时返回 undefined） */
  resolveFolderAlias(accountId: string, alias: MailFolderAlias): string | undefined {
    return this.getFolderMap(accountId)[alias]
  }

  // ============================================
  // 本地草稿箱
  // ============================================

  private readDrafts(): MailDraft[] {
    return moduleDataStore.get<MailDraft[]>(STORE_KEYS.MAIL_DRAFTS) ?? []
  }

  private writeDrafts(list: MailDraft[]): void {
    moduleDataStore.set(STORE_KEYS.MAIL_DRAFTS, list)
  }

  /** 列出某账户的草稿（按更新时间倒序） */
  listDrafts(accountId: string): MailDraft[] {
    return this.readDrafts()
      .filter((d) => d.accountId === accountId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** 新建或覆盖一封草稿，返回草稿 id */
  saveDraft(draft: MailDraft): void {
    const list = this.readDrafts()
    const idx = list.findIndex((d) => d.id === draft.id)
    if (idx >= 0) list[idx] = draft
    else list.push(draft)
    this.writeDrafts(list)
  }

  /** 删除草稿 */
  deleteDraft(id: string): void {
    this.writeDrafts(this.readDrafts().filter((d) => d.id !== id))
  }

  /** 取单封草稿 */
  getDraft(id: string): MailDraft | undefined {
    return this.readDrafts().find((d) => d.id === id)
  }

  // ============================================
  // 本地发件箱（发送失败待重试）
  // ============================================

  private readOutbox(): MailOutboxItem[] {
    return moduleDataStore.get<MailOutboxItem[]>(STORE_KEYS.MAIL_OUTBOX) ?? []
  }

  private writeOutbox(list: MailOutboxItem[]): void {
    moduleDataStore.set(STORE_KEYS.MAIL_OUTBOX, list)
  }

  /** 列出某账户的发件箱（按创建时间倒序） */
  listOutbox(accountId: string): MailOutboxItem[] {
    return this.readOutbox()
      .filter((o) => o.accountId === accountId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  /** 新增一条待发记录 */
  addOutbox(item: MailOutboxItem): void {
    const list = this.readOutbox()
    list.push(item)
    this.writeOutbox(list)
  }

  /** 更新一条待发记录（重试次数 / 错误信息） */
  updateOutbox(id: string, patch: Partial<MailOutboxItem>): void {
    const list = this.readOutbox()
    const idx = list.findIndex((o) => o.id === id)
    if (idx < 0) return
    list[idx] = { ...list[idx], ...patch }
    this.writeOutbox(list)
  }

  /** 取单条待发记录 */
  getOutbox(id: string): MailOutboxItem | undefined {
    return this.readOutbox().find((o) => o.id === id)
  }

  /** 删除一条待发记录 */
  deleteOutbox(id: string): void {
    this.writeOutbox(this.readOutbox().filter((o) => o.id !== id))
  }
}

/** 全局单例 */
export const mailRepository = new MailRepository()
