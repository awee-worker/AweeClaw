/**
 * 推理 Part 视图
 */
import type { AssistantPart } from '@intelligence/providerTypes'
import type { PartRenderContext } from '../types'
import { ThinkingBlockView } from '../blocks/ThinkingBlockView'

export function ReasoningPartView(part: AssistantPart, ctx: PartRenderContext): React.ReactNode {
  const reasoningPart = part as { content?: string; startTime?: number; isStreaming?: boolean }
  if (!reasoningPart.content?.trim() && !reasoningPart.isStreaming) return null
  return (
    <ThinkingBlockView
      content={reasoningPart.content || ''}
      startTime={reasoningPart.startTime}
      isStreaming={!!reasoningPart.isStreaming}
      fontSize={ctx.fontSize}
    />
  )
}
