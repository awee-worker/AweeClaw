import type { WorkflowNodeTypeV2 } from '@shared/protocols/workflowV2'
import { NODE_CATEGORY_MAP, NODE_TYPE_LABELS } from '@shared/protocols/workflowV2'

export { NODE_CATEGORY_MAP, NODE_TYPE_LABELS }

export const NODE_TYPES_WITH_OUTPUTS: WorkflowNodeTypeV2[] = [
  'agent_task', 'agent_group', 'sub_workflow',
  'tool_call', 'mcp_service', 'code_runner', 'http_request',
  'variable_set', 'data_transform', 'knowledge_query',
  'user_input', 'user_approval', 'form_collector',
]

export function getNodeCategory(nodeType: WorkflowNodeTypeV2) {
  return NODE_CATEGORY_MAP[nodeType]?.category || 'agent'
}

export function getNodeIcon(nodeType: WorkflowNodeTypeV2): string {
  return NODE_CATEGORY_MAP[nodeType]?.icon || 'Circle'
}

export function getNodeColor(nodeType: WorkflowNodeTypeV2): string {
  return NODE_CATEGORY_MAP[nodeType]?.color || '#6b7280'
}

export function getNodeLabel(nodeType: WorkflowNodeTypeV2, lang: 'en' | 'zh' = 'zh'): string {
  const labels = NODE_TYPE_LABELS[nodeType]
  return lang === 'zh' ? labels?.zh || labels?.en || nodeType : labels?.en || nodeType
}

export function getNodeDescription(nodeType: WorkflowNodeTypeV2, lang: 'en' | 'zh' = 'zh'): string {
  const labels = NODE_TYPE_LABELS[nodeType]
  return lang === 'zh' ? labels?.descZh || labels?.descEn || '' : labels?.descEn || ''
}

const BLOCKED_TARGET_TYPES: WorkflowNodeTypeV2[] = []

export function getAvailableNextTypes(sourceType: WorkflowNodeTypeV2): WorkflowNodeTypeV2[] {
  if (sourceType === 'merge') return BLOCKED_TARGET_TYPES

  const allTypes = Object.keys(NODE_TYPE_LABELS) as WorkflowNodeTypeV2[]
  return allTypes.filter(t => !BLOCKED_TARGET_TYPES.includes(t))
}

export function getAvailablePrevTypes(targetType: WorkflowNodeTypeV2): WorkflowNodeTypeV2[] {
  if (targetType === 'start' || targetType === 'webhook_trigger' || targetType === 'event_wait') return []

  const allTypes = Object.keys(NODE_TYPE_LABELS) as WorkflowNodeTypeV2[]
  return allTypes.filter(t => {
    if (t === 'merge') return false
    return true
  })
}

export function canConnectTo(sourceType: WorkflowNodeTypeV2, _targetType: WorkflowNodeTypeV2): boolean {
  if (sourceType === 'merge') return false
  return true
}

export function getOutputHandles(nodeType: WorkflowNodeTypeV2): string[] {
  if (nodeType === 'condition') return ['then', 'else']
  if (nodeType === 'switch_case') return ['case-0', 'case-1', 'case-2', 'default']
  if (nodeType === 'parallel') return ['branch-0', 'branch-1', 'branch-2']
  if (nodeType === 'loop') return ['body', 'done']
  if (nodeType === 'merge') return ['out']
  return ['out']
}

export function getInputHandles(nodeType: WorkflowNodeTypeV2): string[] {
  if (nodeType === 'merge') return ['in-0', 'in-1', 'in-2']
  if (nodeType === 'start' || nodeType === 'webhook_trigger' || nodeType === 'event_wait') return []
  return ['in']
}