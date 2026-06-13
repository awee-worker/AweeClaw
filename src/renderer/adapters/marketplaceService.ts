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
 *   3. 付费场景 → backendApi(/payment/scenario-order) → 创建支付订单
 *      → 支付完成后重新调用 install 接口
 *   4. checkUpdates → IPC(scenario:marketplaceCheckUpdates) → 主进程调用后端API
 */

import { backendApi, isAuthenticated, getServerUrl } from '@services/backendApi'
import { logger } from '@shared/toolkit/LogEngine'
import { getAPI } from '@services/electronBridge'
import type {
  MarketplaceScenario,
  MarketplaceSearchResult,
  MarketplaceCategory,
  MarketplaceInstallResult,
  MarketplaceUpdateInfo,
} from '@scenario-system/marketplace'

/** 场景支付订单创建结果 */
export interface ScenarioOrderResult {
  success: boolean
  orderNo?: string
  paymentUrl?: string
  qrCodeUrl?: string
  mockMode?: boolean
  error?: string
}

/** 场景安装结果（含支付流程） */
export interface ScenarioInstallResult {
  success: boolean
  scenarioId?: string
  version?: string
  targetDir?: string
  packageType?: string
  config?: Record<string, unknown>
  error?: string
  requiresPayment?: boolean
  price?: number
  orderNo?: string
  paymentUrl?: string
  qrCodeUrl?: string
  mockMode?: boolean
}

/** 场景依赖检查结果 */
export interface DependencyCheckResult {
  canInstall: boolean
  missingDependencies: Array<{
    id: string
    versionRange?: string
    required: boolean
    available: boolean
  }>
  installedDependencies: string[]
  totalDependencies: number
}

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

/** 检查场景依赖是否满足 */
export async function checkScenarioDependencies(scenarioId: string): Promise<DependencyCheckResult> {
  if (!isAuthenticated()) {
    return { canInstall: false, missingDependencies: [], installedDependencies: [], totalDependencies: 0 }
  }

  try {
    return await backendApi.get<DependencyCheckResult>(`/api/v1/marketplace/dependencies/${scenarioId}`)
  } catch {
    return { canInstall: true, missingDependencies: [], installedDependencies: [], totalDependencies: 0 }
  }
}

export async function installScenarioFromMarketplace(
  scenarioId: string,
  targetVersion?: string,
): Promise<ScenarioInstallResult> {
  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated. Please log in first.' }
  }

  try {
    const versionParam = targetVersion ? `?version=${targetVersion}` : ''
    const installResult = await backendApi.post<MarketplaceInstallResult>(
      `/api/v1/marketplace/install/${scenarioId}${versionParam}`,
    )

    // 付费场景：返回支付信息，由 UI 层引导用户完成支付
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

    logger.channel.debug('[marketplaceService] IPC install result:', JSON.stringify(ipcResult))
    return ipcResult
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 创建场景购买支付订单 */
export async function createScenarioOrder(
  scenarioId: string,
  channel: string = 'ALIPAY',
): Promise<ScenarioOrderResult> {
  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated. Please log in first.' }
  }

  try {
    const result = await backendApi.post<{
      order: { orderNo: string; amount: number }
      payment: { paymentUrl?: string; qrCodeUrl?: string; mockMode?: boolean }
    }>('/api/v1/payment/scenario-order', { scenarioId, channel })

    return {
      success: true,
      orderNo: result.order.orderNo,
      paymentUrl: result.payment.paymentUrl,
      qrCodeUrl: result.payment.qrCodeUrl,
      mockMode: result.payment.mockMode,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 模拟支付（仅 Mock 模式可用） */
export async function mockPayScenarioOrder(orderNo: string): Promise<{
  success: boolean
  error?: string
}> {
  try {
    await backendApi.post(`/api/v1/payment/scenario-mock-pay/${orderNo}`)
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 查询订单支付状态 */
export async function checkOrderStatus(orderNo: string): Promise<{
  status: string
  paidAt?: string
}> {
  try {
    const result = await backendApi.get<{
      status: string
      paidAt?: string
    }>(`/api/v1/payment/order/${orderNo}`)
    return result
  } catch {
    return { status: 'UNKNOWN' }
  }
}

/** 付费场景完整安装流程：创建订单 → 支付 → 轮询支付结果 → 安装 */
export async function purchaseAndInstallScenario(
  scenarioId: string,
  channel: string = 'ALIPAY',
  targetVersion?: string,
  onPaymentCreated?: (result: ScenarioOrderResult) => void,
  onPaymentPolling?: (orderNo: string) => void,
): Promise<ScenarioInstallResult> {
  // 1. 创建支付订单
  const orderResult = await createScenarioOrder(scenarioId, channel)
  if (!orderResult.success) {
    return {
      success: false,
      error: orderResult.error || 'Failed to create order',
    }
  }

  onPaymentCreated?.(orderResult)

  // 2. Mock 模式：直接模拟支付
  if (orderResult.mockMode && orderResult.orderNo) {
    const mockResult = await mockPayScenarioOrder(orderResult.orderNo)
    if (!mockResult.success) {
      return { success: false, error: mockResult.error || 'Mock payment failed' }
    }
  } else {
    // 3. 正式模式：轮询订单状态，等待用户完成支付
    if (!orderResult.orderNo) {
      return { success: false, error: 'No order number returned' }
    }

    const paid = await pollOrderStatus(orderResult.orderNo, onPaymentPolling)
    if (!paid) {
      return {
        success: false,
        error: 'Payment timeout or cancelled',
        orderNo: orderResult.orderNo,
      }
    }
  }

  // 4. 支付成功，重新调用安装接口
  return installScenarioFromMarketplace(scenarioId, targetVersion)
}

/** 轮询订单支付状态（最多等待 5 分钟） */
async function pollOrderStatus(
  orderNo: string,
  onPolling?: (orderNo: string) => void,
  maxWaitMs = 5 * 60 * 1000,
  intervalMs = 3000,
): Promise<boolean> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWaitMs) {
    onPolling?.(orderNo)
    const result = await checkOrderStatus(orderNo)

    if (result.status === 'PAID') {
      return true
    }
    if (result.status === 'CANCELLED' || result.status === 'EXPIRED') {
      return false
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  return false
}

export async function checkScenarioUpdates(
  scenarios: Array<{ id: string; version: string }>,
): Promise<MarketplaceUpdateInfo[]> {
  if (!isAuthenticated() || scenarios.length === 0) return []

  try {
    const api = getAPI()
    const serverUrl = getServerUrl()
    const results = await api.scenarioMarketplace.checkUpdates(scenarios, serverUrl)
    // 过滤掉不需要更新的，映射为 MarketplaceUpdateInfo
    return results
      .filter(r => r.needsUpdate)
      .map(r => ({
        scenarioId: r.scenarioId,
        scenarioName: (r as any).scenarioName,
        scenarioNameZh: (r as any).scenarioNameZh,
        scenarioIcon: (r as any).scenarioIcon,
        currentVersion: r.currentVersion,
        latestVersion: r.latestVersion || '',
        changelog: (r as any).changelog,
        minAppVersion: (r as any).minAppVersion,
        fileSize: (r as any).fileSize,
      }))
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
): Promise<ScenarioInstallResult> {
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
