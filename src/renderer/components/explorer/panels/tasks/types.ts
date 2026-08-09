/**
 * 任务 / 项目 / 自动化 — 共享类型定义
 *
 * 与后端 TaskItem / ProjectItem 结构对齐（见 task.service.ts / project.service.ts）。
 * 客户端独立定义，避免直接依赖后端 Prisma 类型。
 */

// ─── 任务 ───────────────────────────────────────────────

export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELED'
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
export type TaskSource = 'MANUAL' | 'AI_GENERATED' | 'AUTOMATION' | 'PROJECT_TEMPLATE'

export interface TaskItem {
  id: string
  userId: string
  projectId: string | null
  parentTaskId: string | null
  threadId: string | null
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  source: TaskSource
  tags: string[]
  dueAt: string | null
  startedAt: string | null
  completedAt: string | null
  estimatedMin: number | null
  actualMin: number | null
  sortOrder: number
  metadata: unknown
  createdAt: string
  updatedAt: string
  /** 子任务（getById 时返回） */
  children?: TaskItem[]
}

export interface CreateTaskInput {
  title: string
  description?: string
  projectId?: string
  parentTaskId?: string
  threadId?: string
  status?: TaskStatus
  priority?: TaskPriority
  source?: TaskSource
  tags?: string[]
  dueAt?: string
  estimatedMin?: number
  sortOrder?: number
  /** 扩展元数据（质量元数据：预期产出/验收标准/约束等） */
  metadata?: Record<string, unknown>
}

export interface UpdateTaskInput {
  title?: string
  description?: string | null
  projectId?: string | null
  parentTaskId?: string | null
  threadId?: string | null
  status?: TaskStatus
  priority?: TaskPriority
  tags?: string[]
  dueAt?: string | null
  estimatedMin?: number
  actualMin?: number
  sortOrder?: number
  /** 扩展元数据（质量元数据/执行结果，合并写入保留已有字段） */
  metadata?: Record<string, unknown>
}

export interface TaskQuery {
  projectId?: string
  status?: TaskStatus
  priority?: TaskPriority
  tag?: string
  dueBefore?: string
  q?: string
  view?: 'list' | 'kanban' | 'timeline'
  includeArchived?: boolean
  limit?: number
  offset?: number
}

// ─── 项目 ───────────────────────────────────────────────

export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'ARCHIVED'
export type ProjectVisibility = 'PRIVATE' | 'TEAM' | 'PUBLIC'

export interface ProjectStats {
  totalTasks: number
  doneTasks: number
  inProgressTasks: number
  blockedTasks: number
  todoTasks: number
  completionRate: number
  automationRuleCount: number
  conversationCount: number
}

export interface ProjectItem {
  id: string
  userId: string
  name: string
  description: string | null
  icon: string | null
  color: string | null
  status: ProjectStatus
  visibility: ProjectVisibility
  goal: string | null
  workspacePaths: string[]
  knowledgeBaseIds: string[]
  threadIds: string[]
  tags: string[]
  dueAt: string | null
  startedAt: string | null
  completedAt: string | null
  archivedAt: string | null
  createdAt: string
  updatedAt: string
  /** 列表接口附带统计 */
  stats?: ProjectStats
}

export interface CreateProjectInput {
  name: string
  description?: string
  icon?: string
  color?: string
  status?: ProjectStatus
  visibility?: ProjectVisibility
  goal?: string
  workspacePaths?: string[]
  knowledgeBaseIds?: string[]
  threadIds?: string[]
  tags?: string[]
  dueAt?: string
}

export interface UpdateProjectInput {
  name?: string
  description?: string | null
  icon?: string | null
  color?: string | null
  status?: ProjectStatus
  visibility?: ProjectVisibility
  goal?: string | null
  workspacePaths?: string[]
  knowledgeBaseIds?: string[]
  threadIds?: string[]
  tags?: string[]
  dueAt?: string | null
}

// ─── 自动化 ─────────────────────────────────────────────

export interface AutomationRule {
  id: string
  userId: string
  projectId: string | null
  templateId: string | null
  name: string
  description: string | null
  enabled: boolean
  triggerConfig: TriggerConfig
  actionConfig: ActionConfig
  priority: number
  cooldownSeconds: number
  maxExecutions: number
  executionCount: number
  lastExecutedAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface TriggerConfig {
  type: 'schedule' | 'webhook' | 'event'
  cron?: string
  event?: string
  filter?: Record<string, unknown>
  path?: string
}

export interface ActionConfig {
  type: 'workflow' | 'agent' | 'notification' | 'webhook' | 'knowledge' | 'email'
  workflowId?: string
  agentId?: string
  prompt?: string
  channel?: string
  template?: string
  url?: string
  knowledgeBaseId?: string
  inputMapping?: Record<string, string>
}

export interface AutomationRun {
  id: string
  ruleId: string
  triggerType: string
  triggerData: unknown
  status: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'RUNNING'
  output: unknown
  error: string | null
  durationMs: number
  startedAt: string
  finishedAt: string | null
  rule?: { id: string; name: string }
}

export interface AutomationRunStats {
  total: number
  success: number
  failed: number
  timeout: number
  avgDurationMs: number
  lastRunAt: string | null
}

export interface AutomationTemplate {
  id: string
  nameZh: string
  nameEn: string
  descriptionZh: string
  descriptionEn: string
  category: string
  triggerConfig: TriggerConfig
  actionConfig: ActionConfig
}

export interface TriggerDescriptor {
  type: string
  nameZh: string
  nameEn: string
  descriptionZh: string
  descriptionEn: string
  fields: TriggerFieldDescriptor[]
}

export interface ActionDescriptor {
  type: string
  nameZh: string
  nameEn: string
  descriptionZh: string
  descriptionEn: string
  fields: ActionFieldDescriptor[]
}

export interface TriggerFieldDescriptor {
  key: string
  nameZh: string
  nameEn: string
  type: 'string' | 'cron' | 'select'
  required: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
}

export interface ActionFieldDescriptor {
  key: string
  nameZh: string
  nameEn: string
  type: 'string' | 'text' | 'select'
  required: boolean
  placeholder?: string
  options?: { value: string; label: string }[]
}

// ─── 列表响应 ───────────────────────────────────────────

export interface ListResponse<T> {
  items: T[]
  total: number
}
