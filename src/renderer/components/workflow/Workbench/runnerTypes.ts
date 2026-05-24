import {
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  MessageSquare,
  GitBranch,
  UserCheck,
  Zap,
  Bot,
  Wrench,
  Server,
  Globe,
  Terminal,
  Variable,
  Shuffle,
  BookOpen,
  Layers,
  Merge,
  GitMerge,
  Repeat,
  Bell,
  FileText,
  BellRing,
  ClipboardList,
  Workflow,
  Users,
  Pause,
} from 'lucide-react'
import type { WorkflowNodeTypeV2 } from '@shared/protocols/workflowV2'

export interface WorkflowRunV2 {
  id: string
  workflowId: string
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  completedAt?: number
  variables: Record<string, unknown>
  nodeHistory: NodeExecutionRecord[]
  currentNodeId?: string
  error?: string
}

export interface NodeExecutionRecord {
  nodeId: string
  nodeType: WorkflowNodeTypeV2
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'waiting'
  startedAt?: number
  completedAt?: number
  output?: unknown
  error?: string
}

export type NodeDisplayStatus = 'pending' | 'running' | 'completed' | 'failed' | 'waiting'

export const NODE_ICONS: Partial<Record<WorkflowNodeTypeV2, React.ComponentType<{ className?: string }>>> = {
  agent_task: Bot,
  agent_group: Users,
  sub_workflow: Workflow,
  user_input: MessageSquare,
  user_approval: UserCheck,
  form_collector: ClipboardList,
  condition: GitBranch,
  switch_case: GitMerge,
  loop: Repeat,
  parallel: Layers,
  merge: Merge,
  tool_call: Wrench,
  mcp_service: Server,
  code_runner: Terminal,
  http_request: Globe,
  variable_set: Variable,
  data_transform: Shuffle,
  knowledge_query: BookOpen,
  delay: Clock,
  webhook_trigger: Zap,
  event_wait: Bell,
  text_output: FileText,
  file_output: FileText,
  notification: BellRing,
}

export const RUN_STATUS_CONFIG: Record<WorkflowRunV2['status'], { color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { color: 'text-gray-400', bg: 'bg-gray-500/10', icon: Clock },
  running: { color: 'text-blue-400', bg: 'bg-blue-500/10', icon: Loader2 },
  paused: { color: 'text-amber-400', bg: 'bg-amber-500/10', icon: Pause },
  completed: { color: 'text-green-400', bg: 'bg-green-500/10', icon: CheckCircle2 },
  failed: { color: 'text-red-400', bg: 'bg-red-500/10', icon: XCircle },
  cancelled: { color: 'text-gray-400', bg: 'bg-gray-500/10', icon: XCircle },
}

export const NODE_STATUS_DISPLAY: Record<NodeDisplayStatus, { color: string; bg: string; icon: React.ComponentType<{ className?: string }> }> = {
  pending: { color: 'text-gray-400', bg: 'bg-gray-500/10', icon: Clock },
  running: { color: 'text-blue-400', bg: 'bg-blue-500/10', icon: Loader2 },
  completed: { color: 'text-green-400', bg: 'bg-green-500/10', icon: CheckCircle2 },
  failed: { color: 'text-red-400', bg: 'bg-red-500/10', icon: XCircle },
  waiting: { color: 'text-gray-500/30', bg: 'bg-gray-500/5', icon: Clock },
}
