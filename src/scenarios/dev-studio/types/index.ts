/**
 * dev-studio 场景类型定义
 */

export type ProjectStatus = 'active' | 'archived' | 'deleted'

export type DevSessionMode = 'solo' | 'collaborative'

export type DevSessionStatus = 'active' | 'paused' | 'completed'

export type BuildType = 'lint' | 'build' | 'test' | 'deploy' | 'preview'

export type BuildStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'

export type AgentRole = 'pm' | 'coder' | 'reviewer' | 'tester' | 'devops'

export type TemplateCategory = 'frontend' | 'backend' | 'fullstack' | 'mobile' | 'static' | 'library' | 'api' | 'cli'

export type ScaffoldType = 'inline' | 'git' | 'npm' | 'download'

export interface Project {
  id: string
  name: string
  description?: string
  templateId?: string
  localPath: string
  config: ProjectConfig
  status: ProjectStatus
  createdAt: string
  updatedAt: string
}

export interface ProjectConfig {
  typescript?: boolean
  tailwind?: boolean
  eslint?: boolean
  prettier?: boolean
  packageManager?: 'npm' | 'yarn' | 'pnpm' | 'bun'
  envVars?: Record<string, string>
  [key: string]: unknown
}

export interface DevSession {
  id: string
  projectId: string
  title?: string
  mode: DevSessionMode
  status: DevSessionStatus
  tasks: SessionTask[]
  createdAt: string
  updatedAt: string
}

export interface SessionTask {
  id: string
  title: string
  description?: string
  assignee?: AgentRole
  status: 'pending' | 'in_progress' | 'completed' | 'blocked'
  priority: 'high' | 'medium' | 'low'
  createdAt: string
  completedAt?: string
}

export interface BuildLog {
  id: string
  projectId: string
  sessionId?: string
  buildType: BuildType
  command?: string
  status: BuildStatus
  exitCode?: number
  output?: string
  durationMs?: number
  startedAt: string
  finishedAt?: string
}

export interface TemplateVariable {
  key: string
  label: string
  labelZh: string
  type: 'string' | 'boolean' | 'number' | 'select' | 'path'
  default?: string | number | boolean
  required?: boolean
  options?: { label: string; value: string }[]
  description?: string
  descriptionZh?: string
}

export interface TemplateScaffoldConfig {
  type: ScaffoldType
  url?: string
  branch?: string
  files?: Record<string, string>
  ignore?: string[]
  postInstall?: string[]
  preInstall?: string[]
}

export interface ProjectTemplate {
  id: string
  name: string
  nameZh: string
  description: string
  descriptionZh: string
  icon: string
  category: TemplateCategory
  tags: string[]
  variables: TemplateVariable[]
  scaffold: TemplateScaffoldConfig
  previewImage?: string
  featured?: boolean
  minAppVersion?: string
}

export interface AgentRoleDefinition {
  id: AgentRole
  name: string
  nameZh: string
  icon: string
  systemPrompt: string
  tools: string[]
  color: string
}

export interface PipelineStageConfig {
  id: string
  type: BuildType
  label: string
  labelZh: string
  command: string
  enabled: boolean
  timeout?: number
  env?: Record<string, string>
  dependsOn?: string[]
}

export interface PipelineConfig {
  id: string
  projectId: string
  name: string
  stages: PipelineStageConfig[]
  trigger?: 'manual' | 'push' | 'schedule'
  schedule?: string
  createdAt: string
  updatedAt: string
}

export interface CreateProjectOptions {
  name: string
  templateId: string
  localPath: string
  description?: string
  variables?: Record<string, string | number | boolean>
}

export interface ProjectScaffoldResult {
  success: boolean
  projectId?: string
  localPath?: string
  error?: string
  steps: ScaffoldStep[]
}

export interface ScaffoldStep {
  id: string
  status: 'pending' | 'running' | 'success' | 'failed'
  message: string
  error?: string
}