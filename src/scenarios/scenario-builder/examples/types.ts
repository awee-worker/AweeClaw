/**
 * 示例场景类型定义
 *
 * 示例场景用于：
 *  - 用户学习：完整可读的真实场景，可直接克隆到本地体验
 *  - AI 向导参考：提供"模式样本"，让 AI 在生成新场景时引用既有的成熟实现
 *
 * 与 ScenarioTemplate 的区别：
 *  - Template 是骨架 + 配置覆盖，文件内容由模板变量驱动
 *  - ExampleScenario 是完整的成品场景，文件内容固定（克隆后可直接安装运行）
 */
import type { ScenarioType } from '../types'

/** 示例场景内的单个文件 */
export interface ExampleScenarioFile {
  /** 相对路径（基于项目根目录） */
  path: string
  /** 文件内容 */
  content: string
  /** 简短说明（用于文件树展示） */
  description?: string
}

/** 示例场景元信息 */
export interface ExampleScenarioMeta {
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
  /** 场景类型 */
  type: ScenarioType
  /** 分类（用于 UI 分组） */
  category: string
  /** 图标名（lucide-react） */
  icon: string
  /** 标签 */
  tags: string[]
  /** 难度（beginner/intermediate/advanced） */
  difficulty: 'beginner' | 'intermediate' | 'advanced'
  /** 示例亮点（英文） */
  highlights: string[]
  /** 示例亮点（中文） */
  highlightsZh: string[]
}

/** 完整示例场景 = 元信息 + 文件清单 */
export interface ExampleScenario extends ExampleScenarioMeta {
  /** 示例包含的所有文件 */
  files: ExampleScenarioFile[]
  /** 文件树预览（用于 UI 列表展示，相对路径数组） */
  previewStructure: string[]
}

/** 克隆结果 */
export interface CloneExampleResult {
  success: boolean
  exampleId: string
  /** 克隆后的本地路径 */
  localPath?: string
  /** 写入的文件数 */
  filesWritten?: number
  error?: string
}
