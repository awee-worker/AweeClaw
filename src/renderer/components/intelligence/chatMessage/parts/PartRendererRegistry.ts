/**
 * Part 渲染策略注册表
 * 通过注册表模式动态匹配 Part 类型到对应渲染器，消除冗长条件判断
 */
import { createElement } from 'react'
import type { AssistantPart } from '@intelligence/providerTypes'
import type { PartRenderer, PartRenderContext } from '../types'
import { isTextPart, isReasoningPart, isSearchPart, isSystemAlertPart, isLintCheckPart, isContextSnapshotPart, isSourcesPart, isFormPart, isTaskPlanPart, isMultiAgentWorkflowPart, isToolCallPart } from '@intelligence/providerTypes'

import { TextPartView } from './TextPartView'
import { ReasoningPartView } from './ReasoningPartView'
import { SystemAlertPartView } from './SystemAlertPartView'
import { LintCheckPartView } from './LintCheckPartView'
import { ContextSnapshotPartView } from './ContextSnapshotPartView'
import { SourcesPartView } from './SourcesPartView'
import { FormPartView } from './FormPartView'
import { TaskPlanPartView } from './TaskPlanPartView'
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
  // 任务规划看板已移到顶部状态栏 + 右侧面板；会话内只留一行确认，引导用户去面板审核执行。
  // 本文件是 .ts（无 JSX），因此用 createElement 挂载组件，组件内部才能安全使用 hooks
  { predicate: isTaskPlanPart, renderer: (part) => createElement(TaskPlanPartView, { planId: (part as { planId: string }).planId }) },
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
