/**
 * 场景市场 API
 *
 * 定义在线场景市场的接口和数据结构。
 * 渲染进程通过 backendApi 直接调用后端 marketplace 接口，
 * 主进程通过 IPC 负责文件下载、校验、解压。
 *
 * 架构：
 *   渲染进程 (backendApi) → 后端 API (marketplace/*) → 返回场景列表/详情/下载URL
 *   渲染进程 (IPC) → 主进程 (scenario:marketplaceInstall) → 下载+校验+解压
 */

export interface MarketplaceScenario {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  icon: string
  version: string
  author: string
  category: string
  tags: string[]
  downloads: number
  rating: number
  ratingCount: number
  size: string
  publishedAt: string
  updatedAt: string
  screenshotUrls: string[]
  downloadUrl: string
  checksum: string
  minAppVersion: string
  license: string
  homepage: string
  packageType?: string
  isFree?: boolean
  price?: number
  permissions?: string[]
}

export interface MarketplaceSearchResult {
  total: number
  page: number
  pageSize: number
  scenarios: MarketplaceScenario[]
}

export interface MarketplaceCategory {
  id: string
  name: string
  nameZh: string
  icon: string
  count: number
}

export interface MarketplaceInstallResult {
  installed: boolean
  downloadUrl: string
  version: string
  checksum: string
  signature?: string
  fileSize: number
  minAppVersion: string
  packageType: string
  changelog: string
  permissions?: string[]
}

export interface MarketplaceUpdateInfo {
  scenarioId: string
  scenarioName: string
  scenarioNameZh: string
  scenarioIcon: string
  currentVersion: string
  latestVersion: string
  changelog: string
  minAppVersion: string
  fileSize: number
}

export interface MarketplaceAPI {
  search(query: string, page?: number, pageSize?: number): Promise<MarketplaceSearchResult>
  getByCategory(category: string, page?: number, pageSize?: number): Promise<MarketplaceSearchResult>
  getFeatured(): Promise<MarketplaceScenario[]>
  getDetails(scenarioId: string): Promise<MarketplaceScenario | null>
  getCategories(): Promise<MarketplaceCategory[]>
  download(scenarioId: string): Promise<{ success: boolean; error?: string; path?: string }>
  install(scenarioId: string, targetVersion?: string): Promise<MarketplaceInstallResult>
  checkUpdates(scenarios: Array<{ id: string; version: string }>): Promise<MarketplaceUpdateInfo[]>
}

class MockMarketplaceAPI implements MarketplaceAPI {
  async search(_query: string, page = 1, pageSize = 20): Promise<MarketplaceSearchResult> {
    return {
      total: 0,
      page,
      pageSize,
      scenarios: [],
    }
  }

  async getByCategory(_category: string, page = 1, pageSize = 20): Promise<MarketplaceSearchResult> {
    return {
      total: 0,
      page,
      pageSize,
      scenarios: [],
    }
  }

  async getFeatured(): Promise<MarketplaceScenario[]> {
    return []
  }

  async getDetails(_scenarioId: string): Promise<MarketplaceScenario | null> {
    return null
  }

  async getCategories(): Promise<MarketplaceCategory[]> {
    return [
      { id: 'development', name: 'Development', nameZh: '开发', icon: 'Code2', count: 0 },
      { id: 'data', name: 'Data', nameZh: '数据', icon: 'BarChart3', count: 0 },
      { id: 'creative', name: 'Creative', nameZh: '创意', icon: 'PenTool', count: 0 },
      { id: 'productivity', name: 'Productivity', nameZh: '效率', icon: 'Zap', count: 0 },
      { id: 'education', name: 'Education', nameZh: '教育', icon: 'GraduationCap', count: 0 },
      { id: 'automation', name: 'Automation', nameZh: '自动化', icon: 'Cpu', count: 0 },
    ]
  }

  async download(_scenarioId: string): Promise<{ success: boolean; error?: string; path?: string }> {
    return {
      success: false,
      error: 'Marketplace is not yet available. Please install scenarios from local directory.',
    }
  }

  async install(_scenarioId: string, _targetVersion?: string): Promise<MarketplaceInstallResult> {
    throw new Error('Marketplace is not yet available')
  }

  async checkUpdates(_scenarios: Array<{ id: string; version: string }>): Promise<MarketplaceUpdateInfo[]> {
    return []
  }
}

export const marketplaceAPI: MarketplaceAPI = new MockMarketplaceAPI()
