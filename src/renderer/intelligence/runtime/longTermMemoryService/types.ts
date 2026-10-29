import type { TrustChannel, TrustLevel } from '@intelligence/types/trustTypes'

export type MemorySource = 'auto_extracted' | 'user' | 'dreaming_light' | 'dreaming_deep' | 'dreaming_rem' | 'self_reflection' | 'self_correction'

export type MemoryStatus = 'short_term' | 'long_term' | 'forgotten'

export type VerificationStatus = 'unverified' | 'verified' | 'contradicted' | 'superseded'

export interface CorrectionChain {
  supersededBy: string
  supersededAt: number
  reason: string
}

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
  correctionChain?: CorrectionChain
  derivedFrom?: string[]
  verificationStatus?: VerificationStatus
  lastVerifiedAt?: number
  /** 来源信任级别（缺省视为 trusted，兼容存量数据） */
  originTrust?: TrustLevel
  /** 来源定位：文件路径 / URL / 服务名 */
  originLocator?: string
  /** 来源通道 */
  originChannel?: TrustChannel
  /** 证据片段：写入时的原文摘要，用于事后核对 */
  evidence?: string
}

export interface MemoryEntryInput {
  content: string
  source?: MemorySource
  status?: MemoryStatus
  confidence?: number
  tags?: string[]
  enabled?: boolean
  originalSessionId?: string
  correctionChain?: CorrectionChain
  derivedFrom?: string[]
  verificationStatus?: VerificationStatus
  supersedeId?: string
  supersedeReason?: string
  /** 来源信任级别（缺省视为 trusted，兼容存量数据） */
  originTrust?: TrustLevel
  /** 来源定位：文件路径 / URL / 服务名 */
  originLocator?: string
  /** 来源通道 */
  originChannel?: TrustChannel
  /** 证据片段：写入时的原文摘要，用于事后核对 */
  evidence?: string
}

/** 矛盾记录（持久化，替代仅打日志） */
export interface MemoryContradictionRecord {
  id: string
  entryAId: string
  entryBId: string
  reason: string
  detectedAt: number
}

export interface MemorySearchParams {
  query: string
  status?: MemoryStatus
  limit?: number
  /**
   * 词面相关度下限，默认 0（有任何相关即入选）。
   * 需要「宁缺勿滥」的注入场景可以抬高该值，只保留与当前问题重合度较高的记忆。
   */
  minRelevance?: number
}

export interface MemorySearchResult {
  entry: MemoryEntry
  score: number
  /**
   * 与当前问题的词面重合度。只用于同一主题内的比较，
   * 跨主题不可比 —— 不同对象的记忆相关度高低没有意义。
   */
  relevance?: number
  /**
   * 本次注入时，同主题下被折叠掉的更早条目数量。
   * 折叠只影响注入，不修改库里的数据。
   */
  supersededCount?: number
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
  enabled: true,
  lightFrequency: '0 */6 * * *',
  deepFrequency: '0 3 * * *',
  remFrequency: '0 5 * * 0',
  deepMinScore: 0.8,
  deepMinRecallCount: 3,
  deepMinUniqueQueries: 3,
  deepRecencyHalfLifeDays: 14,
  deepMaxAgeDays: 30,
}

export interface ReflectionInsight {
  content: string
  sourceIds: string[]
  type: 'synthesis' | 'contradiction' | 'pattern' | 'refinement'
  confidence: number
  tags: string[]
}

export interface ReflectionResult {
  insights: ReflectionInsight[]
  contradictions: Array<{ entryAId: string; entryBId: string; reason: string }>
  supersededIds: string[]
  newEntryIds: string[]
  timestamp: number
}

export type LearningEventType = 'tool_used' | 'file_accessed' | 'error_encountered' | 'pattern_followed' | 'preference_expressed' | 'correction_made'

export interface SelfLearningRecord {
  id: string
  eventType: LearningEventType
  context: string
  outcome?: string
  timestamp: number
  sessionId?: string
  metadata?: Record<string, unknown>
}

export interface BehavioralPattern {
  pattern: string
  frequency: number
  confidence: number
  firstSeenAt: number
  lastSeenAt: number
  examples: string[]
  tags: string[]
}

export interface LearningResult {
  patterns: BehavioralPattern[]
  newMemoryIds: string[]
  reinforcedIds: string[]
}

export type KnowledgeDomain = 'codebase' | 'user_preference' | 'architecture' | 'error_resolution' | 'workflow' | 'general'

export interface KnowledgeGap {
  domain: KnowledgeDomain
  description: string
  confidence: number
  relatedTags: string[]
  detectedAt: number
}

export interface MetacognitiveState {
  memoryConfidence: number
  knowledgeCoverage: Record<KnowledgeDomain, number>
  gaps: KnowledgeGap[]
  lastAssessmentAt: number
  totalMemories: number
  verifiedRatio: number
  contradictionCount: number
  averageConfidence: number
}

export type TaskType = 'coding' | 'debugging' | 'refactoring' | 'architecture' | 'testing' | 'documentation' | 'general'

export interface MemoryRetrievalContext {
  query: string
  currentFile?: string
  taskType?: TaskType
  recentTopics?: string[]
  sessionId?: string
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'night'
  errorContext?: boolean
}
