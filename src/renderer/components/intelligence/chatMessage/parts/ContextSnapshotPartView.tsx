/**
 * 上下文快照 Part 视图
 */
import type { AssistantPart } from '@intelligence/providerTypes'
import type { PartRenderContext } from '../types'
import { CompressionDigestCard } from '../../CompressionDigestCard'

export function ContextSnapshotPartView(part: AssistantPart, _ctx: PartRenderContext): React.ReactNode {
  const snapshotPart = part as { presentation?: string }
  return (
    <CompressionDigestCard
      part={part as any}
      variant={snapshotPart.presentation === 'source_marker' ? 'timeline' : 'card'}
    />
  )
}
