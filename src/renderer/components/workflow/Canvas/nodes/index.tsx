import type { NodeData } from './NodeShared'
import { StartNode } from './StartNode'
import { AgentTaskNode, AgentGroupNode, SubWorkflowNode } from './AgentNodes'
import { UserInputNode, UserApprovalNode, FormCollectorNode } from './InteractionNodes'
import { ConditionNode, SwitchCaseNode, LoopNode, ParallelNode, MergeNode } from './FlowNodes'
import { ToolCallNode, McpServiceNode, CodeRunnerNode, HttpRequestNode } from './ToolNodes'
import { VariableSetNode, DataTransformNode, KnowledgeQueryNode } from './DataNodes'
import { DelayNode, WebhookTriggerNode, EventWaitNode } from './ControlNodes'
import { TextOutputNode, FileOutputNode, NotificationNode } from './OutputNodes'

export type { NodeData } from './NodeShared'

export type WorkflowNodeProps = {
  id: string
  type: string
  data: NodeData
  selected: boolean
  isConnectable: boolean
  dragging: boolean
  zIndex: number
  xPos: number
  yPos: number
}

export const nodeTypeComponents: Record<string, React.ComponentType<WorkflowNodeProps>> = {
  start: StartNode as React.ComponentType<WorkflowNodeProps>,
  agent_task: AgentTaskNode as React.ComponentType<WorkflowNodeProps>,
  agent_group: AgentGroupNode as React.ComponentType<WorkflowNodeProps>,
  sub_workflow: SubWorkflowNode as React.ComponentType<WorkflowNodeProps>,
  user_input: UserInputNode as React.ComponentType<WorkflowNodeProps>,
  user_approval: UserApprovalNode as React.ComponentType<WorkflowNodeProps>,
  form_collector: FormCollectorNode as React.ComponentType<WorkflowNodeProps>,
  condition: ConditionNode as React.ComponentType<WorkflowNodeProps>,
  switch_case: SwitchCaseNode as React.ComponentType<WorkflowNodeProps>,
  loop: LoopNode as React.ComponentType<WorkflowNodeProps>,
  parallel: ParallelNode as React.ComponentType<WorkflowNodeProps>,
  merge: MergeNode as React.ComponentType<WorkflowNodeProps>,
  tool_call: ToolCallNode as React.ComponentType<WorkflowNodeProps>,
  mcp_service: McpServiceNode as React.ComponentType<WorkflowNodeProps>,
  code_runner: CodeRunnerNode as React.ComponentType<WorkflowNodeProps>,
  http_request: HttpRequestNode as React.ComponentType<WorkflowNodeProps>,
  variable_set: VariableSetNode as React.ComponentType<WorkflowNodeProps>,
  data_transform: DataTransformNode as React.ComponentType<WorkflowNodeProps>,
  knowledge_query: KnowledgeQueryNode as React.ComponentType<WorkflowNodeProps>,
  delay: DelayNode as React.ComponentType<WorkflowNodeProps>,
  webhook_trigger: WebhookTriggerNode as React.ComponentType<WorkflowNodeProps>,
  event_wait: EventWaitNode as React.ComponentType<WorkflowNodeProps>,
  text_output: TextOutputNode as React.ComponentType<WorkflowNodeProps>,
  file_output: FileOutputNode as React.ComponentType<WorkflowNodeProps>,
  notification: NotificationNode as React.ComponentType<WorkflowNodeProps>,
}