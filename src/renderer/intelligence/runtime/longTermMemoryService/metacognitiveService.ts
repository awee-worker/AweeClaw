import { longTermMemoryService } from './registerHandlers'
import { logger } from '@toolkit/LogEngine'
import type { MetacognitiveState, KnowledgeGap, KnowledgeDomain, MemoryEntry } from '@intelligence/providerTypes'

const DOMAIN_TAG_MAP: Record<KnowledgeDomain, string[]> = {
  codebase: ['code', 'file', 'project', 'src', 'component', 'module', 'function', 'class'],
  user_preference: ['preference', 'user-stated', 'like', 'dislike', 'habit', 'style'],
  architecture: ['architecture', 'design', 'pattern', 'structure', 'framework', 'system'],
  error_resolution: ['error', 'bug', 'fix', 'solution', 'correction', 'debug'],
  workflow: ['workflow', 'process', 'step', 'pipeline', 'ci', 'deploy', 'test'],
  general: [],
}

class MetacognitiveService {
  private cachedState: MetacognitiveState | null = null
  private lastAssessmentAt = 0
  private readonly ASSESSMENT_INTERVAL_MS = 30 * 60 * 1000

  async assess(): Promise<MetacognitiveState> {
    const now = Date.now()
    if (this.cachedState && now - this.lastAssessmentAt < this.ASSESSMENT_INTERVAL_MS) {
      return this.cachedState
    }

    const entries = await longTermMemoryService.getEnabledEntries()
    const activeEntries = entries.filter(e => e.verificationStatus !== 'superseded')

    const totalMemories = activeEntries.length
    const verifiedEntries = activeEntries.filter(e => e.verificationStatus === 'verified')
    const contradictedEntries = activeEntries.filter(e => e.verificationStatus === 'contradicted')
    const verifiedRatio = totalMemories > 0 ? verifiedEntries.length / totalMemories : 0
    const contradictionCount = contradictedEntries.length
    const averageConfidence = totalMemories > 0
      ? activeEntries.reduce((sum, e) => sum + e.confidence, 0) / totalMemories
      : 0

    const knowledgeCoverage = this.computeKnowledgeCoverage(activeEntries)
    const gaps = this.detectKnowledgeGaps(activeEntries, knowledgeCoverage)
    const memoryConfidence = this.computeMemoryConfidence(verifiedRatio, averageConfidence, contradictionCount, totalMemories)

    const state: MetacognitiveState = {
      memoryConfidence,
      knowledgeCoverage,
      gaps,
      lastAssessmentAt: now,
      totalMemories,
      verifiedRatio,
      contradictionCount,
      averageConfidence,
    }

    this.cachedState = state
    this.lastAssessmentAt = now

    logger.agent.info(
      `[Metacognitive] Assessment: confidence=${memoryConfidence.toFixed(2)}, memories=${totalMemories}, verified=${(verifiedRatio * 100).toFixed(0)}%, gaps=${gaps.length}`
    )

    return state
  }

  buildMetacognitivePrompt(state: MetacognitiveState): string {
    const lines: string[] = []

    lines.push(`Memory system status: ${state.totalMemories} memories, ${(state.verifiedRatio * 100).toFixed(0)}% verified, average confidence ${state.averageConfidence.toFixed(2)}`)

    const lowCoverage = Object.entries(state.knowledgeCoverage)
      .filter(([, coverage]) => coverage < 0.3)
      .map(([domain]) => domain)
    if (lowCoverage.length > 0) {
      lines.push(`Knowledge gaps in: ${lowCoverage.join(', ')}`)
    }

    if (state.contradictionCount > 0) {
      lines.push(`${state.contradictionCount} contradictory memories detected`)
    }

    if (state.gaps.length > 0) {
      const gapDescriptions = state.gaps.slice(0, 3).map(g => g.description)
      lines.push(`Areas needing more information: ${gapDescriptions.join('; ')}`)
    }

    if (state.memoryConfidence < 0.5) {
      lines.push('Memory confidence is low - consider verifying important facts before relying on them')
    }

    return lines.join('\n')
  }

  private computeKnowledgeCoverage(entries: MemoryEntry[]): Record<KnowledgeDomain, number> {
    const coverage: Record<KnowledgeDomain, number> = {
      codebase: 0,
      user_preference: 0,
      architecture: 0,
      error_resolution: 0,
      workflow: 0,
      general: 0,
    }

    const domainCounts: Record<KnowledgeDomain, number> = {
      codebase: 0,
      user_preference: 0,
      architecture: 0,
      error_resolution: 0,
      workflow: 0,
      general: 0,
    }

    for (const entry of entries) {
      let assigned = false
      for (const [domain, domainTags] of Object.entries(DOMAIN_TAG_MAP) as [KnowledgeDomain, string[]][]) {
        if (domain === 'general') continue
        if (entry.tags.some((tag: string) => domainTags.some(dt => tag.toLowerCase().includes(dt)))) {
          domainCounts[domain]++
          assigned = true
        }
      }
      if (!assigned) {
        domainCounts.general++
      }
    }

    const maxCount = Math.max(1, ...Object.values(domainCounts))
    for (const domain of Object.keys(coverage) as KnowledgeDomain[]) {
      coverage[domain] = Math.min(1, domainCounts[domain] / Math.max(1, maxCount * 0.3))
    }

    return coverage
  }

  private detectKnowledgeGaps(entries: MemoryEntry[], coverage: Record<KnowledgeDomain, number>): KnowledgeGap[] {
    const gaps: KnowledgeGap[] = []

    for (const [domain, cov] of Object.entries(coverage) as [KnowledgeDomain, number][]) {
      if (cov >= 0.3) continue

      const domainTags = DOMAIN_TAG_MAP[domain]
      gaps.push({
        domain,
        description: this.describeGap(domain, cov),
        confidence: 1 - cov,
        relatedTags: domainTags.slice(0, 3),
        detectedAt: Date.now(),
      })
    }

    const lowConfEntries = entries.filter(e => e.confidence < 0.5 && e.verificationStatus === 'unverified')
    if (lowConfEntries.length > 5) {
      gaps.push({
        domain: 'general',
        description: `${lowConfEntries.length} low-confidence unverified memories need validation`,
        confidence: 0.7,
        relatedTags: ['needs-verification'],
        detectedAt: Date.now(),
      })
    }

    return gaps.sort((a, b) => b.confidence - a.confidence).slice(0, 5)
  }

  private describeGap(domain: KnowledgeDomain, coverage: number): string {
    const descriptions: Record<KnowledgeDomain, string> = {
      codebase: 'Limited knowledge about codebase structure and components',
      user_preference: 'Few user preferences recorded - may not align with user expectations',
      architecture: 'Insufficient architectural knowledge - may make inconsistent design decisions',
      error_resolution: 'Limited error resolution memory - may repeat past mistakes',
      workflow: 'Workflow patterns not well captured - may not follow established processes',
      general: 'General knowledge gaps detected',
    }
    return `${descriptions[domain]} (coverage: ${(coverage * 100).toFixed(0)}%)`
  }

  private computeMemoryConfidence(verifiedRatio: number, avgConfidence: number, contradictions: number, total: number): number {
    if (total === 0) return 0

    const verifiedWeight = 0.3
    const confidenceWeight = 0.4
    const contradictionPenalty = 0.3

    const verifiedScore = verifiedRatio * verifiedWeight
    const confidenceScore = avgConfidence * confidenceWeight
    const contradictionScore = Math.max(0, 1 - (contradictions / total) * 2) * contradictionPenalty

    return Math.min(1, verifiedScore + confidenceScore + contradictionScore)
  }

  invalidateCache(): void {
    this.cachedState = null
    this.lastAssessmentAt = 0
  }
}

export const metacognitiveService = new MetacognitiveService()
