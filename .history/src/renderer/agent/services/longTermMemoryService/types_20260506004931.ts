export type MemorySource = 'auto_extracted' | 'user' | 'dreaming_light' | 'dreaming_deep' | 'dreaming_rem'

export type MemoryStatus = 'short_term' | 'long_term' | 'forgotten'

export interface MemoryEntry {
  id: string
  content: string
  source: MemorySource
  status: MemoryStatus
  confidence: number
  recallCount: number
  uniqueQueryCount: number
  lastRecalledAt: number
  halfLifeDays: number
  tags: string[]
  enabled: boolean
  createdAt: number
  updatedAt: number
  promotedAt?: number
  expiresAt?: number
  originalSessionId?: string
}

export interface MemoryEntryInput {
  content: string
  source?: MemorySource
  status?: MemoryStatus
  confidence?: number
  tags?: string[]
  enabled?: boolean
  originalSessionId?: string
}

export interface MemorySearchParams {
  query: string
  status?: MemoryStatus
  limit?: number
}

export interface MemorySearchResult {
  entry: MemoryEntry
  score: number
}

export interface MemoryStore {
  version: number
  shortTerm: MemoryEntry[]
  longTerm: MemoryEntry[]
  forgotten: MemoryEntry[]
}

export interface DreamingConfig {
  enabled: boolean
  lightFrequency: string
  deepFrequency: string
  remFrequency: string
  deepMinScore: number
  deepMinRecallCount: number
  deepMinUniqueQueries: number
  deepRecencyHalfLifeDays: number
  deepMaxAgeDays: number
}

export const DEFAULT_DREAMING_CONFIG: DreamingConfig = {
  enabled: false,
  lightFrequency: '0 */6 * * *',
  deepFrequency: '0 3 * * *',
  remFrequency: '0 5 * * 0',
  deepMinScore: 0.8,
  deepMinRecallCount: 3,
  deepMinUniqueQueries: 3,
  deepRecencyHalfLifeDays: 14,
  deepMaxAgeDays: 30,
}
