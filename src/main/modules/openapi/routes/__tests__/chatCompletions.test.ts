import { EventEmitter } from 'events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RouteContext } from '../routeTypes'

/**
 * 流式参数降级的重试逻辑测试。
 *
 * 关注两件事：
 * 1. 服务商以 400 拒收某个参数时，去掉该参数重发一次并成功
 * 2. 已经向客户端吐出过正文后，任何错误都不得重试（否则内容会重复）
 *
 * 依赖全部按被测文件里的导入路径 mock，保证记录到的调用参数就是
 * 真实链路会传进去的那一份。
 */

const streamTextMock = vi.fn()
const markSuppressedMock = vi.fn()

vi.mock('ai', () => ({
  streamText: (options: unknown) => streamTextMock(options),
}))

vi.mock('../../../ai-provider/modelRegistry', () => ({
  createModel: () => ({ provider: 'test-model' }),
}))

vi.mock('../../../ai-provider/core/MessageAdapter', () => ({
  MessageConverter: class {
    convert() {
      return [{ role: 'user', content: 'hi' }]
    }
  },
}))

vi.mock('../../../ai-provider/core/ProviderFeatureMatrix', () => ({
  buildProtocolProviderOptions: () => ({}),
  buildThinkingProviderOptions: () => ({}),
  mergeProviderOptions: (a: unknown, b: unknown) => ({ ...(a as object), ...(b as object) }),
  resolveThinkingCompatibility: () => ({ enabled: false }),
}))

/**
 * mock 的 settings 构建反映真实语义：被标记抑制的参数不再下发。
 * 这样断言「第二次请求不带 temperature」才有意义。
 */
vi.mock('../../../ai-provider/core/RequestConfigBuilder', async () => {
  const adapter = await vi.importActual<typeof import('../../../ai-provider/core/ProviderParameterAdapter')>(
    '../../../ai-provider/core/ProviderParameterAdapter',
  )
  return {
    buildGenerationSettings: (config: Record<string, unknown>) => {
      const settings: Record<string, unknown> = {}
      if (
        typeof config.temperature === 'number' &&
        !adapter.isParameterSuppressed(config as never, 'temperature')
      ) {
        settings.temperature = config.temperature
      }
      return settings
    },
    buildRequestExecutionOptions: () => ({ headers: {} }),
  }
})

vi.mock('../../../ai-provider/core/ProviderParameterAdapter', async () => {
  const actual = await vi.importActual<typeof import('../../../ai-provider/core/ProviderParameterAdapter')>(
    '../../../ai-provider/core/ProviderParameterAdapter',
  )
  return {
    ...actual,
    markParameterSuppressed: (...args: unknown[]) => {
      markSuppressedMock(...args)
      return (actual.markParameterSuppressed as (...inner: unknown[]) => void)(...args)
    },
  }
})

vi.mock('../../OpenApiModelSource', () => ({
  resolveModelRequest: () => ({
    config: {
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'sk-test',
      temperature: 0.7,
    },
  }),
  getActiveModelId: () => 'deepseek-chat',
}))

/** 最小可用的 SSE 响应替身 */
class FakeResponse extends EventEmitter {
  writableEnded = false
  chunks: string[] = []
  statusCode = 0
  socket = { setNoDelay: () => undefined }
  writtenHeaders: Record<string, unknown> = {}

  writeHead(status: number, headers: Record<string, unknown>): void {
    this.statusCode = status
    this.writtenHeaders = headers
  }

  flushHeaders(): void {}

  write(chunk: string): boolean {
    this.chunks.push(chunk)
    return true
  }

  end(): void {
    this.writableEnded = true
  }

  /** 把 SSE 文本拆成已解析的 data 载荷 */
  payloads(): Array<Record<string, any>> {
    return this.chunks
      .join('')
      .split('\n\n')
      .map((block) => block.replace(/^data: /, '').trim())
      .filter((block) => block && block !== '[DONE]')
      .map((block) => {
        try {
          return JSON.parse(block) as Record<string, any>
        } catch {
          return null
        }
      })
      .filter((item): item is Record<string, any> => item !== null)
  }
}

function createCtx(body: Record<string, unknown>): {
  ctx: RouteContext
  res: FakeResponse
  reportError: ReturnType<typeof vi.fn>
} {
  const res = new FakeResponse()
  const reportError = vi.fn()
  const ctx = {
    config: {},
    readJsonBody: async () => body,
    readJsonBodyRaw: async () => '',
    respondJson: (_res: unknown, status: number, payload: unknown) => {
      res.statusCode = status
      res.write(JSON.stringify(payload))
    },
    reportError,
  } as unknown as RouteContext

  return { ctx, res, reportError }
}

/** 生成成功吐出若干片段的流 */
function streamOf(deltas: string[]): { textStream: AsyncGenerator<string> } {
  return {
    textStream: (async function* () {
      for (const delta of deltas) yield delta
    })(),
  }
}

/** 生成在吐出若干片段后抛错的流 */
function streamFailingAfter(deltas: string[], error: Error): { textStream: AsyncGenerator<string> } {
  return {
    textStream: (async function* () {
      for (const delta of deltas) yield delta
      throw error
    })(),
  }
}

/** 生成立即抛错的流 */
function streamFailing(error: Error): { textStream: AsyncGenerator<string> } {
  return {
    textStream: (async function* () {
      throw error
    })(),
  }
}

const UNSUPPORTED_TEMPERATURE = new Error(
  '400 {"error":{"message":"Unsupported parameter: temperature is not supported with this model"}}',
)

async function runStream(
  body: Record<string, unknown> = {
    model: 'deepseek-chat',
    stream: true,
    messages: [{ role: 'user', content: 'hi' }],
  },
): Promise<{ res: FakeResponse; reportError: ReturnType<typeof vi.fn> }> {
  const { handleChatCompletions } = await import('../chatCompletions')
  const { ctx, res, reportError } = createCtx(body)
  await handleChatCompletions(
    {} as never,
    res as never,
    ctx,
  )
  return { res, reportError }
}

describe('chatCompletions 流式参数降级', () => {
  beforeEach(() => {
    streamTextMock.mockReset()
    markSuppressedMock.mockReset()
  })

  afterEach(async () => {
    const { clearParameterSuppressionState } = await import(
      '../../../ai-provider/core/ProviderParameterAdapter'
    )
    clearParameterSuppressionState()
  })

  it('参数被拒收且未吐字时，去掉该参数重发并成功', async () => {
    streamTextMock
      .mockImplementationOnce(() => streamFailing(UNSUPPORTED_TEMPERATURE))
      .mockImplementationOnce(() => streamOf(['hello', ' world']))

    const { res } = await runStream()

    expect(streamTextMock).toHaveBeenCalledTimes(2)
    expect(markSuppressedMock).toHaveBeenCalledWith(
      expect.anything(),
      'temperature',
      expect.stringContaining('Unsupported parameter'),
    )

    // 首次请求带 temperature，重试时已被抑制
    expect(streamTextMock.mock.calls[0][0]).toMatchObject({ temperature: 0.7 })
    expect(streamTextMock.mock.calls[1][0].temperature).toBeUndefined()

    const payloads = res.payloads()
    const contents = payloads
      .map((item) => item.choices?.[0]?.delta?.content)
      .filter(Boolean)
    expect(contents).toEqual(['hello', ' world'])
    expect(payloads.some((item) => item.error)).toBe(false)
  })

  it('已向客户端吐出正文后出错，不再重试（避免内容重复）', async () => {
    streamTextMock.mockImplementationOnce(() =>
      streamFailingAfter(['partial'], UNSUPPORTED_TEMPERATURE),
    )

    const { res } = await runStream()

    // 关键断言：只请求了一次，没有把 partial 之后的请求再发一遍
    expect(streamTextMock).toHaveBeenCalledTimes(1)

    const payloads = res.payloads()
    const contents = payloads
      .map((item) => item.choices?.[0]?.delta?.content)
      .filter(Boolean)
    expect(contents).toEqual(['partial'])
    // 错误仍要告知客户端，否则它会以为流正常结束
    expect(payloads.some((item) => item.error)).toBe(true)
  })

  it('非参数类错误不重试', async () => {
    streamTextMock.mockImplementationOnce(() => streamFailing(new Error('ECONNREFUSED')))

    const { res } = await runStream()

    expect(streamTextMock).toHaveBeenCalledTimes(1)
    expect(markSuppressedMock).not.toHaveBeenCalled()
    expect(res.payloads().some((item) => item.error)).toBe(true)
  })

  it('连续参数错误达到上限后放弃重试', async () => {
    streamTextMock.mockImplementation(() => streamFailing(UNSUPPORTED_TEMPERATURE))

    const { res } = await runStream()

    // 首次 + MAX_PARAMETER_RETRIES(3) 次重试
    expect(streamTextMock).toHaveBeenCalledTimes(4)
    expect(res.payloads().some((item) => item.error)).toBe(true)
  })
})
