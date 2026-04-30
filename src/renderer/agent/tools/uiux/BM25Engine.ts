/**
 * BM25 搜索引擎
 * 从 ui-ux-pro-max-skill 移植的 TypeScript 实现
 */

/**
 * BM25 排名算法
 */
export class BM25 {
  private k1: number
  private b: number
  private corpus: string[][] = []
  private docLengths: number[] = []
  private avgdl = 0
  private idf: Map<string, number> = new Map()
  private docFreqs: Map<string, number> = new Map()
  private N = 0

  constructor(k1 = 1.5, b = 0.75) {
    this.k1 = k1
    this.b = b
  }

  /**
   * 分词：小写、分割、移除标点、过滤短词
   */
  tokenize(text: string): string[] {
    const cleaned = String(text).toLowerCase().replace(/[^\w\s]/g, ' ')
    return cleaned.split(/\s+/).filter(w => w.length > 2)
  }

  /**
   * 构建 BM25 索引
   */
  fit(documents: string[]): void {
    this.corpus = documents.map(doc => this.tokenize(doc))
    this.N = this.corpus.length
    if (this.N === 0) return

    this.docLengths = this.corpus.map(doc => doc.length)
    this.avgdl = this.docLengths.reduce((a, b) => a + b, 0) / this.N

    // 计算文档频率
    this.docFreqs.clear()
    for (const doc of this.corpus) {
      const seen = new Set<string>()
      for (const word of doc) {
        if (!seen.has(word)) {
          this.docFreqs.set(word, (this.docFreqs.get(word) || 0) + 1)
          seen.add(word)
        }
      }
    }

    // 计算 IDF
    this.idf.clear()
    for (const [word, freq] of this.docFreqs) {
      this.idf.set(word, Math.log((this.N - freq + 0.5) / (freq + 0.5) + 1))
    }
  }

  /**
   * 对所有文档评分
   */
  score(query: string): Array<{ index: number; score: number }> {
    const queryTokens = this.tokenize(query)
    const scores: Array<{ index: number; score: number }> = []

    for (let idx = 0; idx < this.corpus.length; idx++) {
      const doc = this.corpus[idx]
      const docLen = this.docLengths[idx]
      
      // 计算词频
      const termFreqs = new Map<string, number>()
      for (const word of doc) {
        termFreqs.set(word, (termFreqs.get(word) || 0) + 1)
      }

      let score = 0
      for (const token of queryTokens) {
        const idf = this.idf.get(token)
        if (idf !== undefined) {
          const tf = termFreqs.get(token) || 0
          const numerator = tf * (this.k1 + 1)
          const denominator = tf + this.k1 * (1 - this.b + this.b * docLen / this.avgdl)
          score += idf * numerator / denominator
        }
      }

      scores.push({ index: idx, score })
    }

    return scores.sort((a, b) => b.score - a.score)
  }
}

/**
 * 搜索结果
 */
export interface SearchResult<T> {
  item: T
  score: number
}

/**
 * 通用 BM25 搜索器
 */
export class BM25Searcher<T extends Record<string, unknown>> {
  private bm25 = new BM25()
  private data: T[] = []

  /**
   * 初始化搜索器
   * @param data 数据数组
   * @param searchFields 用于搜索的字段名
   */
  initialize(data: T[], searchFields: string[]): void {
    this.data = data

    // 构建搜索文档
    const documents = data.map(item => 
      searchFields.map(field => String(item[field] || '')).join(' ')
    )

    this.bm25.fit(documents)
  }

  /**
   * 搜索
   * @param query 查询字符串
   * @param maxResults 最大结果数
   */
  search(query: string, maxResults = 3): SearchResult<T>[] {
    const ranked = this.bm25.score(query)
    
    return ranked
      .slice(0, maxResults)
      .filter(r => r.score > 0)
      .map(r => ({
        item: this.data[r.index],
        score: r.score,
      }))
  }
}
