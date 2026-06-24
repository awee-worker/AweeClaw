/**
 * Part 渲染策略注册表
 * 通过注册表模式动态匹配 Part 类型到对应渲染器，消除冗长条件判断
 */
import type { AssistantPart } from '@intelligence/providerTypes'
import type { PartRenderer, PartRenderContext } from '../types'
import { isTextPart, isReasoningPart, isSearchPart, isSystemAlertPart, isLintCheckPart, isContextSnapshotPart, isSourcesPart, isFormPart, isMultiAgentWorkflowPart, isToolCallPart } from '@intelligence/providerTypes'

import { TextPartView } from './TextPartView'
import { ReasoningPartView } from './ReasoningPartView'
import { SystemAlertPartView } from './SystemAlertPartView'
import { LintCheckPartView } from './LintCheckPartView'
import { ContextSnapshotPartView } from './ContextSnapshotPartView'
import { SourcesPartView } from './SourcesPartView'
import { FormPartView } from './FormPartView'
import { ToolCallPartView } from './ToolCallPartView'

/** Part 类型谓词与渲染器的映射表 */
const PART_RENDERER_REGISTRY: Array<{
  predicate: (part: AssistantPart) => boolean
  renderer: PartRenderer
}> = [
  { predicate: isTextPart, renderer: TextPartView },
  { predicate: isReasoningPart, renderer: ReasoningPartView },
  { predicate: isSystemAlertPart, renderer: SystemAlertPartView },
  { predicate: isLintCheckPart, renderer: LintCheckPartView },
  { predicate: isContextSnapshotPart, renderer: ContextSnapshotPartView },
  { predicate: isSourcesPart, renderer: SourcesPartView },
  { predicate: isFormPart, renderer: FormPartView },
  { predicate: isToolCallPart, renderer: ToolCallPartView },
  // 搜索结果和多智能体工作流暂不渲染
  { predicate: isSearchPart, renderer: () => null },
  { predicate: isMultiAgentWorkflowPart, renderer: () => null },
]

/** 根据Part类型查找并调用对应渲染器 */
export function renderPart(part: AssistantPart, ctx: PartRenderContext): React.ReactNode {
  for (const entry of PART_RENDERER_REGISTRY) {
    if (entry.predicate(part)) {
      return entry.renderer(part, ctx)
    }
  }
  return null
}
