/**
 * 记忆关联生成
 *
 * 关联此前只能手工创建，所以图谱里几乎没有边，记忆之间也就谈不上「智能关联」。
 * 这里在写入时按内容相似度、场景域与时间邻近自动建边：
 *  - 内容高度相似 → similar
 *  - 内容语义相近 → semantic
 *  - 同场景域且内容相关 → semantic（降权）
 *  - 同场景域、内容相关且写入时间接近 → temporal（弱边）
 *
 * 前置条件是两条记忆必须有实质内容重合：同场景域、写入时间接近本身不构成
 * 关联理由 —— 同一个域里先后聊的两件不相干的事，连起来只会污染关联图。
 * 每条记忆只与最相关的少数几条建边，避免关联图退化成全连通。
 */

export type RelationKind = 'similar' | 'semantic' | 'temporal'

export interface RelationNode {
  id: string
  content: string
  tags: string[]
  createdAt: number
}

export interface RelationCandidate {
  targetId: string
  relationType: RelationKind
  weight: number
  reason: string
}

/** 内容高度相似 */
const SIMILAR_THRESHOLD = 0.85
/** 语义相近：二元组 Jaccard 到这个量级才算真的在讲同一件事 */
const SEMANTIC_THRESHOLD = 0.68
/** 同场景域内的相关下限，比跨域更宽松但仍有实质要求 */
const SAME_DOMAIN_THRESHOLD = 0.55
/** 时序关联只作弱边兜底，同样要求最低内容重合 */
const TEMPORAL_MIN_SIMILARITY = 0.3
/** 交集二元组下限：重合过少多半只是撞了几句套话 */
export const MIN_SHARED_GRAMS = 3
/** 时序关联的时间窗口：一天之内 */
const TEMPORAL_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_RELATIONS = 5
/** 时序关联是弱边，每条记忆最多建一条，避免同域批量写入时把图连成一片 */
const MAX_TEMPORAL_RELATIONS = 1

/**
 * 高频二元组停用表。
 *
 * 中文里「我们」「可以」「需要」「一个」这类搭配几乎出现在任何两段话里，
 * 不剔除就会把无关内容算出虚高的相似度，这也是无关记忆被连边的直接原因之一。
 */
const STOP_GRAMS = new Set([
  // 人称与指代
  '我们', '你们', '他们', '她们', '它们', '咱们', '自己', '这个', '那个', '这些', '那些',
  '这样', '那样', '这里', '那里', '这边', '那边', '其中', '其他', '另外',
  // 高频功能词
  '可以', '需要', '应该', '就是', '不是', '没有', '还有', '如果', '因为', '所以', '但是',
  '然后', '而且', '或者', '以及', '对于', '关于', '通过', '进行', '使用', '实现', '一些',
  '一下', '一个', '什么', '怎么', '如何', '现在', '目前', '已经', '时候', '一起', '之后',
  '之前', '同时', '并且', '并不', '只是', '这种', '那种', '一样', '比较',
  // 泛化名词
  '问题', '情况', '内容', '东西', '部分', '方式', '方法', '地方', '方面', '功能', '效果',
  '结果', '相关', '对应', '信息', '数据', '需求', '样子', '感觉',
  // 英文高频二元组
  'th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'ou', 'it', 'is', 'ar', 've', 'to',
  'of', 'or', 'as', 'be', 'ed', 'es', 'ng', 'st', 'ti', 'io',
])

/** 归一化：去空白与标点，统一小写 */
function normalize(text: string): string {
  return text.replace(/[\s\p{P}]/gu, '').toLowerCase()
}

/**
 * 字符二元组集合（剔除高频套话搭配）。
 *
 * 关联生成与记忆检索共用这一套口径：两边对「两段文字是否在讲同一件事」
 * 的判断必须一致，否则检索命中但与关联判定打架，排查时无从下手。
 */
export function effectiveGrams(text: string): Set<string> {
  const normalized = normalize(text)
  const grams = new Set<string>()
  if (normalized.length === 1) {
    if (!STOP_GRAMS.has(normalized)) grams.add(normalized)
    return grams
  }
  for (let i = 0; i < normalized.length - 1; i++) {
    const gram = normalized.slice(i, i + 2)
    if (!STOP_GRAMS.has(gram)) grams.add(gram)
  }
  return grams
}

export interface TextSimilarityDetail {
  /** 二元组 Jaccard 相似度 */
  similarity: number
  /** 实际重合的二元组数量，用于判断重合是否只是巧合 */
  sharedGrams: number
}

/** 比较两段文本的二元组重合情况，对中英文都适用 */
export function compareText(a: string, b: string): TextSimilarityDetail {
  const setA = effectiveGrams(a)
  const setB = effectiveGrams(b)
  if (setA.size === 0 || setB.size === 0) return { similarity: 0, sharedGrams: 0 }

  let intersection = 0
  for (const gram of setA) {
    if (setB.has(gram)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return {
    similarity: union === 0 ? 0 : intersection / union,
    sharedGrams: intersection,
  }
}

/** 二元组 Jaccard 相似度 */
export function textSimilarity(a: string, b: string): number {
  return compareText(a, b).similarity
}

/** 两条记忆是否属于同一场景域 */
function sharesDomain(a: string[], b: string[]): boolean {
  const domainsOf = (tags: string[]) => tags.filter(t => t.startsWith('domain:'))
  const domainsA = domainsOf(a)
  const domainsB = domainsOf(b)
  return domainsA.some(tag => domainsB.includes(tag))
}

/**
 * 为新记忆挑选关联对象。
 *
 * @param entry     新写入的记忆
 * @param existing  候选记忆（规模由调用方控制，通常取最近的若干条）
 */
export function buildMemoryRelations(
  entry: RelationNode,
  existing: RelationNode[],
  options: { maxRelations?: number } = {},
): RelationCandidate[] {
  const maxRelations = options.maxRelations ?? DEFAULT_MAX_RELATIONS
  const candidates: RelationCandidate[] = []
  let temporalCount = 0

  for (const other of existing) {
    if (!other.id || other.id === entry.id) continue

    const { similarity, sharedGrams } = compareText(entry.content, other.content)
    // 内容没有实质重合：无论同域、无论时间多近，都不建边
    if (sharedGrams < MIN_SHARED_GRAMS) continue

    const sameDomain = sharesDomain(entry.tags, other.tags)
    const timeGap = Math.abs(entry.createdAt - other.createdAt)

    if (similarity >= SIMILAR_THRESHOLD) {
      candidates.push({
        targetId: other.id,
        relationType: 'similar',
        weight: similarity,
        reason: '内容高度相似',
      })
      continue
    }

    if (similarity >= SEMANTIC_THRESHOLD) {
      candidates.push({
        targetId: other.id,
        relationType: 'semantic',
        weight: similarity,
        reason: '内容语义相近',
      })
      continue
    }

    if (sameDomain && similarity >= SAME_DOMAIN_THRESHOLD) {
      candidates.push({
        targetId: other.id,
        relationType: 'semantic',
        weight: similarity * 0.9,
        reason: '同场景域内相关',
      })
      continue
    }

    if (
      sameDomain &&
      similarity >= TEMPORAL_MIN_SIMILARITY &&
      timeGap <= TEMPORAL_WINDOW_MS &&
      temporalCount < MAX_TEMPORAL_RELATIONS
    ) {
      temporalCount++
      candidates.push({
        targetId: other.id,
        relationType: 'temporal',
        weight: 0.35,
        reason: '同场景域、内容相关且时间邻近',
      })
    }
  }

  return candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxRelations)
}
