/**
 * 本地语音配置持久化单元测试
 *
 * 重点回归：「保存成功但开关不生效」——开关（布尔）字段曾被写成 React 事件对象，
 * 序列化后与默认配置类型不符，被 mergeConfig 静默丢弃，表现为重启后回到未启用。
 * 因此 mergeConfig 在「类型不匹配时丢弃」这条路径上必须留下告警日志，
 * 否则同一类问题会再次以「设置不生效」的形式静默复发。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import * as fs from 'fs'

const hoisted = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path')
  return {
    root: fs.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-local-voice-')),
    // 与 vi.mock 工厂共用同一组 fn，避免断言到「另一个 mock 实例」
    warn: vi.fn(),
    error: vi.fn(),
  }
})

vi.mock('electron', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path')
  return {
    app: {
      getPath: (name: string) => {
        const dir = path.join(hoisted.root, name)
        fs.mkdirSync(dir, { recursive: true })
        return dir
      },
      isPackaged: false,
    },
  }
})

vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    system: { info: vi.fn(), warn: hoisted.warn, error: hoisted.error, debug: vi.fn() },
    ipc: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  },
}))

import {
  readLocalVoiceConfig,
  updateLocalVoiceConfig,
  resetLocalVoiceConfig,
  getLocalVoiceConfigPath,
} from '../LocalVoiceStore'

describe('LocalVoiceStore 配置持久化', () => {
  beforeEach(() => {
    resetLocalVoiceConfig()
    hoisted.warn.mockClear()
    hoisted.error.mockClear()
  })

  it('模块总开关能写入并读回', () => {
    updateLocalVoiceConfig({ enabled: true })
    expect(readLocalVoiceConfig().enabled).toBe(true)
  })

  it('ASR / TTS 子开关能写入并读回', () => {
    updateLocalVoiceConfig({
      enabled: true,
      asr: { enabled: true } as never,
      tts: { enabled: true } as never,
    })

    const config = readLocalVoiceConfig()
    expect(config.enabled).toBe(true)
    expect(config.asr.enabled).toBe(true)
    expect(config.tts.enabled).toBe(true)
  })

  it('非原始值（误传事件对象）不得覆盖已保存的布尔值', () => {
    updateLocalVoiceConfig({ enabled: true })
    updateLocalVoiceConfig({ enabled: {} as never })
    expect(readLocalVoiceConfig().enabled).toBe(true)
  })

  it('非原始值（误传事件对象）会写告警日志，指明具体字段', () => {
    updateLocalVoiceConfig({ enabled: {} as never, priority: 'local-only' })

    expect(hoisted.warn).toHaveBeenCalledTimes(1)
    expect(String(hoisted.warn.mock.calls[0][0])).toContain('enabled')
    // 同批次里的合法字段不能被连带丢弃
    expect(readLocalVoiceConfig().priority).toBe('local-only')
  })

  it('磁盘上的脏值（事件对象序列化成 {}）读回时使用默认值，而不是写坏配置', () => {
    // 模拟旧版本写下的坏数据：布尔字段被事件对象覆盖、枚举字段被写成数字
    fs.writeFileSync(
      getLocalVoiceConfigPath(),
      JSON.stringify({ enabled: {}, maxConcurrentDownloads: {}, priority: 42 }),
      'utf-8',
    )

    const config = readLocalVoiceConfig()

    expect(config.enabled).toBe(false)
    expect(config.maxConcurrentDownloads).toBe(2)
    expect(config.priority).toBe('cloud-first')
    expect(hoisted.warn).toHaveBeenCalled()
  })

  it('未知字段被忽略，不会污染配置文件', () => {
    updateLocalVoiceConfig({ notARealField: 'x' } as never)

    const raw = JSON.parse(fs.readFileSync(getLocalVoiceConfigPath(), 'utf-8')) as Record<
      string,
      unknown
    >
    expect(raw).not.toHaveProperty('notARealField')
  })

  it('嵌套子对象按字段深度合并，不整体覆盖', () => {
    updateLocalVoiceConfig({ asr: { modelName: 'custom-asr' } as never })

    const config = readLocalVoiceConfig()
    expect(config.asr.modelName).toBe('custom-asr')
    // 未传入的子字段必须保留默认值（否则保存后会「丢配置」）
    expect(config.asr.numThreads).toBe(4)
    expect(config.asr.engine).toBe('sherpa-asr')
  })

  it('配置文件损坏（非法 JSON）时回退默认值并告警', () => {
    fs.writeFileSync(getLocalVoiceConfigPath(), '{ this is not json', 'utf-8')

    expect(readLocalVoiceConfig().enabled).toBe(false)
    expect(hoisted.warn).toHaveBeenCalled()
  })

  it('启用后的优先级 / 自动下载开关都能持久化', () => {
    updateLocalVoiceConfig({ enabled: true, autoDownloadModels: true, priority: 'local-only' })

    expect(readLocalVoiceConfig()).toMatchObject({
      enabled: true,
      autoDownloadModels: true,
      priority: 'local-only',
    })
  })

  it('修改 priority 不影响已保存的开关', () => {
    updateLocalVoiceConfig({ enabled: true, priority: 'local-only' })

    const config = readLocalVoiceConfig()
    expect(config.enabled).toBe(true)
    expect(config.priority).toBe('local-only')
  })

  it('局部更新不丢失其他已保存字段', () => {
    updateLocalVoiceConfig({ tts: { defaultVoice: 'Xiaoxiao' } as never })
    updateLocalVoiceConfig({ enabled: true })

    expect(readLocalVoiceConfig().tts.defaultVoice).toBe('Xiaoxiao')
  })
})
