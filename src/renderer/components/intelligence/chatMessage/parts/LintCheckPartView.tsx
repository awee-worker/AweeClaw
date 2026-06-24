/**
 * Lint 检查 Part 视图
 */
import type { AssistantPart } from '@intelligence/providerTypes'
import type { PartRenderContext } from '../types'
import { LintCheckCard } from '../../LintCheckCard'

export function LintCheckPartView(part: AssistantPart, _ctx: PartRenderContext): React.ReactNode {
  return <LintCheckCard part={part as any} />
}
