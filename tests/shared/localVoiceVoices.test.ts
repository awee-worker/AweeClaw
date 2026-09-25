/**
 * 音色清单与音色解析测试
 *
 * 回归背景：设置面板曾把 Provider 音色 `Xiaoxiao` 作为内置音色提供，
 * 一旦被保存为 `tts.defaultVoice`，离线合成会在 Python 侧报
 * 「Built-in voice not found: Xiaoxiao」，在「仅本地」优先级下
 * 表现为「点击播报毫无反应」。因此音色解析必须保证：永不返回非法值。
 *
 * 引入多模型后新增一类等价错误：把 A 模型的音色用到 B 模型上
 * （如切到 VITS 后仍带 MOSS 的 `Junhao`），同样会导致合成失败。
 */

import { describe, it, expect } from 'vitest'
import {
  MOSS_BUILTIN_VOICES,
  MOSS_MODEL_ID,
  DEFAULT_BUILTIN_VOICE,
  VITS_MODEL_IDS,
  MODEL_VOICE_CATALOG,
  isBuiltinVoice,
  resolveBuiltinVoice,
  getBuiltinVoicesForModel,
  resolveVoiceForModel,
  normalizeTtsModelId,
} from '@shared/localVoiceVoices'

describe('MOSS 内置音色清单', () => {
  it('音色 ID 唯一', () => {
    const ids = MOSS_BUILTIN_VOICES.map((item) => item.voice)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('包含兜底音色，且每个音色都有展示名与分组', () => {
    expect(isBuiltinVoice(DEFAULT_BUILTIN_VOICE)).toBe(true)
    for (const item of MOSS_BUILTIN_VOICES) {
      expect(item.displayName.length).toBeGreaterThan(0)
      expect(item.group.length).toBeGreaterThan(0)
    }
  })

  it('Provider 音色不在清单中（避免语义混用）', () => {
    expect(isBuiltinVoice('Xiaoxiao')).toBe(false)
    expect(isBuiltinVoice('alloy')).toBe(false)
    expect(isBuiltinVoice('')).toBe(false)
    expect(isBuiltinVoice(undefined)).toBe(false)
  })
})

describe('resolveBuiltinVoice', () => {
  it('合法音色原样透传，不标记替换', () => {
    const result = resolveBuiltinVoice('Xiaoyu', 'Junhao')
    expect(result).toEqual({ voice: 'Xiaoyu', substituted: false, requested: 'Xiaoyu' })
  })

  it('非法音色回退到兜底音色并标记替换（保留请求值便于日志）', () => {
    const result = resolveBuiltinVoice('Xiaoxiao', 'Weiguo')
    expect(result.voice).toBe('Weiguo')
    expect(result.substituted).toBe(true)
    expect(result.requested).toBe('Xiaoxiao')
  })

  it('候选与兜底都非法时落到清单首位', () => {
    const result = resolveBuiltinVoice('alloy', 'Xiaoxiao')
    expect(result.voice).toBe(DEFAULT_BUILTIN_VOICE)
    expect(result.substituted).toBe(true)
  })

  it('空值同样回退，不会把空字符串送给 Python 侧', () => {
    for (const candidate of [undefined, null, '', '   ']) {
      const result = resolveBuiltinVoice(candidate, undefined)
      expect(isBuiltinVoice(result.voice)).toBe(true)
      expect(result.substituted).toBe(true)
    }
  })
})

describe('模型维度音色解析', () => {
  it('MOSS 目录名归一化为模型 ID（兼容已落盘的旧配置）', () => {
    expect(normalizeTtsModelId('MOSS-TTS-Nano-100M-ONNX')).toBe(MOSS_MODEL_ID)
    expect(normalizeTtsModelId(MOSS_MODEL_ID)).toBe(MOSS_MODEL_ID)
    expect(normalizeTtsModelId(VITS_MODEL_IDS.THERESA)).toBe(VITS_MODEL_IDS.THERESA)
  })

  it('每个模型的音色 ID 唯一、非空，且能被清单取回', () => {
    for (const [modelId, voices] of Object.entries(MODEL_VOICE_CATALOG)) {
      expect(voices.length).toBeGreaterThan(0)
      const ids = voices.map((item) => item.voice)
      expect(new Set(ids).size).toBe(ids.length)
      // 模型 ID 写错会静默回退到 MOSS，此处确保清单键与查询一致
      expect(getBuiltinVoicesForModel(modelId)).toBe(voices)
    }
  })

  it('未登记的模型回退到 MOSS 清单，不会返回空列表', () => {
    expect(getBuiltinVoicesForModel('unknown-model')).toBe(MOSS_BUILTIN_VOICES)
    expect(getBuiltinVoicesForModel(undefined)).toBe(MOSS_BUILTIN_VOICES)
    expect(getBuiltinVoicesForModel('')).toBe(MOSS_BUILTIN_VOICES)
  })

  it('VITS 音色使用整数 speaker id', () => {
    for (const modelId of Object.values(VITS_MODEL_IDS)) {
      for (const item of getBuiltinVoicesForModel(modelId)) {
        expect(item.voice).toMatch(/^\d+$/)
        expect(item.displayName.length).toBeGreaterThan(0)
        expect(item.group.length).toBeGreaterThan(0)
      }
    }
  })

  it('跨模型音色被判为非法并回退（不把 MOSS 音色名送给 VITS）', () => {
    const result = resolveVoiceForModel(VITS_MODEL_IDS.THERESA, 'Junhao', 'Junhao')
    expect(result.substituted).toBe(true)
    expect(result.requested).toBe('Junhao')
    expect(result.voice).toMatch(/^\d+$/)
  })

  it('反向跨界同样回退（不把 VITS 的 sid 送给 MOSS）', () => {
    const result = resolveVoiceForModel(MOSS_MODEL_ID, '12', '12')
    expect(result.substituted).toBe(true)
    expect(isBuiltinVoice(result.voice)).toBe(true)
  })

  it('同模型内的合法音色原样透传', () => {
    const result = resolveVoiceForModel(VITS_MODEL_IDS.THERESA, '35', '0')
    expect(result).toEqual({ voice: '35', substituted: false, requested: '35' })
  })
})

