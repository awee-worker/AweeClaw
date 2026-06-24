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

  // ==========================================
  // 辅助方法
  // ==========================================

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
