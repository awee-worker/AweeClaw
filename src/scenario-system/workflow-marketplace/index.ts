/**
 * 工作流模板市场（Phase 5）
 *
 * 扩展 marketplace 支持工作流模板的浏览、下载、安装和发布。
 * 工作流模板是预定义的 WorkflowDefinition，用户可以一键导入使用。
 *
 * 架构：
 *   渲染进程 → backendApi → 后端 marketplace API → 返回模板列表
 *   渲染进程 → IPC → 主进程 → 下载+校验+导入到 WorkflowEngine
 *
 * @module scenario-system/workflow-marketplace
 */

import type { WorkflowDefinition } from '@shared/protocols/workflow'

// ============================================
// 工作流模板类型定义
// ============================================

/** 工作流模板市场项 */
export interface WorkflowTemplate {
  /** 模板唯一标识 */
  id: string
  /** 模板名称 */
  name: string
  /** 中文名称 */
  nameZh: string
  /** 描述 */
  description: string
  /** 中文描述 */
  descriptionZh: string
  /** 图标（lucide 图标名） */
  icon: string
  /** 版本号 */
  version: string
  /** 作者 */
  author: string
  /** 分类 */
  category: WorkflowTemplateCategory
  /** 标签 */
  tags: string[]
  /** 下载次数 */
  downloads: number
  /** 评分（0-5） */
  rating: number
  /** 评分人数 */
  ratingCount: number
  /** 发布时间 */
  publishedAt: string
  /** 更新时间 */
  updatedAt: string
  /** 下载 URL */
  downloadUrl: string
  /** 校验和 */
  checksum: string
  /** 最小应用版本 */
  minAppVersion: string
  /** 许可证 */
  license: string
  /** 主页 URL */
  homepage: string
  /** 是否免费 */
  isFree: boolean
  /** 价格（非免费时） */
  price?: number
  /** 所需权限 */
  permissions: string[]
  /** 步骤数 */
  stepCount: number
  /** 预估执行时间（毫秒） */
  estimatedDuration: number
  /** 支持的平台 */
  platforms: Array<'darwin' | 'win32' | 'linux'>
  /** 截图 URL 列表 */
  screenshotUrls: string[]
}

/** 工作流模板分类 */
export type WorkflowTemplateCategory =
  | 'automation'      // 自动化
  | 'productivity'    // 效率
  | 'data-processing' // 数据处理
  | 'file-management' // 文件管理
  | 'testing'         // 测试
  | 'monitoring'      // 监控
  | 'social'          // 社交
  | 'custom'          // 自定义

/** 模板搜索结果 */
export interface WorkflowTemplateSearchResult {
  total: number
  page: number
  pageSize: number
  templates: WorkflowTemplate[]
}

/** 模板分类信息 */
export interface WorkflowTemplateCategoryInfo {
  id: WorkflowTemplateCategory
  name: string
  nameZh: string
  icon: string
  count: number
}

/** 模板安装结果 */
export interface WorkflowTemplateInstallResult {
  installed: boolean
  workflowId: string
  version: string
  error?: string
  /** 导入的工作流定义 */
  workflow?: WorkflowDefinition
}

/** 模板更新信息 */
export interface WorkflowTemplateUpdateInfo {
  templateId: string
  templateName: string
  templateNameZh: string
  currentVersion: string
  latestVersion: string
  changelog: string
  minAppVersion: string
}

/** 模板发布请求 */
export interface PublishTemplateRequest {
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  icon: string
  category: WorkflowTemplateCategory
  tags: string[]
  license: string
  isFree: boolean
  price?: number
  /** 工作流定义 JSON */
  workflow: WorkflowDefinition
  /** 截图 URL 列表 */
  screenshotUrls: string[]
}

/** 模板发布结果 */
export interface PublishTemplateResult {
  published: boolean
  templateId: string
  error?: string
}

// ============================================
// 工作流模板市场 API 接口
// ============================================

export interface WorkflowTemplateMarketplaceAPI {
  /** 搜索模板 */
  search(query: string, page?: number, pageSize?: number): Promise<WorkflowTemplateSearchResult>
  /** 按分类获取模板 */
  getByCategory(category: WorkflowTemplateCategory, page?: number, pageSize?: number): Promise<WorkflowTemplateSearchResult>
  /** 获取精选模板 */
  getFeatured(): Promise<WorkflowTemplate[]>
  /** 获取模板详情 */
  getDetails(templateId: string): Promise<WorkflowTemplate | null>
  /** 获取所有分类 */
  getCategories(): Promise<WorkflowTemplateCategoryInfo[]>
  /** 下载并安装模板 */
  install(templateId: string, targetVersion?: string): Promise<WorkflowTemplateInstallResult>
  /** 检查更新 */
  checkUpdates(templates: Array<{ id: string; version: string }>): Promise<WorkflowTemplateUpdateInfo[]>
  /** 发布模板 */
  publish(request: PublishTemplateRequest): Promise<PublishTemplateResult>
  /** 卸载已安装的模板 */
  uninstall(templateId: string): Promise<{ success: boolean; error?: string }>
  /** 获取已安装的模板列表 */
  getInstalled(): Promise<Array<{ id: string; version: string; installedAt: string }>>
}

// ============================================
// Mock 实现（实际由后端 API 提供）
// ============================================

class MockWorkflowTemplateAPI implements WorkflowTemplateMarketplaceAPI {
  async search(_query: string, page = 1, pageSize = 20): Promise<WorkflowTemplateSearchResult> {
    return { total: 0, page, pageSize, templates: [] }
  }

  async getByCategory(_category: WorkflowTemplateCategory, page = 1, pageSize = 20): Promise<WorkflowTemplateSearchResult> {
    return { total: 0, page, pageSize, templates: [] }
  }

  async getFeatured(): Promise<WorkflowTemplate[]> {
    return []
  }

  async getDetails(_templateId: string): Promise<WorkflowTemplate | null> {
    return null
  }

  async getCategories(): Promise<WorkflowTemplateCategoryInfo[]> {
    return [
      { id: 'automation', name: 'Automation', nameZh: '自动化', icon: 'Cpu', count: 0 },
      { id: 'productivity', name: 'Productivity', nameZh: '效率', icon: 'Zap', count: 0 },
      { id: 'data-processing', name: 'Data Processing', nameZh: '数据处理', icon: 'Database', count: 0 },
      { id: 'file-management', name: 'File Management', nameZh: '文件管理', icon: 'Folder', count: 0 },
      { id: 'testing', name: 'Testing', nameZh: '测试', icon: 'TestTube', count: 0 },
      { id: 'monitoring', name: 'Monitoring', nameZh: '监控', icon: 'Activity', count: 0 },
      { id: 'social', name: 'Social', nameZh: '社交', icon: 'MessageCircle', count: 0 },
    ]
  }

  async install(_templateId: string, _targetVersion?: string): Promise<WorkflowTemplateInstallResult> {
    return {
      installed: false,
      workflowId: '',
      version: '',
      error: 'Workflow template marketplace is not yet available',
    }
  }

  async checkUpdates(_templates: Array<{ id: string; version: string }>): Promise<WorkflowTemplateUpdateInfo[]> {
    return []
  }

  async publish(_request: PublishTemplateRequest): Promise<PublishTemplateResult> {
    return {
      published: false,
      templateId: '',
      error: 'Publishing is not yet available',
    }
  }

  async uninstall(_templateId: string): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'Not implemented' }
  }

  async getInstalled(): Promise<Array<{ id: string; version: string; installedAt: string }>> {
    return []
  }
}

/** 工作流模板市场 API 实例 */
export const workflowTemplateAPI: WorkflowTemplateMarketplaceAPI = new MockWorkflowTemplateAPI()

// ============================================
// 本地模板导入/导出工具
// ============================================

/** 导出工作流为模板 JSON 文件 */
export function exportWorkflowAsTemplate(workflow: WorkflowDefinition): string {
  const template = {
    format: 'aweeclaw-workflow-template',
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    workflow,
  }
  return JSON.stringify(template, null, 2)
}

/** 从模板 JSON 导入工作流 */
export function importWorkflowFromTemplate(json: string): WorkflowDefinition {
  const parsed = JSON.parse(json) as {
    format?: string
    version?: string
    workflow?: WorkflowDefinition
  }

  if (parsed.format !== 'aweeclaw-workflow-template') {
    throw new Error('Invalid template format: expected "aweeclaw-workflow-template"')
  }

  if (!parsed.workflow) {
    throw new Error('Template missing workflow definition')
  }

  const workflow = parsed.workflow
  if (!workflow.id || !workflow.name || !workflow.steps || !Array.isArray(workflow.steps)) {
    throw new Error('Invalid workflow definition in template')
  }

  return workflow
}

/** 验证工作流模板 JSON 合法性 */
export function validateTemplateJson(json: string): { valid: boolean; error?: string } {
  try {
    importWorkflowFromTemplate(json)
    return { valid: true }
  } catch (err) {
    return { valid: false, error: err instanceof Error ? err.message : String(err) }
  }
}
