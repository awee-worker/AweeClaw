import { describe, expect, it } from 'vitest'
import {
  buildProviderModelsRequest,
  resolveProviderProtocol,
  resolveProviderTransport,
} from '../providerTransport'
import { resolveModelCapabilityProfile } from '../modelCapabilityProfile'
import { resolveProviderCapabilities } from '../providerCapabilities'

describe('resolveProviderProtocol', () => {
  it('把 custom 视作 openai 兼容协议', () => {
    expect(resolveProviderProtocol('custom-123', 'custom')).toBe('openai')
  })

  it('未显式指定时按内置定义推断', () => {
    expect(resolveProviderProtocol('gemini')).toBe('google')
    expect(resolveProviderProtocol('anthropic')).toBe('anthropic')
    expect(resolveProviderProtocol('deepseek')).toBe('openai')
  })
})

describe('resolveProviderTransport', () => {
  it('openai 兼容协议保持 baseUrl 原样', () => {
    const transport = resolveProviderTransport('deepseek', undefined, 'https://api.deepseek.com/v1')
    expect(transport).toEqual({
      protocol: 'openai',
      sdkBaseUrl: 'https://api.deepseek.com/v1',
      apiRoot: 'https://api.deepseek.com/v1',
    })
  })

  it('去重尾斜杠', () => {
    const transport = resolveProviderTransport('deepseek', undefined, 'https://api.deepseek.com/v1/')
    expect(transport?.apiRoot).toBe('https://api.deepseek.com/v1')
  })

  it('anthropic 缺版本段时补 /v1', () => {
    const transport = resolveProviderTransport('anthropic', undefined, 'https://api.anthropic.com')
    expect(transport?.sdkBaseUrl).toBe('https://api.anthropic.com/v1')
  })

  it('anthropic 已有 /v1 时不重复拼接', () => {
    const transport = resolveProviderTransport('anthropic', undefined, 'https://api.anthropic.com/v1')
    expect(transport?.sdkBaseUrl).toBe('https://api.anthropic.com/v1')
  })

  it('google 保留 /v1beta 版本段', () => {
    const transport = resolveProviderTransport(
      'gemini',
      undefined,
      'https://generativelanguage.googleapis.com/v1beta',
    )
    expect(transport?.sdkBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
  })

  it('google 缺版本段时补 /v1beta', () => {
    const transport = resolveProviderTransport(
      'gemini',
      undefined,
      'https://generativelanguage.googleapis.com',
    )
    expect(transport?.sdkBaseUrl).toBe('https://generativelanguage.googleapis.com/v1beta')
  })

  it('openai-responses 补 /v1', () => {
    const transport = resolveProviderTransport('custom-1', 'openai-responses', 'https://gw/api')
    expect(transport?.apiRoot).toBe('https://gw/api/v1')
  })

  it('未配置地址且非内置 provider 时返回 undefined', () => {
    expect(resolveProviderTransport('unknown-provider')).toBeUndefined()
  })
})

describe('buildProviderModelsRequest', () => {
  it('openai 兼容协议使用 Bearer 头且端点与对话同根', () => {
    const transport = resolveProviderTransport('deepseek', undefined, 'https://api.deepseek.com/v1')!
    const request = buildProviderModelsRequest(transport, 'sk-1')

    expect(request.url).toBe('https://api.deepseek.com/v1/models')
    expect(request.headers.Authorization).toBe('Bearer sk-1')
  })

  it('anthropic 使用 x-api-key 与版本头', () => {
    const transport = resolveProviderTransport('anthropic', undefined, 'https://api.anthropic.com')!
    const request = buildProviderModelsRequest(transport, 'ak-1')

    expect(request.url).toBe('https://api.anthropic.com/v1/models')
    expect(request.headers['x-api-key']).toBe('ak-1')
    expect(request.headers['anthropic-version']).toBe('2023-06-01')
    expect(request.headers.Authorization).toBeUndefined()
  })

  it('google 把 key 放到 query 上', () => {
    const transport = resolveProviderTransport('gemini', undefined, 'https://generativelanguage.googleapis.com')!
    const request = buildProviderModelsRequest(transport, 'AIza/test')

    expect(request.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models?key=AIza%2Ftest',
    )
  })
})

describe('resolveModelCapabilityProfile', () => {
  it('gpt-5 归为 OpenAI 推理模型并支持 24h prompt cache', () => {
    const profile = resolveModelCapabilityProfile('gpt-5.2')
    expect(profile.openAIReasoning).toBe(true)
    expect(profile.samplingRestoredWhenEffortNone).toBe(true)
    expect(profile.promptCacheRetention24h).toBe(true)
  })

  it('gpt-5-chat 对话变体不算推理模型', () => {
    expect(resolveModelCapabilityProfile('gpt-5-chat-latest').openAIReasoning).toBe(false)
  })

  it('kimi-k2 温度固定为 1', () => {
    expect(resolveModelCapabilityProfile('kimi-k2-thinking').fixedTemperature).toBe(1)
  })

  it('glm-5 思考强制开启且档位受限', () => {
    const profile = resolveModelCapabilityProfile('glm-5')
    expect(profile.thinkingForced).toBe(true)
    expect(profile.reasoningEffortLevels).toEqual(['low', 'high', 'max'])
  })

  it('anthropic 的思考预算与输出上限叠加计算', () => {
    expect(resolveModelCapabilityProfile('claude-sonnet-4').thinkingBudgetMode).toBe('additive')
  })

  it('未知模型返回默认档案', () => {
    const profile = resolveModelCapabilityProfile('some-model')
    expect(profile.openAIReasoning).toBe(false)
    expect(profile.fixedTemperature).toBeUndefined()
    expect(profile.thinkingBudgetMode).toBe('shared')
  })
})

describe('resolveProviderCapabilities', () => {
  it('内置 provider 读取 features', () => {
    const capabilities = resolveProviderCapabilities('deepseek')
    expect(capabilities.tools).toBe(true)
    expect(capabilities.vision).toBe(false)
  })

  it('自定义 provider 给出保守默认值', () => {
    const capabilities = resolveProviderCapabilities('custom-123', 'openai')
    expect(capabilities.streaming).toBe(true)
    expect(capabilities.tools).toBe(true)
    expect(capabilities.vision).toBe(false)
  })
})
