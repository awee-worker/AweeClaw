/**
 * 场景项目管理服务
 *
 * 负责场景项目的 CRUD 操作，通过场景上下文操作独立 SQLite 数据库。
 * 项目目录默认放在工作区根目录的 scenarios/ 文件夹下。
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import type {
  ScenarioProject,
  ProjectStatus,
  CreateProjectOptions,
  CreateProjectResult,
} from '../types'

function generateId(): string {
  return `sb-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export class ProjectService {
  private context: ScenarioModuleContext | null = null

  setContext(context: ScenarioModuleContext): void {
    this.context = context
  }

  private getContext(): ScenarioModuleContext {
    if (!this.context) {
      throw new Error('ProjectService: context not set. Call setContext() first.')
    }
    return this.context
  }

  /**
   * 执行 SQL（参数化，防注入）
   */
  async executeSql(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    const ctx = this.getContext()
    const formatted = params?.length ? this.formatSql(sql, params) : sql
    const result = await ctx.executeSql(formatted)
    if (!result.success) {
      throw new Error(`SQL execution failed: ${result.error}`)
    }
    return (result.rows ?? []) as Record<string, unknown>[]
  }

  private formatSql(sql: string, params: unknown[]): string {
    let idx = 0
    return sql.replace(/\?/g, () => {
      if (idx >= params.length) return '?'
      return this.escapeValue(params[idx++])
    })
  }

  private escapeValue(val: unknown): string {
    if (val === null || val === undefined) return 'NULL'
    if (typeof val === 'number') return Number.isFinite(val) ? String(val) : 'NULL'
    if (typeof val === 'boolean') return val ? '1' : '0'
    return `'${String(val).replace(/'/g, "''")}'`
  }

  // ==========================================
  // 项目 CRUD
  // ==========================================

  /**
   * 创建场景项目
   * - 在数据库记录项目信息
   * - 在工作区创建项目目录和基础文件
   */
  async createProject(options: CreateProjectOptions): Promise<CreateProjectResult> {
    const steps: CreateProjectResult['steps'] = []
    const ctx = this.getContext()

    // 参数校验
    const trimmedName = options.name?.trim()
    if (!trimmedName || trimmedName.length > 100) {
      return {
        success: false,
        error: '项目名称必须为 1-100 个字符',
        steps: [{ id: 'validate', status: 'failed', message: 'Invalid project name' }],
      }
    }

    const scenarioId = options.scenarioId?.trim() || this.generateScenarioId(trimmedName)
    if (!/^[a-z][a-z0-9-]*$/.test(scenarioId)) {
      return {
        success: false,
        error: '场景 ID 必须为小写字母、数字和连字符，且以字母开头',
        steps: [{ id: 'validate', status: 'failed', message: 'Invalid scenario ID' }],
      }
    }

    const version = options.version?.trim() || '1.0.0'
    const type = options.type
    const author = options.author?.trim() || 'developer'
    const tags = options.tags ?? []
    const description = options.description?.trim() ?? ''

    // 确定项目路径
    const workspacePath = ctx.workspacePath
    if (!workspacePath) {
      return {
        success: false,
        error: '未打开工作区，无法创建项目',
        steps: [{ id: 'workspace', status: 'failed', message: 'No workspace' }],
      }
    }

    const localPath = options.localPath?.trim() || `${workspacePath}/scenarios/${scenarioId}`

    steps.push({ id: 'validate', status: 'success', message: '参数校验通过' })

    // 在文件系统创建项目骨架
    try {
      const createResult = await this.createProjectScaffold({
        localPath,
        scenarioId,
        name: trimmedName,
        nameZh: trimmedName, // 简化：中文名默认用项目名（用户可后续编辑 scenario.json）
        description,
        descriptionZh: description,
        author,
        version,
        category: options.config?.category,
        type,
      })
      if (!createResult.success) {
        steps.push({ id: 'scaffold', status: 'failed', message: createResult.error || '骨架创建失败' })
        return { success: false, error: createResult.error || '骨架创建失败', steps }
      }
      steps.push({ id: 'scaffold', status: 'success', message: '项目骨架已创建' })
    } catch (err) {
      steps.push({ id: 'scaffold', status: 'failed', message: `骨架创建失败: ${(err as Error).message}` })
      return { success: false, error: (err as Error).message, steps }
    }

    // 写入数据库
    const id = generateId()
    const now = new Date().toISOString()
    const configJson = JSON.stringify(options.config ?? {})

    try {
      await this.executeSql(
        `INSERT INTO scenario_projects (id, name, scenario_id, version, description, type, local_path, config, status, author, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        [id, trimmedName, scenarioId, version, description, type, localPath, configJson, author, JSON.stringify(tags), now, now],
      )
      steps.push({ id: 'database', status: 'success', message: '项目记录已保存' })
    } catch (err) {
      steps.push({ id: 'database', status: 'failed', message: `数据库写入失败: ${(err as Error).message}` })
      return { success: false, error: (err as Error).message, steps }
    }

    const project: ScenarioProject = {
      id,
      name: trimmedName,
      scenarioId,
      version,
      description,
      type,
      localPath,
      config: options.config ?? {},
      status: 'draft',
      author,
      tags,
      createdAt: now,
      updatedAt: now,
    }

    return {
      success: true,
      project,
      localPath,
      steps,
    }
  }

  /**
   * 获取项目详情
   */
  async getProject(projectId: string): Promise<ScenarioProject | null> {
    const rows = await this.executeSql(
      `SELECT * FROM scenario_projects WHERE id = ?`,
      [projectId],
    )
    if (rows.length === 0) return null
    return this.mapRowToProject(rows[0])
  }

  /**
   * 根据场景 ID 获取项目
   */
  async getProjectByScenarioId(scenarioId: string): Promise<ScenarioProject | null> {
    const rows = await this.executeSql(
      `SELECT * FROM scenario_projects WHERE scenario_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [scenarioId],
    )
    if (rows.length === 0) return null
    return this.mapRowToProject(rows[0])
  }

  /**
   * 列出所有项目
   */
  async listProjects(status?: ProjectStatus): Promise<ScenarioProject[]> {
    const sql = status
      ? `SELECT * FROM scenario_projects WHERE status = ? ORDER BY updated_at DESC`
      : `SELECT * FROM scenario_projects WHERE status != 'archived' ORDER BY updated_at DESC`
    const params = status ? [status] : []
    const rows = await this.executeSql(sql, params)
    return rows.map((row) => this.mapRowToProject(row))
  }

  /**
   * 更新项目
   */
  async updateProject(projectId: string, updates: Partial<ScenarioProject>): Promise<void> {
    const fields: string[] = []
    const values: unknown[] = []

    if (updates.name !== undefined) {
      fields.push('name = ?')
      values.push(updates.name)
    }
    if (updates.version !== undefined) {
      fields.push('version = ?')
      values.push(updates.version)
    }
    if (updates.description !== undefined) {
      fields.push('description = ?')
      values.push(updates.description)
    }
    if (updates.status !== undefined) {
      fields.push('status = ?')
      values.push(updates.status)
    }
    if (updates.config !== undefined) {
      fields.push('config = ?')
      values.push(JSON.stringify(updates.config))
    }
    if (updates.tags !== undefined) {
      fields.push('tags = ?')
      values.push(JSON.stringify(updates.tags))
    }
    if (updates.author !== undefined) {
      fields.push('author = ?')
      values.push(updates.author)
    }
    if (updates.localPath !== undefined) {
      fields.push('local_path = ?')
      values.push(updates.localPath)
    }
    if (updates.lastBuiltAt !== undefined) {
      fields.push('last_built_at = ?')
      values.push(updates.lastBuiltAt)
    }
    if (updates.lastPublishedAt !== undefined) {
      fields.push('last_published_at = ?')
      values.push(updates.lastPublishedAt)
    }

    if (fields.length === 0) return

    fields.push('updated_at = ?')
    values.push(new Date().toISOString())
    values.push(projectId)

    await this.executeSql(
      `UPDATE scenario_projects SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }

  /**
   * 删除项目（软删除，标记为 archived）
   */
  async deleteProject(projectId: string): Promise<void> {
    await this.updateProject(projectId, { status: 'archived' })
  }

  /**
   * 彻底删除项目记录
   */
  async purgeProject(projectId: string): Promise<void> {
    await this.executeSql(`DELETE FROM scenario_projects WHERE id = ?`, [projectId])
  }

  /**
   * 克隆内置示例场景为本地项目
   *
   * 流程：
   *   1. 参数校验 + 确定目标路径（workspacePath/scenarios/<scenarioId>）
   *   2. registerClonedProject 仅在 DB 注册（不创建 scaffold）
   *   3. 通过 scenarioBuilderCloneExample IPC 一次性写入所有示例文件
   *   4. 若文件写入失败，回滚 DB 记录（purgeProject）
   *
   * @param example 示例场景对象（含 files）
   * @param options 克隆参数（scenarioId / name 可选覆盖）
   */
  async cloneExample(
    example: { id: string; name: string; type: 'declarative' | 'programmatic'; files: Array<{ path: string; content: string }> },
    options: { scenarioId?: string; name?: string },
  ): Promise<{ success: boolean; projectId?: string; localPath?: string; error?: string }> {
    const ctx = this.getContext()
    const workspacePath = ctx.workspacePath
    if (!workspacePath) {
      return { success: false, error: '未打开工作区，无法克隆示例' }
    }

    // 确定参数
    const scenarioId = options.scenarioId?.trim() || `${example.id}-copy`
    if (!/^[a-z][a-z0-9-]*$/.test(scenarioId)) {
      return { success: false, error: '场景 ID 必须为小写字母、数字和连字符，且以字母开头' }
    }
    const name = options.name?.trim() || example.name
    const localPath = `${workspacePath}/scenarios/${scenarioId}`

    // 1. 注册 DB 记录（不创建 scaffold）
    const reg = await this.registerClonedProject({
      name,
      scenarioId,
      type: example.type,
      localPath,
    })
    if (!reg.success || !reg.project) {
      return { success: false, error: reg.error || 'DB 注册失败' }
    }
    const projectId = reg.project.id

    // 2. 调用 IPC 写入文件
    if (typeof window === 'undefined' || !(window as any).electronAPI?.scenarioBuilderCloneExample) {
      // 回滚 DB
      await this.purgeProject(projectId)
      return { success: false, error: 'Electron API not available (scenarioBuilderCloneExample)' }
    }
    try {
      const result = await (window as any).electronAPI.scenarioBuilderCloneExample({
        targetPath: localPath,
        files: example.files,
      })
      if (!result?.success) {
        // 文件写入失败，回滚 DB
        await this.purgeProject(projectId)
        return {
          success: false,
          error: result?.error || '文件写入失败',
        }
      }
      ctx.getLogger().info(
        `[ProjectService] Cloned example "${example.id}" to ${localPath} (${result.filesWritten} files)`,
      )
      return {
        success: true,
        projectId,
        localPath,
      }
    } catch (err) {
      await this.purgeProject(projectId)
      return { success: false, error: (err as Error).message }
    }
  }

  // ==========================================
  // 辅助方法
  // ==========================================

  /**
   * 通过 IPC 调用主进程创建项目骨架
   * 失败时回退为不创建骨架（向后兼容旧版本主进程）
   */
  private async createProjectScaffold(params: {
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
  }): Promise<{ success: boolean; error?: string }> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.scenarioBuilderCreateProjectFiles) {
      try {
        const result = await (window as any).electronAPI.scenarioBuilderCreateProjectFiles(params)
        return { success: result.success === true, error: result.error }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
    // 降级：返回成功（不创建骨架，但允许流程继续；后续用户可手动创建文件）
    return { success: true }
  }

  /**
   * 通过 IPC 调用主进程从模板创建项目骨架
   *
   * 与 createProjectScaffold 的区别：
   * - 传入 configOverride / extraFiles / overrideFiles
   * - 主进程先创建基础骨架，再应用模板配置覆盖与额外文件
   *
   * @returns 步骤记录数组，用于前端展示创建进度
   */
  private async createProjectFromTemplateScaffold(params: {
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
    configOverride?: Record<string, unknown>
    extraFiles?: Record<string, string>
    overrideFiles?: Record<string, string>
  }): Promise<{
    success: boolean
    error?: string
    steps: Array<{ id: string; status: 'success' | 'failed'; message: string }>
  }> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.scenarioBuilderCreateProjectFromTemplate) {
      try {
        const result = await (window as any).electronAPI.scenarioBuilderCreateProjectFromTemplate(params)
        return {
          success: result.success === true,
          error: result.error,
          steps: result.steps ?? [],
        }
      } catch (err) {
        return {
          success: false,
          error: (err as Error).message,
          steps: [{ id: 'ipc', status: 'failed', message: (err as Error).message }],
        }
      }
    }
    // 降级：老版本主进程不支持模板创建，回退到普通骨架创建
    const fallback = await this.createProjectScaffold(params)
    return {
      success: fallback.success,
      error: fallback.error,
      steps: [
        {
          id: 'scaffold',
          status: fallback.success ? 'success' : 'failed',
          message: fallback.success ? '已使用基础骨架（模板能力降级）' : (fallback.error || '骨架创建失败'),
        },
      ],
    }
  }

  /**
   * 从示例场景克隆项目（注册到数据库，跳过 scaffold 创建）
   *
   * 与 createProject / createProjectFromTemplate 的区别：
   *  - 不调用主进程 scaffold IPC（示例文件通过 scenarioBuilderCloneExample 单独写入）
   *  - 仅在数据库插入项目记录
   *
   * 调用流程：
   *   1. renderer 通过 listExampleMetas / getExampleById 拿到示例文件列表
   *   2. renderer 调用 registerClonedProject 在 DB 注册项目（拿到 projectId）
   *   3. renderer 调用 scenarioBuilderCloneExample IPC 把文件写入 localPath
   *   4. 若步骤 3 失败，可调用 deleteProject(purgeProject) 清理 DB 记录
   *
   * @param options 克隆参数
   */
  async registerClonedProject(options: {
    name: string
    scenarioId: string
    version?: string
    description?: string
    type: 'declarative' | 'programmatic'
    localPath: string
    author?: string
    tags?: string[]
    config?: Record<string, unknown>
  }): Promise<{ success: boolean; project?: ScenarioProject; error?: string }> {
    // 参数校验
    const trimmedName = options.name?.trim()
    if (!trimmedName || trimmedName.length > 100) {
      return { success: false, error: '项目名称必须为 1-100 个字符' }
    }
    if (!/^[a-z][a-z0-9-]*$/.test(options.scenarioId)) {
      return { success: false, error: '场景 ID 必须为小写字母、数字和连字符，且以字母开头' }
    }

    const id = generateId()
    const now = new Date().toISOString()
    const version = options.version?.trim() || '1.0.0'
    const author = options.author?.trim() || 'developer'
    const tags = options.tags ?? []
    const description = options.description?.trim() ?? ''
    const configJson = JSON.stringify(options.config ?? {})

    try {
      await this.executeSql(
        `INSERT INTO scenario_projects (id, name, scenario_id, version, description, type, local_path, config, status, author, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        [id, trimmedName, options.scenarioId, version, description, options.type, options.localPath, configJson, author, JSON.stringify(tags), now, now],
      )
    } catch (err) {
      return { success: false, error: `数据库写入失败: ${(err as Error).message}` }
    }

    const project: ScenarioProject = {
      id,
      name: trimmedName,
      scenarioId: options.scenarioId,
      version,
      description,
      type: options.type,
      localPath: options.localPath,
      config: options.config ?? {},
      status: 'draft',
      author,
      tags,
      createdAt: now,
      updatedAt: now,
    }

    return { success: true, project }
  }

  /**
   * 从模板创建项目
   *
   * 流程：
   * 1. 参数校验（name / scenarioId / version）
   * 2. 通过 templateService.prepareScaffoldParams 准备模板参数（含变量解析）
   * 3. 调用主进程 IPC 创建项目骨架（含模板覆盖）
   * 4. 写入数据库记录
   *
   * 与 createProject 的区别：使用模板的 configOverride/extraFiles/overrideFiles，
   * 生成的项目骨架带有模板特定的配置和文件（如自定义工具、UI 组件、数据库脚本）
   */
  async createProjectFromTemplate(options: CreateProjectOptions & {
    configOverride?: Record<string, unknown>
    extraFiles?: Record<string, string>
    overrideFiles?: Record<string, string>
    templateSteps?: Array<{ id: string; status: 'success' | 'failed'; message: string }>
  }): Promise<CreateProjectResult> {
    const steps: CreateProjectResult['steps'] = [
      ...(options.templateSteps ?? []),
    ]
    const ctx = this.getContext()

    // 参数校验
    const trimmedName = options.name?.trim()
    if (!trimmedName || trimmedName.length > 100) {
      return {
        success: false,
        error: '项目名称必须为 1-100 个字符',
        steps: [{ id: 'validate', status: 'failed', message: 'Invalid project name' }],
      }
    }

    const scenarioId = options.scenarioId?.trim() || this.generateScenarioId(trimmedName)
    if (!/^[a-z][a-z0-9-]*$/.test(scenarioId)) {
      return {
        success: false,
        error: '场景 ID 必须为小写字母、数字和连字符，且以字母开头',
        steps: [{ id: 'validate', status: 'failed', message: 'Invalid scenario ID' }],
      }
    }

    const version = options.version?.trim() || '1.0.0'
    const type = options.type
    const author = options.author?.trim() || 'developer'
    const tags = options.tags ?? []
    const description = options.description?.trim() ?? ''

    const workspacePath = ctx.workspacePath
    if (!workspacePath) {
      return {
        success: false,
        error: '未打开工作区，无法创建项目',
        steps: [{ id: 'workspace', status: 'failed', message: 'No workspace' }],
      }
    }

    const localPath = options.localPath?.trim() || `${workspacePath}/scenarios/${scenarioId}`

    // 在文件系统创建项目骨架（带模板覆盖）
    try {
      const createResult = await this.createProjectFromTemplateScaffold({
        localPath,
        scenarioId,
        name: trimmedName,
        nameZh: trimmedName,
        description,
        descriptionZh: description,
        author,
        version,
        category: options.config?.category,
        type,
        configOverride: options.configOverride,
        extraFiles: options.extraFiles,
        overrideFiles: options.overrideFiles,
      })
      if (!createResult.success) {
        steps.push(...createResult.steps)
        steps.push({ id: 'scaffold', status: 'failed', message: createResult.error || '骨架创建失败' })
        return { success: false, error: createResult.error || '骨架创建失败', steps }
      }
      steps.push(...createResult.steps)
    } catch (err) {
      steps.push({ id: 'scaffold', status: 'failed', message: `骨架创建失败: ${(err as Error).message}` })
      return { success: false, error: (err as Error).message, steps }
    }

    // 写入数据库
    const id = generateId()
    const now = new Date().toISOString()
    const configJson = JSON.stringify(options.config ?? {})

    try {
      await this.executeSql(
        `INSERT INTO scenario_projects (id, name, scenario_id, version, description, type, local_path, config, status, author, tags, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
        [id, trimmedName, scenarioId, version, description, type, localPath, configJson, author, JSON.stringify(tags), now, now],
      )
      steps.push({ id: 'database', status: 'success', message: '项目记录已保存' })
    } catch (err) {
      steps.push({ id: 'database', status: 'failed', message: `数据库写入失败: ${(err as Error).message}` })
      return { success: false, error: (err as Error).message, steps }
    }

    const project: ScenarioProject = {
      id,
      name: trimmedName,
      scenarioId,
      version,
      description,
      type,
      localPath,
      config: options.config ?? {},
      status: 'draft',
      author,
      tags,
      createdAt: now,
      updatedAt: now,
    }

    return {
      success: true,
      project,
      localPath,
      steps,
    }
  }

  private generateScenarioId(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50)
  }

  private mapRowToProject(row: Record<string, unknown>): ScenarioProject {
    return {
      id: row.id as string,
      name: row.name as string,
      scenarioId: row.scenario_id as string,
      version: row.version as string,
      description: row.description as string,
      type: row.type as ScenarioProject['type'],
      localPath: row.local_path as string,
      config: this.safeParseJson(row.config as string, {}),
      status: row.status as ProjectStatus,
      author: row.author as string,
      tags: this.safeParseJson(row.tags as string, []),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
      lastBuiltAt: (row.last_built_at as string) || undefined,
      lastPublishedAt: (row.last_published_at as string) || undefined,
    }
  }

  private safeParseJson<T>(str: string | undefined | null, defaultValue: T): T {
    if (!str) return defaultValue
    try {
      return JSON.parse(str) as T
    } catch {
      return defaultValue
    }
  }
}

export const projectService = new ProjectService()
