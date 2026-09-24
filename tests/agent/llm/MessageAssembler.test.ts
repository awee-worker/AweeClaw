import { describe, expect, it } from 'vitest'
import { MessageAssembler } from '@intelligence/capabilities/message'
import type { ChatMessage } from '@intelligence/types'

describe('MessageAssembler', () => {
  it('attaches runtime state to the current user turn instead of a fake assistant turn', () => {
    const assembler = new MessageAssembler()
    const history: ChatMessage[] = []

    const result = assembler.assemble(
      history,
      assembler.assembleUserMessage('继续处理上下文压缩', ''),
      'stable system prompt',
      0,
      {
        handoffContext: '## Session Resume Context\nCarry over previous work.',
        pendingObjective: '修复上下文续接',
        pendingSteps: ['补齐最新消息', '补齐任务列表'],
        todos: [
          { content: '补齐最新消息', activeForm: '正在补齐最新消息', status: 'in_progress' },
        ],
      }
    )

    expect(result.messages[0]).toMatchObject({
      role: 'system',
      content: 'stable system prompt',
    })

    // 运行时状态跟随用户消息下发：插成 assistant 轮次会让模型把状态快照当成
    // 自己刚给出的回复，从而丢掉上一轮真正的回答。
    expect(result.messages).toHaveLength(2)
    const lastMessage = result.messages[1]
    expect(lastMessage).toMatchObject({ role: 'user' })

    const sent = Array.isArray(lastMessage.content)
      ? lastMessage.content.map(part => (part as { text?: string }).text ?? '').join('')
      : String(lastMessage.content)
    expect(sent).toContain('## Application Runtime State')
    expect(sent).toContain('## Session Resume Context')
    expect(sent).toContain('## Runtime Task State')
    expect(sent).toContain('## Open Task List')
    expect(sent).toContain('继续处理上下文压缩')
  })
})
