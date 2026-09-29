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

  it('上一轮回复很长且被工具轮次拆成多条 → 衔接说明带上完整要点与待处理清单', async () => {
    patchGlobals()
    const { buildPendingQuestionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const thread = threadWith([
      { id: 'u1', role: 'user', content: '帮我检查一下这个项目', timestamp: 1 },
      {
        id: 'a1',
        role: 'assistant',
        content: [
          '我扫描了主要模块，发现 3 个问题：',
          '- 登录接口没有做参数校验',
          '- 上传目录缺少大小限制',
          '- 日志里会打印用户手机号',
        ].join('\n'),
        timestamp: 2,
        isStreaming: false,
        parts: [],
        toolCalls: [{ id: 't1', name: 'read_file', arguments: {} }],
      },
      { id: 't1', role: 'tool', toolCallId: 't1', name: 'read_file', content: '文件内容…', timestamp: 3 },
      {
        id: 'a2',
        role: 'assistant',
        content: '以上就是本次检查结果。要不要我一并处理？',
        timestamp: 4,
        isStreaming: false,
        parts: [],
        toolCalls: [],
      },
    ] as unknown as ChatMessage[])

    const notice = buildPendingQuestionNotice(thread, '要一并处理', 'zh')

    expect(notice).toBeTruthy()
    // 提问原文仍在
    expect(notice).toContain('要不要我一并处理？')
    // 「要处理什么」不再丢失：清单被单独带出
    expect(notice).toContain('登录接口没有做参数校验')
    expect(notice).toContain('日志里会打印用户手机号')
  })

  it('指代型回复（超简短确认长度）→ 仍附加上一轮内容', async () => {
    patchGlobals()
    const { buildPendingQuestionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const thread = threadWith([USER_REQUEST, ASSISTANT_QUESTION] as unknown as ChatMessage[])
    // 17 个有效字符，超出「简短确认」上限，但含「上面 / 那些 / 一并」指代词
    const notice = buildPendingQuestionNotice(thread, '把上面说的那些问题一并处理了吧', 'zh')

    expect(notice).toBeTruthy()
    expect(notice).toContain('要不要我继续实现注册功能？')
  })

  it('指代型否定回复 → 不附加', async () => {
    patchGlobals()
    const { buildPendingQuestionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const thread = threadWith([USER_REQUEST, ASSISTANT_QUESTION] as unknown as ChatMessage[])
    expect(buildPendingQuestionNotice(thread, '这些都不用处理了', 'zh')).toBeNull()
  })

  it('静默注入的 hidden 用户消息不作为「上一轮请求」', async () => {
    patchGlobals()
    const { buildPendingQuestionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const thread = threadWith([
      { id: 'u1', role: 'user', content: '帮我实现登录功能', timestamp: 1 },
      ASSISTANT_QUESTION,
      { id: 'u2', role: 'user', content: '项目上下文：xxx', timestamp: 3, hidden: true },
    ] as unknown as ChatMessage[])

    const notice = buildPendingQuestionNotice(thread, '要', 'zh')
    expect(notice).toBeTruthy()
    // 请求应回溯到真实用户消息，而不是静默注入的上下文
    expect(notice).toContain('帮我实现登录功能')
    expect(notice).not.toContain('项目上下文：xxx')
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

describe('衔接说明静默注入（不进用户气泡）', () => {
  it('agentContext 拼进请求，但用户消息对象本身仍是用户输入', async () => {
    patchGlobals()
    const { MessageAssembler } = await import('../MessageBuilder')
    const assembler = new MessageAssembler()

    const history = [
      USER_REQUEST,
      ASSISTANT_QUESTION,
      { id: 'u2', role: 'user', content: '要', timestamp: 3 },
    ] as unknown as ChatMessage[]

    const notice = '## 上下文衔接（自动附加）\n用户本次回复是对上一条提问的简短确认。'
    const userContent = assembler.assembleUserMessage('要', '', notice)

    // 原始内容未被改写：气泡/历史里保存的仍是用户输入
    expect(userContent.raw).toBe('要')

    const assembled = assembler.assemble(history, userContent, 'SYSTEM', 0)
    const lastMessage = assembled.messages[assembled.messages.length - 1]
    const sent = Array.isArray(lastMessage.content)
      ? lastMessage.content.map(part => (part as { text?: string }).text || '').join('')
      : String(lastMessage.content ?? '')

    // 发给模型的请求里带有说明
    expect(sent).toContain('上下文衔接（自动附加）')
  })

  it('无 agentContext 时不产生额外前缀（纯文本请求保持原样）', async () => {
    patchGlobals()
    const { MessageAssembler } = await import('../MessageBuilder')
    const assembler = new MessageAssembler()

    const userContent = assembler.assembleUserMessage('帮我实现登录功能', '')
    expect(userContent.combined).toBe('帮我实现登录功能')
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

describe('选项交互的回答衔接', () => {
  /** 一条带选项的助手消息：提问走 ask_user，正文为空，选项在 interactive 上 */
  const ASSISTANT_OPTIONS = {
    id: 'a2',
    role: 'assistant',
    content: '',
    timestamp: 2,
    isStreaming: false,
    parts: [],
    toolCalls: [],
    interactive: {
      type: 'interactive',
      question: '这次想先做哪个模块？',
      options: [
        { id: 'auth', label: '账号体系' },
        { id: 'order', label: '订单模块' },
      ],
      multiSelect: false,
    },
  }

  it('点选单个选项 → 说明里同时带提问原文与选中项', async () => {
    patchGlobals()
    const { buildInteractiveSelectionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const notice = buildInteractiveSelectionNotice(
      threadWith([USER_REQUEST, ASSISTANT_OPTIONS] as unknown as ChatMessage[]),
      '订单模块',
      'zh',
    )

    expect(notice).toBeTruthy()
    expect(notice).toContain('这次想先做哪个模块？')
    expect(notice).toContain('用户选择了：订单模块')
  })

  it('多选（逗号拼接）→ 命中全部选中项', async () => {
    patchGlobals()
    const { buildInteractiveSelectionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const thread = threadWith([
      USER_REQUEST,
      { ...ASSISTANT_OPTIONS, interactive: { ...ASSISTANT_OPTIONS.interactive, multiSelect: true } },
    ] as unknown as ChatMessage[])

    const notice = buildInteractiveSelectionNotice(thread, '账号体系, 订单模块', 'zh')
    expect(notice).toContain('账号体系、订单模块')
  })

  it('自由作答（不在选项内）→ 仍带提问原文，并标注为非选项', async () => {
    patchGlobals()
    const { buildInteractiveSelectionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const notice = buildInteractiveSelectionNotice(
      threadWith([USER_REQUEST, ASSISTANT_OPTIONS] as unknown as ChatMessage[]),
      '先把支付接上',
      'zh',
    )

    expect(notice).toContain('这次想先做哪个模块？')
    expect(notice).toContain('不属于上面给出的选项')
  })

  it('最后一条助手消息不带选项（更早的带）→ 不附加', async () => {
    patchGlobals()
    const { buildInteractiveSelectionNotice } = await import('@intelligence/utils/pendingQuestionContext')

    const thread = threadWith([
      USER_REQUEST,
      ASSISTANT_OPTIONS,
      { id: 'a3', role: 'assistant', content: '好的，已开始。', timestamp: 3, parts: [], toolCalls: [] },
    ] as unknown as ChatMessage[])

    expect(buildInteractiveSelectionNotice(thread, '订单模块', 'zh')).toBeNull()
  })
})
