/**
 * 代码片段类型定义
 *
 * 代码片段（Snippet）用于：
 *  - 开发者快速插入常用样板代码（CRUD / 校验 / 错误处理 / 生命周期等）
 *  - AI 在生成场景时按需引用，避免重复造轮子
 *
 * 与 ExampleScenario 的区别：
 *  - Snippet 是单文件代码片段，插入到既有项目中（不创建新项目）
 *  - ExampleScenario 是完整场景，克隆后可独立运行
 */
import type { ScenarioType } from '../types'

/** 片段分类 */
export type SnippetCategory =
  | 'tool'        // 工具定义与执行器
  | 'validation'  // 参数校验
  | 'error'       // 错误处理
  | 'service'     // 服务模板
  | 'lifecycle'   // 生命周期钩子
  | 'database'    // 数据库脚本
  | 'ui'          // UI 组件片段
  | 'ipc'         // IPC 处理器
  | 'misc'        // 杂项

/** 可替换变量定义（用于插入时的简单模板替换） */
export interface SnippetVariable {
  /** 变量名（不带 ${} 包裹） */
  name: string
  /** 默认值 */
  defaultValue: string
  /** 英文描述 */
  description: string
  /** 中文描述 */
  descriptionZh: string
  /** 是否必填 */
  required?: boolean
}

/** 片段元信息（用于列表展示） */
export interface SnippetMeta {
  /** 唯一 ID */
  id: string
  /** 英文名 */
  name: string
  /** 中文名 */
  nameZh: string
  /** 英文描述 */
  description: string
  /** 中文描述 */
  descriptionZh: string
  /** 分类 */
  category: SnippetCategory
  /** 适用场景类型（declarative / programmatic / both） */
  applicableTypes: ScenarioType[] | ['both']
  /** 语言（typescript / sql / markdown / json） */
  language: string
  /** 图标名（lucide-react） */
  icon: string
  /** 标签 */
  tags: string[]
  /** 难度（beginner/intermediate/advanced） */
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  /** 目标文件路径建议（如 src/tools/index.ts） */
  targetFile?: string
}

/** 完整片段 = 元信息 + 代码 + 变量 */
export interface Snippet extends SnippetMeta {
  /** 代码内容（含 ${var} 占位符） */
  code: string
  /** 可替换变量列表 */
  variables: SnippetVariable[]
  /** 使用说明（中文） */
  usage?: string
}

/** 片段插入结果 */
export interface InsertSnippetResult {
  success: boolean
  /** 插入后的完整代码（仅当成功时返回） */
  insertedCode?: string
  /** 替换变量后的最终代码 */
  resolvedCode?: string
  error?: string
}
