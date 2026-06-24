/**
 * 来源 Part 视图
 */
import type { AssistantPart } from '@intelligence/providerTypes'
import type { PartRenderContext } from '../types'
import { SourcesBlockView } from '../blocks/SourcesBlockView'

export function SourcesPartView(part: AssistantPart, _ctx: PartRenderContext): React.ReactNode {
  const sourcesPart = part as { sources: any[] }
  return <SourcesBlockView sources={sourcesPart.sources || []} />
}
