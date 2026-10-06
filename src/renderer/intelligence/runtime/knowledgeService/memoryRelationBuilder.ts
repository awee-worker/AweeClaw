/**
 * 记忆关联生成
 *
 * 关联此前只能手工创建，所以图谱里几乎没有边，记忆之间也就谈不上「智能关联」。
 * 这里在写入时按内容相似度、场景域与时间邻近自动建边：
 *  - 内容高度相似 → similar
 *  - 内容语义相近，或同场景域内相关 → semantic
 *  - 同场景域且写入时间接近 → temporal
 *
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

const SIMILAR_THRESHOLD = 0.85
const SEMANTIC_THRESHOLD = 0.6
const RELATED_THRESHOLD = 0.45
/** 时序关联的时间窗口：一天之内 */
const TEMPORAL_WINDOW_MS = 24 * 60 * 60 * 1000
const DEFAULT_MAX_RELATIONS = 5

/** 归一化：去空白与标点，统一小写 */
function normalize(text: string): string {
  return text.replace(/[\s\p{P}]/gu, '').toLowerCase()
}

/** 字符二元组集合 */
function bigrams(text: string): Set<string> {
  const normalized = normalize(text)
  const grams = new Set<string>()
  if (normalized.length === 1) {
    grams.add(normalized)
    return grams
  }
  for (let i = 0; i < normalized.length - 1; i++) {
    grams.add(normalized.slice(i, i + 2))
  }
  return grams
}

/** 二元组 Jaccard 相似度，对中英文都适用 */
export function textSimilarity(a: string, b: string): number {
  const setA = bigrams(a)
  const setB = bigrams(b)
  if (setA.size === 0 || setB.size === 0) return 0

  let intersection = 0
  for (const gram of setA) {
    if (setB.has(gram)) intersection++
  }
  return intersection / (setA.size + setB.size - intersection)
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

  for (const other of existing) {
    if (!other.id || other.id === entry.id) continue

    const similarity = textSimilarity(entry.content, other.content)
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

    if (sameDomain && similarity >= RELATED_THRESHOLD) {
      candidates.push({
        targetId: other.id,
        relationType: 'semantic',
        weight: similarity * 0.9,
        reason: '同场景域内相关',
      })
      continue
    }

    if (sameDomain && timeGap <= TEMPORAL_WINDOW_MS) {
      candidates.push({
        targetId: other.id,
        relationType: 'temporal',
        weight: 0.5,
        reason: '同场景域且时间邻近',
      })
    }
  }

  return candidates
    .sort((a, b) => b.weight - a.weight)
    .slice(0, maxRelations)
}
