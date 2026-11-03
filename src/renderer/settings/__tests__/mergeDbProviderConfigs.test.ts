import { describe, expect, it } from 'vitest'
import { mergeDbProviderConfigs } from '../mergeDbProviderConfigs'
import { SETTINGS } from '@shared/configuration/preferenceSchema'
import { isBuiltinProvider } from '@shared/configuration/aiProviders'

/**
 * 取一个真实内置 provider 的 id，避免在测试里硬编码服务商名称 ——
 * 内置清单调整时这里不需要跟着改。
 */
const builtinId = Object.keys(SETTINGS.providerConfigs.default).find((id) =>
  isBuiltinProvider(id),
) as string

describe('mergeDbProviderConfigs', () => {
  it('内置 provider：数据库的 customModels 覆盖默认空清单', () => {
    // 前置：默认清单为空数组（内置静态清单只是缺省值）
    expect(SETTINGS.providerConfigs.default[builtinId].customModels).toEqual([])

    const merged = mergeDbProviderConfigs({
      [builtinId]: { customModels: ['synced-model-a', 'synced-model-b'] },
    })

    // 预期：同步写入的清单生效，不会被默认值盖回
    expect(merged[builtinId].customModels).toEqual(['synced-model-a', 'synced-model-b'])
  })

  it('内置 provider：数据库未提供的字段保留默认值', () => {
    const defaultBaseUrl = SETTINGS.providerConfigs.default[builtinId].baseUrl

    const merged = mergeDbProviderConfigs({
      [builtinId]: { customModels: ['only-models'] },
    })

    // 只改清单不应把 baseUrl 之类的默认值打掉
    expect(merged[builtinId].baseUrl).toBe(defaultBaseUrl)
  })

  it('非内置 provider：原样合并，不注入内置默认值', () => {
    const merged = mergeDbProviderConfigs({
      'custom-abc': { customModels: ['x-model'], baseUrl: 'https://example.test/v1' },
    })

    expect(merged['custom-abc'].customModels).toEqual(['x-model'])
    expect(merged['custom-abc'].baseUrl).toBe('https://example.test/v1')
  })

  it('数据库中没有的 provider：默认配置仍然存在', () => {
    const merged = mergeDbProviderConfigs({})

    expect(Object.keys(merged).sort()).toEqual(
      Object.keys(SETTINGS.providerConfigs.default).sort(),
    )
  })
})
