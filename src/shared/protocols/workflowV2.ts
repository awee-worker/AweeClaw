import type { AgentRole, WorkflowCategory, ConditionOperator, WorkflowInputParam } from './workflow'

export type WorkflowNodeTypeV2 =
  | 'start'
  | 'agent_task'
  | 'agent_group'
  | 'sub_workflow'
  | 'user_input'
  | 'user_approval'
  | 'form_collector'
  | 'condition'
  | 'switch_case'
  | 'loop'
  | 'parallel'
  | 'merge'
  | 'tool_call'
  | 'mcp_service'
  | 'code_runner'
  | 'http_request'
  | 'variable_set'
  | 'data_transform'
  | 'knowledge_query'
  | 'delay'
  | 'webhook_trigger'
  | 'event_wait'
  | 'text_output'
  | 'file_output'
  | 'notification'

export interface WorkflowEdgeV2 {
  id: string
  source: string
  target: string
  sourceHandle?: string
  targetHandle?: string
  label?: string
  condition?: string
  type?: 'default' | 'condition' | 'parallel' | 'loop-back'
  animated?: boolean
  style?: Record<string, unknown>
}

export interface WorkflowNodeV2 {
  id: string
  type: WorkflowNodeTypeV2
  name: string
  nameZh?: string
  position: { x: number; y: number }
  data: WorkflowNodeData
}

export interface GuideQuestion {
  id: string
  text: string
  textZh: string
}

export interface SystemVariable {
  key: string
  label: string
  labelZh: string
  type: 'string' | 'number' | 'object'
  description: string
  descriptionZh: string
  source: 'user' | 'session' | 'time' | 'workspace' | 'workflow' | 'env'
  default?: string
}

export const SYSTEM_VARIABLES: SystemVariable[] = [
  { key: '$user.id', label: 'User ID', labelZh: '用户ID', type: 'string', description: 'Current user unique identifier', descriptionZh: '当前用户唯一标识', source: 'user' },
  { key: '$user.username', label: 'Username', labelZh: '用户名', type: 'string', description: 'Current user display name', descriptionZh: '当前用户显示名', source: 'user' },
  { key: '$user.email', label: 'Email', labelZh: '邮箱', type: 'string', description: 'Current user email', descriptionZh: '当前用户邮箱', source: 'user' },
  { key: '$user.realName', label: 'Real Name', labelZh: '真实姓名', type: 'string', description: 'Current user real name', descriptionZh: '当前用户真实姓名', source: 'user' },
  { key: '$user.role', label: 'Role', labelZh: '用户角色', type: 'string', description: 'Current user role', descriptionZh: '当前用户角色', source: 'user' },
  { key: '$time.now', label: 'Current Time', labelZh: '当前时间', type: 'string', description: 'Current time HH:mm:ss', descriptionZh: '当前时间 HH:mm:ss', source: 'time', default: new Date().toTimeString().slice(0, 8) },
  { key: '$time.date', label: 'Current Date', labelZh: '当前日期', type: 'string', description: 'Current date YYYY-MM-DD', descriptionZh: '当前日期 YYYY-MM-DD', source: 'time', default: new Date().toISOString().slice(0, 10) },
  { key: '$time.iso', label: 'ISO Time', labelZh: 'ISO 时间', type: 'string', description: 'Current datetime ISO 8601', descriptionZh: '当前日期时间 ISO 8601', source: 'time', default: new Date().toISOString() },
  { key: '$time.timestamp', label: 'Timestamp', labelZh: '时间戳', type: 'number', description: 'Current Unix timestamp ms', descriptionZh: '当前 Unix 时间戳（毫秒）', source: 'time', default: String(Date.now()) },
  { key: '$session.id', label: 'Session ID', labelZh: '会话ID', type: 'string', description: 'Current session identifier', descriptionZh: '当前会话标识', source: 'session' },
  { key: '$session.threadId', label: 'Thread ID', labelZh: '对话线程ID', type: 'string', description: 'Current conversation thread ID', descriptionZh: '当前对话线程ID', source: 'session' },
  { key: '$workflow.id', label: 'Workflow ID', labelZh: '工作流ID', type: 'string', description: 'Current workflow identifier', descriptionZh: '当前工作流标识', source: 'workflow' },
  { key: '$workflow.name', label: 'Workflow Name', labelZh: '工作流名称', type: 'string', description: 'Current workflow display name', descriptionZh: '当前工作流显示名', source: 'workflow' },
  { key: '$workflow.runId', label: 'Run ID', labelZh: '运行ID', type: 'string', description: 'Current workflow run unique ID', descriptionZh: '当前工作流运行唯一ID', source: 'workflow' },
  { key: '$env.language', label: 'Language', labelZh: '语言', type: 'string', description: 'Current UI language setting', descriptionZh: '当前界面语言设置', source: 'env' },
  { key: '$env.theme', label: 'Theme', labelZh: '主题', type: 'string', description: 'Current theme (light/dark)', descriptionZh: '当前主题（浅色/深色）', source: 'env' },
]

export interface WorkflowNodeData {
  _expanded?: boolean
  description?: string
  descriptionZh?: string

  roleId?: string
  roleName?: string
  customRole?: AgentRole
  systemPrompt?: string
  userPrompt?: string
  modelId?: string
  temperature?: number
  chatMode?: 'chat' | 'agent' | 'plan'
  boundTools?: string[]
  boundMcpServers?: string[]
  boundMcpTools?: string[]

  groupRoles?: AgentRole[]
  collaborationMode?: 'sequential' | 'debate' | 'voting'
  maxRounds?: number
  consensusCondition?: string

  subWorkflowId?: string
  inputMapping?: Record<string, string>
  outputMapping?: Record<string, string>

  toolName?: string
  toolArgs?: Record<string, unknown>
  mcpServerId?: string
  mcpToolName?: string

  codeLanguage?: 'javascript' | 'typescript' | 'python' | 'bash' | 'go'
  codeSnippet?: string
  codeInputVars?: string[]
  codeOutputVars?: string[]

  httpMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  httpUrl?: string
  httpHeaders?: Record<string, string>
  httpBody?: string
  httpAuth?: HttpAuthConfig

  conditions?: ConditionRule[]
  switchCases?: SwitchCase[]
  switchVariable?: string
  loopType?: 'for_each' | 'while' | 'times'
  loopMode?: string
  loopMaxIterations?: number
  loopVariable?: string
  parallelStrategy?: 'all' | 'any' | 'count'
  parallelCount?: number
  mergeStrategy?: 'all' | 'any' | 'count'
  mergeCount?: number

  inputType?: 'text' | 'number' | 'select' | 'multiline' | 'confirm' | 'file'
  inputLabel?: string
  inputPlaceholder?: string
  required?: boolean
  inputOptions?: Array<{ label: string; value: string }>
  allowMultipleFiles?: boolean
  allowedFileTypes?: string[]
  maxFileSize?: number
  approvalTitle?: string
  approvalTitleZh?: string
  approvalDescription?: string
  approvalDescriptionZh?: string
  approvalTimeout?: number
  approvalAutoAction?: 'approve' | 'reject' | 'pause'
  approverList?: string[]
  formTitle?: string
  formTitleZh?: string
  formFields?: FormFieldDefinition[]

  variableName?: string
  variableValue?: string
  variableType?: string
  transformExpression?: string
  knowledgeBaseId?: string
  queryContent?: string
  queryContentZh?: string
  topK?: number
  similarityThreshold?: number

  inputVars?: Record<string, string>
  outputVar?: string
  timeout?: number
  retryPolicy?: RetryPolicy
  onError?: ErrorHandlerConfig

  delayMs?: number
  webhookMethod?: string
  webhookPath?: string
  eventType?: string
  eventTimeout?: number

  textContent?: string
  filePath?: string
  outputFormat?: string
  fileFormat?: string
  encoding?: string
  notificationChannel?: 'system' | 'email' | 'webhook'
  notificationTemplate?: string
  recipients?: string[]

  welcomeMessage?: string
  welcomeMessageZh?: string
  guideQuestions?: GuideQuestion[]
  quickActions?: GuideQuestion[]
}

export interface HttpAuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'api-key'
  token?: string
  user?: string
  pass?: string
  headerName?: string
  headerValue?: string
}

export interface ConditionRule {
  id: string
  variable: string
  operator: ConditionOperator
  value?: unknown
  targetHandle: string
}

export interface SwitchCase {
  id: string
  label: string
  condition: string
  targetHandle: string
}

export interface FormFieldDefinition {
  name: string
  label: string
  labelZh?: string
  type: 'text' | 'number' | 'select' | 'checkbox' | 'textarea'
  required?: boolean
  options?: Array<{ label: string; value: string }>
  validation?: string
  defaultValue?: unknown
}

export interface RetryPolicy {
  maxRetries: number
  delayMs: number
  backoff: 'fixed' | 'exponential'
}

export interface ErrorHandlerConfig {
  action: 'retry' | 'skip' | 'abort' | 'goto'
  gotoNodeId?: string
  maxRetries?: number
  retryDelayMs?: number
  fallbackOutput?: unknown
}

export interface WorkflowVariable {
  name: string
  type: 'string' | 'number' | 'boolean' | 'object' | 'array'
  defaultValue?: unknown
  description?: string
  scope: 'workflow' | 'run'
}

export interface WorkflowDefinitionV2 {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  version: string
  author: string
  category: WorkflowCategory
  tags: string[]
  icon?: string
  nodes: WorkflowNodeV2[]
  edges: WorkflowEdgeV2[]
  variables: WorkflowVariable[]
  inputSchema?: Record<string, WorkflowInputParam>
  isCustom?: boolean
  createdAt?: number
  updatedAt?: number
  thumbnail?: string
}

export type WorkflowRunStatusV2 = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'

export interface WorkflowNodeResultV2 {
  nodeId: string
  nodeName: string
  nodeType: WorkflowNodeTypeV2
  status: 'success' | 'failed' | 'skipped'
  startedAt: number
  completedAt: number
  output?: unknown
  error?: string
  durationMs: number
}

export interface WorkflowRunV2 {
  id: string
  workflowId: string
  workflowName: string
  workflowNameZh: string
  status: WorkflowRunStatusV2
  startedAt: number
  completedAt?: number
  currentNodeId?: string
  variables: Record<string, unknown>
  nodeResults: WorkflowNodeResultV2[]
  error?: string
  threadId?: string
}

export const NODE_CATEGORY_MAP: Record<WorkflowNodeTypeV2, {
  category: 'start' | 'agent' | 'interaction' | 'flow' | 'tool' | 'data' | 'control' | 'output'
  icon: string
  color: string
}> = {
  start: { category: 'start', icon: 'Play', color: '#22c55e' },
  agent_task: { category: 'agent', icon: 'Bot', color: '#3b82f6' },
  agent_group: { category: 'agent', icon: 'Users', color: '#8b5cf6' },
  sub_workflow: { category: 'agent', icon: 'Workflow', color: '#6366f1' },
  user_input: { category: 'interaction', icon: 'MessageSquare', color: '#f59e0b' },
  user_approval: { category: 'interaction', icon: 'CheckCircle', color: '#10b981' },
  form_collector: { category: 'interaction', icon: 'ClipboardList', color: '#06b6d4' },
  condition: { category: 'flow', icon: 'GitBranch', color: '#f97316' },
  switch_case: { category: 'flow', icon: 'GitMerge', color: '#ea580c' },
  loop: { category: 'flow', icon: 'Repeat', color: '#d946ef' },
  parallel: { category: 'flow', icon: 'Layers', color: '#14b8a6' },
  merge: { category: 'flow', icon: 'Merge', color: '#0ea5e9' },
  tool_call: { category: 'tool', icon: 'Wrench', color: '#64748b' },
  mcp_service: { category: 'tool', icon: 'Server', color: '#7c3aed' },
  code_runner: { category: 'tool', icon: 'Terminal', color: '#059669' },
  http_request: { category: 'tool', icon: 'Globe', color: '#0284c7' },
  variable_set: { category: 'data', icon: 'Variable', color: '#a855f7' },
  data_transform: { category: 'data', icon: 'Shuffle', color: '#ec4899' },
  knowledge_query: { category: 'data', icon: 'BookOpen', color: '#0891b2' },
  delay: { category: 'control', icon: 'Clock', color: '#6b7280' },
  webhook_trigger: { category: 'control', icon: 'Webhook', color: '#dc2626' },
  event_wait: { category: 'control', icon: 'Bell', color: '#ca8a04' },
  text_output: { category: 'output', icon: 'FileText', color: '#2563eb' },
  file_output: { category: 'output', icon: 'FileOutput', color: '#4f46e5' },
  notification: { category: 'output', icon: 'BellRing', color: '#e11d48' },
}

export const NODE_CATEGORY_LABELS: Record<string, { en: string; zh: string }> = {
  agent: { en: 'Agent', zh: '智能体' },
  interaction: { en: 'Interaction', zh: '交互' },
  flow: { en: 'Flow Control', zh: '流程控制' },
  tool: { en: 'Tools', zh: '工具' },
  data: { en: 'Data', zh: '数据' },
  control: { en: 'Control', zh: '控制' },
  output: { en: 'Output', zh: '输出' },
}

export const NODE_TYPE_LABELS: Record<WorkflowNodeTypeV2, { en: string; zh: string; descEn: string; descZh: string }> = {
  start: { en: 'Start', zh: '开始', descEn: 'Workflow start trigger', descZh: '工作流开始触发点' },
  agent_task: { en: 'Agent Task', zh: '智能体任务', descEn: 'Send task to AI agent with role and tools', descZh: '向 AI 智能体发送任务，指定角色和工具' },
  agent_group: { en: 'Agent Group', zh: '智能体协作组', descEn: 'Multiple agents collaborate on a task', descZh: '多个智能体协作完成任务' },
  sub_workflow: { en: 'Sub Workflow', zh: '子工作流', descEn: 'Call another workflow as a step', descZh: '调用另一个工作流作为步骤' },
  user_input: { en: 'User Input', zh: '用户输入', descEn: 'Pause for user text input', descZh: '暂停等待用户文本输入' },
  user_approval: { en: 'User Approval', zh: '用户审批', descEn: 'Pause for user approval or rejection', descZh: '暂停等待用户审批或拒绝' },
  form_collector: { en: 'Form Collector', zh: '表单收集', descEn: 'Collect structured data via form', descZh: '通过表单收集结构化数据' },
  condition: { en: 'Condition', zh: '条件分支', descEn: 'Branch based on condition (if/else)', descZh: '基于条件进行分支（如果/否则）' },
  switch_case: { en: 'Switch', zh: '多路分支', descEn: 'Branch to multiple cases', descZh: '多路条件分支' },
  loop: { en: 'Loop', zh: '循环', descEn: 'Execute steps in a loop', descZh: '循环执行步骤' },
  parallel: { en: 'Parallel', zh: '并行执行', descEn: 'Execute multiple branches in parallel', descZh: '并行执行多个分支' },
  merge: { en: 'Merge', zh: '合并', descEn: 'Merge multiple branches', descZh: '合并多个分支' },
  tool_call: { en: 'Tool Call', zh: '工具调用', descEn: 'Call a built-in tool', descZh: '调用内置工具' },
  mcp_service: { en: 'MCP Service', zh: 'MCP 服务', descEn: 'Call an MCP server tool', descZh: '调用 MCP 服务器工具' },
  code_runner: { en: 'Code Runner', zh: '代码执行', descEn: 'Execute JavaScript or Python code', descZh: '执行 JavaScript 或 Python 代码' },
  http_request: { en: 'HTTP Request', zh: 'HTTP 请求', descEn: 'Send HTTP request to external API', descZh: '向外部 API 发送 HTTP 请求' },
  variable_set: { en: 'Set Variable', zh: '设置变量', descEn: 'Set or update a workflow variable', descZh: '设置或更新工作流变量' },
  data_transform: { en: 'Data Transform', zh: '数据转换', descEn: 'Transform data with expression', descZh: '通过表达式转换数据' },
  knowledge_query: { en: 'Knowledge Query', zh: '知识库检索', descEn: 'Search knowledge base for relevant info', descZh: '检索知识库获取相关信息' },
  delay: { en: 'Delay', zh: '延时等待', descEn: 'Wait for a specified duration', descZh: '等待指定时长' },
  webhook_trigger: { en: 'Webhook Trigger', zh: 'Webhook 触发', descEn: 'Trigger workflow via webhook', descZh: '通过 Webhook 触发工作流' },
  event_wait: { en: 'Event Wait', zh: '事件等待', descEn: 'Wait for an event to occur', descZh: '等待事件发生' },
  text_output: { en: 'Text Output', zh: '文本输出', descEn: 'Output text content', descZh: '输出文本内容' },
  file_output: { en: 'File Output', zh: '文件输出', descEn: 'Write content to file', descZh: '将内容写入文件' },
  notification: { en: 'Notification', zh: '通知推送', descEn: 'Send notification', descZh: '发送通知' },
}
