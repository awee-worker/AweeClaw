/**
 * 会话连贯性回归测试
 *
 * 覆盖两类会让「AI 不记得自己刚才回复了什么」的缺陷：
 * 1. 运行时状态（待办清单等）被当成一轮 assistant 消息插入历史 —— 模型的「上一轮
 *    回复」变成应用状态快照，真正的回复被顶掉，话题也被过期待办带走。
 * 2. 懒加载线程的消息条数被写成 0，随后该会话被判成「已加载且为空」，历史再也读不
 *    出来，请求里只剩一条当前消息。
 */

import { describe, it, expect } from 'vitest'
import type { ChatMessage, TodoItem } from '@intelligence/providerTypes'

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

const REPLY = '登录功能已完成：新建了 auth.ts，并在 router 里挂上了 /login。'

const USER_TURN_1 = { id: 'u1', role: 'user', content: '帮我实现登录功能', timestamp: 1 }
const ASSISTANT_TURN_1 = {
  id: 'a1',
  role: 'assistant',
  content: REPLY,
  timestamp: 2,
  isStreaming: false,
  parts: [{ type: 'text', content: REPLY }],
  toolCalls: [],
}

function todo(content: string, status: TodoItem['status']): TodoItem {
  return { content, status, activeForm: content }
}

async function assembleWith(runtimeState: Record<string, unknown>) {
  patchGlobals()
  const { MessageAssembler } = await import('../MessageBuilder')
  const assembler = new MessageAssembler()

  const userContent = assembler.assembleUserMessage('再帮我加上记住我', '')
  const history = [USER_TURN_1, ASSISTANT_TURN_1] as unknown as ChatMessage[]

  return assembler.assemble(history, userContent, 'SYSTEM', 0, runtimeState)
}

describe('运行时状态不得顶掉上一轮助手回复', () => {
  it('上一轮回复仍是最后一条 assistant 消息', async () => {
    const result = await assembleWith({
      todos: [todo('实现登录功能', 'completed'), todo('加上记住我', 'pending')],
    })

    const assistantMessages = result.messages.filter(m => m.role === 'assistant')
    const lastAssistant = String(assistantMessages[assistantMessages.length - 1]?.content ?? '')

    expect(lastAssistant).toContain('auth.ts')
    expect(lastAssistant).not.toContain('Application Runtime State')
  })

  it('未完成待办作为当前用户消息的前置说明下发', async () => {
    const result = await assembleWith({ todos: [todo('加上记住我', 'pending')] })

    const lastMessage = result.messages[result.messages.length - 1]
    const sent = Array.isArray(lastMessage.content)
      ? lastMessage.content.map(part => (part as { text?: string }).text || '').join('')
      : String(lastMessage.content ?? '')

    expect(lastMessage.role).toBe('user')
    expect(sent).toContain('Open Task List')
    expect(sent).toContain('加上记住我')
    expect(sent).toContain('再帮我加上记住我')
  })

  it('待办全部完成时不注入，避免把话题带回早已结束的任务', async () => {
    const result = await assembleWith({
      todos: [todo('实现登录功能', 'completed'), todo('补测试', 'completed')],
    })

    const joined = result.messages.map(m => String(m.content ?? '')).join('\n')
    expect(joined).not.toContain('Open Task List')
    expect(joined).not.toContain('补测试')
  })
})

describe('懒加载线程的条数与加载判定', () => {
  it('消息未载入时不把 message_count 清成 0，并透传载入标记', async () => {
    patchGlobals()
    const { toPersistedChatThread } = await import('@intelligence/types/dialogThreadModel')

    const lazyThread = {
      id: 't1',
      createdAt: 1,
      lastModified: 1,
      messages: [],
      messagesHydrated: false,
      messageCount: 42,
      contextItems: [],
      contextSummary: null,
    } as never

    const persisted = toPersistedChatThread(lazyThread)
    expect(persisted.messageCount).toBe(42)
    expect(persisted.messagesHydrated).toBe(false)
  })

  it('已载入时以内存消息为准', async () => {
    patchGlobals()
    const { toPersistedChatThread } = await import('@intelligence/types/dialogThreadModel')

    const persisted = toPersistedChatThread({
      id: 't2',
      createdAt: 1,
      lastModified: 1,
      messages: [USER_TURN_1],
      messagesHydrated: true,
      contextItems: [],
      contextSummary: null,
    } as never)

    expect(persisted.messageCount).toBe(1)
    expect(persisted.messagesHydrated).toBe(true)
  })

  it('message_count 为 0 的历史线程仍须按需加载消息', async () => {
    patchGlobals()
    const { fromPersistedChatThread } = await import('@intelligence/types/dialogThreadModel')

    const restored = fromPersistedChatThread({
      id: 't3',
      createdAt: 1,
      lastModified: 1,
      messages: [],
      contextItems: [],
      messageCount: 0,
      contextSummary: null,
    })

    expect(restored.messagesHydrated).toBe(false)
  })

  it('已带消息的线程直接视为已载入', async () => {
    patchGlobals()
    const { fromPersistedChatThread } = await import('@intelligence/types/dialogThreadModel')

    const restored = fromPersistedChatThread({
      id: 't4',
      createdAt: 1,
      lastModified: 1,
      messages: [USER_TURN_1, ASSISTANT_TURN_1],
      contextItems: [],
      messageCount: 2,
      contextSummary: null,
    } as never)

    expect(restored.messagesHydrated).toBe(true)
    expect(restored.messages).toHaveLength(2)
  })
})
