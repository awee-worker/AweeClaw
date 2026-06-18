/**
 * dev-studio 项目管理服务
 *
 * 负责项目的 CRUD 操作，通过场景上下文操作独立 SQLite 数据库。
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import type {
  Project,
  ProjectConfig,
  ProjectStatus,
  DevSession,
  DevSessionMode,
  BuildLog,
  BuildType,
  BuildStatus,
} from '../types'

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
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
    if (typeof val === 'number') {
      return Number.isFinite(val) ? String(val) : 'NULL'
    }
    if (typeof val === 'boolean') return val ? '1' : '0'
    return `'${String(val).replace(/'/g, "''")}'`
  }

  // ==========================================
  // 项目 CRUD
  // ==========================================

  async createProject(
    name: string,
    localPath: string,
    templateId?: string,
    description?: string,
    config?: ProjectConfig,
  ): Promise<Project> {
    const trimmedName = name?.trim()
    if (!trimmedName || trimmedName.length > 100) {
      throw new Error('Project name must be 1-100 characters')
    }
    if (!localPath?.trim()) {
      throw new Error('Local path is required')
    }
    const id = generateId()
    const now = new Date().toISOString()
    const configJson = JSON.stringify(config ?? {})

    await this.executeSql(
      `INSERT INTO projects (id, name, description, template_id, local_path, config, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      [id, trimmedName, description ?? '', templateId ?? '', localPath, configJson, now, now],
    )

    return {
      id,
      name: trimmedName,
      description,
      templateId,
      localPath,
      config: config ?? {},
      status: 'active',
      createdAt: now,
      updatedAt: now,
    }
  }

  async getProject(id: string): Promise<Project | null> {
    const rows = await this.executeSql('SELECT * FROM projects WHERE id = ?', [id])
    if (rows.length === 0) return null
    return this.mapProject(rows[0])
  }

  async listProjects(status?: ProjectStatus): Promise<Project[]> {
    let sql = 'SELECT * FROM projects'
    if (status) {
      sql += ' WHERE status = ?'
      const rows = await this.executeSql(sql, [status])
      return rows.map(r => this.mapProject(r))
    }
    const rows = await this.executeSql(sql)
    return rows.map(r => this.mapProject(r))
  }

  async updateProject(id: string, updates: Partial<Pick<Project, 'name' | 'description' | 'status'>>): Promise<boolean> {
    const fields: string[] = []
    const values: unknown[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }

    if (fields.length === 0) return false

    fields.push("updated_at = datetime('now', 'localtime')")
    values.push(id)

    await this.executeSql(
      `UPDATE projects SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
    return true
  }

  async deleteProject(id: string): Promise<boolean> {
    await this.executeSql('DELETE FROM projects WHERE id = ?', [id])
    return true
  }

  // ==========================================
  // 开发会话
  // ==========================================

  async createSession(projectId: string, title?: string, mode: DevSessionMode = 'solo'): Promise<DevSession> {
    const id = generateId()
    const now = new Date().toISOString()

    await this.executeSql(
      `INSERT INTO dev_sessions (id, project_id, title, mode, status, tasks, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', '[]', ?, ?)`,
      [id, projectId, title ?? '', mode, now, now],
    )

    return { id, projectId, title, mode, status: 'active', tasks: [], createdAt: now, updatedAt: now }
  }

  async listSessions(projectId: string): Promise<DevSession[]> {
    const rows = await this.executeSql(
      'SELECT * FROM dev_sessions WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    )
    return rows.map(r => this.mapSession(r))
  }

  async updateSessionStatus(id: string, status: string): Promise<boolean> {
    await this.executeSql(
      "UPDATE dev_sessions SET status = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
      [status, id],
    )
    return true
  }

  async updateSessionTasks(id: string, tasks: string): Promise<boolean> {
    await this.executeSql(
      "UPDATE dev_sessions SET tasks = ?, updated_at = datetime('now', 'localtime') WHERE id = ?",
      [tasks, id],
    )
    return true
  }

  // ==========================================
  // 构建日志
  // ==========================================

  async createBuildLog(
    projectId: string,
    buildType: BuildType,
    command?: string,
    sessionId?: string,
  ): Promise<BuildLog> {
    const id = generateId()
    const now = new Date().toISOString()

    await this.executeSql(
      `INSERT INTO build_logs (id, project_id, session_id, build_type, command, status, started_at)
       VALUES (?, ?, ?, ?, ?, 'pending', ?)`,
      [id, projectId, sessionId ?? '', buildType, command ?? '', now],
    )

    return {
      id, projectId, sessionId, buildType, command,
      status: 'pending', startedAt: now,
    }
  }

  async updateBuildLog(
    id: string,
    updates: { status?: BuildStatus; exitCode?: number; output?: string; durationMs?: number },
  ): Promise<boolean> {
    const fields: string[] = []
    const values: unknown[] = []

    if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status) }
    if (updates.exitCode !== undefined) { fields.push('exit_code = ?'); values.push(updates.exitCode) }
    if (updates.output !== undefined) { fields.push('output = ?'); values.push(updates.output) }
    if (updates.durationMs !== undefined) { fields.push('duration_ms = ?'); values.push(updates.durationMs) }

    if (updates.status === 'success' || updates.status === 'failed' || updates.status === 'cancelled') {
      fields.push("finished_at = datetime('now', 'localtime')")
    }

    if (fields.length === 0) return false
    values.push(id)

    await this.executeSql(
      `UPDATE build_logs SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
    return true
  }

  async listBuildLogs(projectId: string, limit = 20): Promise<BuildLog[]> {
    const rows = await this.executeSql(
      'SELECT * FROM build_logs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?',
      [projectId, limit],
    )
    return rows.map(r => this.mapBuildLog(r))
  }

  // ==========================================
  // 映射工具
  // ==========================================

  private mapProject(row: Record<string, unknown>): Project {
    return {
      id: row.id as string,
      name: row.name as string,
      description: (row.description as string) || undefined,
      templateId: (row.template_id as string) || undefined,
      localPath: row.local_path as string,
      config: this.safeJsonParse(row.config as string, {}),
      status: (row.status as ProjectStatus) || 'active',
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }
  }

  private mapSession(row: Record<string, unknown>): DevSession {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      title: (row.title as string) || undefined,
      mode: (row.mode as DevSessionMode) || 'solo',
      status: (row.status as string) as DevSession['status'],
      tasks: this.safeJsonParse(row.tasks as string, []),
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }
  }

  private mapBuildLog(row: Record<string, unknown>): BuildLog {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      sessionId: (row.session_id as string) || undefined,
      buildType: row.build_type as BuildType,
      command: (row.command as string) || undefined,
      status: (row.status as BuildStatus) || 'pending',
      exitCode: (row.exit_code as number) ?? undefined,
      output: (row.output as string) || undefined,
      durationMs: (row.duration_ms as number) || undefined,
      startedAt: row.started_at as string,
      finishedAt: (row.finished_at as string) || undefined,
    }
  }

  private safeJsonParse<T>(str: string, fallback: T): T {
    try {
      return JSON.parse(str) as T
    } catch {
      return fallback
    }
  }
}

export const projectService = new ProjectService()