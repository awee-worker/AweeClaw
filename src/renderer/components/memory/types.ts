/**
 * 记忆系统类型定义
 * 与后端 Prisma schema 对齐
 */

// ============ 枚举类型 ============

export type MemoryCategory =
  | 'LIFE'
  | 'WORK'
  | 'PEOPLE'
  | 'KNOWLEDGE'
  | 'PREFERENCE'
  | 'EVENT'
  | 'EMOTION'
  | 'FINANCE'
  | 'UNCATEGORIZED'

export type MemoryTier = 'permanent' | 'long_term' | 'short_term' | 'working'

export type MemoryType = 'SHORT_TERM' | 'LONG_TERM' | 'EPISODIC' | 'SEMANTIC' | 'PROCEDURAL'

export type SceneType =
  | 'home'
  | 'office'
  | 'cafe'
  | 'outdoor'
  | 'commute'
  | 'travel'
  | 'unknown'

export type MemoryRelationType =
  | 'similar'
  | 'causal'
  | 'temporal'
  | 'semantic'
  | 'contrast'
  | 'extension'

export type MemoryFeedbackType = 'useful' | 'not_useful' | 'outdated' | 'incorrect'

export type ClassifiedBy = 'manual' | 'rule' | 'llm' | 'system'

// ============ 数据模型 ============

export interface AgentMemory {
  id: string
  userId: string
  conversationId: string | null
  type: MemoryType
  content: string
  summary: string | null
  importance: number
  accessCount: number
  lastAccessedAt: string | null
  expiresAt: string | null
  embedding: number[]
  createdAt: string
  updatedAt: string
  // v3.0 新增字段
  category?: MemoryCategory | null
  subcategory?: string | null
  tier?: MemoryTier
  tags?: string[] | null
  enabled?: boolean
  version?: number
  retentionScore?: number
  reviewCount?: number
  lastReviewedAt?: string | null
  classifiedBy?: ClassifiedBy | null
  classifiedAt?: string | null
  classificationConfidence?: number | null
  // 关联数据
  spatialMemory?: SpatialMemory | null
  sourceRelations?: MemoryRelation[]
  targetRelations?: MemoryRelation[]
  versions?: MemoryVersion[]
  feedbacks?: MemoryFeedback[]
}

export interface SpatialMemory {
  id: string
  memoryId: string
  locationName: string | null
  latitude: number | null
  longitude: number | null
  address: string | null
  sceneType: SceneType
  sceneDescription: string | null
  deviceType: string | null
  deviceName: string | null
  createdAt: string
  updatedAt: string
}

export interface MemoryRelation {
  id: string
  sourceMemoryId: string
  targetMemoryId: string
  relationType: MemoryRelationType
  weight: number
  createdAt: string
  sourceMemory?: Pick<AgentMemory, 'id' | 'content' | 'summary' | 'category'>
  targetMemory?: Pick<AgentMemory, 'id' | 'content' | 'summary' | 'category'>
}

export interface MemoryVersion {
  id: string
  memoryId: string
  version: number
  content: string
  summary: string | null
  importance: number
  category: MemoryCategory | null
  subcategory: string | null
  changeReason: string | null
  changedBy: string | null
  createdAt: string
}

export interface MemoryFeedback {
  id: string
  memoryId: string
  userId: string
  feedbackType: MemoryFeedbackType
  comment: string | null
  createdAt: string
}

export interface CategoryConfig {
  id: string
  code: MemoryCategory
  name: string
  nameEn: string
  icon: string
  color: string
  description: string
  sortOrder: number
  enabled: boolean
  subcategories: SubcategoryConfig[]
}

export interface SubcategoryConfig {
  id: string
  categoryId: string
  code: string
  name: string
  nameEn: string
  keywords: string[]
  description: string | null
  sortOrder: number
  enabled: boolean
}

// ============ API 响应类型 ============

export interface MemoryListResponse {
  items: AgentMemory[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface MemoryListQuery {
  limit?: number
  offset?: number
  category?: MemoryCategory
  tier?: MemoryTier
  type?: MemoryType
  keyword?: string
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export interface ClassificationResult {
  memoryId: string
  category: MemoryCategory
  subcategory: string | null
  confidence: number
  classifiedBy: ClassifiedBy
  method: 'cache' | 'rule' | 'llm'
}

export interface ForgettingStats {
  total: number
  active: number
  forgotten: number
  expired: number
  byTier: Array<{ tier: MemoryTier; count: number; avgRetention: number }>
  promotedToday: number
  forgottenToday: number
}

export interface VisualizationData {
  nodes: VisualizationNode[]
  edges: VisualizationEdge[]
  meta: {
    total: number
    byCategory: Record<string, number>
    byTier: Record<string, number>
    avgImportance: number
    avgRetention: number
  }
}

export interface VisualizationNode {
  id: string
  label: string
  category: MemoryCategory
  tier: MemoryTier
  importance: number
  retentionScore: number
  createdAt: string
  tags: string[]
}

export interface VisualizationEdge {
  source: string
  target: string
  relationType: MemoryRelationType
  weight: number
}

export interface MemoryOverview {
  total: number
  active: number
  forgotten: number
  byCategory: Array<{ category: MemoryCategory; count: number; avgImportance: number }>
  byTier: Array<{ tier: MemoryTier; count: number; avgRetention: number }>
  recentGrowth: Array<{ date: string; count: number }>
  topTags: Array<{ tag: string; count: number }>
}

export interface TimelineItem {
  id: string
  content: string
  summary: string | null
  category: MemoryCategory
  tier: MemoryTier
  importance: number
  createdAt: string
  tags: string[]
}

export interface SpatialContext {
  locationName?: string
  latitude?: number
  longitude?: number
  address?: string
  sceneType?: SceneType
  sceneDescription?: string
  deviceType?: string
  deviceName?: string
}

// ============ UI 辅助类型 ============

export type MemoryViewMode = 'list' | 'grid' | 'timeline' | 'graph' | '3d'

export type MemorySortField =
  | 'createdAt'
  | 'updatedAt'
  | 'importance'
  | 'retentionScore'
  | 'lastReviewedAt'

export interface MemoryFilter {
  keyword?: string
  categories?: MemoryCategory[]
  tiers?: MemoryTier[]
  types?: MemoryType[]
  tags?: string[]
  dateFrom?: string
  dateTo?: string
  minImportance?: number
  maxImportance?: number
  enabledOnly?: boolean
}

// ============ 分类显示元数据 ============

export const CATEGORY_META: Record<
  MemoryCategory,
  { label: string; labelEn: string; color: string; icon: string }
> = {
  LIFE: { label: '生活', labelEn: 'Life', color: '#10B981', icon: 'home' },
  WORK: { label: '工作', labelEn: 'Work', color: '#3B82F6', icon: 'briefcase' },
  PEOPLE: { label: '人物', labelEn: 'People', color: '#8B5CF6', icon: 'users' },
  KNOWLEDGE: { label: '知识', labelEn: 'Knowledge', color: '#F59E0B', icon: 'book-open' },
  PREFERENCE: { label: '偏好', labelEn: 'Preference', color: '#EC4899', icon: 'heart' },
  EVENT: { label: '事件', labelEn: 'Event', color: '#EF4444', icon: 'calendar' },
  EMOTION: { label: '情感', labelEn: 'Emotion', color: '#F97316', icon: 'mood' },
  FINANCE: { label: '财务', labelEn: 'Finance', color: '#14B8A6', icon: 'dollar-sign' },
  UNCATEGORIZED: { label: '未分类', labelEn: 'Uncategorized', color: '#6B7280', icon: 'help-circle' },
}

export const TIER_META: Record<
  MemoryTier,
  { label: string; labelEn: string; color: string; description: string }
> = {
  permanent: {
    label: '永久记忆',
    labelEn: 'Permanent',
    color: '#DC2626',
    description: '永不遗忘的核心记忆',
  },
  long_term: {
    label: '长期记忆',
    labelEn: 'Long-term',
    color: '#7C3AED',
    description: '经过巩固的重要记忆',
  },
  short_term: {
    label: '短期记忆',
    labelEn: 'Short-term',
    color: '#3B82F6',
    description: '近期记忆，会逐渐衰减',
  },
  working: {
    label: '工作记忆',
    labelEn: 'Working',
    color: '#10B981',
    description: '当前会话的临时记忆',
  },
}

export const RELATION_TYPE_META: Record<
  MemoryRelationType,
  { label: string; labelEn: string; color: string }
> = {
  similar: { label: '相似', labelEn: 'Similar', color: '#3B82F6' },
  causal: { label: '因果', labelEn: 'Causal', color: '#EF4444' },
  temporal: { label: '时序', labelEn: 'Temporal', color: '#10B981' },
  semantic: { label: '语义', labelEn: 'Semantic', color: '#8B5CF6' },
  contrast: { label: '对比', labelEn: 'Contrast', color: '#F59E0B' },
  extension: { label: '延伸', labelEn: 'Extension', color: '#EC4899' },
}
