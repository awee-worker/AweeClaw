import { describe, expect, it } from 'vitest'
import type { ToolCall } from '@intelligence/providerTypes'
import { reuseToolCallsIfUnchanged } from '../toolCallsArrayReuse'

/** 构造一个身份稳定的工具调用桩：本模块只比较引用，不看字段 */
function makeToolCall(id: string): ToolCall {
  return { id, name: 'read_file', arguments: {}, status: 'success' } as unknown as ToolCall
}

describe('reuseToolCallsIfUnchanged', () => {
  it('首次渲染（无上一轮数组）时直接采用新数组', () => {
    const next = [makeToolCall('a')]
    expect(reuseToolCallsIfUnchanged(undefined, next)).toBe(next)
  })

  it('元素逐个相同时沿用旧引用，保住下游 memo', () => {
    const a = makeToolCall('a')
    const b = makeToolCall('b')
    const previous = [a, b]
    // 模拟 _doAppendToAssistant：数组重建，元素身份不变
    const next = [a, b]

    expect(next).not.toBe(previous)
    expect(reuseToolCallsIfUnchanged(previous, next)).toBe(previous)
  })

  it('长度变化时采用新数组（追加了新工具）', () => {
    const a = makeToolCall('a')
    const b = makeToolCall('b')
    const previous = [a]
    const next = [a, b]
    expect(reuseToolCallsIfUnchanged(previous, next)).toBe(next)
  })

  it('长度缩短时采用新数组（工具被移除）', () => {
    const a = makeToolCall('a')
    const b = makeToolCall('b')
    const previous = [a, b]
    const next = [a]
    expect(reuseToolCallsIfUnchanged(previous, next)).toBe(next)
  })

  it('同位置元素身份变化时采用新数组（工具状态被重建）', () => {
    const a1 = makeToolCall('a')
    const a2 = makeToolCall('a')
    const previous = [a1]
    const next = [a2]
    expect(reuseToolCallsIfUnchanged(previous, next)).toBe(next)
  })

  it('两轮都为空数组时沿用旧引用', () => {
    const previous: ToolCall[] = []
    expect(reuseToolCallsIfUnchanged(previous, [])).toBe(previous)
  })

  it('重复调用是幂等的（回收后再次回收仍得同一引用）', () => {
    const a = makeToolCall('a')
    const previous = [a]
    const next = [a]
    const once = reuseToolCallsIfUnchanged(previous, next)
    expect(reuseToolCallsIfUnchanged(previous, once)).toBe(previous)
  })
})
