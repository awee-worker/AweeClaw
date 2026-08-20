/**
 * 场景开发助手（scenario-builder）类型定义
 */

// ==========================================
// 项目状态与类型
// ==========================================

/** 项目状态 */
export type ProjectStatus = 'draft' | 'developing' | 'building' | 'ready' | 'published' | 'archived'

/** 场景类型 */
export type ScenarioType = 'declarative' | 'programmatic'

/** 项目类型（声明式 / 编程式） */
export interface ProjectKind {
  type: ScenarioType
  template?: string
}

// ==========================================
// 项目核心模型
// ==========================================

/** 场景开发项目 */
export interface ScenarioProject {
  id: string
  name: string
  scenarioId: string
  version: string
  description: string
  type: ScenarioType
  localPath: string
  config: ProjectConfig
  status: ProjectStatus
  author: string
  tags: string[]
  createdAt: string
  updatedAt: string
  lastBuiltAt?: string
  lastPublishedAt?: string
}

/** 项目配置 */
export interface ProjectConfig {
  icon?: string
  category?: string
  minAppVersion?: string
  permissions?: string[]
  dependencies?: Array<{ scenarioId: string; version: string }>
  envVars?: Record<string, string>
  [key: string]: unknown
}

// ==========================================
// 构建与调试
// ==========================================

export type BuildType = 'validate' | 'build' | 'pack' | 'dev'
export type BuildStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'

/** 构建记录 */
export interface BuildRecord {
  id: string
  projectId: string
  buildType: BuildType
  command: string
  status: BuildStatus
  exitCode?: number
  output: string
  durationMs: number
  startedAt: string
  finishedAt?: string
}

/** 校验结果 */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: ValidationWarning[]
}

export interface ValidationError {
  field: string
  message: string
  code: string
}

export interface ValidationWarning {
  field: string
  message: string
  code: string
}

// ==========================================
// 安装与发布
// ==========================================

export type InstallStatus = 'pending' | 'installing' | 'installed' | 'failed' | 'uninstalled'
export type PublishStatus = 'pending' | 'uploading' | 'published' | 'failed' | 'rejected'

/** 安装记录 */
export interface InstallRecord {
  id: string
  projectId: string
  /** 已安装场景的 scenarioId（用于卸载） */
  scenarioId?: string
  version: string
  packagePath: string
  status: InstallStatus
  error?: string
  installedAt: string
}

/** 发布记录 */
export interface PublishRecord {
  id: string
  projectId: string
  version: string
  packageName: string
  status: PublishStatus
  marketplaceId?: string
  downloadUrl?: string
  error?: string
  publishedAt: string
}

// ==========================================
// 模板
// ==========================================
//
// 注意：ScenarioTemplate 接口已迁移至 templates/types.ts
// 此处保留空注释区段，避免下游 import 路径变更产生破坏性改动
// 新代码请从 '../../templates' 或 '../../templates/types' 导入

// ==========================================
// 创建项目选项
// ==========================================

export interface CreateProjectOptions {
  name: string
  scenarioId: string
  version?: string
  description?: string
  type: ScenarioType
  localPath?: string
  templateId?: string
  author?: string
  tags?: string[]
  config?: ProjectConfig
}

/** 项目创建结果 */
export interface CreateProjectResult {
  success: boolean
  project?: ScenarioProject
  localPath?: string
  error?: string
  steps: Array<{ id: string; status: 'pending' | 'running' | 'success' | 'failed'; message: string }>
}
