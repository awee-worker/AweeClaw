/**
 * 工具调用 Part 视图
 */
import type { AssistantPart } from '@intelligence/providerTypes'
import type { PartRenderContext } from '../types'
import { renderToolCallCard } from '../../ToolCallGroup'

export function ToolCallPartView(part: AssistantPart, ctx: PartRenderContext): React.ReactNode {
  const toolCallPart = part as { toolCall: any }
  const tc = toolCallPart.toolCall
  return (
    <div className="my-3">
      {renderToolCallCard(tc, {
        pendingToolId: ctx.pendingToolId,
        onApproveTool: ctx.onApproveTool,
        onRejectTool: ctx.onRejectTool,
        onOpenDiff: ctx.onOpenDiff,
        messageId: ctx.messageId,
      })}
    </div>
  )
}
