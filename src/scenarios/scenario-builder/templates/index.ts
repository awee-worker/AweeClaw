/**
 * 场景模板注册表
 *
 * 统一聚合所有内置模板，提供单一查询入口：
 * - 内置模板（basic / advanced 分类）
 * - 后续可扩展：用户自定义模板 / 市场模板
 *
 * 设计原则：
 * - 单一数据源（Single Source of Truth）：所有模板在此导出
 * - 按需扩展：新增模板只需在此文件追加一行 export，无需改动调用方
 * - 类型完备：导出 ScenarioTemplate 类型供下游使用
 */
import type { ScenarioTemplate } from './types'
import { declarativeBasicTemplate } from './declarative-basic'
import { declarativeWithToolsTemplate } from './declarative-with-tools'
import { programmaticBasicTemplate } from './programmatic-basic'
import { programmaticFullTemplate } from './programmatic-full'

// ==========================================
// 类型再导出（供下游模块使用，避免循环依赖）
// ==========================================

export type { ScenarioTemplate, TemplateVariable, CreateFromTemplateOptions, CreateFromTemplateResult, ScenarioConfigOverride } from './types'

// ==========================================
// 内置模板注册表
// ==========================================

/**
 * 内置模板列表
 *
 * 顺序约定：
 * - basic 分类优先（适合新手）
 * - advanced 分类其次（适合进阶）
 * - 同分类内：declarative 优先于 programmatic（声明式更易上手）
 */
export const BUILTIN_TEMPLATES: ScenarioTemplate[] = [
  declarativeBasicTemplate,
  declarativeWithToolsTemplate,
  programmaticBasicTemplate,
  programmaticFullTemplate,
]

/**
 * 模板 ID → 模板对象 映射（O(1) 查找）
 *
 * 用于 createProjectFromTemplate 时根据 templateId 快速定位
 */
export const BUILTIN_TEMPLATE_MAP: Record<string, ScenarioTemplate> = BUILTIN_TEMPLATES.reduce(
  (map, tpl) => {
    map[tpl.id] = tpl
    return map
  },
  {} as Record<string, ScenarioTemplate>,
)

// ==========================================
// 查询 API
// ==========================================

/**
 * 获取所有内置模板
 *
 * @param filters 可选过滤器
 *  - type: 仅返回指定类型（declarative / programmatic）
 *  - category: 仅返回指定分类（basic / advanced / official）
 */
export function getBuiltinTemplates(filters?: {
  type?: 'declarative' | 'programmatic'
  category?: 'basic' | 'advanced' | 'official'
}): ScenarioTemplate[] {
  if (!filters) return [...BUILTIN_TEMPLATES]
  return BUILTIN_TEMPLATES.filter((tpl) => {
    if (filters.type && tpl.type !== filters.type) return false
    if (filters.category && tpl.category !== filters.category) return false
    return true
  })
}

/**
 * 根据 ID 获取内置模板
 *
 * @returns 模板对象，不存在返回 null
 */
export function getBuiltinTemplateById(templateId: string): ScenarioTemplate | null {
  return BUILTIN_TEMPLATE_MAP[templateId] || null
}

/**
 * 获取模板分类列表（用于 UI 筛选标签）
 */
export function getTemplateCategories(): Array<{ value: 'basic' | 'advanced' | 'official'; label: string; labelZh: string }> {
  return [
    { value: 'basic', label: 'Basic', labelZh: '基础' },
    { value: 'advanced', label: 'Advanced', labelZh: '进阶' },
    { value: 'official', label: 'Official', labelZh: '官方' },
  ]
}

/**
 * 获取模板类型列表（用于 UI 筛选标签）
 */
export function getTemplateTypes(): Array<{ value: 'declarative' | 'programmatic'; label: string; labelZh: string }> {
  return [
    { value: 'declarative', label: 'Declarative', labelZh: '声明式' },
    { value: 'programmatic', label: 'Programmatic', labelZh: '编程式' },
  ]
}
