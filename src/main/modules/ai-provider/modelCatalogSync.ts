/**
 * 模型清单自动同步
 *
 * 内置 provider 的静态模型清单长期落后于服务商实际提供的模型（部分 provider
 * 的清单直接为空），设置页的模型下拉因此缺少可选项，用户只能手输模型名。
 * 本模块在启动后异步拉取各已配置服务商的 `/models`，把结果写回该 provider
 * 的 custom_models。
 *
 * 写入策略刻意保守：
 * - 只处理内置 provider —— 自定义端点的清单格式无约定，不做猜测；
 * - 只在 custom_models 为空时填充 —— 用户手工维护过的清单不被覆盖；
 * - 只写 custom_models 一列 —— 不触碰 api_key / is_current / enabled；
 * - 全程不抛错、不阻塞启动 —— 拉取失败仅记录，降级为「清单仍旧为空」。
 */

import { logger } from '@shared/toolkit/LogEngine'
import { isBuiltinProvider, type ApiProtocol } from '@shared/configuration/aiProviders'
import {
  buildProviderModelsRequest,
  resolveProviderTransport,
  type ProviderTransport,
} from '@shared/configuration/providerTransport'
import type { SettingsDb } from '../settings-db/SettingsDb'

/** 单个 provider 的拉取超时 */
const FETCH_TIMEOUT_MS = 8_000

/** 启动后延迟执行，让首屏与主流程先跑完 */
const STARTUP_DELAY_MS = 10_000

export interface ModelCatalogEntry {
  providerId: string
  status: 'skipped' | 'synced' | 'failed'
  /** 跳过或失败的原因，便于排查「为什么没同步」 */
  reason?: string
  modelCount?: number
}

/**
 * 解析模型列表响应。
 *
 * 三种形态：
 * - OpenAI / Anthropic 风格：`{ data: [{ id }] }`
 * - Google 风格：`{ models: [{ name: 'models/xxx' }] }`，需剥掉 `models/` 前缀
 * - 部分网关直接返回字符串数组
 */
export function parseModelCatalogPayload(
  payload: unknown,
  protocol: ApiProtocol,
): string[] {
  if (Array.isArray(payload)) {
    return payload
      .map(item =>
        typeof item === 'string'
          ? item
          : ((item as { id?: string; name?: string } | null)?.id
            ?? (item as { id?: string; name?: string } | null)?.name),
      )
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  }

  if (!payload || typeof payload !== 'object') return []

  const record = payload as Record<string, unknown>

  if (protocol === 'google' && Array.isArray(record.models)) {
    return (record.models as Array<{ name?: string } | null>)
      .map(item =>
        typeof item?.name === 'string' ? item.name.replace(/^models\//, '') : '',
      )
      .filter(Boolean)
  }

  if (Array.isArray(record.data)) {
    return (record.data as Array<{ id?: string; name?: string } | null>)
      .map(item =>
        typeof item?.id === 'string'
          ? item.id
          : (typeof item?.name === 'string' ? item.name : ''),
      )
      .filter(Boolean)
  }

  return []
}

/** 去重并排序，保证写入结果稳定（同样的输入永远得到同样的顺序） */
function normalizeModelList(models: string[]): string[] {
  return [...new Set(models)].sort()
}

async function fetchModelCatalog(
  transport: ProviderTransport,
  apiKey: string,
  timeoutMs: number,
): Promise<string[]> {
  const { url, headers } = buildProviderModelsRequest(transport, apiKey)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const payload = (await response.json()) as unknown
    return normalizeModelList(parseModelCatalogPayload(payload, transport.protocol))
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 同步一个 provider 的模型清单。
 *
 * 结构化返回而不是抛错：调用方（启动流程）需要一份「谁同步了、谁跳过了、
 * 为什么」的清单，且任何单个 provider 的失败都不该影响其它 provider。
 */
async function syncOneProvider(
  db: SettingsDb,
  providerId: string,
  timeoutMs: number,
): Promise<ModelCatalogEntry> {
  if (!isBuiltinProvider(providerId)) {
    return { providerId, status: 'skipped', reason: 'custom-provider' }
  }

  const config = db.getProviderConfig(providerId)
  if (!config) {
    return { providerId, status: 'skipped', reason: 'no-config' }
  }

  const apiKey = typeof config.apiKey === 'string' ? config.apiKey.trim() : ''
  if (!apiKey) {
    return { providerId, status: 'skipped', reason: 'no-api-key' }
  }

  const existing = Array.isArray(config.customModels) ? config.customModels : []
  if (existing.length > 0) {
    return { providerId, status: 'skipped', reason: 'has-models', modelCount: existing.length }
  }

  const transport = resolveProviderTransport(providerId, config.protocol, config.baseUrl)
  if (!transport) {
    return { providerId, status: 'skipped', reason: 'no-base-url' }
  }

  try {
    const models = await fetchModelCatalog(transport, apiKey, timeoutMs)
    if (models.length === 0) {
      return { providerId, status: 'failed', reason: 'empty-list' }
    }

    // 拉取期间用户可能已在设置里保存了清单，写入前复核一次，
    // 避免用刚拉到的旧结果覆盖用户刚保存的数据
    const latest = db.getProviderConfig(providerId)
    const latestModels = Array.isArray(latest?.customModels) ? latest.customModels : []
    if (latestModels.length > 0) {
      return { providerId, status: 'skipped', reason: 'has-models', modelCount: latestModels.length }
    }

    db.updateProviderCustomModels(providerId, models)
    return { providerId, status: 'synced', modelCount: models.length }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { providerId, status: 'failed', reason }
  }
}

/**
 * 同步所有已配置 provider 的模型清单。
 *
 * 串行执行：服务商侧多有速率限制，并发拉取容易触发 429，
 * 而这项任务没有时效要求。
 */
export async function syncModelCatalog(
  db: SettingsDb,
  options: { timeoutMs?: number } = {},
): Promise<ModelCatalogEntry[]> {
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS
  const configs = db.getAllProviderConfigs()
  const entries: ModelCatalogEntry[] = []

  for (const providerId of Object.keys(configs)) {
    const entry = await syncOneProvider(db, providerId, timeoutMs)
    entries.push(entry)

    if (entry.status === 'failed') {
      logger.llm.warn('[ModelCatalogSync] 模型清单同步失败', {
        providerId,
        reason: entry.reason,
      })
    }
  }

  return entries
}

/**
 * 启动钩子：延迟后台同步，不阻塞首屏。
 *
 * 传入 getter 而不是实例，避免本模块在启动早期就强制初始化 SettingsDb。
 */
export function scheduleModelCatalogSync(getDb: () => SettingsDb): void {
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const report = await syncModelCatalog(getDb())
        const synced = report.filter(entry => entry.status === 'synced')

        if (synced.length > 0) {
          logger.system.info('[ModelCatalogSync] 启动同步完成', {
            synced: synced.map(entry => `${entry.providerId}:${entry.modelCount}`),
          })
        }
      } catch (error) {
        // 启动期能力，任何异常都不该冒泡到主流程
        logger.system.error('[ModelCatalogSync] 启动同步异常', {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    })()
  }, STARTUP_DELAY_MS)

  // 不阻止进程退出：应用关闭时无需等待同步完成
  timer.unref?.()
}
