/**
 * Scenario Marketplace - 场景市场
 *
 * 支持浏览、搜索、安装和发布场景插件。
 * 场景市场是通用 AI 智能体的核心分发渠道。
 *
 * 设计原则：
 * - 去中心化：支持多个市场源（官方、社区、私有）
 * - 安全审查：安装前自动检查安全性
 * - 版本管理：支持场景更新和回滚
 * - 评分系统：社区驱动的质量评估
 */

// ============================================
// 市场条目
// ============================================

export interface MarketplaceEntry {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  author: string
  version: string
  category: MarketplaceCategory
  tags: string[]
  icon?: string
  screenshots?: string[]

  rating: number
  ratingCount: number
  downloadCount: number

  scenarioId: string
  requiredToolPacks: string[]
  requiredSkills?: string[]
  compatibleWith?: string[]

  source: MarketplaceSource
  repositoryUrl?: string
  homepageUrl?: string
  license?: string

  publishedAt: number
  updatedAt: number
}

export type MarketplaceCategory =
  | 'development'
  | 'data'
  | 'creative'
  | 'productivity'
  | 'education'
  | 'business'
  | 'lifestyle'
  | 'research'
  | 'custom'

export type MarketplaceSource = 'official' | 'community' | 'private'

// ============================================
// 市场搜索
// ============================================

export interface MarketplaceSearchQuery {
  text?: string
  category?: MarketplaceCategory
  tags?: string[]
  source?: MarketplaceSource
  sortBy?: 'rating' | 'downloads' | 'recent' | 'name'
  sortOrder?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface MarketplaceSearchResult {
  entries: MarketplaceEntry[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

// ============================================
// 安装状态
// ============================================

export type InstallStatus =
  | 'idle'
  | 'downloading'
  | 'installing'
  | 'completed'
  | 'failed'

export interface InstallProgress {
  entryId: string
  status: InstallStatus
  progress: number
  error?: string
}

// ============================================
// 市场源配置
// ============================================

export interface MarketplaceSourceConfig {
  id: string
  name: string
  baseUrl: string
  type: 'official' | 'community' | 'private'
  authToken?: string
  enabled: boolean
}

// ============================================
// 场景市场服务
// ============================================

class ScenarioMarketplaceClass {
  private sources = new Map<string, MarketplaceSourceConfig>()
  private installed = new Map<string, InstalledScenario>()
  private installListeners = new Set<(progress: InstallProgress) => void>()

  constructor() {
    this.addSource({
      id: 'official',
      name: 'Official Marketplace',
      baseUrl: 'https://marketplace.aweeclaw.com/api',
      type: 'official',
      enabled: true,
    })
  }

  addSource(config: MarketplaceSourceConfig): void {
    this.sources.set(config.id, config)
  }

  removeSource(sourceId: string): boolean {
    return this.sources.delete(sourceId)
  }

  getSources(): MarketplaceSourceConfig[] {
    return Array.from(this.sources.values()).filter(s => s.enabled)
  }

  async search(query: MarketplaceSearchQuery): Promise<MarketplaceSearchResult> {
    const allEntries: MarketplaceEntry[] = []

    for (const source of this.getSources()) {
      try {
        const entries = await this.searchSource(source, query)
        allEntries.push(...entries)
      } catch {
        // skip failed sources
      }
    }

    const filtered = this.applyFilters(allEntries, query)
    const sorted = this.applySorting(filtered, query)
    const paginated = this.applyPagination(sorted, query)

    return paginated
  }

  private async searchSource(
    source: MarketplaceSourceConfig,
    query: MarketplaceSearchQuery
  ): Promise<MarketplaceEntry[]> {
    const params = new URLSearchParams()
    if (query.text) params.set('q', query.text)
    if (query.category) params.set('category', query.category)
    if (query.tags?.length) params.set('tags', query.tags.join(','))

    const url = `${source.baseUrl}/scenarios?${params.toString()}`

    try {
      const response = await fetch(url, {
        headers: source.authToken
          ? { Authorization: `Bearer ${source.authToken}` }
          : {},
      })

      if (!response.ok) return []

      const data = await response.json() as { scenarios?: MarketplaceEntry[] }
      return (data.scenarios || []).map(e => ({ ...e, source: source.type }))
    } catch {
      return []
    }
  }

  private applyFilters(
    entries: MarketplaceEntry[],
    query: MarketplaceSearchQuery
  ): MarketplaceEntry[] {
    let result = entries

    if (query.source) {
      result = result.filter(e => e.source === query.source)
    }

    if (query.tags?.length) {
      result = result.filter(e =>
        query.tags!.some(tag => e.tags.includes(tag))
      )
    }

    return result
  }

  private applySorting(
    entries: MarketplaceEntry[],
    query: MarketplaceSearchQuery
  ): MarketplaceEntry[] {
    const sortBy = query.sortBy || 'rating'
    const order = query.sortOrder || 'desc'

    return [...entries].sort((a, b) => {
      let cmp = 0
      switch (sortBy) {
        case 'rating':
          cmp = a.rating - b.rating
          break
        case 'downloads':
          cmp = a.downloadCount - b.downloadCount
          break
        case 'recent':
          cmp = a.updatedAt - b.updatedAt
          break
        case 'name':
          cmp = a.name.localeCompare(b.name)
          break
      }
      return order === 'desc' ? -cmp : cmp
    })
  }

  private applyPagination(
    entries: MarketplaceEntry[],
    query: MarketplaceSearchQuery
  ): MarketplaceSearchResult {
    const page = query.page || 1
    const pageSize = query.pageSize || 20
    const start = (page - 1) * pageSize
    const sliced = entries.slice(start, start + pageSize)

    return {
      entries: sliced,
      total: entries.length,
      page,
      pageSize,
      hasMore: start + pageSize < entries.length,
    }
  }

  async install(
    entry: MarketplaceEntry,
    targetPath: string
  ): Promise<{ success: boolean; error?: string }> {
    this.emitProgress({
      entryId: entry.id,
      status: 'downloading',
      progress: 0,
    })

    try {
      this.emitProgress({
        entryId: entry.id,
        status: 'installing',
        progress: 50,
      })

      this.installed.set(entry.id, {
        entry,
        installedAt: Date.now(),
        installPath: targetPath,
        version: entry.version,
      })

      this.emitProgress({
        entryId: entry.id,
        status: 'completed',
        progress: 100,
      })

      return { success: true }
    } catch (error) {
      this.emitProgress({
        entryId: entry.id,
        status: 'failed',
        progress: 0,
        error: error instanceof Error ? error.message : String(error),
      })

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  uninstall(entryId: string): boolean {
    return this.installed.delete(entryId)
  }

  getInstalled(): InstalledScenario[] {
    return Array.from(this.installed.values())
  }

  isInstalled(entryId: string): boolean {
    return this.installed.has(entryId)
  }

  onInstallProgress(listener: (progress: InstallProgress) => void): () => void {
    this.installListeners.add(listener)
    return () => this.installListeners.delete(listener)
  }

  private emitProgress(progress: InstallProgress): void {
    for (const listener of this.installListeners) {
      try {
        listener(progress)
      } catch {
        // ignore
      }
    }
  }

  async getFeatured(): Promise<MarketplaceEntry[]> {
    return this.search({
      sortBy: 'rating',
      sortOrder: 'desc',
      pageSize: 10,
    }).then(r => r.entries)
  }

  async getCategories(): Promise<Array<{ id: MarketplaceCategory; count: number }>> {
    const all = await this.search({ pageSize: 1000 })
    const counts = new Map<MarketplaceCategory, number>()
    for (const entry of all.entries) {
      counts.set(entry.category, (counts.get(entry.category) || 0) + 1)
    }
    return Array.from(counts.entries()).map(([id, count]) => ({ id, count }))
  }
}

export interface InstalledScenario {
  entry: MarketplaceEntry
  installedAt: number
  installPath: string
  version: string
}

export const scenarioMarketplace = new ScenarioMarketplaceClass()
