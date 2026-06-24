/**
 * 文本 Part 视图
 */
import type { AssistantPart } from '@intelligence/providerTypes'
import type { PartRenderContext } from '../types'
import { MarkdownContentView } from '../markdown/MarkdownContentView'

export function TextPartView(part: AssistantPart, ctx: PartRenderContext): React.ReactNode {
  const textPart = part as { content?: string }
  const textStr = typeof textPart.content === 'string' ? textPart.content : String(textPart.content ?? '')
  if (!textStr.trim()) return null
  return (
    <MarkdownContentView
      content={textStr}
      fontSize={ctx.fontSize}
      isStreaming={ctx.isStreaming}
    />
  )
}
