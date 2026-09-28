/**
 * 可用模型清单
 *
 * 汇总当前可本地调用的模型：内置服务商中已启用且配置了凭证的，
 * 加上 custom- 前缀的自定义服务商。聊天输入框模型选择器与角色模型
 * 选择器共用这份逻辑，保证两处「可选模型」范围完全一致。
 */

import { BUILTIN_PROVIDERS } from '@shared/configuration/aiProviders'
import type { ProviderModelConfig } from '@shared/configuration/preferenceSync'

/** 扁平化后的模型条目 */
export interface FlatModel {
  id: string
  name: string
  providerId: string
  providerName: string
  isCustom?: boolean
}

/**
 * 构建可本地调用的模型列表。
 *
 * @param providerConfigs 服务商配置表
 * @param fallbackApiKey 全局兜底 apiKey（部分服务商只在全局配置了 key）
 */
export function buildEnabledLocalModels(
  providerConfigs: Record<string, ProviderModelConfig>,
  fallbackApiKey?: string,
): FlatModel[] {
  const models: FlatModel[] = []
  const seen = new Set<string>()

  for (const [providerId, provider] of Object.entries(BUILTIN_PROVIDERS)) {
    const providerConfig = providerConfigs[providerId]
    if (providerConfig?.enabled !== true) continue
    // Ollama 走本地地址，不依赖 apiKey
    if (!providerConfig?.apiKey && !fallbackApiKey && providerId !== 'ollama') continue

    const customModels = providerConfig?.customModels || []
    const modelConfigs = providerConfig?.modelConfigs || {}

    for (const id of customModels) {
      if (modelConfigs[id]?.enabled !== true) continue
      if (!id) continue
      const key = `${providerId}::${id}`
      if (seen.has(key)) continue
      seen.add(key)
      models.push({
        id,
        name: id.split('/').pop() || id,
        providerId,
        providerName: provider.displayName,
        isCustom: true,
      })
    }
  }

  for (const [providerId, config] of Object.entries(providerConfigs)) {
    if (!providerId.startsWith('custom-')) continue
    if (config?.enabled !== true) continue
    if (!config?.apiKey) continue

    const modelIds = config.customModels || []
    const providerName = config.displayName || providerId
    const modelConfigs = config?.modelConfigs || {}

    for (const id of modelIds) {
      if (modelConfigs[id]?.enabled !== true) continue
      const key = `${providerId}::${id}`
      if (seen.has(key)) continue
      seen.add(key)
      models.push({
        id,
        name: id.split('/').pop() || id,
        providerId,
        providerName,
        isCustom: true,
      })
    }
  }

  return models
}