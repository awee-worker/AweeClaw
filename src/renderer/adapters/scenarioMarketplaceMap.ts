/**
 * 场景市场与本地已安装场景的对应关系
 *
 * 市场条目的 ID（后端场景包 ID、安装目录名）与注册进 scenarioRegistry 的场景 ID
 * （场景包里 config.id）并不总是同一个值：场景包可以声明与市场条目不同的 id。
 * 直接拿市场 ID 去查 registry，结果一定是「未安装」——市场页的卡片与详情页因此
 * 一直停在「安装场景」，更新检查也会因为拿错 ID 查不到新版本。
 *
 * 本模块维护 marketId → 本地场景 ID 的映射（localStorage），并在映射缺失时按名称
 * 兜底匹配（覆盖升级前就已安装、没有写入映射的老数据），同时提供基于正确 ID 的
 * 更新检查与更新执行能力，供场景市场页面和应用启动时的自动检查复用。
 */

import { scenarioRegistry } from '@configuration/scenarios'
import { logger } from '@toolkit/LogEngine'
import type { ScenarioPlugin } from '@protocols/scenario'
import {
  checkScenarioUpdates,
  getScenarioDetail,
  updateScenarioFromMarketplace,
} from './marketplaceService'

const MARKET_MAP_STORAGE_KEY = 'aweeclaw:scenario-market-map'

interface MarketScenarioLink {
  /** 本地 registry 中的场景 ID */
  installedId: string
  /** 建立映射时的场景版本 */
  version: string
  linkedAt: number
  /**
   * 市场条目图标（图片地址或 lucide 图标名）
   *
   * 场景包自带的 icon 未必与市场条目一致，已安装场景要展示「场景自身的图标」，
   * 因此把市场图标一并缓存下来，供列表与切换器直接读取。
   */
  icon?: string
}

type MarketMap = Record<string, MarketScenarioLink>

function readMap(): MarketMap {
  try {
    const raw = localStorage.getItem(MARKET_MAP_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as MarketMap
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeMap(map: MarketMap): void {
  try {
    localStorage.setItem(MARKET_MAP_STORAGE_KEY, JSON.stringify(map))
  } catch {
    // 映射只是加速与兜底，写不进去不影响主流程
  }
}

/** 记录「市场条目 → 本地场景」的对应关系 */
export function linkMarketplaceScenario(
  marketId: string,
  installedId: string,
  version?: string,
  icon?: string,
): void {
  if (!marketId || !installedId) return
  const map = readMap()
  const previous = map[marketId]
  map[marketId] = {
    installedId,
    version: version || previous?.version || '',
    linkedAt: Date.now(),
    icon: icon || previous?.icon,
  }
  writeMap(map)
}

/**
 * 批量缓存市场图标
 *
 * 市场列表、精选列表返回的每个条目都带 icon，浏览过市场即可把已安装场景的
 * 图标补齐，无需再逐个请求详情。
 */
export function cacheMarketplaceIcons(items: Array<{ id?: string; icon?: string }>): void {
  if (!Array.isArray(items) || items.length === 0) return
  const map = readMap()
  let changed = false

  for (const item of items) {
    if (!item?.id || !item.icon) continue
    const link = map[item.id]
    if (!link || link.icon === item.icon) continue
    map[item.id] = { ...link, icon: item.icon }
    changed = true
  }

  if (changed) writeMap(map)
}

/**
 * 取场景最终展示的图标
 *
 * 优先用市场条目图标（场景应用市场里对应场景的图标），没有缓存时回落到
 * 场景包自己声明的 icon。
 */
export function resolveScenarioIcon(scenario: ScenarioPlugin): string | undefined {
  const marketId = resolveMarketplaceId(scenario)
  const cached = readMap()[marketId]?.icon
  return cached || scenario.icon || undefined
}

/** 场景被卸载后清掉对应的映射，避免市场页误判为已安装 */
export function unlinkMarketplaceScenario(installedId: string): void {
  const map = readMap()
  let changed = false
  for (const [marketId, link] of Object.entries(map)) {
    if (link.installedId === installedId) {
      delete map[marketId]
      changed = true
    }
  }
  if (changed) writeMap(map)
}

/**
 * 找出市场条目在本地对应的已安装场景 ID
 *
 * 依次尝试：场景 ID 直接命中 → 映射命中 → 名称命中。
 * 名称命中用于兼容建立映射之前就已经安装的场景，命中后会补写映射。
 */
export function findInstalledScenarioId(item: {
  id: string
  name?: string
  nameZh?: string
}): string | null {
  if (!item?.id) return null

  if (scenarioRegistry.has(item.id)) {
    linkMarketplaceScenario(item.id, item.id, scenarioRegistry.get(item.id)?.version)
    return item.id
  }

  const link = readMap()[item.id]
  if (link && scenarioRegistry.has(link.installedId)) return link.installedId

  const names = [item.name, item.nameZh].filter((n): n is string => !!n)
  if (names.length === 0) return null

  for (const scenario of scenarioRegistry.getInstalled()) {
    if (scenario.isBuiltin) continue
    if (names.includes(scenario.name) || names.includes(scenario.nameZh)) {
      linkMarketplaceScenario(item.id, scenario.id, scenario.version)
      return scenario.id
    }
  }

  // 映射指向的场景已被卸载：清掉脏数据
  if (link) unlinkMarketplaceScenario(link.installedId)
  return null
}

/** 市场条目是否已安装（返回本地场景 ID，未安装返回 null） */
export function isMarketplaceScenarioInstalled(item: {
  id: string
  name?: string
  nameZh?: string
}): string | null {
  return findInstalledScenarioId(item)
}

/** 取某个已安装场景对应的市场 ID（用于向后端查询更新） */
export function resolveMarketplaceId(scenario: ScenarioPlugin): string {
  if (scenario.marketplaceId) return scenario.marketplaceId
  for (const [marketId, link] of Object.entries(readMap())) {
    if (link.installedId === scenario.id) return marketId
  }
  return scenario.id
}

/** 单个场景的待更新信息 */
export interface ScenarioUpdateCandidate {
  /** 后端市场场景 ID */
  marketId: string
  /** 本地 registry 场景 ID */
  installedId: string
  name: string
  nameZh: string
  currentVersion: string
  latestVersion: string
  changelog?: string
  minAppVersion?: string
  fileSize: number
}

/** 单个场景的更新执行结果 */
export interface ScenarioUpdateOutcome extends ScenarioUpdateCandidate {
  success: boolean
  /** 更新后落盘的场景配置（用于重新注册场景） */
  config?: Record<string, unknown>
  /** 更新后由主进程确认的目录 ID（通常等于 config.id） */
  resolvedScenarioId?: string
  error?: string
}

/**
 * 检查所有非内置场景是否有新版本
 *
 * 内置场景随客户端发版更新，不参与市场更新检查。
 */
export async function checkInstalledScenarioUpdates(): Promise<ScenarioUpdateCandidate[]> {
  const installed = scenarioRegistry.getInstalled().filter((s) => !s.isBuiltin)
  if (installed.length === 0) return []

  const entries = installed.map((scenario) => ({
    scenario,
    marketId: resolveMarketplaceId(scenario),
  }))

  const updates = await checkScenarioUpdates(
    entries.map((e) => ({ id: e.marketId, version: e.scenario.version || '1.0.0' })),
  )
  if (updates.length === 0) return []

  const byMarketId = new Map(entries.map((e) => [e.marketId, e.scenario]))
  const candidates: ScenarioUpdateCandidate[] = []

  for (const update of updates) {
    const scenario = byMarketId.get(update.scenarioId)
    if (!scenario || !update.latestVersion) continue
    candidates.push({
      marketId: update.scenarioId,
      installedId: scenario.id,
      name: scenario.name,
      nameZh: scenario.nameZh,
      currentVersion: scenario.version || update.currentVersion || '1.0.0',
      latestVersion: update.latestVersion,
      changelog: update.changelog,
      minAppVersion: update.minAppVersion,
      fileSize: update.fileSize || 0,
    })
  }

  return candidates
}

/**
 * 执行单个场景的更新
 *
 * 只负责下载落盘与版本登记，重新注册场景由调用方完成（需要时可用返回的 config）。
 */
export async function applyInstalledScenarioUpdate(
  candidate: ScenarioUpdateCandidate,
): Promise<ScenarioUpdateOutcome> {
  try {
    const result = await updateScenarioFromMarketplace(candidate.marketId, candidate.latestVersion)
    if (!result.success) {
      return {
        ...candidate,
        success: false,
        error: result.error || 'Update failed',
      }
    }

    const resolvedScenarioId = result.scenarioId || candidate.installedId
    linkMarketplaceScenario(candidate.marketId, resolvedScenarioId, candidate.latestVersion)
    if (resolvedScenarioId !== candidate.installedId) {
      linkMarketplaceScenario(candidate.marketId, candidate.installedId, candidate.latestVersion)
    }

    return {
      ...candidate,
      success: true,
      installedId: resolvedScenarioId,
      config: result.config,
      resolvedScenarioId,
    }
  } catch (err) {
    logger.scenario.warn('[ScenarioMarketplace] Update failed:', err)
    return {
      ...candidate,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * 补齐已安装场景的市场图标
 *
 * 早前安装的场景只保留了场景包自带的 icon，本地没有市场图标缓存。这里对缺少
 * 缓存的场景逐个拉一次市场详情，把图标写回注册表并持久化，让「已安装」列表、
 * 详情页与顶部切换器都显示它在市场里的图标。
 *
 * 未登录、离线或场景已下架时静默跳过，不阻断启动流程。
 */
export async function syncInstalledScenarioIcons(): Promise<number> {
  const installed = scenarioRegistry.getInstalled().filter((s) => !s.isBuiltin)
  if (installed.length === 0) return 0

  const map = readMap()
  const pending = installed.filter((scenario) => !map[resolveMarketplaceId(scenario)]?.icon)
  if (pending.length === 0) return 0

  let applied = 0
  for (const scenario of pending) {
    const marketId = resolveMarketplaceId(scenario)
    try {
      const detail = await getScenarioDetail(marketId)
      if (!detail?.icon) continue

      linkMarketplaceScenario(marketId, scenario.id, scenario.version, detail.icon)
      if (scenario.icon !== detail.icon) {
        scenarioRegistry.updateScenario(scenario.id, { icon: detail.icon })
      }
      applied++
    } catch {
      // 单个场景补图失败不影响其它场景
    }
  }

  return applied
}
