import type { WorkflowNodeTypeV2 } from '@shared/protocols/workflowV2'

export type TabId = 'basic' | 'role' | 'tools' | 'io' | 'error' | 'advanced'

export interface TabProps {
  nodeType: WorkflowNodeTypeV2
  data: import('@shared/protocols/workflowV2').WorkflowNodeData
  onChange: (field: string, value: unknown) => void
  language: 'en' | 'zh'
}

export interface PropertyPanelProps {
  node: import('@shared/protocols/workflowV2').WorkflowNodeV2 | null
  onUpdateNodeData: (nodeId: string, data: Partial<import('@shared/protocols/workflowV2').WorkflowNodeData>) => void
  onUpdateNodeName: (nodeId: string, name: string) => void
  onDeleteNode: (nodeId: string) => void
  language?: 'en' | 'zh'
}

export function getAvailableTabs(nodeType: WorkflowNodeTypeV2): TabId[] {
  const tabs: TabId[] = ['basic']

  if (nodeType === 'agent_task' || nodeType === 'agent_group') {
    tabs.push('role')
  }

  if (
    nodeType === 'agent_task' ||
    nodeType === 'tool_call' ||
    nodeType === 'mcp_service' ||
    nodeType === 'code_runner'
  ) {
    tabs.push('tools')
  }

  tabs.push('io', 'advanced')
  return tabs
}