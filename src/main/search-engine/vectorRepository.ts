/**
 * 向量存储仓储 — 基于 LanceDB 的代码向量持久化
 *
 * 使用仓储模式封装 LanceDB 操作，提供向量相似度搜索与关键词搜索
 */

import { logger } from '@shared/toolkit/LogEngine'
import * as path from 'path'
import * as fs from 'fs'
import { IndexedChunk, SearchResult } from './providerTypes'
import { BRAND } from '@shared/brand'

/* ------------------------------------------------------------------ */
/* LanceDB 类型定义                                                   */
/* ------------------------------------------------------------------ */

/** LanceDB 连接接口 */
interface LanceDbConnection {
  tableNames(): Promise<string[]>
  openTable(name: string): Promise<LanceDbTable>
  createTable(name: string, data: unknown[]): Promise<LanceDbTable>
  dropTable(name: string): Promise<void>
}

/** LanceDB 表接口 */
interface LanceDbTable {
  countRows(): Promise<number>
  add(data: unknown[]): Promise<void>
  delete(filter: string): Promise<void>
  query(): LanceDbQuery
  search(vector: number[]): LanceDbVectorQuery
}

/** LanceDB 查询接口 */
interface LanceDbQuery {
  select(columns: string[]): LanceDbQuery
  where(filter: string): LanceDbQuery
  limit(n: number): LanceDbQuery
  execute(): AsyncGenerator<LanceDbRecord>
  toArray(): Promise<LanceDbRecord[]>
}

/** LanceDB 向量查询接口 */
interface LanceDbVectorQuery {
  limit(n: number): LanceDbVectorQuery
  execute(): AsyncGenerator<LanceDbSearchResult>
  toArray(): Promise<LanceDbSearchResult[]>
}

/** LanceDB 记录类型 */
interface LanceDbRecord {
  filePath: string
  relativePath: string
  fileHash: string
  content: string
  startLine: number
  endLine: number
  type: string
  language: string
  symbols: string
}

/** LanceDB 向量搜索结果 */
interface LanceDbSearchResult extends LanceDbRecord {
  _distance: number
}

/* ------------------------------------------------------------------ */
/* SQL 安全处理器                                                     */
/* ------------------------------------------------------------------ */

/** SQL 注入防护 — 转义文件路径与关键词 */
class SqlSanitizer {
  /** 清理文件路径，防止 SQL 注入 */
  static sanitizePath(filePath: string): string {
    return filePath
      .replace(/'/g, "''")
      .replace(/--/g, '')
      .replace(/;/g, '')
      .slice(0, 1000)
  }

  /** 清理搜索关键词，防止 SQL 注入 */
  static sanitizeKeyword(keyword: string): string {
    return keyword
      .replace(/'/g, "''")
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
      .replace(/--/g, '')
      .replace(/;/g, '')
      .slice(0, 100)
  }

  /** 转义正则表达式特殊字符 */
  static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}

/* ------------------------------------------------------------------ */
/* 数据映射器                                                         */
/* ------------------------------------------------------------------ */

/** 代码块与数据库记录的双向映射 */
class ChunkMapper {
  /** 将 IndexedChunk 转换为数据库记录 */
  static toRecord(chunk: IndexedChunk) {
    return {
      id: chunk.id,
      filePath: chunk.filePath,
      relativePath: chunk.relativePath,
      fileHash: chunk.fileHash,
      content: chunk.content,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      type: chunk.type,
      language: chunk.language,
      symbols: chunk.symbols?.join(',') || '',
      vector: chunk.vector,
    }
  }

  /** 批量转换 */
  static toRecords(chunks: IndexedChunk[]) {
    return chunks.map((chunk) => this.toRecord(chunk))
  }

  /** 将数据库记录转换为搜索结果 */
  static toSearchResult(record: LanceDbRecord, score: number): SearchResult {
    return {
      filePath: record.filePath,
      relativePath: record.relativePath,
      content: record.content,
      startLine: record.startLine,
      endLine: record.endLine,
      type: record.type,
      language: record.language,
      score,
    }
  }

  /** 将向量搜索结果转换为 SearchResult */
  static toVectorSearchResult(record: LanceDbSearchResult): SearchResult {
    return this.toSearchResult(record, 1 - record._distance)
  }
}

/* ------------------------------------------------------------------ */
/* 关键词评分器                                                       */
/* ------------------------------------------------------------------ */

/** 计算关键词匹配得分 */
class KeywordScorer {
  /** 计算关键词在内容与符号中的匹配得分 */
  static score(content: string, symbols: string, keywords: string[]): number {
    const lowerContent = content.toLowerCase()
    const lowerSymbols = (symbols || '').toLowerCase()
    let score = 0

    for (const kw of keywords) {
      const lowerKw = kw.toLowerCase()
      // 符号匹配权重更高
      if (lowerSymbols.includes(lowerKw)) {
        score += 0.3
      }
      // 内容匹配
      const pattern = new RegExp(SqlSanitizer.escapeRegex(lowerKw), 'g')
      const matches = (lowerContent.match(pattern) || []).length
      score += Math.min(matches * 0.1, 0.5)
    }

    return Math.min(score, 1)
  }

  /** 构建关键词搜索的 WHERE 条件 */
  static buildWhereClause(keywords: string[]): string {
    return keywords
      .map((kw) => {
        const safe = SqlSanitizer.sanitizeKeyword(kw)
        return `(content LIKE '%${safe}%' OR symbols LIKE '%${safe}%' OR "relativePath" LIKE '%${safe}%')`
      })
      .join(' OR ')
  }
}

/* ------------------------------------------------------------------ */
/* 数据库连接管理器                                                   */
/* ------------------------------------------------------------------ */

/** 管理 LanceDB 连接与表的懒加载 */
class ConnectionManager {
  private db: LanceDbConnection | null = null
  private table: LanceDbTable | null = null

  constructor(
    private readonly indexPath: string,
    private readonly tableName: string,
  ) {}

  /** 初始化数据库连接 */
  async connect(): Promise<boolean> {
    if (!fs.existsSync(this.indexPath)) {
      fs.mkdirSync(this.indexPath, { recursive: true })
    }

    try {
      const lancedb = await import('@lancedb/lancedb')
      this.db = (await lancedb.connect(this.indexPath)) as unknown as LanceDbConnection
      return true
    } catch (e) {
      logger.index.error('[VectorStore] 初始化 LanceDB 失败:', e)
      this.db = null
      return false
    }
  }

  /** 获取当前连接 */
  getConnection(): LanceDbConnection | null {
    return this.db
  }

  /** 确保表已打开（懒加载） */
  async ensureTable(): Promise<LanceDbTable | null> {
    if (this.table) return this.table
    if (!this.db) {
      const ok = await this.connect()
      if (!ok) return null
    }

    try {
      const tables = await this.db!.tableNames()
      if (tables.includes(this.tableName)) {
        this.table = (await this.db!.openTable(this.tableName)) as unknown as LanceDbTable
        return this.table
      }
    } catch (e) {
      logger.index.error('[VectorStore] 打开表失败:', e)
    }
    return null
  }

  /** 获取当前表 */
  getTable(): LanceDbTable | null {
    return this.table
  }

  /** 设置当前表 */
  setTable(table: LanceDbTable | null): void {
    this.table = table
  }

  /** 验证表 schema 是否正确 */
  async validateSchema(): Promise<boolean> {
    if (!this.table) return false
    try {
      await this.table.query().select(['filePath', 'fileHash']).limit(1).toArray()
      return true
    } catch (e) {
      logger.index.warn('[VectorStore] Schema 验证失败:', e)
      return false
    }
  }

  /** 关闭连接 */
  disconnect(): void {
    this.db = null
    this.table = null
  }
}

/* ------------------------------------------------------------------ */
/* 向量存储仓储                                                       */
/* ------------------------------------------------------------------ */

/** 向量存储服务 — 提供代码向量的持久化与检索 */
export class VectorStoreService {
  private readonly connection: ConnectionManager

  constructor(workspacePath: string) {
    const indexPath = path.join(workspacePath, BRAND.dirName, 'index')
    this.connection = new ConnectionManager(indexPath, 'code_chunks')
  }

  /** 初始化数据库连接 */
  async initialize(): Promise<void> {
    const ok = await this.connection.connect()
    if (!ok) return

    const db = this.connection.getConnection()!
    const tableName = 'code_chunks'
    const tables = await db.tableNames()
    logger.index.info(`[VectorStore] 现有表: ${tables.join(', ')}`)

    if (tables.includes(tableName)) {
      const table = (await db.openTable(tableName)) as unknown as LanceDbTable
      this.connection.setTable(table)
      logger.index.info(`[VectorStore] 已打开表: ${tableName}`)

      if (!(await this.connection.validateSchema())) {
        logger.index.warn('[VectorStore] Schema 无效，删除旧表')
        await db.dropTable(tableName)
        this.connection.setTable(null)
      }
    } else {
      logger.index.warn(`[VectorStore] 表 ${tableName} 不存在`)
    }
  }

  /** 检查是否已初始化 */
  isInitialized(): boolean {
    return this.connection.getConnection() !== null
  }

  /** 检查是否有索引数据 */
  async hasIndex(): Promise<boolean> {
    const table = await this.connection.ensureTable()
    if (!table) return false
    const count = await table.countRows()
    return count > 0
  }

  /** 获取索引统计 */
  async getStats(): Promise<{ chunkCount: number; fileCount: number }> {
    const table = await this.connection.ensureTable()
    if (!table) return { chunkCount: 0, fileCount: 0 }
    const count = await table.countRows()
    return { chunkCount: count, fileCount: Math.ceil(count / 5) }
  }

  /** 获取所有文件的 Hash 映射 */
  async getFileHashes(): Promise<Map<string, string>> {
    const table = await this.connection.ensureTable()
    if (!table) return new Map()

    try {
      const results = await table.query().select(['filePath', 'fileHash']).toArray()
      const hashMap = new Map<string, string>()
      for (const r of results) {
        if (r.filePath && r.fileHash && !hashMap.has(r.filePath)) {
          hashMap.set(r.filePath, r.fileHash)
        }
      }
      logger.index.info(`[VectorStore] 加载 ${hashMap.size} 个文件哈希`)
      return hashMap
    } catch (e) {
      logger.index.error('[VectorStore] 获取文件哈希失败:', e)
      return new Map()
    }
  }

  /** 创建或重建索引 */
  async createIndex(chunks: IndexedChunk[]): Promise<void> {
    const db = this.connection.getConnection()
    if (!db) return
    if (chunks.length === 0) {
      logger.index.info('[VectorStore] 无分块需要索引')
      return
    }

    const data = ChunkMapper.toRecords(chunks)
    const tables = await db.tableNames()
    if (tables.includes('code_chunks')) {
      await db.dropTable('code_chunks')
    }
    const table = (await db.createTable('code_chunks', data)) as unknown as LanceDbTable
    this.connection.setTable(table)
    logger.index.info(`[VectorStore] 创建索引，共 ${chunks.length} 个分块`)
  }

  /** 批量添加分块（追加模式） */
  async addBatch(chunks: IndexedChunk[]): Promise<void> {
    const db = this.connection.getConnection()
    if (!db || chunks.length === 0) return

    const data = ChunkMapper.toRecords(chunks)
    const table = this.connection.getTable()
    if (!table) {
      const newTable = (await db.createTable('code_chunks', data)) as unknown as LanceDbTable
      this.connection.setTable(newTable)
      logger.index.info(`[VectorStore] 创建表，初始 ${chunks.length} 个分块`)
    } else {
      await table.add(data)
    }
  }

  /** 添加或更新文件的分块 */
  async upsertFile(filePath: string, chunks: IndexedChunk[]): Promise<void> {
    const table = await this.connection.ensureTable()
    if (!table) return

    await this.deleteFile(filePath)
    if (chunks.length === 0) return
    await table.add(ChunkMapper.toRecords(chunks))
  }

  /** 删除指定文件的所有分块 */
  async deleteFile(filePath: string): Promise<void> {
    const table = await this.connection.ensureTable()
    if (!table) return
    try {
      const safePath = SqlSanitizer.sanitizePath(filePath)
      await table.delete(`filePath = '${safePath}'`)
    } catch (e) {
      logger.index.warn('[VectorStore] 删除文件失败:', e)
    }
  }

  /** 批量删除多个文件的分块 */
  async deleteFiles(filePaths: string[]): Promise<void> {
    const table = await this.connection.ensureTable()
    if (!table || filePaths.length === 0) return

    try {
      const conditions = filePaths
        .map((fp) => `filePath = '${SqlSanitizer.sanitizePath(fp)}'`)
        .join(' OR ')
      await table.delete(conditions)
      logger.index.info(`[VectorStore] 批量删除 ${filePaths.length} 个文件`)
    } catch (e) {
      logger.index.error('[VectorStore] 批量删除失败:', e)
      for (const fp of filePaths) {
        await this.deleteFile(fp)
      }
    }
  }

  /** 向量相似度搜索 */
  async search(queryVector: number[], topK = 10): Promise<SearchResult[]> {
    const table = await this.connection.ensureTable()
    if (!table) {
      logger.index.info('[VectorStore] 搜索失败：表未初始化')
      return []
    }

    const results = await table.search(queryVector).limit(topK).toArray()
    logger.index.info(`[VectorStore] 语义搜索完成，找到 ${results.length} 条结果`)
    return results.map((r) => ChunkMapper.toVectorSearchResult(r))
  }

  /** 关键词搜索 */
  async keywordSearch(keywords: string[], topK = 10): Promise<SearchResult[]> {
    const table = await this.connection.ensureTable()
    if (!table || keywords.length === 0) return []

    try {
      const whereClause = KeywordScorer.buildWhereClause(keywords)
      const results = await table.query().where(whereClause).limit(topK).toArray()
      logger.index.info(`[VectorStore] 关键词搜索完成，找到 ${results.length} 条结果`)
      return results.map((r) =>
        ChunkMapper.toSearchResult(r, KeywordScorer.score(r.content, r.symbols, keywords)),
      )
    } catch (e) {
      logger.index.warn('[VectorStore] 关键词搜索失败:', e)
      return []
    }
  }

  /** 清空索引 */
  async clear(): Promise<void> {
    const db = this.connection.getConnection()
    if (!db) return
    const tables = await db.tableNames()
    if (tables.includes('code_chunks')) {
      await db.dropTable('code_chunks')
      this.connection.setTable(null)
    }
  }

  /** 关闭连接 */
  async close(): Promise<void> {
    this.connection.disconnect()
  }
}
