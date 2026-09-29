import { describe, expect, it } from 'vitest'
import type { AssistantPart, ToolCall } from '@intelligence/providerTypes'
import { buildAssistantGroups, toolGroupKey } from '../assistantGrouping'

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

  it('工具调用之间的空白文本不打断工具组连续性', () => {
    // 工具调用前的文本缓冲区 flush 可能留下空行或换行，
    // 这类 part 不产生可见 DOM，不应把连续工具调用拆成多个单工具组
    const groups = buildAssistantGroups([
      toolPart('a'),
      textPart('\n'),
      toolPart('b'),
      textPart('  '),
      toolPart('c'),
    ])

    expect(shapeOf(groups)).toEqual(['tools:a,b,c@0'])
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

  it('parts 完整时，预览组的 startIndex 与正式化后的下标一致', () => {
    // 前提是文本已全部写入 parts。文本若还压在 StreamingBuffer 里，正式化前会先
    // flush 出一个 text part，下标随之位移 —— 分组身份不能依赖 startIndex，
    // 渲染 key 走 toolGroupKey，见下一个用例。
    const parts = [reasoningPart('现在创建 b')]
    const preview = [makeToolCall('b')]

    const previewed = buildAssistantGroups(parts, preview)
    // 工具正式写入 parts 尾部的下标即 1，与预览组的 startIndex 一致
    const persisted = buildAssistantGroups([...parts, toolPart('b')])

    expect(shapeOf(previewed)).toEqual(['reasoning@0', 'tools:b@1'])
    expect(shapeOf(persisted)).toEqual(['reasoning@0', 'tools:b@1'])
  })

  it('文本缓冲区 flush 导致下标位移时，工具组的渲染标识保持不变', () => {
    // 回归场景：流式文本尚未写入 parts，工具先以预览出现（落位 parts.length = 0）；
    // 正式化时先 flush 出 text part，工具组的 startIndex 变成 1。
    // 渲染 key 若取 startIndex，这一步会把同一个组判定成换了元素，整组卡片卸载重建，
    // 表现为卡片闪一下、会话内容跳动。
    const previewed = buildAssistantGroups([], [makeToolCall('b')])
    const persisted = buildAssistantGroups([textPart('现在创建 b'), toolPart('b')])

    const previewedGroup = previewed[0]
    const persistedGroup = persisted[1]
    if (previewedGroup.type !== 'tool_group' || persistedGroup.type !== 'tool_group') {
      throw new Error('预期两侧的首个渲染单元都是工具组')
    }

    // 下标确实位移了……
    expect(previewedGroup.startIndex).toBe(0)
    expect(persistedGroup.startIndex).toBe(1)
    // ……但渲染标识不变，工具卡片得以复用同一份 DOM
    expect(toolGroupKey(previewedGroup)).toBe(toolGroupKey(persistedGroup))
  })

  it('收尾后内容为空的推理块（渲染为 null）不打断工具组连续性', () => {
    // 回归场景：工具执行期间推理块收尾后 content 为空，ReasoningPartView 返回 null，
    // 不占 DOM。若仍按「内容间断」处理，连续工具调用会被切成多个单工具组，
    // 用户先看到几张独立卡片、随后又重新并组 —— 表现为卡片跳动。
    const groups = buildAssistantGroups([
      toolPart('a'),
      reasoningPart(''),
      toolPart('b'),
      reasoningPart('   '),
      toolPart('c'),
    ])

    expect(shapeOf(groups)).toEqual(['tools:a,b,c@0'])
  })

  it('流式中的空推理块是可见内容，会正常打断工具组', () => {
    // 与上一条相对：流式中的推理块会渲染「思考中」骨架，占 DOM，
    // 因此必须切断工具组，否则工具卡片会排到思考块上方，顺序颠倒。
    const streamingReasoning = {
      type: 'reasoning',
      content: '',
      isStreaming: true,
    } as unknown as AssistantPart

    const groups = buildAssistantGroups([toolPart('a'), streamingReasoning, toolPart('b')])

    expect(shapeOf(groups)).toEqual(['tools:a@0', 'reasoning@1', 'tools:b@2'])
  })

  it('注册表里不渲染的搜索 / 多智能体工作流片段不打断工具组连续性', () => {
    const searchPart = { type: 'search' } as unknown as AssistantPart
    const workflowPart = { type: 'multi_agent_workflow' } as unknown as AssistantPart

    const groups = buildAssistantGroups([
      toolPart('a'),
      searchPart,
      toolPart('b'),
      workflowPart,
      toolPart('c'),
    ])

    expect(shapeOf(groups)).toEqual(['tools:a,b,c@0'])
  })
})
