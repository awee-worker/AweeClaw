/**
 * 示例场景注册表
 *
 * 统一聚合所有内置示例场景，提供单一查询入口：
 *  - 内置示例：translator-assistant / doc-generator / kb-qa
 *  - 后续可扩展：官方推荐场景 / 社区精选
 *
 * 设计原则：
 *  - 单一数据源：所有示例在此导出
 *  - 按需扩展：新增示例只需在此文件追加一行 export
 *  - 与 Template 区分：Example 是完整成品，Template 是骨架
 */
import type { ExampleScenario, ExampleScenarioMeta } from './types'
import { translatorAssistantExample } from './translator-assistant'
import { docGeneratorExample } from './doc-generator'
import { kbQaExample } from './kb-qa'

// ==========================================
// 类型再导出
// ==========================================

export type { ExampleScenario, ExampleScenarioFile, ExampleScenarioMeta, CloneExampleResult } from './types'

// ==========================================
// 内置示例注册表
// ==========================================

/**
 * 内置示例列表
 *
 * 顺序约定：按难度递增（beginner → intermediate → advanced）
 */
export const BUILTIN_EXAMPLES: ExampleScenario[] = [
  translatorAssistantExample,
  docGeneratorExample,
  kbQaExample,
]

/** 示例 ID → 示例对象映射（O(1) 查找） */
export const BUILTIN_EXAMPLE_MAP: Record<string, ExampleScenario> = BUILTIN_EXAMPLES.reduce(
  (map, ex) => {
    map[ex.id] = ex
    return map
  },
  {} as Record<string, ExampleScenario>,
)

// ==========================================
// 查询 API
// ==========================================

/**
 * 获取所有内置示例的元信息（不含文件内容，避免传输冗余）
 *
 * 用于欢迎页 / 模板选择器列表展示
 */
export function listExampleMetas(filter?: {
  type?: 'declarative' | 'programmatic'
  difficulty?: 'beginner' | 'intermediate' | 'advanced'
  category?: string
}): ExampleScenarioMeta[] {
  return BUILTIN_EXAMPLES.filter((ex) => {
    if (filter?.type && ex.type !== filter.type) return false
    if (filter?.difficulty && ex.difficulty !== filter.difficulty) return false
    if (filter?.category && ex.category !== filter.category) return false
    return true
  }).map((ex) => ({
    id: ex.id,
    name: ex.name,
    nameZh: ex.nameZh,
    description: ex.description,
    descriptionZh: ex.descriptionZh,
    type: ex.type,
    category: ex.category,
    icon: ex.icon,
    tags: ex.tags,
    difficulty: ex.difficulty,
    highlights: ex.highlights,
    highlightsZh: ex.highlightsZh,
  }))
}

/** 根据 ID 获取示例完整内容（含文件） */
export function getExampleById(exampleId: string): ExampleScenario | null {
  return BUILTIN_EXAMPLE_MAP[exampleId] || null
}

/** 获取示例难度列表（用于 UI 筛选标签） */
export function getExampleDifficulties(): Array<{
  value: 'beginner' | 'intermediate' | 'advanced'
  label: string
  labelZh: string
}> {
  return [
    { value: 'beginner', label: 'Beginner', labelZh: '入门' },
    { value: 'intermediate', label: 'Intermediate', labelZh: '进阶' },
    { value: 'advanced', label: 'Advanced', labelZh: '高级' },
  ]
}
