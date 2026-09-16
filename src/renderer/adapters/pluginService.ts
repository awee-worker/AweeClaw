/**
 * 插件服务（渲染进程）
 *
 * 调用链路：
 *   1. browse/search/detail → backendApi → 后端 /plugins/* 接口
 *   2. install → backendApi(/plugins/:id/install) → 获取下载信息
 *      → IPC(plugin:install) → 主进程下载+校验+解压+注册+MCP 连接
 *   3. 付费插件 → backendApi(/payment/plugin-order) → 创建支付订单
 *      → 支付完成后重新调用 install
 *
 * 设计原则：
 * - 市场浏览（网络请求）走 backendApi，避免主进程承担网络转发
 * - 本地文件操作（安装/卸载）走 IPC
 * - 进度事件通过 IPC 订阅
 */

import { backendApi, isAuthenticated, getServerUrl, getAccessToken } from '@services/backendApi'
import { getAPI } from '@services/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'

// ─── 类型定义 ───────────────────────────────────────────

/** 插件市场条目（列表/详情） */
export interface PluginMarketItem {
  id: string
  pluginKey: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  type: string
  icon: string | null
  category: string
  tags: string[]
  developerId: string | null
  source: string
  isFree: boolean
  price: number
  latestVersion: string | null
  totalDownloads: number
  rating: number
  ratingCount: number
  reviewStatus: string
  featured: boolean
  minAppVersion: string | null
  platforms: string[]
  screenshotUrls: string[]
  homepage: string | null
  repository: string | null
  license: string
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/** 插件版本详情 */
export interface PluginVersionDetail {
  id: string
  pluginId: string
  version: string
  changelog: string | null
  packageUrl: string
  packageSize: number
  checksum: string
  manifest: Record<string, unknown>
  reviewStatus: string
  isLatest: boolean
  createdAt: string
}

/** 插件下载信息（后端返回） */
export interface PluginDownloadInfo {
  downloadUrl: string
  checksum: string
  packageSize: number
  version: string
  manifest?: Record<string, unknown>
  requiresPayment?: boolean
  price?: number
  /** 权益已到期（需续费而非首次购买） */
  expired?: boolean
  /** 是否为配置型插件（无包文件） */
  configOnly?: boolean
}

/** 已安装插件记录 */

export interface InstalledPlugin {
  pluginId: string
  pluginKey: string
  version: string
  installedAt: string
  enabled: boolean
  types: string[]
  manifest: Record<string, unknown>
  mcpServerId?: string
}

/** 插件安装进度 */
export interface PluginInstallProgress {
  pluginId: string
  phase: 'pending' | 'downloading' | 'verifying' | 'extracting' | 'registering' | 'mcp_connecting' | 'done' | 'error'
  bytesDownloaded: number
  bytesTotal: number
  percent: number
  message?: string
}

/** 插件安装结果 */
export interface PluginInstallResult {
  success: boolean
  pluginId?: string
  pluginKey?: string
  version?: string
  pluginDir?: string
  manifest?: Record<string, unknown>
  mcpServerId?: string
  error?: string
  /** MCP 服务连接错误（安装成功但 MCP 连接失败时填充） */
  mcpConnectError?: string
  requiresPayment?: boolean
  price?: number
  /** 权益已到期（需续费而非首次购买） */
  expired?: boolean
  orderNo?: string
  paymentUrl?: string
  qrCodeUrl?: string
}

/** 插件购买订单创建结果 */
export interface PluginOrderResult {
  success: boolean
  orderNo?: string
  paymentUrl?: string
  qrCodeUrl?: string
  mockMode?: boolean
  error?: string
}

/** 插件市场分类 */
export interface PluginCategory {
  id: string
  name: string
  nameZh: string
  /** 客户端兜底分类携带的图标名（后端不返回该字段，渲染时由 PluginCategoryFilter 的 CATEGORY_ICONS 映射） */
  icon?: string
  count: number
}

/** 插件市场搜索结果 */
export interface PluginSearchResult {
  total: number
  page: number
  pageSize: number
  items: PluginMarketItem[]
}

// ─── 市场浏览 API（直连后端） ──────────────────────────

/**
 * 浏览插件市场
 *
 * @param params 筛选条件
 */
export async function browsePlugins(params: {
  category?: string
  search?: string
  type?: string
  isFree?: boolean
  featured?: boolean
  page?: number
  limit?: number
}): Promise<PluginSearchResult> {
  if (!isAuthenticated()) {
    return { total: 0, page: 1, pageSize: 20, items: [] }
  }

  const query = new URLSearchParams()
  if (params.category) query.set('category', params.category)
  if (params.search) query.set('search', params.search)
  if (params.type) query.set('type', params.type)
  if (params.isFree !== undefined) query.set('isFree', String(params.isFree))
  if (params.featured !== undefined) query.set('featured', String(params.featured))
  if (params.page) query.set('page', String(params.page))
  if (params.limit) query.set('limit', String(params.limit))

  const qs = query.toString()
  const path = `/api/v1/plugins/browse${qs ? `?${qs}` : ''}`

  return backendApi.get<PluginSearchResult>(path)
}

/** 获取插件详情 */
export async function getPluginDetail(pluginId: string): Promise<PluginMarketItem | null> {
  if (!isAuthenticated()) return null

  try {
    return await backendApi.get<PluginMarketItem>(`/api/v1/plugins/detail/${pluginId}`)
  } catch (err) {
    logger.ipc.warn('[pluginService] Get detail failed:', err)
    return null
  }
}

/** 获取精选插件 */
export async function getFeaturedPlugins(): Promise<PluginMarketItem[]> {
  if (!isAuthenticated()) return []

  try {
    return await backendApi.get<PluginMarketItem[]>('/api/v1/plugins/featured')
  } catch {
    return []
  }
}

/** 获取热门插件（按下载量排序，取 10 条） */
export async function getPopularPlugins(): Promise<PluginMarketItem[]> {
  if (!isAuthenticated()) return []

  try {
    return await backendApi.get<PluginMarketItem[]>('/api/v1/plugins/popular')
  } catch {
    return []
  }
}

/**
 * 兜底分类定义（与后端 PLUGIN_CATEGORIES 保持一致）。
 *
 * 用于未登录 / 后端不可达 / 接口返回空 等场景，确保分类筛选始终完整。
 * 新增分类时需同步更新后端 plugin.service.ts 的 PLUGIN_CATEGORIES。
 */
const FALLBACK_CATEGORIES: PluginCategory[] = [
  { id: 'productivity', name: 'Productivity', nameZh: '效率', icon: 'Zap', count: 0 },
  { id: 'development', name: 'Development', nameZh: '开发', icon: 'Code2', count: 0 },
  { id: 'automation', name: 'Automation', nameZh: '自动化与集成', icon: 'Cpu', count: 0 },
  { id: 'database', name: 'Database', nameZh: '数据库', icon: 'BarChart3', count: 0 },
  { id: 'design', name: 'Design', nameZh: '设计', icon: 'PenTool', count: 0 },
  { id: 'office', name: 'Office', nameZh: '办公', icon: 'FileText', count: 0 },
  { id: 'ai', name: 'AI', nameZh: 'AI 与搜索', icon: 'Sparkles', count: 0 },
  { id: 'utility', name: 'Utility', nameZh: '实用工具', icon: 'Wrench', count: 0 },
]

/**
 * 获取插件市场分类
 *
 * 数据来源优先级：
 *   1. 已登录 → 调用后端 GET /api/v1/plugins/categories（返回所有大类，含 count=0）
 *   2. 未登录 / 接口异常 → 返回与后端 PLUGIN_CATEGORIES 一致的兜底分类（8 大类）
 *
 * 兜底分类必须与后端 plugin.service.ts 中的 PLUGIN_CATEGORIES 保持同步，
 * 确保未登录或离线场景下分类筛选列表仍然完整且一致。
 */
export async function getPluginCategories(): Promise<PluginCategory[]> {
  if (!isAuthenticated()) {
    return FALLBACK_CATEGORIES
  }

  try {
    const result = await backendApi.get<PluginCategory[]>('/api/v1/plugins/categories')
    // 后端返回空数组时（极端异常），回退到本地兜底分类，避免分类筛选条空白
    return result && result.length > 0 ? result : FALLBACK_CATEGORIES
  } catch {
    return FALLBACK_CATEGORIES
  }
}

/** 获取插件版本列表 */
export async function getPluginVersions(pluginId: string): Promise<PluginVersionDetail[]> {
  if (!isAuthenticated()) return []

  try {
    return await backendApi.get<PluginVersionDetail[]>(`/api/v1/plugins/versions/${pluginId}`)
  } catch {
    return []
  }
}

// ─── 安装 / 卸载（IPC） ────────────────────────────────

/**
 * 预取插件 manifest（含 configSchema）。
 *
 * 用于安装前展示配置表单：用户点击"安装"时，先调用此函数获取 manifest，
 * 检查 configSchema.fields 中是否有 required 字段。若有，则弹出配置对话框。
 *
 * 此函数仅触发 /download 接口（不递增下载量，不创建购买记录），
 * 真正的安装上报在 installPluginFromMarketplace 中完成。
 *
 * @param pluginId 插件 ID
 * @param version 目标版本（可选，默认最新）
 * @returns manifest 对象（含 configSchema）；失败返回 null
 */
export async function fetchPluginManifest(
  pluginId: string,
  version?: string,
): Promise<Record<string, unknown> | null> {
  if (!isAuthenticated()) return null
  try {
    // 优先使用传入版本；未传则先查询最新版本
    let resolvedVersion = version
    if (!resolvedVersion) {
      const detail = await getPluginDetail(pluginId)
      resolvedVersion = detail?.latestVersion || undefined
    }
    if (!resolvedVersion) return null

    const info = await backendApi.get<PluginDownloadInfo>(
      `/api/v1/plugins/download/${pluginId}/${encodeURIComponent(resolvedVersion)}`,
    )
    return info.manifest || null
  } catch (err) {
    logger.ipc.warn(`[pluginService] fetchPluginManifest failed: ${err}`)
    return null
  }
}

/**
 * 从市场安装插件
 *
 * 流程：
 * 1. 调用后端 /plugins/install/:id 上报安装（递增下载量、创建购买记录）
 * 2. 调用后端 /plugins/download/:id/:version 获取完整下载信息
 * 3. 调用 IPC(plugin:install) 触发主进程安装（传递预取数据，避免主进程网络请求失败）
 *
 * @param pluginId 插件 ID
 * @param version 目标版本（可选，默认最新）
 * @param marketItem 市场列表项（可选，用于预取插件详情避免主进程请求后端）
 * @param userConfig 用户填写的插件配置值（覆盖 defaultValue，用于 {{config.KEY}} 模板替换）
 */
export async function installPluginFromMarketplace(
  pluginId: string,
  version?: string,
  marketItem?: PluginMarketItem,
  userConfig?: Record<string, string>,
): Promise<PluginInstallResult> {
  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated. Please log in first.' }
  }

  try {
    // 1. 上报安装（递增下载量、创建免费购买记录）
    const versionParam = version ? `?version=${encodeURIComponent(version)}` : ''
    const installResult = await backendApi.post<PluginDownloadInfo>(
      `/api/v1/plugins/install/${pluginId}${versionParam}`,
      {},
    )

    // 2. 付费插件未购买（或权益已到期需续费）
    if (installResult.requiresPayment && !installResult.downloadUrl) {
      return {
        success: false,
        requiresPayment: true,
        price: installResult.price,
        expired: !!installResult.expired,
        error: `This plugin requires payment. Price: ¥${installResult.price}`,
      }
    }

    // 3. 获取完整下载信息（含 checksum、packageSize、configOnly、manifest）
    const resolvedVersion = installResult.version || version || ''
    if (!resolvedVersion) {
      return { success: false, error: 'Version not resolved' }
    }

    const downloadInfo = await backendApi.get<PluginDownloadInfo>(
      `/api/v1/plugins/download/${pluginId}/${encodeURIComponent(resolvedVersion)}`,
    )

    // 配置型插件允许 downloadUrl 为空
    if (!downloadInfo.configOnly && !downloadInfo.downloadUrl) {
      return { success: false, error: 'No download URL returned from server' }
    }

    // 4. 调用主进程 IPC 完成本地安装（传递预取数据避免主进程网络请求）
    const api = getAPI()
    const backendUrl = getServerUrl()
    const authToken = getAccessToken() || undefined

    // 从市场列表项构建插件详情（主进程需要 pluginKey 等字段）
    const preloadedPluginDetail = marketItem
      ? {
          pluginId: marketItem.id,
          pluginKey: marketItem.pluginKey,
          name: marketItem.name,
          nameZh: marketItem.nameZh,
          description: marketItem.description,
          descriptionZh: marketItem.descriptionZh,
          type: marketItem.type,
          icon: marketItem.icon || undefined,
          category: marketItem.category,
          tags: marketItem.tags,
          developerId: marketItem.developerId || undefined,
          source: marketItem.source,
          isFree: marketItem.isFree,
          price: marketItem.price,
          latestVersion: marketItem.latestVersion || undefined,
          totalDownloads: marketItem.totalDownloads,
          rating: marketItem.rating,
          ratingCount: marketItem.ratingCount,
          featured: marketItem.featured,
          minAppVersion: marketItem.minAppVersion || undefined,
          platforms: marketItem.platforms,
          screenshotUrls: marketItem.screenshotUrls,
          homepage: marketItem.homepage || undefined,
          repository: marketItem.repository || undefined,
          license: marketItem.license,
          enabled: marketItem.enabled,
        }
      : undefined

    const ipcResult = await api.plugin.install({
      pluginId,
      version: resolvedVersion,
      backendUrl,
      authToken,
      preloadedDownloadInfo: {
        downloadUrl: downloadInfo.downloadUrl,
        checksum: downloadInfo.checksum,
        packageSize: downloadInfo.packageSize,
        manifest: downloadInfo.manifest as Record<string, unknown> | undefined,
        configOnly: downloadInfo.configOnly,
      },
      preloadedPluginDetail,
      userConfig,
    })

    logger.ipc.debug('[pluginService] IPC install result:', JSON.stringify(ipcResult))

    // 安装成功后刷新插件 UI 扩展点注册表，使新插件贡献的导航项/顶部按钮立即可用
    // 失败不阻塞返回值（已安装成功），仅记录日志
    if (ipcResult.success) {
      void refreshPluginUiRegistry().catch((e) =>
        logger.ipc.warn(`[pluginService] refreshPluginUiRegistry after install failed: ${e}`),
      )
    }

    return {
      ...ipcResult,
      manifest: ipcResult.manifest as Record<string, unknown> | undefined,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 刷新插件 UI 扩展点注册表
 *
 * 动态 import 避免循环依赖（PluginUiRegistry 可能间接依赖 pluginService）。
 * 在插件安装/卸载/更新/启用/禁用成功后调用，使 UI 扩展点（导航项、顶部按钮）
 * 即时反映变更，无需重启应用。
 */
async function refreshPluginUiRegistry(): Promise<void> {
  const { pluginUiRegistry } = await import('@renderer/plugins/PluginUiRegistry')
  await pluginUiRegistry.refresh()
}

/**
 * 升级插件到指定版本（复用安装流程）
 *
 * 设计要点：
 * - 不传 marketItem：让主进程自行 fetchPluginDetail 获取最新详情
 * - 不传 userConfig：主进程 resolveConfigDefaults 会自动用已保存的 pluginConfigs
 *   作为兜底，实现升级时保留用户原有配置（API Key 等不丢失）
 * - 升级流程会自动卸载旧版本运行时、重连 MCP 服务
 *
 * @param pluginId  插件 ID（后端主键，非 pluginKey）
 * @param version   目标版本号
 * @returns 安装/升级结果
 */
export async function updatePlugin(
  pluginId: string,
  version: string,
): Promise<PluginInstallResult> {
  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated. Please log in first.' }
  }

  try {
    const api = getAPI()
    const backendUrl = getServerUrl()
    const authToken = getAccessToken() || undefined

    // 获取下载信息（含 manifest、configOnly 标记）
    const downloadInfo = await backendApi.get<PluginDownloadInfo>(
      `/api/v1/plugins/download/${pluginId}/${encodeURIComponent(version)}`,
    )

    // 上报安装（递增下载量、创建/更新免费购买记录）
    await backendApi.post(`/api/v1/plugins/install/${pluginId}?version=${encodeURIComponent(version)}`, {})

    // 调用主进程 IPC 完成本地升级（不传 userConfig，主进程自动保留旧配置）
    const ipcResult = await api.plugin.install({
      pluginId,
      version,
      backendUrl,
      authToken,
      preloadedDownloadInfo: {
        downloadUrl: downloadInfo.downloadUrl,
        checksum: downloadInfo.checksum,
        packageSize: downloadInfo.packageSize,
        manifest: downloadInfo.manifest as Record<string, unknown> | undefined,
        configOnly: downloadInfo.configOnly,
      },
      // preloadedPluginDetail 不传：主进程会自行 fetchPluginDetail
      // userConfig 不传：主进程 resolveConfigDefaults 自动复用已保存配置
    })

    logger.ipc.info(`[pluginService] Update result: ${ipcResult.success ? 'ok' : 'fail'} (${pluginId} → v${version})`)

    // 更新成功后刷新插件 UI 扩展点注册表（版本变化会触发 reloadPlugin 清理旧组件并重新注册）
    if (ipcResult.success) {
      void refreshPluginUiRegistry().catch((e) =>
        logger.ipc.warn(`[pluginService] refreshPluginUiRegistry after update failed: ${e}`),
      )
    }

    return {
      ...ipcResult,
      manifest: ipcResult.manifest as Record<string, unknown> | undefined,
    }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 卸载插件 */
export async function uninstallPlugin(pluginKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const api = getAPI()
    const result = await api.plugin.uninstall(pluginKey)

    // 卸载成功后刷新插件 UI 扩展点注册表，使导航项/顶部按钮立即消失
    if (result.success) {
      void refreshPluginUiRegistry().catch((e) =>
        logger.ipc.warn(`[pluginService] refreshPluginUiRegistry after uninstall failed: ${e}`),
      )
    }
    return result
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 启用插件 */
export async function enablePlugin(pluginKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const api = getAPI()
    const result = await api.plugin.enable(pluginKey)

    // 启用后刷新插件 UI 扩展点注册表，使该插件贡献的导航项/顶部按钮重新出现
    if (result.success) {
      void refreshPluginUiRegistry().catch((e) =>
        logger.ipc.warn(`[pluginService] refreshPluginUiRegistry after enable failed: ${e}`),
      )
    }
    return result
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 禁用插件 */
export async function disablePlugin(pluginKey: string): Promise<{ success: boolean; error?: string }> {
  try {
    const api = getAPI()
    const result = await api.plugin.disable(pluginKey)

    // 禁用后刷新插件 UI 扩展点注册表，使该插件贡献的导航项/顶部按钮立即消失
    if (result.success) {
      void refreshPluginUiRegistry().catch((e) =>
        logger.ipc.warn(`[pluginService] refreshPluginUiRegistry after disable failed: ${e}`),
      )
    }
    return result
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─── 已安装查询（IPC） ─────────────────────────────────

/** 获取已安装插件列表 */
export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  try {
    const api = getAPI()
    const records = await api.plugin.getInstalled()
    return records.map((r) => {
      // 兼容主进程返回：优先取 types 数组，缺失时回退到 manifest.type / 单 type 字段
      const manifest = (r.manifest as Record<string, unknown>) || {}
      const manifestType = manifest.type
      const types: string[] = Array.isArray(r.types)
        ? r.types
        : Array.isArray(manifestType)
          ? manifestType as string[]
          : [typeof manifestType === 'string' ? manifestType : 'tool']
      return {
        pluginId: r.pluginId,
        pluginKey: r.pluginKey,
        version: r.version,
        installedAt: r.installedAt,
        enabled: r.enabled,
        types,
        manifest,
        mcpServerId: r.mcpServerId,
      }
    })
  } catch (err) {
    logger.ipc.error('[pluginService] Get installed failed:', err)
    return []
  }
}

/** 检查是否已安装 */
export async function isPluginInstalled(pluginKey: string): Promise<boolean> {
  try {
    const api = getAPI()
    return await api.plugin.isInstalled(pluginKey)
  } catch {
    return false
  }
}

/** 检查插件更新 */
export async function checkPluginUpdate(
  pluginKey: string,
): Promise<{ hasUpdate: boolean; currentVersion?: string; latestVersion?: string }> {
  if (!isAuthenticated()) {
    return { hasUpdate: false }
  }

  try {
    const api = getAPI()
    const backendUrl = getServerUrl()
    const authToken = getAccessToken() || undefined
    return await api.plugin.checkUpdate(pluginKey, backendUrl, authToken)
  } catch (err) {
    logger.ipc.warn('[pluginService] Check update failed:', err)
    return { hasUpdate: false }
  }
}

// ─── 事件订阅 ─────────────────────────────────────────

/** 订阅插件安装进度 */
export function onPluginInstallProgress(
  callback: (progress: PluginInstallProgress) => void,
): () => void {
  const api = getAPI()
  return api.plugin.onInstallProgress(callback)
}

// ─── 支付（付费插件） ─────────────────────────────────

/**
 * 创建插件购买 / 续费订单
 *
 * @param intent purchase=首次购买（已有有效权益时后端会拒绝，避免重复付款）
 *               renew=续费（有效期未满时从原到期时间顺延）
 */
export async function createPluginOrder(
  pluginId: string,
  channel: string = 'WECHAT',
  intent: 'purchase' | 'renew' = 'purchase',
): Promise<PluginOrderResult> {
  if (!isAuthenticated()) {
    return { success: false, error: 'Not authenticated. Please log in first.' }
  }

  try {
    const result = await backendApi.post<{
      order: { orderNo: string; amount: number }
      payment: { paymentUrl?: string; qrCodeUrl?: string; mockMode?: boolean }
    }>('/api/v1/payment/plugin-order', { pluginId, channel, intent })

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

/** 模拟支付（仅测试环境可用，需后端开启 MOCK 模式） */
export async function mockPayPluginOrder(
  orderNo: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await backendApi.post(`/api/v1/payment/plugin-mock-pay/${orderNo}`, {})
    return { success: true }
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/** 轮询查询订单支付状态（通过插件购买列表间接判断） */
export async function refreshPurchasedPlugins(): Promise<void> {
  // 触发后端 PluginPurchase 列表刷新，客户端可通过 getInstalledPlugins 重新拉取
  await getInstalledPlugins().catch(() => {})
}

// ─── 插件用户配置（{{config.KEY}} 模板变量） ──

/**
 * 读取插件用户配置。
 * @returns 该插件的所有用户配置键值对（可能为空对象）
 */
export async function getPluginConfig(pluginKey: string): Promise<Record<string, string>> {
  try {
    const api = getAPI()
    return await api.plugin.getConfig(pluginKey)
  } catch (err) {
    logger.ipc.warn(`[pluginService] getPluginConfig failed for ${pluginKey}: ${err}`)
    return {}
  }
}

/**
 * 保存插件用户配置并触发 MCP 重连（若该插件是 MCP 型且已注册）。
 * @param pluginKey 插件 key
 * @param values 配置键值对（会整体覆盖该插件的原有配置）
 * @returns 保存结果（含是否触发了 MCP 重连）
 */
export async function savePluginConfig(
  pluginKey: string,
  values: Record<string, string>,
): Promise<{ success: boolean; reconnected: boolean; error?: string }> {
  try {
    const api = getAPI()
    return await api.plugin.saveConfig(pluginKey, values)
  } catch (err) {
    return {
      success: false,
      reconnected: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

