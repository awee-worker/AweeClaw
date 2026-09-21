/**
 * 助手消息 Part 分组
 *
 * 把 Part 序列切成渲染单元：连续的工具调用合成一个工具组，todo_write 抽出为
 * 任务列表组（在文本流中对应位置渲染任务列表），其余 Part 各自成组。
 *
 * 分组顺序即渲染顺序，因此「流式预览工具落在哪一组」直接决定用户看到的先后。
 * 预览工具是尚未写入 parts 的调用（tool_call_start 之后、正式执行之前），
 * 若一律并进最后一个工具组，遇到「工具组 → 思考 → 新调用」这种序列时，
 * 新调用会被塞回前面的工具组，渲染成「两个工具一组 → 思考」——用户在思考里
 * 刚看到「现在创建 b.html」，卡片却出现在这条思考的上方，观感是倒序的。
 * 因此这里只在分组结果以工具组结尾时才并入，否则另起一组追加到末尾。
 *
 * @module chatMessage/blocks/assistantGrouping
 */

import type { AssistantPart, ToolCall, TodoItem } from '@intelligence/providerTypes'
import { isToolCallPart } from '@intelligence/providerTypes'
import type { AssistantGroupItem } from '../types'

/** 从 todo_write 工具调用参数中安全提取任务列表 */
function extractTodos(args: Record<string, unknown>): TodoItem[] {
  const raw = args.todos
  if (!Array.isArray(raw)) return []
  return raw.filter((t): t is TodoItem =>
    t != null &&
    typeof t.content === 'string' &&
    typeof t.status === 'string' &&
    typeof t.activeForm === 'string'
  )
}

/**
 * 把流式预览工具落到合适的分组位置
 *
 * - 末尾已是工具组：说明这批预览紧接已渲染的工具调用，属同一批连续调用，并入该组
 * - 末尾是其它内容（思考/正文/任务列表）或根本没有内容：预览属于新一轮调用，
 *   另起一个工具组追加到末尾，保证它渲染在已有内容之后
 *
 * 新建组的 startIndex 取 parts.length，与工具正式写入 parts 后所在的下标一致，
 * 这样预览转正式时分组 key 不变，卡片 DOM 复用，不会闪动。
 *
 * @param result 分组结果，原地修改
 * @param tailIndex 预览组落位时使用的下标（即当前 parts 长度）
 * @param previewToolCalls 流式预览中的工具调用
 */
function appendPreviewToolGroup(
  result: AssistantGroupItem[],
  tailIndex: number,
  previewToolCalls?: ToolCall[],
): void {
  if (!previewToolCalls || previewToolCalls.length === 0) return

  // 已写入 parts 的调用不再作为预览重复渲染
  const existingIds = new Set<string>()
  for (const group of result) {
    if (group.type !== 'tool_group') continue
    for (const tc of group.toolCalls) existingIds.add(tc.id)
  }

  const fresh = previewToolCalls.filter(tc => !existingIds.has(tc.id))
  if (fresh.length === 0) return

  const tail = result[result.length - 1]
  if (tail && tail.type === 'tool_group') {
    result[result.length - 1] = {
      type: 'tool_group',
      toolCalls: [...tail.toolCalls, ...fresh],
      startIndex: tail.startIndex,
    }
    return
  }

  result.push({ type: 'tool_group', toolCalls: fresh, startIndex: tailIndex })
}

/**
 * 将助手消息的 Part 序列分组为渲染单元
 *
 * @param parts 助手消息的 Part 序列
 * @param previewToolCalls 流式预览中的工具调用（尚未写入 parts）
 * @returns 按渲染顺序排列的分组结果
 */
export function buildAssistantGroups(
  parts: AssistantPart[],
  previewToolCalls?: ToolCall[],
): AssistantGroupItem[] {
  const result: AssistantGroupItem[] = []
  let currentToolCalls: ToolCall[] = []
  let startIndex = -1

  const flushToolGroup = () => {
    if (currentToolCalls.length > 0) {
      result.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
      currentToolCalls = []
    }
  }

  parts.forEach((part, index) => {
    if (isToolCallPart(part)) {
      // todo_write 单独作为任务列表组渲染，从工具组中分离
      if (part.toolCall.name === 'todo_write') {
        flushToolGroup()
        result.push({ type: 'todo_list', todos: extractTodos(part.toolCall.arguments), index })
        return
      }
      if (currentToolCalls.length === 0) startIndex = index
      currentToolCalls.push(part.toolCall)
      return
    }

    flushToolGroup()
    result.push({ type: 'part', part, index })
  })

  flushToolGroup()

  appendPreviewToolGroup(result, parts.length, previewToolCalls)

  return result
}
