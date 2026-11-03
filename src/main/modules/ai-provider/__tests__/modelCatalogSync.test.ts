import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  parseModelCatalogPayload,
  scheduleModelCatalogSync,
  syncModelCatalog,
} from '../modelCatalogSync'
import type { SettingsDb } from '../../settings-db/SettingsDb'

interface ProviderRow {
  apiKey?: string
  baseUrl?: string
  protocol?: string
  customModels?: string[]
}

/**
 * 构造最小的 SettingsDb 替身。
 *
 * 只实现本模块用到的三个方法，写入行为记录到 writes 里供断言。
 */
function createDb(rows: Record<string, ProviderRow>): {
  db: SettingsDb
  writes: Array<{ providerId: string; models: string[] }>
} {
  const writes: Array<{ providerId: string; models: string[] }> = []
  const db = {
    getAllProviderConfigs: () => rows,
    getProviderConfig: (providerId: string) => rows[providerId] ?? null,
    updateProviderCustomModels: (providerId: string, models: string[]) => {
      writes.push({ providerId, models })
    },
  } as unknown as SettingsDb

  return { db, writes }
}

function stubFetchOnce(status: number, payload: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  })))
}

describe('parseModelCatalogPayload', () => {
  it('OpenAI 风格读取 data[].id', () => {
    const models = parseModelCatalogPayload(
      { data: [{ id: 'model-b' }, { id: 'model-a' }] },
      'openai',
    )
    expect(models).toEqual(['model-b', 'model-a'])
  })

  it('Anthropic 同样是 data[].id', () => {
    const models = parseModelCatalogPayload({ data: [{ id: 'claude-x' }] }, 'anthropic')
    expect(models).toEqual(['claude-x'])
  })

  it('Google 风格剥掉 models/ 前缀', () => {
    const models = parseModelCatalogPayload(
      { models: [{ name: 'models/gemini-pro' }, { name: 'models/gemini-flash' }] },
      'google',
    )
    expect(models).toEqual(['gemini-pro', 'gemini-flash'])
  })

  it('直接返回字符串数组', () => {
    expect(parseModelCatalogPayload(['a', 'b'], 'openai')).toEqual(['a', 'b'])
  })

  it('无法识别的负载返回空数组', () => {
    expect(parseModelCatalogPayload({ error: 'nope' }, 'openai')).toEqual([])
    expect(parseModelCatalogPayload(null, 'openai')).toEqual([])
  })
})

describe('syncModelCatalog 跳过策略', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('自定义 provider 不参与同步', async () => {
    const { db, writes } = createDb({
      'custom-123': { apiKey: 'sk-1' },
    })

    const report = await syncModelCatalog(db)

    expect(report).toEqual([
      { providerId: 'custom-123', status: 'skipped', reason: 'custom-provider' },
    ])
    expect(writes).toHaveLength(0)
  })

  it('未配置 apiKey 不发起请求', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { db } = createDb({ deepseek: {} })
    const report = await syncModelCatalog(db)

    expect(report[0]).toMatchObject({ status: 'skipped', reason: 'no-api-key' })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('已有清单不覆盖用户数据', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const { db, writes } = createDb({
      deepseek: { apiKey: 'sk-1', customModels: ['my-model'] },
    })
    const report = await syncModelCatalog(db)

    expect(report[0]).toMatchObject({
      status: 'skipped',
      reason: 'has-models',
      modelCount: 1,
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
  })
})

describe('syncModelCatalog 写入与错误分级', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('拉取成功后只写 custom_models，且内容去重排序', async () => {
    stubFetchOnce(200, { data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'b-model' }] })

    const { db, writes } = createDb({ deepseek: { apiKey: 'sk-1' } })
    const report = await syncModelCatalog(db)

    expect(report[0]).toMatchObject({ status: 'synced', modelCount: 2 })
    expect(writes).toEqual([{ providerId: 'deepseek', models: ['a-model', 'b-model'] }])
  })

  it('HTTP 失败记为 failed，不影响后续 provider', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [{ id: 'ok-model' }] }) })
    vi.stubGlobal('fetch', fetchSpy)

    const { db, writes } = createDb({
      deepseek: { apiKey: 'sk-1' },
      openai: { apiKey: 'sk-2' },
    })

    const report = await syncModelCatalog(db)

    expect(report[0]).toMatchObject({ status: 'failed', reason: 'HTTP 500' })
    expect(report[1]).toMatchObject({ status: 'synced', modelCount: 1 })
    expect(writes).toEqual([{ providerId: 'openai', models: ['ok-model'] }])
  })

  it('空清单记为 failed 且不写库', async () => {
    stubFetchOnce(200, { data: [] })

    const { db, writes } = createDb({ deepseek: { apiKey: 'sk-1' } })
    const report = await syncModelCatalog(db)

    expect(report[0]).toMatchObject({ status: 'failed', reason: 'empty-list' })
    expect(writes).toHaveLength(0)
  })

  it('拉取期间清单被写入时放弃覆盖', async () => {
    const rows: Record<string, ProviderRow> = { deepseek: { apiKey: 'sk-1' } }

    // 模拟：请求返回前，用户已在设置里保存了自己的清单
    vi.stubGlobal('fetch', vi.fn(async () => {
      rows.deepseek = { apiKey: 'sk-1', customModels: ['user-model'] }
      return { ok: true, status: 200, json: async () => ({ data: [{ id: 'remote-model' }] }) }
    }))

    const { db, writes } = createDb(rows)
    const report = await syncModelCatalog(db)

    expect(report[0]).toMatchObject({ status: 'skipped', reason: 'has-models' })
    expect(writes).toHaveLength(0)
  })

  it('网络异常被收敛为 failed，不抛出', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))

    const { db, writes } = createDb({ deepseek: { apiKey: 'sk-1' } })
    const report = await syncModelCatalog(db)

    expect(report[0]).toMatchObject({ status: 'failed', reason: 'ECONNREFUSED' })
    expect(writes).toHaveLength(0)
  })
})

describe('scheduleModelCatalogSync 启动钩子', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('延迟到期才触发同步，且只触发一次', async () => {
    vi.useFakeTimers()
    stubFetchOnce(200, { data: [{ id: 'm1' }] })

    const { db, writes } = createDb({ deepseek: { apiKey: 'sk-1' } })
    const getDb = vi.fn(() => db)

    scheduleModelCatalogSync(getDb)

    // 未到延迟时间：不应读取数据库，更不能发起请求
    expect(getDb).not.toHaveBeenCalled()

    // 与实现里的 STARTUP_DELAY_MS 对齐（10s）
    await vi.advanceTimersByTimeAsync(10_000)

    expect(getDb).toHaveBeenCalledTimes(1)
    expect(writes).toEqual([{ providerId: 'deepseek', models: ['m1'] }])
  })

  it('同步过程抛错不外泄', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ECONNREFUSED')
    }))

    const { db, writes } = createDb({ deepseek: { apiKey: 'sk-1' } })

    // 钩子本身是 fire-and-forget，调用不该抛
    expect(() => scheduleModelCatalogSync(() => db)).not.toThrow()

    // 定时器到期后异常被内部吞掉：不产生 unhandled rejection，也不写库
    await vi.advanceTimersByTimeAsync(10_000)
    await Promise.resolve()
    expect(writes).toHaveLength(0)
  })
})
