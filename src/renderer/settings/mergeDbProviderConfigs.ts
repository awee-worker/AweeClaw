/**
 * provider 配置合并 — SQLite 行数据 → 运行时 ProviderModelConfig
 *
 * 独立成模块的原因：这段逻辑决定了「数据库里的值是否真的覆盖默认值」，
 * 是本机模型清单同步能否生效的关键一环，需要能被单测直接验证。
 * 放在 preferencesService 内部时，import 会连带拉起 electronBridge 等
 * 渲染进程适配层，测试环境无法加载。
 *
 * 本模块只依赖 shared 层的纯函数，无任何副作用。
 */

import {
  SETTINGS,
  type ProviderModelConfig,
} from '@shared/configuration/preferenceSync'
import {
  isBuiltinProvider,
  resolveOpenAICompatibilityProfile,
} from '@shared/configuration/aiProviders'

/**
 * 将 SQLite 中的 provider 配置合并默认值，生成运行时 ProviderModelConfig。
 *
 * 合并顺序是「默认值在前、数据库值在后」，因此数据库里的字段（包括
 * customModels）始终覆盖内置静态清单 —— 内置清单只是缺省值，不是权威来源。
 */
export function mergeDbProviderConfigs(
  dbConfigs: Record<string, any>,
): Record<string, ProviderModelConfig> {
  const defaults = SETTINGS.providerConfigs.default
  const merged: Record<string, ProviderModelConfig> = { ...defaults }

  for (const [id, config] of Object.entries(dbConfigs)) {
    if (isBuiltinProvider(id)) {
      const resolved = { ...defaults[id], ...config }
      merged[id] = {
        ...resolved,
        openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
          id,
          resolved.protocol ?? defaults[id]?.protocol,
          resolved.openAICompatibilityProfile,
        ),
      }
      continue
    }

    merged[id] = {
      ...config,
      openAICompatibilityProfile: resolveOpenAICompatibilityProfile(
        id,
        config.protocol,
        config.openAICompatibilityProfile,
      ),
    }
  }

  return merged
}
