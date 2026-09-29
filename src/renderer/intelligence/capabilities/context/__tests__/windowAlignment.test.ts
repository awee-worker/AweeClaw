/**
 * 历史窗口回合对齐测试
 *
 * 覆盖 ContextCompressor 的窗口截断：起点必须对齐到回合起始（user 消息），
 * 避免切出孤立 tool 结果或丢掉本轮用户意图。
 */

import { describe, it, expect } from 'vitest'
import type { ChatMessage } from '@intelligence/providerTypes'
import { alignWindowStart, prepareMessages } from '../ContextCompressor'

/** store / 配置链路会在模块级触碰 window/document，这里补最小桩 */
function patchGlobals() {
  const g = globalThis as any
  if (typeof g.window === 'undefined') g.window = g
  const w = g.window as any
  w.addEventListener = w.addEventListener || (() => {})
  w.removeEventListener = w.removeEventListener || (() => {})
  w.dispatchEvent = w.dispatchEvent || (() => true)
  g.addEventListener = g.addEventListener || w.addEventListener
  g.removeEventListener = g.removeEventListener || w.removeEventListener
  g.dispatchEvent = g.dispatchEvent || w.dispatchEvent
  w.electronAPI = makeAnyProxy()

  if (typeof g.document === 'undefined') {
    g.document = {
      addEventListener: () => {},
      removeEventListener: () => {},
      visibilityState: 'visible',
      hidden: false,
      createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }),
      head: { appendChild: () => {} },
      body: { appendChild: () => {} },
    }
  }
}

/** 递归万能代理：任意层级属性可访问、可调用 */
function makeAnyProxy(): any {
  const target: any = () => makeAnyProxy()
  return new Proxy(target, {
    get: (_t, key) => {
      if (key === 'then' || key === 'catch' || key === 'finally') return undefined
      if (key === Symbol.toPrimitive) return () => ''
      if (key === 'toString' || key === 'valueOf') return () => ''
      if (key === Symbol.toStringTag) return 'AnyProxy'
      return makeAnyProxy()
    },
    apply: () => makeAnyProxy(),
    has: () => true,
  })
}

/** 仅带 role 的轻量序列，用于纯函数对齐测试 */
function seq(...roles: string[]) {
  return roles.map((role) => ({ role }))
}

const user = (id: string): ChatMessage =>
  ({ id, role: 'user', content: 'hi', timestamp: 1 } as unknown as ChatMessage)

const assistant = (id: string, withToolCalls = false): ChatMessage =>
  ({
    id,
    role: 'assistant',
    content: '',
    timestamp: 1,
    parts: [],
    toolCalls: withToolCalls ? [{ id: 'c1', name: 'x', arguments: {} }] : [],
  } as unknown as ChatMessage)

const tool = (id: string): ChatMessage =>
  ({ id, role: 'tool', toolCallId: 'c1', name: 'x', content: 'r', timestamp: 1 } as unknown as ChatMessage)

describe('alignWindowStart 回合对齐规则', () => {
  it('起点已是 user → 原样返回', () => {
    const m = seq('assistant', 'user', 'assistant')
    expect(alignWindowStart(m, 1, 10)).toBe(1)
  })

  it('start <= 0 → 0', () => {
    expect(alignWindowStart(seq('user'), 0, 10)).toBe(0)
    expect(alignWindowStart(seq('user'), -3, 10)).toBe(0)
  })

  it('起点是 assistant → 回退到该回合的 user', () => {
    const m = seq('user', 'assistant', 'tool', 'assistant', 'assistant')
    expect(alignWindowStart(m, 3, 10)).toBe(0)
  })

  it('起点是 tool → 回退到 user，不产生孤立工具结果', () => {
    const m = seq('user', 'assistant', 'user', 'assistant', 'tool', 'tool')
    expect(alignWindowStart(m, 4, 10)).toBe(2)
  })

  it('回退距离受 maxLookback 限制，超出则跳过开头孤立 tool', () => {
    // 索引 2..4 内无 user → 兜底从起点向后跳过 tool，落到 index 6 的 assistant
    const m = seq('assistant', 'tool', 'assistant', 'tool', 'assistant', 'tool', 'assistant', 'user')
    expect(alignWindowStart(m, 5, 3)).toBe(6)
  })
})

describe('prepareMessages 窗口截断对齐到回合起始', () => {
  it('截断起点落在 assistant → 前移到该回合的 user 起点', () => {
    patchGlobals()
    // 18 条，L3 条数限额 15 → 原起点 3 落在 assistant 上
    const messages: ChatMessage[] = [
      user('u1'), assistant('a1'), user('u2'), assistant('a2'), tool('t1'),
      assistant('a3'), user('u3'), assistant('a4'), tool('t2'),
      user('u4'), assistant('a5'), tool('t3'),
      user('u5'), assistant('a6'), tool('t4'),
      user('u6'), assistant('a7'), user('u7'),
    ]

    const result = prepareMessages(messages, 3)

    // 起点前移到 index 2 的 user，窗口以 user 开头，回合完整
    expect(result.messages[0].id).toBe('u2')
    expect(result.messages.length).toBe(16)
    expect(result.removedMessages).toBe(2)
  })

  it('截断起点落在 tool → 前移到 user，窗口不以孤立工具结果开头', () => {
    patchGlobals()
    // 18 条，L3 限额 15 → 原起点 3 落在 tool 上
    const messages: ChatMessage[] = [
      user('u1'), assistant('a1', true), tool('t1'), tool('t2'), assistant('a2'),
      user('u2'), assistant('a3'), tool('t3'),
      user('u3'), assistant('a4'), tool('t4'),
      user('u4'), assistant('a5'), tool('t5'),
      user('u5'), assistant('a6'), tool('t6'),
      user('u6'),
    ]

    const result = prepareMessages(messages, 3)

    // 起点前移到 index 0 的 user，窗口首条不是孤立 tool 结果
    expect(result.messages[0].role).toBe('user')
    expect(result.messages[0].id).toBe('u1')
    expect(result.messages).toHaveLength(18)
  })
})
