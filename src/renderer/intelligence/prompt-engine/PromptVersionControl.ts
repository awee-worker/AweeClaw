import { logger } from '@toolkit/LogEngine'

export interface PromptVersion {
  id: string
  name: string
  description: string
  content: string
  category: PromptCategory
  tags: string[]
  createdAt: number
  updatedAt: number
  createdBy: 'user' | 'system'
  parentId?: string
  version: number
  isActive: boolean
  metrics?: PromptMetrics
}

export interface PromptMetrics {
  usageCount: number
  successRate: number
  avgResponseTime: number
  avgTokenUsage: number
  lastUsedAt?: number
}

export type PromptCategory = 'system' | 'identity' | 'security' | 'workflow' | 'tool_guideline' | 'custom'

export interface ABTestConfig {
  id: string
  name: string
  promptAId: string
  promptBId: string
  category: PromptCategory
  trafficSplit: number
  status: 'draft' | 'running' | 'paused' | 'completed'
  startDate: number
  endDate?: number
  minSampleSize: number
  targetMetric: 'successRate' | 'avgResponseTime' | 'avgTokenUsage'
  results?: ABTestResult
}

export interface ABTestResult {
  sampleA: number
  sampleB: number
  metricA: number
  metricB: number
  winner?: 'A' | 'B' | 'none'
  confidence: number
  completedAt: number
}

export interface ABTestSample {
  testId: string
  variant: 'A' | 'B'
  metric: number
  timestamp: number
}

type VersionListener = (versions: PromptVersion[]) => void

class PromptVersionControlService {
  private versions = new Map<string, PromptVersion>()
  private abTests = new Map<string, ABTestConfig>()
  private abSamples = new Map<string, ABTestSample[]>()
  private listeners = new Set<VersionListener>()
  private userAssignmentCache = new Map<string, { testId: string; variant: 'A' | 'B' }>()

  createVersion(params: Omit<PromptVersion, 'id' | 'createdAt' | 'updatedAt' | 'version' | 'metrics'>): PromptVersion {
    const existingVersions = this.getVersionsByCategory(params.category)
    const maxVersion = existingVersions.reduce((max, v) => Math.max(max, v.version), 0)

    const version: PromptVersion = {
      ...params,
      id: `pv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: maxVersion + 1,
      metrics: {
        usageCount: 0,
        successRate: 0,
        avgResponseTime: 0,
        avgTokenUsage: 0,
      },
    }

    this.versions.set(version.id, version)
    this.notifyListeners()
    logger.agent.info(`[PromptVC] Created version: ${version.name} v${version.version}`)
    return version
  }

  updateVersion(id: string, updates: Partial<Pick<PromptVersion, 'name' | 'description' | 'content' | 'tags' | 'isActive'>>): PromptVersion | undefined {
    const version = this.versions.get(id)
    if (!version) return undefined

    const updated: PromptVersion = {
      ...version,
      ...updates,
      updatedAt: Date.now(),
    }

    this.versions.set(id, updated)
    this.notifyListeners()
    return updated
  }

  forkVersion(id: string, newName?: string): PromptVersion | undefined {
    const source = this.versions.get(id)
    if (!source) return undefined

    return this.createVersion({
      name: newName || `${source.name} (fork)`,
      description: source.description,
      content: source.content,
      category: source.category,
      tags: [...source.tags],
      createdBy: 'user',
      parentId: source.id,
      isActive: false,
    })
  }

  deleteVersion(id: string): boolean {
    const version = this.versions.get(id)
    if (!version) return false

    const activeTests = Array.from(this.abTests.values()).filter(
      t => t.status === 'running' && (t.promptAId === id || t.promptBId === id)
    )
    if (activeTests.length > 0) {
      logger.agent.warn(`[PromptVC] Cannot delete version ${id}: used in active A/B test`)
      return false
    }

    this.versions.delete(id)
    this.notifyListeners()
    return true
  }

  getVersion(id: string): PromptVersion | undefined {
    return this.versions.get(id)
  }

  getVersionsByCategory(category: PromptCategory): PromptVersion[] {
    return Array.from(this.versions.values())
      .filter(v => v.category === category)
      .sort((a, b) => b.version - a.version)
  }

  getActiveVersion(category: PromptCategory): PromptVersion | undefined {
    return Array.from(this.versions.values())
      .find(v => v.category === category && v.isActive)
  }

  setActiveVersion(id: string): void {
    const version = this.versions.get(id)
    if (!version) return

    for (const v of this.versions.values()) {
      if (v.category === version.category) {
        v.isActive = v.id === id
      }
    }

    this.notifyListeners()
    logger.agent.info(`[PromptVC] Set active version for ${version.category}: ${version.name}`)
  }

  recordUsage(id: string, success: boolean, responseTime: number, tokenUsage: number): void {
    const version = this.versions.get(id)
    if (!version || !version.metrics) return

    const m = version.metrics
    const totalSamples = m.usageCount
    m.usageCount++
    m.successRate = (m.successRate * totalSamples + (success ? 1 : 0)) / m.usageCount
    m.avgResponseTime = (m.avgResponseTime * totalSamples + responseTime) / m.usageCount
    m.avgTokenUsage = (m.avgTokenUsage * totalSamples + tokenUsage) / m.usageCount
    m.lastUsedAt = Date.now()

    this.checkABTestAssignments(id, success, responseTime, tokenUsage)
  }

  createABTest(config: Omit<ABTestConfig, 'id' | 'status' | 'results'>): ABTestConfig {
    const test: ABTestConfig = {
      ...config,
      id: `abt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: 'draft',
    }
    this.abTests.set(test.id, test)
    this.abSamples.set(test.id, [])
    logger.agent.info(`[PromptVC] Created A/B test: ${test.name}`)
    return test
  }

  startABTest(id: string): boolean {
    const test = this.abTests.get(id)
    if (!test) return false

    if (!this.versions.has(test.promptAId) || !this.versions.has(test.promptBId)) {
      logger.agent.warn(`[PromptVC] Cannot start test ${id}: missing prompt versions`)
      return false
    }

    test.status = 'running'
    test.startDate = Date.now()
    logger.agent.info(`[PromptVC] Started A/B test: ${test.name}`)
    return true
  }

  pauseABTest(id: string): void {
    const test = this.abTests.get(id)
    if (test) test.status = 'paused'
  }

  completeABTest(id: string): ABTestResult | undefined {
    const test = this.abTests.get(id)
    if (!test) return undefined

    const result = this.calculateABTestResult(id)
    if (result) {
      test.results = result
      test.status = 'completed'
      test.endDate = Date.now()
      logger.agent.info(`[PromptVC] A/B test completed: ${test.name}, winner: ${result.winner || 'none'}`)
    }
    return result
  }

  getABTest(id: string): ABTestConfig | undefined {
    return this.abTests.get(id)
  }

  getAllABTests(): ABTestConfig[] {
    return Array.from(this.abTests.values())
  }

  resolvePromptForUser(userId: string, category: PromptCategory): PromptVersion | undefined {
    const runningTests = Array.from(this.abTests.values()).filter(
      t => t.status === 'running' && t.category === category
    )

    if (runningTests.length === 0) {
      return this.getActiveVersion(category)
    }

    const test = runningTests[0]
    const cached = this.userAssignmentCache.get(userId)

    if (cached && cached.testId === test.id) {
      const versionId = cached.variant === 'A' ? test.promptAId : test.promptBId
      return this.versions.get(versionId)
    }

    const variant: 'A' | 'B' = Math.random() < test.trafficSplit ? 'A' : 'B'
    this.userAssignmentCache.set(userId, { testId: test.id, variant })

    const versionId = variant === 'A' ? test.promptAId : test.promptBId
    return this.versions.get(versionId)
  }

  getVersionHistory(id: string): PromptVersion[] {
    const history: PromptVersion[] = []
    let current = this.versions.get(id)

    while (current) {
      history.push(current)
      current = current.parentId ? this.versions.get(current.parentId) : undefined
    }

    return history
  }

  getAllVersions(): PromptVersion[] {
    return Array.from(this.versions.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  subscribe(listener: VersionListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private checkABTestAssignments(promptVersionId: string, success: boolean, responseTime: number, tokenUsage: number): void {
    for (const test of this.abTests.values()) {
      if (test.status !== 'running') continue
      if (test.promptAId !== promptVersionId && test.promptBId !== promptVersionId) continue

      const variant = test.promptAId === promptVersionId ? 'A' : 'B'
      const metric = test.targetMetric === 'successRate' ? (success ? 1 : 0) :
        test.targetMetric === 'avgResponseTime' ? responseTime : tokenUsage

      const samples = this.abSamples.get(test.id) || []
      samples.push({
        testId: test.id,
        variant,
        metric,
        timestamp: Date.now(),
      })
      this.abSamples.set(test.id, samples)

      if (samples.length >= test.minSampleSize * 2) {
        const result = this.calculateABTestResult(test.id)
        if (result && result.confidence >= 0.95) {
          this.completeABTest(test.id)
        }
      }
    }
  }

  private calculateABTestResult(testId: string): ABTestResult | undefined {
    const test = this.abTests.get(testId)
    const samples = this.abSamples.get(testId)
    if (!test || !samples || samples.length < 10) return undefined

    const samplesA = samples.filter(s => s.variant === 'A')
    const samplesB = samples.filter(s => s.variant === 'B')

    if (samplesA.length < 5 || samplesB.length < 5) return undefined

    const metricA = samplesA.reduce((sum, s) => sum + s.metric, 0) / samplesA.length
    const metricB = samplesB.reduce((sum, s) => sum + s.metric, 0) / samplesB.length

    const seA = this.standardError(samplesA.map(s => s.metric))
    const seB = this.standardError(samplesB.map(s => s.metric))
    const seDiff = Math.sqrt(seA * seA + seB * seB)

    const zScore = seDiff > 0 ? Math.abs(metricA - metricB) / seDiff : 0
    const confidence = this.normalCDF(zScore) * 2 - 1

    let winner: 'A' | 'B' | 'none' = 'none'
    if (confidence >= 0.95) {
      const lowerIsBetter = test.targetMetric === 'avgResponseTime' || test.targetMetric === 'avgTokenUsage'
      if (lowerIsBetter) {
        winner = metricA < metricB ? 'A' : metricB < metricA ? 'B' : 'none'
      } else {
        winner = metricA > metricB ? 'A' : metricB > metricA ? 'B' : 'none'
      }
    }

    return {
      sampleA: samplesA.length,
      sampleB: samplesB.length,
      metricA,
      metricB,
      winner,
      confidence,
      completedAt: Date.now(),
    }
  }

  private standardError(values: number[]): number {
    if (values.length < 2) return 0
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1)
    return Math.sqrt(variance / values.length)
  }

  private normalCDF(z: number): number {
    const a1 = 0.254829592
    const a2 = -0.284496736
    const a3 = 1.421413741
    const a4 = -1.453152027
    const a5 = 1.061405429
    const p = 0.3275911

    const sign = z < 0 ? -1 : 1
    const x = Math.abs(z) / Math.sqrt(2)
    const t = 1 / (1 + p * x)
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x)

    return 0.5 * (1 + sign * y)
  }

  private notifyListeners(): void {
    const versions = this.getAllVersions()
    for (const listener of this.listeners) {
      try {
        listener(versions)
      } catch (e) {
        logger.agent.error('[PromptVC] Listener error:', e)
      }
    }
  }
}

export const promptVersionControl = new PromptVersionControlService()
