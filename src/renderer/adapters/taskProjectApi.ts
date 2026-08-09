/**
 * 任务 / 项目 / 自动化 — 后端 API 适配层
 *
 * 基于 backendApi 封装，提供类型安全的 CRUD 方法。
 * 所有路径与后端 Controller 对齐：
 *   任务：     /api/v1/tasks
 *   项目：     /api/v1/projects
 *   自动化：   /api/v1/automation-rules
 *
 * 设计要点：
 * - 查询参数自动过滤 undefined，避免发送空值
 * - 列表接口返回 { items, total } 结构，与后端一致
 * - 错误统一抛出 BackendApiError，由调用方处理
 */
import { backendApi, BackendApiError } from './backendApi'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  TaskItem,
  CreateTaskInput,
  UpdateTaskInput,
  TaskQuery,
  ProjectItem,
  ProjectStats,
  CreateProjectInput,
  UpdateProjectInput,
  AutomationRule,
  AutomationRun,
  AutomationRunStats,
  AutomationTemplate,
  TriggerDescriptor,
  ActionDescriptor,
  ListResponse,
} from '@renderer/components/explorer/panels/tasks/types'

// ─── 工具函数 ───────────────────────────────────────────

/** 过滤 undefined 值，构建 URL 查询参数 */
function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(key, String(value))
    }
  }
  const qs = search.toString()
  return qs ? `?${qs}` : ''
}

// ============================================
// 任务 API
// ============================================

export const tasksApi = {
  /** 查询任务列表 */
  async list(query: TaskQuery = {}): Promise<ListResponse<TaskItem>> {
    const qs = buildQuery(query as Record<string, unknown>)
    const result = await backendApi.get<TaskItem[] | ListResponse<TaskItem>>(`/api/v1/tasks${qs}`)
    // 后端可能返回数组或 { items, total } 两种格式，统一处理
    if (Array.isArray(result)) {
      return { items: result, total: result.length }
    }
    return result
  },

  /** 获取任务详情（含子任务） */
  async getById(id: string): Promise<TaskItem> {
    return backendApi.get<TaskItem>(`/api/v1/tasks/${id}`)
  },

  /** 创建任务 */
  async create(input: CreateTaskInput): Promise<TaskItem> {
    return backendApi.post<TaskItem>('/api/v1/tasks', input)
  },

  /** 更新任务（含状态流转） */
  async update(id: string, input: UpdateTaskInput): Promise<TaskItem> {
    return backendApi.patch<TaskItem>(`/api/v1/tasks/${id}`, input)
  },

  /** 删除任务（软删除） */
  async remove(id: string): Promise<void> {
    await backendApi.delete<void>(`/api/v1/tasks/${id}`)
  },

  /** 拖拽排序（支持跨项目移动） */
  async reorder(id: string, sortOrder: number, projectId?: string): Promise<TaskItem> {
    return backendApi.post<TaskItem>(`/api/v1/tasks/${id}/reorder`, { sortOrder, projectId })
  },

  /** 批量更新任务 */
  async batchUpdate(taskIds: string[], updates: { status?: string; priority?: string; projectId?: string | null }): Promise<unknown> {
    return backendApi.post<unknown>('/api/v1/tasks/batch', { taskIds, ...updates })
  },

  /** AI 接力：获取任务关联的对话上下文 */
  async aiResume(id: string): Promise<unknown> {
    return backendApi.post<unknown>(`/api/v1/tasks/${id}/ai-resume`)
  },

  /** 复制任务到目标项目（状态重置为 TODO） */
  async copyTo(id: string, targetProjectId?: string): Promise<TaskItem> {
    return backendApi.post<TaskItem>(`/api/v1/tasks/${id}/copy-to`, {
      targetProjectId: targetProjectId || undefined,
    })
  },
}

// ============================================
// 项目 API
// ============================================

export const projectsApi = {
  /** 查询项目列表（含统计） */
  async list(includeArchived = false): Promise<ProjectItem[]> {
    const qs = buildQuery({ includeArchived })
    return backendApi.get<ProjectItem[]>(`/api/v1/projects${qs}`)
  },

  /** 获取项目详情（含统计） */
  async getById(id: string): Promise<ProjectItem & { stats?: ProjectStats }> {
    return backendApi.get<ProjectItem & { stats?: ProjectStats }>(`/api/v1/projects/${id}`)
  },

  /** 获取项目下任务列表 */
  async getTasks(id: string): Promise<TaskItem[]> {
    return backendApi.get<TaskItem[]>(`/api/v1/projects/${id}/tasks`)
  },

  /** 创建项目 */
  async create(input: CreateProjectInput): Promise<ProjectItem> {
    return backendApi.post<ProjectItem>('/api/v1/projects', input)
  },

  /** 从模板创建项目（自动生成任务清单） */
  async createFromTemplate(templateId: string, name?: string): Promise<ProjectItem> {
    return backendApi.post<ProjectItem>('/api/v1/projects/from-template', { templateId, name })
  },

  /** 更新项目 */
  async update(id: string, input: UpdateProjectInput): Promise<ProjectItem> {
    return backendApi.patch<ProjectItem>(`/api/v1/projects/${id}`, input)
  },

  /** 删除项目（软删除，任务保留为独立任务） */
  async remove(id: string): Promise<void> {
    await backendApi.delete<void>(`/api/v1/projects/${id}`)
  },

  /** 归档项目 */
  async archive(id: string): Promise<ProjectItem> {
    return backendApi.post<ProjectItem>(`/api/v1/projects/${id}/archive`)
  },

  /** 获取可用项目模板 */
  async getTemplates(): Promise<unknown[]> {
    return backendApi.get<unknown[]>('/api/v1/projects/templates')
  },

  /** 批量创建 AI 生成的任务（前端已通过 callLLM 生成并解析） */
  async generateTasks(
    projectId: string,
    tasks: Array<{ title: string; description?: string; priority?: string; estimatedMin?: number }>,
    hint?: string,
  ): Promise<TaskItem[]> {
    return backendApi.post<TaskItem[]>(`/api/v1/projects/${projectId}/generate-tasks`, {
      tasks,
      hint: hint || undefined,
    })
  },
}

// ============================================
// 项目附件 API
// ============================================

/** 项目附件项 */
export interface ProjectAttachmentItem {
  id: string
  projectId: string
  fileName: string
  fileSize: number
  mimeType: string
  storageUrl: string
  textContent: string | null
  textTruncated: boolean
  hasText: boolean
  createdAt: string
}

export const projectAttachmentsApi = {
  /** 上传多个附件文件 */
  async upload(projectId: string, files: File[]): Promise<ProjectAttachmentItem[]> {
    const formData = new FormData()
    for (const file of files) {
      formData.append('files', file, file.name)
    }
    return backendApi.uploadFiles<ProjectAttachmentItem[]>(
      `/api/v1/projects/${projectId}/attachments`,
      formData,
    )
  },

  /** 查询项目附件列表 */
  async list(projectId: string): Promise<ProjectAttachmentItem[]> {
    return backendApi.get<ProjectAttachmentItem[]>(
      `/api/v1/projects/${projectId}/attachments`,
    )
  },

  /** 删除单个附件 */
  async remove(projectId: string, attachmentId: string): Promise<void> {
    await backendApi.delete<void>(
      `/api/v1/projects/${projectId}/attachments/${attachmentId}`,
    )
  },
}

// ============================================
// 自动化 API
// ============================================

export const automationApi = {
  /** 查询自动化规则列表 */
  async list(params: { projectId?: string; enabled?: boolean } = {}): Promise<AutomationRule[]> {
    const qs = buildQuery(params)
    return backendApi.get<AutomationRule[]>(`/api/v1/automation-rules${qs}`)
  },

  /** 获取规则详情 */
  async getById(id: string): Promise<AutomationRule> {
    return backendApi.get<AutomationRule>(`/api/v1/automation-rules/${id}`)
  },

  /** 创建规则 */
  async create(input: {
    name: string
    description?: string
    projectId?: string
    triggerType: string
    triggerConfig: Record<string, unknown>
    actionType: string
    actionConfig: Record<string, unknown>
    priority?: number
    cooldownSeconds?: number
    maxExecutions?: number
    enabled?: boolean
  }): Promise<AutomationRule> {
    return backendApi.post<AutomationRule>('/api/v1/automation-rules', input)
  },

  /** 从模板创建规则 */
  async createFromTemplate(templateId: string, name?: string, projectId?: string): Promise<AutomationRule> {
    return backendApi.post<AutomationRule>('/api/v1/automation-rules/from-template', { templateId, name, projectId })
  },

  /** 更新规则 */
  async update(id: string, input: {
    name?: string
    description?: string
    projectId?: string | null
    triggerConfig?: Record<string, unknown>
    actionConfig?: Record<string, unknown>
    enabled?: boolean
    priority?: number
    cooldownSeconds?: number
    maxExecutions?: number
  }): Promise<AutomationRule> {
    return backendApi.patch<AutomationRule>(`/api/v1/automation-rules/${id}`, input)
  },

  /** 删除规则（级联删除运行历史） */
  async remove(id: string): Promise<void> {
    await backendApi.delete<void>(`/api/v1/automation-rules/${id}`)
  },

  /** 手动执行规则 */
  async execute(id: string, payload?: Record<string, unknown>): Promise<unknown> {
    return backendApi.post<unknown>(`/api/v1/automation-rules/${id}/execute`, { payload })
  },

  /** 获取全局运行历史 */
  async listRuns(params: { limit?: number; offset?: number; status?: string } = {}): Promise<ListResponse<AutomationRun>> {
    const qs = buildQuery(params)
    return backendApi.get<ListResponse<AutomationRun>>(`/api/v1/automation-rules/runs${qs}`)
  },

  /** 获取某规则的运行历史 */
  async listRunsByRule(id: string, params: { limit?: number; offset?: number } = {}): Promise<ListResponse<AutomationRun>> {
    const qs = buildQuery(params)
    return backendApi.get<ListResponse<AutomationRun>>(`/api/v1/automation-rules/${id}/runs${qs}`)
  },

  /** 获取某规则的运行统计 */
  async getRunStats(id: string): Promise<AutomationRunStats> {
    return backendApi.get<AutomationRunStats>(`/api/v1/automation-rules/${id}/runs/stats`)
  },

  /** 获取可用模板 */
  async getTemplates(): Promise<AutomationTemplate[]> {
    return backendApi.get<AutomationTemplate[]>('/api/v1/automation-rules/templates')
  },

  /** 获取可用触发器类型 */
  async getTriggers(): Promise<TriggerDescriptor[]> {
    return backendApi.get<TriggerDescriptor[]>('/api/v1/automation-rules/triggers')
  },

  /** 获取可用动作类型 */
  async getActions(): Promise<ActionDescriptor[]> {
    return backendApi.get<ActionDescriptor[]>('/api/v1/automation-rules/actions')
  },
}

// ─── 统一错误处理 ───────────────────────────────────────

/** 提取后端错误消息，提供友好的回退文案 */
export function getApiErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof BackendApiError) {
    return err.message || fallback
  }
  if (err instanceof Error) {
    return err.message || fallback
  }
  return fallback
}

/** 安全执行异步操作，捕获异常并记录日志，返回 [data, error] 元组 */
export async function safeCall<T>(
  fn: () => Promise<T>,
  context: string,
): Promise<[T | null, string | null]> {
  try {
    const data = await fn()
    return [data, null]
  } catch (err) {
    const msg = getApiErrorMessage(err, '操作失败')
    logger.system.error(`[taskProjectApi] ${context}: ${msg}`)
    return [null, msg]
  }
}
