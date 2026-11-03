import { afterEach, describe, expect, it } from 'vitest'
import {
  clearParameterSuppressionState,
  detectUnsupportedParameter,
  isParameterSuppressed,
  markParameterSuppressed,
} from '../ProviderParameterAdapter'
import { ToolConverter } from '../ToolSchemaAdapter'

function createApiError(message: string, responseBody?: string): Error {
  const error = new Error(message) as Error & { responseBody?: string }
  if (responseBody) error.responseBody = responseBody
  return error
}

const config = {
  provider: 'deepseek',
  protocol: 'openai' as const,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
}

describe('detectUnsupportedParameter', () => {
  afterEach(() => {
    clearParameterSuppressionState()
  })

  it('识别 top_k 不被支持', () => {
    const error = createApiError("Unsupported parameter: 'top_k' is not supported with this model.")
    expect(detectUnsupportedParameter(error)?.parameter).toBe('topK')
  })

  it('从 responseBody 里识别参数名', () => {
    const error = createApiError('400 Bad Request', '{"error":"unknown parameter: temperature"}')
    expect(detectUnsupportedParameter(error)?.parameter).toBe('temperature')
  })

  it('识别 reasoning_effort 不被支持', () => {
    const error = createApiError('This model does not support reasoning_effort')
    expect(detectUnsupportedParameter(error)?.parameter).toBe('reasoningEffort')
  })

  it('普通业务错误不误判', () => {
    expect(detectUnsupportedParameter(new Error('Invalid API key provided'))).toBeNull()
    expect(detectUnsupportedParameter(new Error('Rate limit exceeded'))).toBeNull()
  })

  it('请求体回显里的参数名不触发降级', () => {
    const error = createApiError(
      '400 Unknown field "foo"\n{"temperature":0.7,"messages":[]}',
    )
    expect(detectUnsupportedParameter(error)).toBeNull()
  })
})

describe('参数降级标记', () => {
  afterEach(() => {
    clearParameterSuppressionState()
  })

  it('标记后对该 provider+model 组合生效', () => {
    expect(isParameterSuppressed(config, 'topK')).toBe(false)

    markParameterSuppressed(config, 'topK', 'unsupported parameter')
    expect(isParameterSuppressed(config, 'topK')).toBe(true)

    // 不同参数不受影响
    expect(isParameterSuppressed(config, 'temperature')).toBe(false)

    // 不同模型组合不受影响
    expect(isParameterSuppressed({ ...config, model: 'other' }, 'topK')).toBe(false)
  })
})

describe('ToolConverter', () => {
  it('原样保留 JSON Schema，不做有损重建', () => {
    const converter = new ToolConverter()
    const parameters = {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          description: '目标',
          // 联合类型与数值范围在旧的 Zod 重建里会被丢掉
          anyOf: [{ type: 'string' }, { type: 'number' }],
        },
        level: { type: 'string', enum: ['low', 'high'] },
      },
      required: ['target'],
    }

    const tools = converter.convert([
      { name: 'demo', description: '演示工具', parameters },
    ])

    const schema = (tools.demo as { inputSchema: { jsonSchema: unknown } }).inputSchema
    expect(schema.jsonSchema).toEqual(parameters)
  })
})
