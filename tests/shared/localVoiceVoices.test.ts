/**
 * MOSS 内置音色清单与音色解析测试
 *
 * 回归背景：设置面板曾把 Provider 音色 `Xiaoxiao` 作为内置音色提供，
 * 一旦被保存为 `tts.defaultVoice`，离线合成会在 Python 侧报
 * 「Built-in voice not found: Xiaoxiao」，在「仅本地」优先级下
 * 表现为「点击播报毫无反应」。因此音色解析必须保证：永不返回非法值。
 */

import { describe, it, expect } from 'vitest'
import {
  MOSS_BUILTIN_VOICES,
  DEFAULT_BUILTIN_VOICE,
  isBuiltinVoice,
  resolveBuiltinVoice,
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
