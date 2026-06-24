/**
 * 助手消息内容视图
 * 将 Part 序列分组渲染：连续的工具调用合并为工具组，其他 Part 单独渲染
 */
import React, { useMemo } from 'react'
import type { AssistantPart, ToolCall } from '@intelligence/providerTypes'
import { isToolCallPart } from '@intelligence/providerTypes'
import ToolCallGroup from '../../ToolCallGroup'
import { renderPart } from '../parts/PartRendererRegistry'
import type { PartRenderContext, AssistantGroupItem } from '../types'

interface AssistantMessageContentViewProps extends PartRenderContext {
  parts: AssistantPart[]
}

function AssistantMessageContentViewBase({ parts, ...ctx }: AssistantMessageContentViewProps) {
  /** 将 Part 序列分组：连续的工具调用合并 */
  const groups = useMemo(() => {
    const result: AssistantGroupItem[] = []
    let currentToolCalls: ToolCall[] = []
    let startIndex = -1

    parts.forEach((part, index) => {
      if (isToolCallPart(part)) {
        if (currentToolCalls.length === 0) startIndex = index
        currentToolCalls.push(part.toolCall)
      } else {
        if (currentToolCalls.length > 0) {
          result.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
          currentToolCalls = []
        }
        result.push({ type: 'part', part, index })
      }
    })

    if (currentToolCalls.length > 0) {
      result.push({ type: 'tool_group', toolCalls: currentToolCalls, startIndex })
    }

    return result
  }, [parts])

  return (
    <>
      {groups.map((group) => {
        if (group.type === 'part') {
          return (
            <div key={`wrap-part-${group.index}`} className="w-full">
              {renderPart(group.part, ctx)}
            </div>
          )
        }

        // 单个工具调用走普通渲染路径
        if (group.toolCalls.length === 1) {
          return (
            <div key={`wrap-tool-${group.startIndex}`} className="w-full">
              {renderPart(parts[group.startIndex], ctx)}
            </div>
          )
        }

        // 多个工具调用合并为工具组
        return (
          <div key={`wrap-group-${group.startIndex}`} className="w-full">
            <ToolCallGroup
              toolCalls={group.toolCalls}
              pendingToolId={ctx.pendingToolId}
              onApproveTool={ctx.onApproveTool}
              onRejectTool={ctx.onRejectTool}
              onOpenDiff={ctx.onOpenDiff}
              messageId={ctx.messageId}
            />
          </div>
        )
      })}
    </>
  )
}

export const AssistantMessageContentView = React.memo(AssistantMessageContentViewBase)
AssistantMessageContentView.displayName = 'AssistantMessageContentView'
