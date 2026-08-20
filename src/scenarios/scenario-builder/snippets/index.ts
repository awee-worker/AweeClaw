/**
 * 代码片段注册表与查询 API
 *
 * 用法：
 *  - listSnippetMetas()      → 列出所有片段元信息（用于 UI 列表）
 *  - getSnippetById(id)      → 获取完整片段（含代码）
 *  - resolveSnippet(id, vars) → 替换变量后返回最终代码
 *
 * 与 examples/ 的区别：
 *  - examples 是完整场景，克隆后独立运行
 *  - snippets 是单文件片段，插入到既有项目（不创建新项目）
 */
import type {
  Snippet,
  SnippetMeta,
  SnippetCategory,
} from './types'
import type { ScenarioType } from '../types'

import {
  toolDefinitionSnippet,
  toolExecutorSnippet,
  toolCrudSetSnippet,
  toolCrudExecutorsSnippet,
} from './tool-crud'
import {
  validateStringSnippet,
  validateNumberSnippet,
  validateArraySnippet,
  validateObjectSnippet,
} from './param-validate'
import {
  tryCatchResultSnippet,
  customErrorClassSnippet,
  errorCodeRegistrySnippet,
} from './error-handler'
import {
  serviceClassSnippet,
  serviceFactorySnippet,
} from './service-template'
import {
  lifecycleActivateSnippet,
  lifecycleDeactivateSnippet,
  lifecycleHealthCheckSnippet,
  lifecycleFullSnippet,
} from './lifecycle-hook'
import {
  dbInstallBasicSnippet,
  dbInstallAuditSnippet,
  dbInstallFkSnippet,
  dbUninstallBasicSnippet,
  dbSeedDataSnippet,
} from './db-install'

// ==========================================
// 注册表
// ==========================================

export const BUILTIN_SNIPPETS: Snippet[] = [
  // 工具相关
  toolDefinitionSnippet,
  toolExecutorSnippet,
  toolCrudSetSnippet,
  toolCrudExecutorsSnippet,

  // 参数校验
  validateStringSnippet,
  validateNumberSnippet,
  validateArraySnippet,
  validateObjectSnippet,

  // 错误处理
  tryCatchResultSnippet,
  customErrorClassSnippet,
  errorCodeRegistrySnippet,

  // 服务模板
  serviceClassSnippet,
  serviceFactorySnippet,

  // 生命周期钩子
  lifecycleActivateSnippet,
  lifecycleDeactivateSnippet,
  lifecycleHealthCheckSnippet,
  lifecycleFullSnippet,

  // 数据库
  dbInstallBasicSnippet,
  dbInstallAuditSnippet,
  dbInstallFkSnippet,
  dbUninstallBasicSnippet,
  dbSeedDataSnippet,
]

/** id → Snippet 映射，加速查找 */
export const BUILTIN_SNIPPET_MAP: Record<string, Snippet> = BUILTIN_SNIPPETS.reduce(
  (map, sn) => {
    map[sn.id] = sn
    return map
  },
  {} as Record<string, Snippet>,
)

/** 分类列表（用于 UI 分组展示） */
export const SNIPPET_CATEGORIES: Array<{ value: SnippetCategory; label: string; labelZh: string; icon: string }> = [
  { value: 'tool', label: 'Tool', labelZh: '工具', icon: 'Wrench' },
  { value: 'validation', label: 'Validation', labelZh: '参数校验', icon: 'CheckSquare' },
  { value: 'error', label: 'Error Handling', labelZh: '错误处理', icon: 'ShieldAlert' },
  { value: 'service', label: 'Service', labelZh: '服务', icon: 'Server' },
  { value: 'lifecycle', label: 'Lifecycle', labelZh: '生命周期', icon: 'Power' },
  { value: 'database', label: 'Database', labelZh: '数据库', icon: 'Database' },
  { value: 'ui', label: 'UI Component', labelZh: 'UI 组件', icon: 'Layout' },
  { value: 'ipc', label: 'IPC Handler', labelZh: 'IPC 处理器', icon: 'Plug' },
  { value: 'misc', label: 'Misc', labelZh: '杂项', icon: 'Package' },
]

// ==========================================
// 查询 API
// ==========================================

/**
 * 列出片段元信息（不含 code）
 * 支持按分类、场景类型、难度过滤
 */
export function listSnippetMetas(filter?: {
  category?: SnippetCategory
  type?: ScenarioType | 'both'
  difficulty?: 'beginner' | 'intermediate' | 'advanced'
  tag?: string
}): SnippetMeta[] {
  return BUILTIN_SNIPPETS.filter((sn) => {
    if (filter?.category && sn.category !== filter.category) return false
    if (filter?.type) {
      const applicable = sn.applicableTypes as readonly string[]
      const matches = applicable.includes(filter.type) || applicable.includes('both')
      if (!matches) return false
    }
    if (filter?.difficulty && sn.difficulty !== filter.difficulty) return false
    if (filter?.tag && !sn.tags.includes(filter.tag)) return false
    return true
  }).map((sn) => ({
    id: sn.id,
    name: sn.name,
    nameZh: sn.nameZh,
    description: sn.description,
    descriptionZh: sn.descriptionZh,
    category: sn.category,
    applicableTypes: sn.applicableTypes,
    language: sn.language,
    icon: sn.icon,
    tags: sn.tags,
    difficulty: sn.difficulty,
    targetFile: sn.targetFile,
  }))
}

/**
 * 按 id 获取完整片段（含 code）
 */
export function getSnippetById(snippetId: string): Snippet | null {
  return BUILTIN_SNIPPET_MAP[snippetId] || null
}

/**
 * 替换片段中的 ${var} 占位符
 * @param snippet 目标片段
 * @param values 变量值映射（未提供的变量使用默认值；必填变量缺失时报错）
 */
export function resolveSnippet(
  snippet: Snippet,
  values: Record<string, string> = {},
): { success: boolean; code?: string; error?: string; missing?: string[] } {
  const missing: string[] = []

  // 1. 校验必填变量
  for (const v of snippet.variables) {
    if (v.required) {
      const provided = values[v.name]
      if (provided === undefined || provided === null || provided === '') {
        // 允许使用默认值
        if (v.defaultValue) {
          values[v.name] = v.defaultValue
        } else {
          missing.push(v.name)
        }
      }
    } else if (values[v.name] === undefined || values[v.name] === '') {
      if (v.defaultValue) values[v.name] = v.defaultValue
    }
  }

  if (missing.length > 0) {
    return { success: false, error: `缺少必填变量：${missing.join(', ')}`, missing }
  }

  // 2. 替换 ${var}（避免对代码内部 ${expr} 求值，仅替换 variables 中声明的）
  let code = snippet.code
  for (const v of snippet.variables) {
    const value = values[v.name] ?? v.defaultValue ?? ''
    // 使用 split-join 替换字面 ${var}，避免正则歧义
    code = code.split(`\${${v.name}}`).join(value)
  }

  return { success: true, code }
}

/**
 * 列出指定片段的可替换变量定义
 */
export function getSnippetVariables(snippetId: string): Array<{
  name: string
  defaultValue: string
  description: string
  descriptionZh: string
  required?: boolean
}> {
  const sn = getSnippetById(snippetId)
  if (!sn) return []
  return sn.variables
}
