/**
 * 场景市场 API
 *
 * 定义在线场景市场的接口和数据结构。
 * 当前为接口定义，实际市场后端待接入。
 *
 * 功能：
 * - 浏览市场场景列表
 * - 搜索场景
 * - 获取场景详情
 * - 下载并安装场景
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

export interface MarketplaceAPI {
  search(query: string, page?: number, pageSize?: number): Promise<MarketplaceSearchResult>
  getByCategory(category: string, page?: number, pageSize?: number): Promise<MarketplaceSearchResult>
  getFeatured(): Promise<MarketplaceScenario[]>
  getDetails(scenarioId: string): Promise<MarketplaceScenario | null>
  getCategories(): Promise<MarketplaceCategory[]>
  download(scenarioId: string): Promise<{ success: boolean; error?: string; path?: string }>
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

  async getByCategory(category: string, page = 1, pageSize = 20): Promise<MarketplaceSearchResult> {
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

  async getDetails(scenarioId: string): Promise<MarketplaceScenario | null> {
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

  async download(scenarioId: string): Promise<{ success: boolean; error?: string; path?: string }> {
    return {
      success: false,
      error: 'Marketplace is not yet available. Please install scenarios from local directory.',
    }
  }
}

export const marketplaceAPI: MarketplaceAPI = new MockMarketplaceAPI()
