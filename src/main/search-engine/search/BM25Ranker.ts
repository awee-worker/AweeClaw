/**
 * BM25 关键词检索引擎
 *
 * 通过组合多个专职组件实现关键词搜索：
 * - 文本分词器：将源码文本切分为检索词
 * - 逆文档频率表：计算并缓存每个词的 IDF 值
 * - 相关性评分器：基于 BM25 公式计算文档与查询的相关性
 * - 符号加权器：对符号命中给予额外加分
 * - 文档注册表：管理文档集合的增删与序列化
 */

import { SearchResult } from '../providerTypes'

/* ------------------------------------------------------------------ */
/* 常量                                                               */
/* ------------------------------------------------------------------ */

/** BM25 饱和参数，控制词频的影响上限 */
const K1 = 1.2
/** BM25 长度归一化参数，控制文档长度对得分的影响 */
const B = 0.75
/** 符号命中时的额外加分 */
const SYMBOL_BONUS = 2
/** 最小词长度 */
const MIN_TERM_LENGTH = 2

/* ------------------------------------------------------------------ */
/* 文档类型                                                           */
/* ------------------------------------------------------------------ */

/** BM25 索引文档 */
export interface BM25Document {
  id: string
  filePath: string
  relativePath: string
  content: string
  startLine: number
  endLine: number
  type: string
  language: string
  symbols: string[]
  termFreq: Map<string, number>
  docLength: number
}

/* ------------------------------------------------------------------ */
/* 文本分词器                                                         */
/* ------------------------------------------------------------------ */

/** 将文本切分为小写检索词 */
class TextTokenizer {
  /** 分词正则：按空白和非单词字符切分 */
  private static readonly SPLITTER = /[\s\W]+/

  /**
   * 对文本进行分词
   *
   * @param text 源文本
   * @returns 过滤后的检索词列表（小写）
   */
  tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .split(TextTokenizer.SPLITTER)
      .filter((t) => t.length >= MIN_TERM_LENGTH && !/^\d+$/.test(t))
  }
}

/* ------------------------------------------------------------------ */
/* 逆文档频率表                                                       */
/* ------------------------------------------------------------------ */

/** 计算并存储每个词的 IDF 值 */
class IdfTable {
  private readonly table = new Map<string, number>()

  /**
   * 根据文档集合计算 IDF
   *
   * @param documents 文档列表
   */
  compute(documents: BM25Document[]): void {
    const docFreq = new Map<string, number>()
    const totalDocs = documents.length

    for (const doc of documents) {
      for (const term of doc.termFreq.keys()) {
        docFreq.set(term, (docFreq.get(term) ?? 0) + 1)
      }
    }

    this.table.clear()
    for (const [term, df] of docFreq) {
      this.table.set(term, Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1))
    }
  }

  /** 获取指定词的 IDF 值 */
  get(term: string): number {
    return this.table.get(term) ?? 0
  }

  /** 清空表 */
  clear(): void {
    this.table.clear()
  }

  /** 序列化为数组 */
  toArray(): [string, number][] {
    return Array.from(this.table.entries())
  }

  /** 从数组恢复 */
  fromArray(data: [string, number][]): void {
    this.table.clear()
    for (const [term, value] of data) {
      this.table.set(term, value)
    }
  }
}

/* ------------------------------------------------------------------ */
/* 相关性评分器                                                       */
/* ------------------------------------------------------------------ */

/** 基于 BM25 公式计算单个词在单个文档中的得分 */
class RelevanceScorer {
  /**
   * @param idfTable IDF 表
   * @param avgDocLength 文档集合的平均长度
   */
  constructor(
    private readonly idfTable: IdfTable,
    private readonly avgDocLength: number,
  ) {}

  /**
   * 计算词项在文档中的 BM25 得分
   *
   * @param term 检索词
   * @param doc 目标文档
   * @returns 该词的 BM25 得分
   */
  scoreTerm(term: string, doc: BM25Document): number {
    const tf = doc.termFreq.get(term) ?? 0
    if (tf === 0) return 0

    const idf = this.idfTable.get(term)
    const numerator = tf * (K1 + 1)
    const denominator = tf + K1 * (1 - B + B * (doc.docLength / this.avgDocLength))
    return idf * (numerator / denominator)
  }
}

/* ------------------------------------------------------------------ */
/* 符号加权器                                                         */
/* ------------------------------------------------------------------ */

/** 对符号命中查询词的文档给予额外加分 */
class SymbolBooster {
  /**
   * 计算符号匹配加分
   *
   * @param symbols 文档的符号列表
   * @param queryTerms 查询词列表
   * @returns 符号加分总和
   */
  computeBonus(symbols: string[], queryTerms: string[]): number {
    if (symbols.length === 0 || queryTerms.length === 0) return 0

    let bonus = 0
    for (const symbol of symbols) {
      const lowerSymbol = symbol.toLowerCase()
      for (const term of queryTerms) {
        if (lowerSymbol.includes(term)) {
          bonus += SYMBOL_BONUS
        }
      }
    }
    return bonus
  }
}

/* ------------------------------------------------------------------ */
/* 文档注册表                                                         */
/* ------------------------------------------------------------------ */

/** 管理文档集合的增删与序列化 */
class DocumentRegistry {
  private readonly documents: BM25Document[] = []
  private avgDocLength = 0

  /** 添加单个文档（自动分词并计算词频） */
  add(raw: Omit<BM25Document, 'termFreq' | 'docLength'>, tokenizer: TextTokenizer): void {
    const terms = tokenizer.tokenize(raw.content)
    const termFreq = new Map<string, number>()
    for (const term of terms) {
      termFreq.set(term, (termFreq.get(term) ?? 0) + 1)
    }
    this.documents.push({ ...raw, termFreq, docLength: terms.length })
  }

  /** 获取所有文档 */
  all(): BM25Document[] {
    return this.documents
  }

  /** 删除指定文件的所有文档 */
  removeByFile(relativePath: string): boolean {
    const before = this.documents.length
    const filtered = this.documents.filter((d) => d.relativePath !== relativePath)
    if (filtered.length === before) return false
    this.documents.length = 0
    this.documents.push(...filtered)
    return true
  }

  /** 清空所有文档 */
  clear(): void {
    this.documents.length = 0
    this.avgDocLength = 0
  }

  /** 计算平均文档长度 */
  computeAvgLength(): number {
    if (this.documents.length === 0) {
      this.avgDocLength = 0
      return 0
    }
    const total = this.documents.reduce((sum, doc) => sum + doc.docLength, 0)
    this.avgDocLength = total / this.documents.length
    return this.avgDocLength
  }

  /** 获取平均文档长度 */
  getAverageLength(): number {
    return this.avgDocLength
  }

  /** 获取文档数量 */
  get size(): number {
    return this.documents.length
  }

  /** 序列化文档列表 */
  serializeDocuments(): unknown[] {
    return this.documents.map((doc) => ({
      ...doc,
      termFreq: Array.from(doc.termFreq.entries()),
    }))
  }

  /** 从序列化数据恢复文档 */
  deserializeDocuments(data: unknown[]): void {
    this.documents.length = 0
    for (const item of data) {
      const d = item as BM25Document & { termFreq: [string, number][] }
      this.documents.push({
        ...d,
        termFreq: new Map(d.termFreq),
      })
    }
  }
}

/* ------------------------------------------------------------------ */
/* BM25 索引（外观）                                                  */
/* ------------------------------------------------------------------ */

/** BM25 关键词索引 — 协调分词、IDF、评分与文档管理 */
export class BM25Index {
  private readonly tokenizer = new TextTokenizer()
  private readonly idfTable = new IdfTable()
  private readonly registry = new DocumentRegistry()
  private readonly booster = new SymbolBooster()

  /** 添加单个文档 */
  addDocument(doc: Omit<BM25Document, 'termFreq' | 'docLength'>): void {
    this.registry.add(doc, this.tokenizer)
  }

  /** 批量添加文档 */
  addDocuments(docs: Omit<BM25Document, 'termFreq' | 'docLength'>[]): void {
    for (const doc of docs) {
      this.registry.add(doc, this.tokenizer)
    }
  }

  /** 构建索引（计算平均长度与 IDF） */
  build(): void {
    const avgLength = this.registry.computeAvgLength()
    if (avgLength === 0) return
    this.idfTable.compute(this.registry.all())
  }

  /** 搜索文档 */
  search(query: string, topK: number = 10): SearchResult[] {
    const docs = this.registry.all()
    if (docs.length === 0) return []

    const queryTerms = this.tokenizer.tokenize(query)
    if (queryTerms.length === 0) return []

    const avgLength = this.registry.getAverageLength()
    const scorer = new RelevanceScorer(this.idfTable, avgLength)
    const scored: { doc: BM25Document; score: number }[] = []

    for (const doc of docs) {
      let score = 0
      for (const term of queryTerms) {
        score += scorer.scoreTerm(term, doc)
      }
      score += this.booster.computeBonus(doc.symbols, queryTerms)

      if (score > 0) {
        scored.push({ doc, score })
      }
    }

    scored.sort((a, b) => b.score - a.score)

    return scored.slice(0, topK).map(({ doc, score }) => ({
      filePath: doc.filePath,
      relativePath: doc.relativePath,
      content: doc.content,
      startLine: doc.startLine,
      endLine: doc.endLine,
      score: score / 10,
      type: doc.type,
      language: doc.language,
    }))
  }

  /** 清空索引 */
  clear(): void {
    this.registry.clear()
    this.idfTable.clear()
  }

  /** 删除指定文件的所有文档 */
  deleteFile(relativePath: string): void {
    this.registry.removeByFile(relativePath)
  }

  /** 获取文档数量 */
  get size(): number {
    return this.registry.size
  }

  /** 序列化为 JSON */
  toJSON(): { documents: BM25Document[]; avgDocLength: number; idf: [string, number][] } {
    return {
      documents: this.registry.serializeDocuments() as BM25Document[],
      avgDocLength: this.registry.getAverageLength(),
      idf: this.idfTable.toArray(),
    }
  }

  /** 从 JSON 恢复 */
  fromJSON(data: { documents: unknown[]; avgDocLength: number; idf: [string, number][] }): void {
    this.registry.deserializeDocuments(data.documents)
    this.idfTable.fromArray(data.idf)
  }
}
