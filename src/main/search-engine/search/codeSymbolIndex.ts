/**
 * 符号索引 — 函数、类、变量等符号的快速查找
 *
 * 通过组合多个专职组件实现符号检索：
 * - 名称索引表：按符号名建立倒排索引
 * - 文件索引表：按文件路径建立正向索引
 * - 匹配评分器：根据匹配类型计算相关性得分
 * - 标识符拆分器：将驼峰/下划线标识符拆分为子词
 */

import { SymbolInfo, SymbolKind } from '../providerTypes'

/* ------------------------------------------------------------------ */
/* 匹配等级                                                           */
/* ------------------------------------------------------------------ */

/** 匹配类型与对应的基础得分 */
enum MatchTier {
  /** 名称完全相等 */
  Exact = 100,
  /** 名称以查询开头 */
  Prefix = 80,
  /** 名称包含查询 */
  Contains = 50,
  /** 标识符子词以查询开头 */
  TokenPrefix = 30,
  /** 不匹配 */
  None = 0,
}

/* ------------------------------------------------------------------ */
/* 标识符拆分器                                                       */
/* ------------------------------------------------------------------ */

/** 将驼峰/下划线标识符拆分为子词列表 */
class IdentifierSplitter {
  /** 驼峰边界正则：匹配小写到大写的转换 */
  private static readonly CAMEL_BOUNDARY = /([a-z])([A-Z])/g
  /** 分词正则：按空格切分 */
  private static readonly WORD_SPLITTER = /\s+/

  /**
   * 拆分标识符
   *
   * @param name 原始标识符
   * @returns 拆分后的子词列表
   */
  split(name: string): string[] {
    const spaced = name
      .replace(IdentifierSplitter.CAMEL_BOUNDARY, '$1 $2')
      .replace(/_/g, ' ')
    return spaced.split(IdentifierSplitter.WORD_SPLITTER).filter(Boolean)
  }
}

/* ------------------------------------------------------------------ */
/* 匹配评分器                                                         */
/* ------------------------------------------------------------------ */

/** 根据查询与符号名的匹配程度计算得分 */
class MatchScorer {
  private readonly splitter = new IdentifierSplitter()

  /**
   * 计算匹配得分
   *
   * @param symbolName 符号名称
   * @param lowerQuery 已转为小写的查询词
   * @returns 匹配等级对应的得分
   */
  score(symbolName: string, lowerQuery: string): number {
    const lowerName = symbolName.toLowerCase()

    if (lowerName === lowerQuery) return MatchTier.Exact
    if (lowerName.startsWith(lowerQuery)) return MatchTier.Prefix
    if (lowerName.includes(lowerQuery)) return MatchTier.Contains

    const tokens = this.splitter.split(symbolName)
    for (const token of tokens) {
      if (token.toLowerCase().startsWith(lowerQuery)) {
        return MatchTier.TokenPrefix
      }
    }

    return MatchTier.None
  }
}

/* ------------------------------------------------------------------ */
/* 名称索引表                                                         */
/* ------------------------------------------------------------------ */

/** 按符号名建立倒排索引 */
class NameIndex {
  private readonly entries = new Map<string, SymbolInfo[]>()

  /** 添加符号到名称索引 */
  insert(symbol: SymbolInfo): void {
    const list = this.entries.get(symbol.name)
    if (list) {
      list.push(symbol)
    } else {
      this.entries.set(symbol.name, [symbol])
    }
  }

  /** 获取指定名称的所有符号 */
  lookup(name: string): SymbolInfo[] {
    return this.entries.get(name) ?? []
  }

  /** 遍历所有名称与符号列表 */
  iterate(): Iterable<[string, SymbolInfo[]]> {
    return this.entries.entries()
  }

  /** 获取所有唯一符号名 */
  names(): string[] {
    return Array.from(this.entries.keys())
  }

  /** 从名称索引中删除指定文件的符号 */
  purgeFile(relativePath: string): void {
    for (const [name, list] of this.entries) {
      const filtered = list.filter((s) => s.relativePath !== relativePath)
      if (filtered.length === 0) {
        this.entries.delete(name)
      } else {
        this.entries.set(name, filtered)
      }
    }
  }

  /** 清空索引 */
  clear(): void {
    this.entries.clear()
  }

  /** 获取唯一符号名数量 */
  get size(): number {
    return this.entries.size
  }

  /** 序列化 */
  serialize(): [string, SymbolInfo[]][] {
    return Array.from(this.entries.entries())
  }

  /** 反序列化 */
  deserialize(data: [string, SymbolInfo[]][]): void {
    this.entries.clear()
    for (const [name, list] of data) {
      this.entries.set(name, list)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 文件索引表                                                         */
/* ------------------------------------------------------------------ */

/** 按文件路径建立正向索引 */
class FileIndex {
  private readonly entries = new Map<string, SymbolInfo[]>()

  /** 添加符号到文件索引 */
  insert(symbol: SymbolInfo): void {
    const list = this.entries.get(symbol.relativePath)
    if (list) {
      list.push(symbol)
    } else {
      this.entries.set(symbol.relativePath, [symbol])
    }
  }

  /** 获取指定文件的所有符号 */
  lookup(relativePath: string): SymbolInfo[] {
    return this.entries.get(relativePath) ?? []
  }

  /** 删除指定文件的所有符号 */
  purgeFile(relativePath: string): SymbolInfo[] | null {
    const symbols = this.entries.get(relativePath)
    if (symbols) {
      this.entries.delete(relativePath)
      return symbols
    }
    return null
  }

  /** 清空索引 */
  clear(): void {
    this.entries.clear()
  }

  /** 获取已索引文件数量 */
  get fileCount(): number {
    return this.entries.size
  }

  /** 序列化 */
  serialize(): [string, SymbolInfo[]][] {
    return Array.from(this.entries.entries())
  }

  /** 反序列化 */
  deserialize(data: [string, SymbolInfo[]][]): void {
    this.entries.clear()
    for (const [path, list] of data) {
      this.entries.set(path, list)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 符号索引（外观）                                                   */
/* ------------------------------------------------------------------ */

/** 符号索引 — 协调名称索引、文件索引与匹配评分 */
export class SymbolIndex {
  private readonly nameIndex = new NameIndex()
  private readonly fileIndex = new FileIndex()
  private readonly scorer = new MatchScorer()

  /** 添加单个符号 */
  add(symbol: SymbolInfo): void {
    this.nameIndex.insert(symbol)
    this.fileIndex.insert(symbol)
  }

  /** 批量添加符号 */
  addBatch(symbols: SymbolInfo[]): void {
    for (const symbol of symbols) {
      this.add(symbol)
    }
  }

  /**
   * 搜索符号
   *
   * @param query 查询字符串
   * @param topK 返回的最大结果数
   * @returns 按匹配度排序的符号列表
   */
  search(query: string, topK: number = 20): SymbolInfo[] {
    const lowerQuery = query.toLowerCase()
    const candidates: { symbol: SymbolInfo; score: number }[] = []

    for (const [name, symbols] of this.nameIndex.iterate()) {
      const score = this.scorer.score(name, lowerQuery)
      if (score > 0) {
        for (const symbol of symbols) {
          candidates.push({ symbol, score })
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score)
    return candidates.slice(0, topK).map((c) => c.symbol)
  }

  /**
   * 按符号类型过滤搜索
   *
   * @param query 查询字符串
   * @param kind 符号类型
   * @param topK 返回的最大结果数
   */
  searchByKind(query: string, kind: SymbolKind, topK: number = 20): SymbolInfo[] {
    return this.search(query, topK * 2)
      .filter((s) => s.kind === kind)
      .slice(0, topK)
  }

  /** 获取指定文件的所有符号 */
  getFileSymbols(relativePath: string): SymbolInfo[] {
    return this.fileIndex.lookup(relativePath)
  }

  /** 获取所有唯一符号名 */
  getAllNames(): string[] {
    return this.nameIndex.names()
  }

  /** 清空索引 */
  clear(): void {
    this.nameIndex.clear()
    this.fileIndex.clear()
  }

  /** 删除指定文件的所有符号 */
  deleteFile(relativePath: string): void {
    const symbols = this.fileIndex.purgeFile(relativePath)
    if (!symbols) return
    this.nameIndex.purgeFile(relativePath)
  }

  /** 获取唯一符号名数量 */
  get size(): number {
    return this.nameIndex.size
  }

  /** 获取已索引文件数量 */
  get fileCount(): number {
    return this.fileIndex.fileCount
  }

  /** 序列化为 JSON */
  toJSON(): { byName: [string, SymbolInfo[]][]; byFile: [string, SymbolInfo[]][] } {
    return {
      byName: this.nameIndex.serialize(),
      byFile: this.fileIndex.serialize(),
    }
  }

  /** 从 JSON 恢复 */
  fromJSON(data: { byName: [string, SymbolInfo[]][]; byFile: [string, SymbolInfo[]][] }): void {
    this.nameIndex.deserialize(data.byName)
    this.fileIndex.deserialize(data.byFile)
  }
}
