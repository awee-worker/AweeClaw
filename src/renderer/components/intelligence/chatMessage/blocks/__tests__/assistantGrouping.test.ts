import { describe, expect, it } from 'vitest'
import type { AssistantPart, ToolCall } from '@intelligence/providerTypes'
import { buildAssistantGroups } from '../assistantGrouping'

function makeToolCall(id: string, name = 'create_file_or_folder'): ToolCall {
  return { id, name, arguments: {}, status: 'success' } as unknown as ToolCall
}

function toolPart(id: string, name = 'create_file_or_folder'): AssistantPart {
  return { type: 'tool_call', toolCall: makeToolCall(id, name) } as unknown as AssistantPart
}

function reasoningPart(content: string): AssistantPart {
  return { type: 'reasoning', content } as unknown as AssistantPart
}

function textPart(content: string): AssistantPart {
  return { type: 'text', content } as unknown as AssistantPart
}

/** 取分组的可读形状，便于断言渲染顺序 */
function shapeOf(groups: ReturnType<typeof buildAssistantGroups>) {
  return groups.map(g => {
    if (g.type === 'tool_group') return `tools:${g.toolCalls.map(tc => tc.id).join(',')}@${g.startIndex}`
    if (g.type === 'todo_list') return `todo@${g.index}`
    return `${g.part.type}@${g.index}`
  })
}

describe('buildAssistantGroups', () => {
  it('连续的普通工具调用合并为一个工具组', () => {
    const groups = buildAssistantGroups([toolPart('a'), toolPart('b')])

    expect(shapeOf(groups)).toEqual(['tools:a,b@0'])
  })

  it('非连续的相同工具不会被合进同一个组', () => {
    const groups = buildAssistantGroups([
      toolPart('a'),
      textPart('继续'),
      toolPart('b'),
    ])

    expect(shapeOf(groups)).toEqual(['tools:a@0', 'text@1', 'tools:b@2'])
  })

  it('todo_write 抽成任务列表组，不进入相邻工具组', () => {
    const todos = [{ content: '写文档', status: 'pending', activeForm: '正在写文档' }]
    const todoPart = {
      type: 'tool_call',
      toolCall: { id: 't', name: 'todo_write', arguments: { todos }, status: 'success' },
    } as unknown as AssistantPart

    const groups = buildAssistantGroups([toolPart('a'), todoPart, toolPart('b')])

    expect(shapeOf(groups)).toEqual(['tools:a@0', 'todo@1', 'tools:b@2'])
  })

  it('末尾不是工具组时，预览工具另起一组排在内容之后', () => {
    // 回归场景：已完成 a → 思考「现在创建 b」→ b 的预览出现。
    // 预览若并进第一个工具组，渲染顺序会变成「a、b → 思考」，与时间线相反。
    const parts = [toolPart('a'), reasoningPart('现在创建 b')]
    const preview = [makeToolCall('b', 'create_file_or_folder')]

    expect(shapeOf(buildAssistantGroups(parts, preview))).toEqual([
      'tools:a@0',
      'reasoning@1',
      'tools:b@2',
    ])
  })

  it('末尾已是工具组时，预览并入该组（同一批连续调用）', () => {
    const parts = [toolPart('a')]
    const preview = [makeToolCall('b')]

    expect(shapeOf(buildAssistantGroups(parts, preview))).toEqual(['tools:a,b@0'])
  })

  it('末尾是任务列表时，预览同样另起一组', () => {
    const todos = [{ content: '写文档', status: 'in_progress', activeForm: '正在写文档' }]
    const todoPart = {
      type: 'tool_call',
      toolCall: { id: 't', name: 'todo_write', arguments: { todos }, status: 'success' },
    } as unknown as AssistantPart

    expect(shapeOf(buildAssistantGroups([todoPart], [makeToolCall('a')]))).toEqual([
      'todo@0',
      'tools:a@1',
    ])
  })

  it('没有 parts 时，预览组落在下标 0', () => {
    expect(shapeOf(buildAssistantGroups([], [makeToolCall('a')]))).toEqual(['tools:a@0'])
  })

  it('已写入 parts 的调用不再重复出现在预览组里', () => {
    const persisted = makeToolCall('a')
    const parts = [
      { type: 'tool_call', toolCall: persisted } as unknown as AssistantPart,
    ]

    expect(shapeOf(buildAssistantGroups(parts, [persisted]))).toEqual(['tools:a@0'])
  })

  it('新建预览组的 startIndex 等于 parts 长度，正式化后分组身份不变', () => {
    const parts = [reasoningPart('现在创建 b')]
    const preview = [makeToolCall('b')]

    const previewed = buildAssistantGroups(parts, preview)
    // 工具正式写入 parts 尾部的下标即 1，与预览组的 startIndex 一致
    const persisted = buildAssistantGroups([...parts, toolPart('b')])

    expect(shapeOf(previewed)).toEqual(['reasoning@0', 'tools:b@1'])
    expect(shapeOf(persisted)).toEqual(['reasoning@0', 'tools:b@1'])
  })
})
