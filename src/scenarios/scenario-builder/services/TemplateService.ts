/**
 * 模板服务（TemplateService）
 *
 * 职责：
 * 1. 提供模板列表查询 API（支持按类型/分类/关键字过滤）
 * 2. 根据模板 ID 获取模板详情
 * 3. 解析模板变量占位符（将 {{key}} 替换为实际值）
 * 4. 准备项目骨架参数（合并 scenarioConfigOverride / extraFiles / overrideFiles）
 *
 * 设计要点：
 * - 纯函数式服务，无副作用，不直接接触文件系统（文件操作交由主进程 IPC 完成）
 * - 通过 setContext 注入 ScenarioModuleContext，用于后续扩展（如读取本地自定义模板）
 * - 变量解析采用健壮的正则替换，支持缺省值回退
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import { getBuiltinTemplates, getBuiltinTemplateById } from '../templates'
import type {
  ScenarioTemplate,
  TemplateVariable,
  CreateFromTemplateOptions,
  CreateFromTemplateResult,
} from '../templates/types'

// ==========================================
// 类型定义
// ==========================================

/** 模板查询过滤器 */
export interface TemplateFilter {
  /** 类型过滤 */
  type?: 'declarative' | 'programmatic'
  /** 分类过滤 */
  category?: 'basic' | 'advanced' | 'official'
  /** 关键字（模糊匹配名称/描述/标签） */
  keyword?: string
}

/** 模板变量解析上下文 */
export interface TemplateVariableContext {
  /** 用户填写的变量值（key → value） */
  values: Record<string, string>
  /** 项目基础信息（自动注入，无需用户填写） */
  scenarioId: string
  name: string
  version: string
  author: string
  description?: string
}

/** 项目骨架生成参数（传给主进程 IPC） */
export interface ProjectScaffoldParams {
  localPath: string
  scenarioId: string
  name: string
  nameZh: string
  description?: string
  descriptionZh?: string
  author?: string
  version?: string
  category?: string
  type: 'declarative' | 'programmatic'
  /** 模板的 scenarioConfigOverride（用于覆盖默认 scenario.json 字段） */
  configOverride?: Record<string, unknown>
  /** 模板的额外文件（相对路径 → 内容，已替换变量占位符） */
  extraFiles?: Record<string, string>
  /** 模板的覆盖文件（相对路径 → 内容，已替换变量占位符） */
  overrideFiles?: Record<string, string>
}

// ==========================================
// 服务实现
// ==========================================

export class TemplateService {
  private context: ScenarioModuleContext | null = null

  /**
   * 注入场景上下文
   *
   * 当前实现主要用于：
   * - 通过 context.workspacePath 拼接本地模板路径（扩展点，后续支持用户自定义模板）
   * - 通过 context.getLogger() 输出调试日志
   * - 通过 context.executeSql() 持久化用户自定义模板（后续扩展）
   */
  setContext(context: ScenarioModuleContext): void {
    this.context = context
  }

  /**
   * 获取上下文（内部使用）
   */
  private getContext(): ScenarioModuleContext | null {
    return this.context
  }

  // ==========================================
  // 查询 API
  // ==========================================

  /**
   * 列出模板（支持过滤）
   */
  async listTemplates(filter?: TemplateFilter): Promise<ScenarioTemplate[]> {
    try {
      let templates = getBuiltinTemplates({
        type: filter?.type,
        category: filter?.category,
      })

      // 关键字模糊匹配（中英文名称、描述、标签）
      if (filter?.keyword) {
        const kw = filter.keyword.toLowerCase().trim()
        if (kw) {
          templates = templates.filter((tpl) => {
            const haystack = [
              tpl.id,
              tpl.name,
              tpl.nameZh,
              tpl.description,
              tpl.descriptionZh,
              ...tpl.tags,
            ]
              .join(' ')
              .toLowerCase()
            return haystack.includes(kw)
          })
        }
      }

      return templates
    } catch (err) {
      // 使用 context 的 logger 记录错误（若 context 可用）
      const ctx = this.getContext()
      if (ctx) {
        ctx.getLogger().error('[TemplateService] listTemplates failed:', err)
      }
      return []
    }
  }

  /**
   * 根据 ID 获取模板
   */
  async getTemplate(templateId: string): Promise<ScenarioTemplate | null> {
    const tpl = getBuiltinTemplateById(templateId)
    if (!tpl) {
      const ctx = this.getContext()
      if (ctx) {
        ctx.getLogger().warn(`[TemplateService] Template not found: ${templateId}`)
      }
    }
    return tpl
  }

  /**
   * 获取模板的可定制变量
   */
  async getTemplateVariables(templateId: string): Promise<TemplateVariable[]> {
    const tpl = getBuiltinTemplateById(templateId)
    if (!tpl) return []
    return tpl.variables ?? []
  }

  // ==========================================
  // 变量解析
  // ==========================================

  /**
   * 解析模板变量占位符
   *
   * 支持的占位符：
   * - {{name}} / {{scenarioId}} / {{version}} / {{author}} / {{description}} — 项目基础信息
   * - {{variableKey}} — 用户填写的自定义变量
   * - {{descriptionJson}} — 描述的 JSON 字符串形式（用于 TypeScript 模板中嵌入 JSON 字面量）
   *
   * 未匹配的占位符保留原样（避免误伤用户内容）
   */
  resolveVariables(content: string, ctx: TemplateVariableContext): string {
    if (!content) return content

    // 合并基础信息 + 用户变量
    const allVars: Record<string, string> = {
      scenarioId: ctx.scenarioId,
      name: ctx.name,
      version: ctx.version,
      author: ctx.author,
      description: ctx.description ?? '',
      ...ctx.values,
    }

    // descriptionJson：将描述转为 JSON 字符串字面量（含引号），用于嵌入 TypeScript 代码
    const descriptionJson = JSON.stringify(ctx.description ?? ctx.values.description ?? '')

    // 先替换 descriptionJson（避免被通用正则覆盖）
    let resolved = content.replace(/\{\{\s*descriptionJson\s*\}\}/g, () => descriptionJson)

    // 通用变量替换：{{key}} → value
    resolved = resolved.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
      const value = allVars[key]
      if (value === undefined || value === null) {
        // 未找到变量值，保留原占位符（便于发现配置错误）
        return match
      }
      return String(value)
    })

    return resolved
  }

  /**
   * 批量解析文件内容
   */
  resolveFiles(
    files: Record<string, string> | undefined,
    ctx: TemplateVariableContext,
  ): Record<string, string> {
    if (!files) return {}
    const result: Record<string, string> = {}
    for (const [relPath, content] of Object.entries(files)) {
      // 路径也支持变量替换（如 {{scenarioId}}.json）
      const resolvedPath = this.resolveVariables(relPath, ctx)
      result[resolvedPath] = this.resolveVariables(content, ctx)
    }
    return result
  }

  // ==========================================
  // 项目骨架参数准备
  // ==========================================

  /**
   * 根据模板和用户输入，准备项目骨架参数
   *
   * 流程：
   * 1. 校验必填变量
   * 2. 合并变量值与基础信息
   * 3. 解析 extraFiles / overrideFiles 的占位符
   * 4. 组装 ProjectScaffoldParams 供主进程 IPC 使用
   */
  prepareScaffoldParams(options: CreateFromTemplateOptions): {
    success: boolean
    params?: ProjectScaffoldParams
    error?: string
    steps: CreateFromTemplateResult['steps']
  } {
    const steps: CreateFromTemplateResult['steps'] = []

    // 1. 查找模板
    const template = getBuiltinTemplateById(options.templateId)
    if (!template) {
      steps.push({ id: 'template', status: 'failed', message: `模板不存在: ${options.templateId}` })
      return { success: false, error: `模板不存在: ${options.templateId}`, steps }
    }
    steps.push({ id: 'template', status: 'success', message: `已找到模板: ${template.nameZh || template.name}` })

    // 2. 校验必填变量
    const variables = template.variables ?? []
    const missing: string[] = []
    for (const v of variables) {
      if (v.required) {
        const val = options.variableValues?.[v.key] ?? v.defaultValue ?? ''
        if (!val.trim()) {
          missing.push(v.label || v.labelEn || v.key)
        }
      }
    }
    if (missing.length > 0) {
      steps.push({ id: 'validate', status: 'failed', message: `缺少必填变量: ${missing.join(', ')}` })
      return { success: false, error: `缺少必填变量: ${missing.join(', ')}`, steps }
    }
    steps.push({ id: 'validate', status: 'success', message: '变量校验通过' })

    // 3. 合并变量值（用户输入 > 默认值）
    const mergedValues: Record<string, string> = {}
    for (const v of variables) {
      const userVal = options.variableValues?.[v.key]
      mergedValues[v.key] = userVal !== undefined && userVal !== ''
        ? userVal
        : (v.defaultValue ?? '')
    }

    // 4. 构造变量解析上下文
    const name = options.name
    const scenarioId = options.scenarioId
    const version = options.version || '1.0.0'
    const author = options.author || 'developer'
    const description = options.description || mergedValues.description || ''

    const ctx: TemplateVariableContext = {
      values: mergedValues,
      scenarioId,
      name,
      version,
      author,
      description,
    }

    // 5. 解析文件内容
    const extraFiles = this.resolveFiles(template.extraFiles, ctx)
    const overrideFiles = this.resolveFiles(template.overrideFiles, ctx)

    // 6. 组装参数
    const params: ProjectScaffoldParams = {
      localPath: options.localPath || '', // 由调用方填充默认路径
      scenarioId,
      name,
      nameZh: name, // 简化：中文名默认等于项目名
      description,
      descriptionZh: description,
      author,
      version,
      category: (template.scenarioConfigOverride?.category as string) || 'custom',
      type: template.type,
      configOverride: template.scenarioConfigOverride as Record<string, unknown> | undefined,
      extraFiles,
      overrideFiles,
    }

    steps.push({ id: 'prepare', status: 'success', message: '骨架参数已准备完毕' })

    return { success: true, params, steps }
  }
}

// ==========================================
// 单例导出
// ==========================================

export const templateService = new TemplateService()
