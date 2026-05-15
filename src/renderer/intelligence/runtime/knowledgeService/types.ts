export type KnowledgeSource = 'user' | 'file' | 'url' | 'database' | 'web-crawl' | 'migrated'

export type KnowledgeCategory =
  | 'concept'
  | 'decision'
  | 'faq'
  | 'reference'
  | 'glossary'
  | 'best-practice'
  | 'error-solution'
  | 'api'
  | 'pattern'
  | 'document'

export const KNOWLEDGE_CATEGORIES: Array<{
  id: KnowledgeCategory
  labelZh: string
  labelEn: string
  color: string
}> = [
  { id: 'concept', labelZh: '概念', labelEn: 'Concept', color: 'text-blue-400' },
  { id: 'decision', labelZh: '架构决策', labelEn: 'Decision', color: 'text-amber-400' },
  { id: 'faq', labelZh: '常见问题', labelEn: 'FAQ', color: 'text-orange-400' },
  { id: 'reference', labelZh: '参考资料', labelEn: 'Reference', color: 'text-emerald-400' },
  { id: 'glossary', labelZh: '术语表', labelEn: 'Glossary', color: 'text-purple-400' },
  { id: 'best-practice', labelZh: '最佳实践', labelEn: 'Best Practice', color: 'text-cyan-400' },
  { id: 'error-solution', labelZh: '错误解决方案', labelEn: 'Error Solution', color: 'text-red-400' },
  { id: 'api', labelZh: 'API 文档', labelEn: 'API Doc', color: 'text-indigo-400' },
  { id: 'pattern', labelZh: '设计模式', labelEn: 'Pattern', color: 'text-teal-400' },
  { id: 'document', labelZh: '文档', labelEn: 'Document', color: 'text-sky-400' },
]

export interface KnowledgeEntry {
  id: string
  title: string
  content: string
  category: KnowledgeCategory
  tags: string[]
  starred: boolean
  enabled: boolean
  source: KnowledgeSource
  sourceDetail?: string
  confidence: number
  accessCount: number
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

export interface KnowledgeEntryInput {
  title?: string
  content: string
  category?: KnowledgeCategory
  tags?: string[]
  starred?: boolean
  enabled?: boolean
  source?: KnowledgeSource
  sourceDetail?: string
  confidence?: number
}

export interface KnowledgeSearchParams {
  query: string
  tags?: string[]
  category?: KnowledgeCategory
  starred?: boolean
  limit?: number
}

export interface KnowledgeSearchResult {
  entry: KnowledgeEntry
  score: number
}

export interface KnowledgeStore {
  version: number
  entries: KnowledgeEntry[]
  migratedFromMemory?: boolean
}

export interface VectorIndexStats {
  totalVectors: number
  lastRebuildAt: number | null
  lastIncrementalUpdateAt: number | null
  indexSizeBytes: number
  embeddingProvider: string | null
  isHealthy: boolean
}

export interface CrossProjectSearchResult {
  projectId: string
  projectName: string
  entry: KnowledgeEntry
  score: number
}

export interface IndexHealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy'
  totalEntries: number
  indexedEntries: number
  staleEntries: number
  lastRebuildAt: number | null
  embeddingAvailable: boolean
  issues: Array<{ severity: 'warning' | 'error'; message: string }>
}
