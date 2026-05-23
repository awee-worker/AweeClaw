/**
 * 场景市场服务（渲染进程）
 *
 * 渲染进程通过 backendApi 直接调用后端 marketplace 接口，
 * 通过 IPC 调用主进程完成场景包下载、校验、解压。
 *
 * 调用链路：
 *   1. browse/search/detail → backendApi → 后端 /marketplace/*
 *   2. install → backendApi(/marketplace/install/:id) → 获取下载URL
 *      → IPC(scenario:marketplaceInstall) → 主进程下载+校验+解压
 *   3. checkUpdates → backendApi(/marketplace/check-updates) → 后端返回更新信息
 */

import { backendApi, isAuthenticated } from '@services/backendApi'
import { getAPI } from '@services/electronBridge'
import type {
  MarketplaceScenario,
  MarketplaceSearchResult,
  MarketplaceCategory,
  MarketplaceInstallResult,
  MarketplaceUpdateInfo,
} from '@scenario-system/marketplace'

export async function browseScenarios(params: {
  category?: string
  search?: string
  isFree?: boolean
  page?: number
  limit?: number
}): Promise<MarketplaceSearchResult> {
  if (!isAuthenticated()) {
    return { total: 0, page: 1, pageSize: 20, scenarios: [] }
  }

  const query = new URLSearchParams()
  if (params.category) query.set('category', params.category)
  if (params.search) query.set('search', params.search)
  if (params.isFree !== undefined) query.set('isFree', String(params.isFree))
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))

  const qs = query.toString()
  const path = `/api/v1/marketplace/browse${qs ? `?${qs}` : ''}`

  return backendApi.get<MarketplaceSearchResult>(path)
}

export async function getScenarioDetail(scenarioId: string): Promise<MarketplaceScenario | null> {
  if (!isAuthenticated()) return null

  try {
    return await backendApi.get<MarketplaceScenario>(`/api/v1/marketplace/detail/${scenarioId}`)
  } catch {
    return null
  }
}

export async function getFeaturedScenarios(): Promise<MarketplaceScenario[]> {
  if (!isAuthenticated()) return []

  try {
    return await backendApi.get<MarketplaceScenario[]>('/api/v1/marketplace/featured')
  } catch {
    return []
  }
}

export async function getMarketplaceCategories(): Promise<MarketplaceCategory[]> {
  if (!isAuthenticated()) {
    return [
      { id: 'development', name: 'Development', nameZh: '开发', icon: 'Code2', count: 0 },
      { id: 'data', name: 'Data', nameZh: '数据', icon: 'BarChart3', count: 0 },
      { id: 'creative', name: 'Creative', nameZh: '创意', icon: 'PenTool', count: 0 },
      { id: 'productivity', name: 'Productivity', nameZh: '效率', icon: 'Zap', count: 0 },
      { id: 'education', name: 'Education', nameZh: '教育', icon: 'GraduationCap', count: 0 },
      { id: 'automation', name: 'Automation', nameZh: '自动化', icon: 'Cpu', count: 0 },
    ]
  }

  try {
    return await backendApi.get<MarketplaceCategory[]>('/api/v1/marketplace/categories')
  } catch {
    return []
  }
}

export async function installScenarioFromMarketplace(
  scenarioId: string,
  targetVersion?: string,
): Promise<{
  success: boolean
  scenarioId?: string
  version?: string
  targetDir?: string
  packageType?: string
  config?: Record<string, unknown>
  error?: string
  requiresPayment?: boolean
  price?: number
}> {
  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated. Please log in first.' }
  }

  try {
    const versionParam = targetVersion ? `?version=${targetVersion}` : ''
    const installResult = await backendApi.post<MarketplaceInstallResult>(
      `/api/v1/marketplace/install/${scenarioId}${versionParam}`,
    )

    if (installResult.requiresPayment && !installResult.installed) {
      return {
        success: false,
        requiresPayment: true,
        price: installResult.price,
        error: `This scenario requires payment. Price: ¥${installResult.price}`,
      }
    }

    if (!installResult.downloadUrl) {
      return { success: false, error: 'No download URL returned from server' }
    }

    const api = getAPI()
    const ipcResult = await api.scenarioMarketplace.install({
      scenarioId,
      downloadUrl: installResult.downloadUrl,
      checksum: installResult.checksum,
      signature: installResult.signature,
      version: installResult.version,
      fileSize: installResult.fileSize,
      packageType: installResult.packageType,
    })

    console.log('[marketplaceService] IPC install result:', JSON.stringify(ipcResult))
    return ipcResult
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function checkScenarioUpdates(
  scenarios: Array<{ id: string; version: string }>,
): Promise<MarketplaceUpdateInfo[]> {
  if (!isAuthenticated() || scenarios.length === 0) return []

  try {
    return await backendApi.post<MarketplaceUpdateInfo[]>(
      '/api/v1/marketplace/check-updates',
      { scenarios },
    )
  } catch {
    return []
  }
}

export async function getInstalledScenarios(): Promise<unknown[]> {
  if (!isAuthenticated()) return []

  try {
    return await backendApi.get<unknown[]>('/api/v1/marketplace/installed')
  } catch {
    return []
  }
}

export async function uninstallScenarioFromMarketplace(scenarioId: string): Promise<{
  success: boolean
  error?: string
}> {
  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated. Please log in first.' }
  }

  try {
    await backendApi.post(`/api/v1/marketplace/uninstall/${scenarioId}`)
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function updateScenarioFromMarketplace(
  scenarioId: string,
  targetVersion: string,
): Promise<{
  success: boolean
  scenarioId?: string
  version?: string
  targetDir?: string
  packageType?: string
  config?: Record<string, unknown>
  error?: string
  requiresPayment?: boolean
  price?: number
}> {
  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated. Please log in first.' }
  }

  try {
    const versionParam = targetVersion ? `?version=${targetVersion}` : ''
    const installResult = await backendApi.post<MarketplaceInstallResult>(
      `/api/v1/marketplace/install/${scenarioId}${versionParam}`,
    )

    if (installResult.requiresPayment && !installResult.installed) {
      return {
        success: false,
        requiresPayment: true,
        price: installResult.price,
        error: `This scenario requires payment. Price: ¥${installResult.price}`,
      }
    }

    if (!installResult.downloadUrl) {
      return { success: false, error: 'No download URL returned from server' }
    }

    const api = getAPI()
    const ipcResult = await api.scenarioMarketplace.update({
      scenarioId,
      downloadUrl: installResult.downloadUrl,
      checksum: installResult.checksum,
      signature: installResult.signature,
      version: installResult.version,
      fileSize: installResult.fileSize,
      packageType: installResult.packageType,
    })

    return ipcResult
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}
