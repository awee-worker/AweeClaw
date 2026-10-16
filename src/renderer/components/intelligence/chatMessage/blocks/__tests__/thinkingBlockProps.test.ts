import { describe, it, expect } from 'vitest'
import { thinkingBlockPropsEqual } from '../ThinkingBlockView'

/**
 * 思考块的 memo 比较函数
 *
 * 这组用例锁定的是一条曾导致线上冻结的回归：比较时忽略 content 会让
 * React.memo 命中 bailout，整棵子树被跳过，子组件 ThinkingStreamText 拿不到
 * 新的 content，思考过程只显示第一块内容后卡死。
 */
describe('thinkingBlockPropsEqual', () => {
  const base = {
    content: '第一块思考内容',
    startTime: 1000,
    isStreaming: true,
    isActiveTail: true,
    fontSize: 14,
  }

  it('内容增长时必须判定为不等，保证子组件拿到新 props', () => {
    expect(thinkingBlockPropsEqual(base, { ...base, content: '第一块思考内容第二块' })).toBe(false)
  })

  it('内容只增加长度不改变其它字段时仍判定为不等', () => {
    const next = { ...base, content: base.content + 'x' }
    expect(thinkingBlockPropsEqual(base, next)).toBe(false)
  })

  it('完全相同的 props 判定为相等，避免无谓重渲染', () => {
    expect(thinkingBlockPropsEqual(base, { ...base })).toBe(true)
  })

  it('内容清空（回退）判定为不等', () => {
    expect(thinkingBlockPropsEqual(base, { ...base, content: '' })).toBe(false)
  })

  it('流式状态翻转判定为不等', () => {
    expect(thinkingBlockPropsEqual(base, { ...base, isStreaming: false })).toBe(false)
  })

  it('活跃尾部翻转判定为不等', () => {
    expect(thinkingBlockPropsEqual(base, { ...base, isActiveTail: false })).toBe(false)
  })

  it('字号变化判定为不等', () => {
    expect(thinkingBlockPropsEqual(base, { ...base, fontSize: 16 })).toBe(false)
  })

  it('startTime 变化判定为不等', () => {
    expect(thinkingBlockPropsEqual(base, { ...base, startTime: 2000 })).toBe(false)
  })
})
