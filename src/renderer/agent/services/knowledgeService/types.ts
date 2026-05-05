export type KnowledgeLayer = 'manual' | 'conversation' | 'codebase'

export type KnowledgeCategory =
  | 'concept'
  | 'decision'
  | 'preference'
  | 'faq'
  | 'reference'
  | 'glossary'
  | 'best-practice'
  | 'error-solution'
  | 'api'
  | 'pattern'

export const KNOWLEDGE_CATEGORIES: Array<{
  id: KnowledgeCategory
  labelZh: string
  labelEn: string
  color: string
}> = [
  { id: 'concept', labelZh: '概念', labelEn: 'Concept', color: 'text-blue-400' },
  { id: 'decision', labelZh: '架构决策', labelEn: 'Decision', color: 'text-amber-400' },
  { id: 'preference', labelZh: '偏好', labelEn: 'Preference', color: 'text-pink-400' },
  { id: 'faq', labelZh: '常见问题', labelEn: 'FAQ', color: 'text-orange-400' },
  { id: 'reference', labelZh: '参考资料', labelEn: 'Reference', color: 'text-emerald-400' },
  { id: 'glossary', labelZh: '术语表', labelEn: 'Glossary', color: 'text-purple-400' },
  { id: 'best-practice', labelZh: '最佳实践', labelEn: 'Best Practice', color: 'text-cyan-400' },
  { id: 'error-solution', labelZh: '错误解决方案', labelEn: 'Error Solution', color: 'text-red-400' },
  { id: 'api', labelZh: 'API 文档', labelEn: 'API Doc', color: 'text-indigo-400' },
  { id: 'pattern', labelZh: '设计模式', labelEn: 'Pattern', color: 'text-teal-400' },
]

export interface KnowledgeEntry {
  id: string
  title: string
  content: string
  layer: KnowledgeLayer
  category: KnowledgeCategory
  tags: string[]
  starred: boolean
  enabled: boolean
  source: string
  confidence: number
  accessCount: number
  createdAt: number
  updatedAt: number
  expiresAt?: number
}

export interface KnowledgeEntryInput {
  title?: string
  content: string
  layer?: KnowledgeLayer
  category?: KnowledgeCategory
  tags?: string[]
  starred?: boolean
  enabled?: boolean
  source?: string
  confidence?: number
}

export interface KnowledgeSearchParams {
  query: string
  tags?: string[]
  category?: KnowledgeCategory
  layer?: KnowledgeLayer
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
