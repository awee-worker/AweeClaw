/**
 * 上下文衔接回归测试
 *
 * 覆盖「AI 执行完成后提问 → 用户只回一句『要』」这一场景下的上下文保真：
 * 1. 简短确认时自动附加上一条助手提问（pendingQuestionContext）
 * 2. 助手 content 为空但存在提问（interactive / ask_user）时消息不被丢弃
 * 3. 消息组装后上一条助手提问仍存在于发给 LLM 的历史中
 */

import { describe, it, expect } from 'vitest'
import type { ChatMessage } from '@intelligence/providerTypes'

/** store/providerTypes 链路会在模块级触碰 window/document，这里补最小桩 */
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

const USER_REQUEST = { id: 'u1', role: 'user', content: '帮我实现登录功能', timestamp: 1 }

const ASSISTANT_QUESTION = {
  id: 'a1',
  role: 'assistant',
  content: '登录功能已完成。要不要我继续实现注册功能？',
  timestamp: 2,
  isStreaming: false,
  parts: [],
  toolCalls: [],
}

function threadWith(messages: ChatMessage[]) {
  return { id: 't1', messages } as never
}

describe('待确认提问的上下文衔接', () => {
  it('简短肯定回复 → 附加提问原文', async () => {
    patchGlobals()
    const { buildPendingQuestionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const notice = buildPendingQuestionNotice(
      threadWith([USER_REQUEST, ASSISTANT_QUESTION] as unknown as ChatMessage[]),
      '要',
      'zh',
    )

    expect(notice).toBeTruthy()
    expect(notice).toContain('要不要我继续实现注册功能？')
  })

  it('否定/收尾回复 → 不附加', async () => {
    patchGlobals()
    const { buildPendingQuestionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const thread = threadWith([USER_REQUEST, ASSISTANT_QUESTION] as unknown as ChatMessage[])
    expect(buildPendingQuestionNotice(thread, '不用了', 'zh')).toBeNull()
    expect(buildPendingQuestionNotice(thread, 'no thanks', 'en')).toBeNull()
  })

  it('用户发送完整表述 → 不附加', async () => {
    patchGlobals()
    const { buildPendingQuestionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const thread = threadWith([USER_REQUEST, ASSISTANT_QUESTION] as unknown as ChatMessage[])
    expect(
      buildPendingQuestionNotice(thread, '帮我再补一个找回密码的页面', 'zh'),
    ).toBeNull()
  })

  it('上一条助手消息不是提问 → 不附加', async () => {
    patchGlobals()
    const { buildPendingQuestionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const thread = threadWith([
      USER_REQUEST,
      { ...ASSISTANT_QUESTION, content: '登录功能已完成。' },
    ] as unknown as ChatMessage[])

    expect(buildPendingQuestionNotice(thread, '要', 'zh')).toBeNull()
  })

  it('提问走 ask_user（content 为空 + interactive）→ 仍能还原提问', async () => {
    patchGlobals()
    const { buildPendingQuestionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const thread = threadWith([
      USER_REQUEST,
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        isStreaming: false,
        parts: [],
        toolCalls: [],
        interactive: {
          type: 'interactive',
          question: '要不要我继续实现注册功能？',
          options: [{ id: 'yes', label: '要' }],
        },
      },
    ] as unknown as ChatMessage[])

    const notice = buildPendingQuestionNotice(thread, '要', 'zh')
    expect(notice).toBeTruthy()
    expect(notice).toContain('要不要我继续实现注册功能？')
  })
})

describe('助手提问消息在历史转换中不被丢弃', () => {
  it('content 为空但存在 interactive 提问 → 保留为 assistant 文本', async () => {
    patchGlobals()
    const { buildLLMApiMessages } = await import('../MessageAdapter')

    const messages = [
      USER_REQUEST,
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        timestamp: 2,
        isStreaming: false,
        parts: [],
        toolCalls: [],
        interactive: {
          type: 'interactive',
          question: '要不要我继续实现注册功能？',
          options: [{ id: 'yes', label: '要' }],
        },
      },
      { id: 'u2', role: 'user', content: '要', timestamp: 3 },
    ] as unknown as ChatMessage[]

    const result = buildLLMApiMessages(messages)
    const assistantTexts = result.filter(m => m.role === 'assistant').map(m => String(m.content ?? ''))

    expect(assistantTexts.join('\n')).toContain('要不要我继续实现注册功能？')
  })
})

describe('消息组装保留上一条助手提问', () => {
  it('history 含当前用户消息时，提问仍在最终消息序列中', async () => {
    patchGlobals()
    const { MessageAssembler } = await import('../MessageBuilder')
    const assembler = new MessageAssembler()

    const history = [
      USER_REQUEST,
      ASSISTANT_QUESTION,
      { id: 'u2', role: 'user', content: '要', timestamp: 3 },
    ] as unknown as ChatMessage[]

    const userContent = assembler.assembleUserMessage('要', '')
    const assembled = assembler.assemble(history, userContent, 'SYSTEM', 0)

    const joined = assembled.messages.map(m => String(m.content ?? '')).join('\n')
    expect(joined).toContain('要不要我继续实现注册功能？')
    // 组装后仅追加一条当前用户消息（不产生重复用户气泡）
    expect(assembled.messages.filter(m => m.role === 'user')).toHaveLength(2)
  })
})
