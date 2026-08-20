/**
 * 场景模板类型定义
 *
 * 模板用于快速创建场景项目骨架，包含：
 * - 元信息（id/name/description/category/icon）
 * - scenarioConfigOverride：覆盖默认 scenario.json 的字段
 * - extraFiles：在基础骨架之上额外写入/覆盖的文件（相对路径 → 内容）
 * - variables：可定制变量（创建时让用户填写，注入到文件内容中）
 */

import type { ScenarioType } from '../types'

/** 模板变量定义 */
export interface TemplateVariable {
  /** 变量键（注入到文件内容中用 {{key}} 占位） */
  key: string
  /** 显示标签（中文） */
  label: string
  /** 显示标签（英文） */
  labelEn: string
  /** 默认值 */
  defaultValue?: string
  /** 是否必填 */
  required?: boolean
  /** 占位提示 */
  placeholder?: string
}

/** scenario.json 配置覆盖（按字段路径覆盖默认配置） */
export interface ScenarioConfigOverride {
  /** 场景分类 */
  category?: string
  /** 图标名（lucide-react） */
  icon?: string
  /** 场景能力配置（声明式场景的 capabilities） */
  capabilities?: Record<string, unknown>
  /** UI 配置 */
  ui?: Record<string, unknown>
  /** 数据库脚本配置 */
  database?: Record<string, unknown>
  /** 生命周期脚本配置 */
  scripts?: Record<string, unknown>
  /** 权限列表 */
  permissions?: string[]
  /** 依赖场景 */
  dependencies?: Array<{ scenarioId: string; version: string }>
  /** 最低客户端版本 */
  minAppVersion?: string
  /** 编程式入口文件 */
  entryPoint?: string
  /** 编程式共享依赖 */
  sharedDeps?: Record<string, string>
  /** 额外字段（用于扩展） */
  [key: string]: unknown
}

/** 场景模板 */
export interface ScenarioTemplate {
  /** 模板 ID（唯一） */
  id: string
  /** 英文名 */
  name: string
  /** 中文名 */
  nameZh: string
  /** 英文描述 */
  description: string
  /** 中文描述 */
  descriptionZh: string
  /** 模板类型 */
  type: ScenarioType
  /** 分类（basic/advanced/official） */
  category: 'basic' | 'advanced' | 'official'
  /** 图标名（lucide-react） */
  icon: string
  /** 标签 */
  tags: string[]
  /** scenario.json 配置覆盖 */
  scenarioConfigOverride?: ScenarioConfigOverride
  /** 额外文件（相对路径 → 内容，支持 {{variable}} 占位符替换） */
  extraFiles?: Record<string, string>
  /** 需要覆盖基础骨架的文件列表（相对路径 → 内容） */
  overrideFiles?: Record<string, string>
  /** 可定制变量 */
  variables?: TemplateVariable[]
  /** 模板预览（用于画廊展示，列出关键文件树） */
  previewStructure?: string[]
}

/** 从模板创建项目的参数 */
export interface CreateFromTemplateOptions {
  /** 模板 ID */
  templateId: string
  /** 项目名 */
  name: string
  /** 场景 ID */
  scenarioId: string
  /** 版本号 */
  version?: string
  /** 作者 */
  author?: string
  /** 描述 */
  description?: string
  /** 项目目录（默认 workspace/scenarios/{scenarioId}） */
  localPath?: string
  /** 变量值（key → value） */
  variableValues?: Record<string, string>
}

/** 从模板创建项目的结果 */
export interface CreateFromTemplateResult {
  success: boolean
  project?: {
    id: string
    name: string
    scenarioId: string
    version: string
    localPath: string
  }
  error?: string
  steps: Array<{
    id: string
    status: 'pending' | 'running' | 'success' | 'failed'
    message: string
  }>
}
