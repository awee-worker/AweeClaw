/**
 * 构建服务（重构版）
 *
 * 内嵌构建、校验、打包，**不再依赖 aweeclaw-scenario-cli 外部 CLI**。
 * 全部能力通过主进程 IPC 调用 scenario-system/cli 中的现成函数实现。
 *
 * 修复要点：
 * - 修复 cwd bug：原来传 projectId（DB 主键）作为 cwd，改为传 project.localPath
 * - 移除 aweeclaw-scenario CLI 依赖，改为调用 scenario-builder:validate/build/pack IPC
 * - 统一通过 electronAPI 命名方法调用 IPC，而非不存在的 .invoke()
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import type { BuildRecord, BuildType, BuildStatus, ValidationResult } from '../types'
import { projectService } from './ProjectService'

function generateId(): string {
  return `bld-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export class BuildService {
  private context: ScenarioModuleContext | null = null

  setContext(context: ScenarioModuleContext): void {
    this.context = context
  }

  private getContext(): ScenarioModuleContext {
    if (!this.context) {
      throw new Error('BuildService: context not set')
    }
    return this.context
  }

  private async executeSql(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
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

  /**
   * 创建构建记录
   */
  async createBuildRecord(projectId: string, buildType: BuildType, command: string): Promise<BuildRecord> {
    const id = generateId()
    const now = new Date().toISOString()

    await this.executeSql(
      `INSERT INTO build_records (id, project_id, build_type, command, status, output, duration_ms, started_at)
       VALUES (?, ?, ?, ?, 'running', '', 0, ?)`,
      [id, projectId, buildType, command, now],
    )

    return {
      id,
      projectId,
      buildType,
      command,
      status: 'running',
      output: '',
      durationMs: 0,
      startedAt: now,
    }
  }

  /**
   * 更新构建记录
   */
  async updateBuildRecord(
    buildId: string,
    updates: Partial<Pick<BuildRecord, 'status' | 'exitCode' | 'output' | 'durationMs' | 'finishedAt'>>,
  ): Promise<void> {
    const fields: string[] = []
    const values: unknown[] = []

    if (updates.status !== undefined) {
      fields.push('status = ?')
      values.push(updates.status)
    }
    if (updates.exitCode !== undefined) {
      fields.push('exit_code = ?')
      values.push(updates.exitCode)
    }
    if (updates.output !== undefined) {
      fields.push('output = ?')
      values.push(updates.output)
    }
    if (updates.durationMs !== undefined) {
      fields.push('duration_ms = ?')
      values.push(updates.durationMs)
    }
    if (updates.finishedAt !== undefined) {
      fields.push('finished_at = ?')
      values.push(updates.finishedAt)
    }

    if (fields.length === 0) return

    values.push(buildId)
    await this.executeSql(
      `UPDATE build_records SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }

  /**
   * 获取构建记录
   */
  async getBuildRecord(buildId: string): Promise<BuildRecord | null> {
    const rows = await this.executeSql(
      `SELECT * FROM build_records WHERE id = ?`,
      [buildId],
    )
    if (rows.length === 0) return null
    return this.mapRowToBuildRecord(rows[0])
  }

  /**
   * 获取项目的构建历史
   */
  async getBuildHistory(projectId: string, limit = 20): Promise<BuildRecord[]> {
    const rows = await this.executeSql(
      `SELECT * FROM build_records WHERE project_id = ? ORDER BY started_at DESC LIMIT ?`,
      [projectId, limit],
    )
    return rows.map((row) => this.mapRowToBuildRecord(row))
  }

  /**
   * 获取最近的构建记录
   */
  async getLatestBuild(projectId: string): Promise<BuildRecord | null> {
    const rows = await this.executeSql(
      `SELECT * FROM build_records WHERE project_id = ? ORDER BY started_at DESC LIMIT 1`,
      [projectId],
    )
    if (rows.length === 0) return null
    return this.mapRowToBuildRecord(rows[0])
  }

  /**
   * 本地基础校验（不调用 IPC，作为快速预检）
   */
  validateConfig(config: Record<string, unknown>): ValidationResult {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    if (!config.id) {
      errors.push({ field: 'id', message: '场景 ID 不能为空', code: 'REQUIRED' })
    } else if (!/^[a-z][a-z0-9-]*$/.test(config.id as string)) {
      errors.push({ field: 'id', message: '场景 ID 必须为小写字母、数字和连字符', code: 'INVALID_FORMAT' })
    }

    if (!config.version) {
      errors.push({ field: 'version', message: '版本号不能为空', code: 'REQUIRED' })
    } else if (!/^\d+\.\d+\.\d+/.test(config.version as string)) {
      errors.push({ field: 'version', message: '版本号必须符合语义化版本规范（如 1.0.0）', code: 'INVALID_FORMAT' })
    }

    if (!config.name) {
      errors.push({ field: 'name', message: '英文名称不能为空', code: 'REQUIRED' })
    }
    if (!config.nameZh) {
      warnings.push({ field: 'nameZh', message: '建议提供中文名称', code: 'RECOMMENDED' })
    }

    const identity = config.identity as Record<string, unknown> | undefined
    if (!identity) {
      errors.push({ field: 'identity', message: 'identity 配置不能为空', code: 'REQUIRED' })
    } else if (!identity.systemPrompt && !identity.systemPromptFile) {
      errors.push({ field: 'identity.systemPrompt', message: '系统提示词不能为空', code: 'REQUIRED' })
    }

    const capabilities = config.capabilities as Record<string, unknown> | undefined
    if (!capabilities) {
      warnings.push({ field: 'capabilities', message: '建议配置 capabilities', code: 'RECOMMENDED' })
    }

    const ui = config.ui as Record<string, unknown> | undefined
    if (!ui) {
      warnings.push({ field: 'ui', message: '建议配置 ui 布局', code: 'RECOMMENDED' })
    } else if (!ui.layout) {
      warnings.push({ field: 'ui.layout', message: '建议指定 UI 布局类型', code: 'RECOMMENDED' })
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * 校验场景项目（调用主进程内嵌校验器）
   */
  async validateProject(projectId: string): Promise<BuildRecord> {
    const record = await this.createBuildRecord(projectId, 'validate', 'scenario-builder:validate')
    const startTime = Date.now()

    try {
      const projectPath = await this.resolveProjectPath(projectId)
      if (!projectPath) {
        throw new Error(`Project not found: ${projectId}`)
      }

      const result = await this.invokeValidate({ projectPath })
      const finishedAt = new Date().toISOString()
      const output = this.formatValidateOutput(result)
      const status: BuildStatus = result.success && result.valid ? 'success' : 'failed'

      await this.updateBuildRecord(record.id, {
        status,
        exitCode: status === 'success' ? 0 : 1,
        output,
        durationMs: Date.now() - startTime,
        finishedAt,
      })

      return { ...record, status, exitCode: status === 'success' ? 0 : 1, output, durationMs: Date.now() - startTime, finishedAt }
    } catch (err) {
      return await this.handleBuildError(record, err, startTime)
    }
  }

  /**
   * 构建场景项目（修复 cwd bug：使用 localPath 而非 projectId）
   */
  async buildProject(projectId: string): Promise<BuildRecord> {
    const record = await this.createBuildRecord(projectId, 'build', 'scenario-builder:build')
    const startTime = Date.now()

    try {
      const projectPath = await this.resolveProjectPath(projectId)
      if (!projectPath) {
        throw new Error(`Project not found: ${projectId}`)
      }

      const result = await this.invokeBuild({ projectPath })
      const finishedAt = new Date().toISOString()
      const status: BuildStatus = result.success ? 'success' : 'failed'

      await this.updateBuildRecord(record.id, {
        status,
        exitCode: status === 'success' ? 0 : 1,
        output: result.output,
        durationMs: Date.now() - startTime,
        finishedAt,
      })

      // 更新项目状态
      if (result.success) {
        await projectService.updateProject(projectId, { status: 'building', lastBuiltAt: finishedAt })
      }

      return { ...record, status, exitCode: status === 'success' ? 0 : 1, output: result.output, durationMs: Date.now() - startTime, finishedAt }
    } catch (err) {
      return await this.handleBuildError(record, err, startTime)
    }
  }

  /**
   * 打包场景项目
   */
  async packProject(projectId: string): Promise<BuildRecord> {
    const record = await this.createBuildRecord(projectId, 'pack', 'scenario-builder:pack')
    const startTime = Date.now()

    try {
      const projectPath = await this.resolveProjectPath(projectId)
      if (!projectPath) {
        throw new Error(`Project not found: ${projectId}`)
      }

      const result = await this.invokePack({ projectPath })
      const finishedAt = new Date().toISOString()
      const status: BuildStatus = result.success ? 'success' : 'failed'
      const output = result.success
        ? `Pack succeeded.\n  Package: ${result.packagePath}\n  Size: ${result.size} bytes\n  Hash: ${result.hash}`
        : `Pack failed: ${result.error}`

      await this.updateBuildRecord(record.id, {
        status,
        exitCode: status === 'success' ? 0 : 1,
        output,
        durationMs: Date.now() - startTime,
        finishedAt,
      })

      // 更新项目状态为 ready
      if (result.success) {
        await projectService.updateProject(projectId, { status: 'ready' })
      }

      return { ...record, status, exitCode: status === 'success' ? 0 : 1, output, durationMs: Date.now() - startTime, finishedAt }
    } catch (err) {
      return await this.handleBuildError(record, err, startTime)
    }
  }

  /**
   * 获取打包产物路径（供 InstallService 调用）
   */
  async getPackagePath(projectId: string): Promise<string | null> {
    const project = await projectService.getProject(projectId)
    if (!project) return null

    // 优先使用最近一次成功的 pack 记录中的输出
    const history = await this.getBuildHistory(projectId, 10)
    const lastPack = history.find(r => r.buildType === 'pack' && r.status === 'success')
    if (lastPack) {
      // 从 output 中解析 packagePath
      const match = lastPack.output.match(/Package: (.+)/)
      if (match) return match[1].trim()
    }

    // 兜底：返回 dist/ 目录下的预期路径
    return `${project.localPath}/dist/${project.scenarioId}-${project.version}.aweeclawpkg`
  }

  // ==========================================
  // IPC 桥接（统一通过 electronAPI 命名方法调用）
  // ==========================================

  private async resolveProjectPath(projectId: string): Promise<string | null> {
    const project = await projectService.getProject(projectId)
    return project?.localPath || null
  }

  private async invokeValidate(params: { projectPath: string }): Promise<{
    success: boolean
    valid?: boolean
    errors?: Array<{ path: string; message: string }>
    warnings?: Array<{ path: string; message: string }>
    error?: string
  }> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.scenarioBuilderValidate) {
      try {
        return await (window as any).electronAPI.scenarioBuilderValidate(params)
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
    return { success: false, error: 'Electron API not available' }
  }

  private async invokeBuild(params: { projectPath: string }): Promise<{
    success: boolean
    output: string
    error?: string
  }> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.scenarioBuilderBuild) {
      try {
        return await (window as any).electronAPI.scenarioBuilderBuild(params)
      } catch (err) {
        return { success: false, output: '', error: (err as Error).message }
      }
    }
    return { success: false, output: '', error: 'Electron API not available' }
  }

  private async invokePack(params: { projectPath: string; outputPath?: string }): Promise<{
    success: boolean
    packagePath?: string
    size?: number
    hash?: string
    error?: string
  }> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.scenarioBuilderPack) {
      try {
        return await (window as any).electronAPI.scenarioBuilderPack(params)
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
    return { success: false, error: 'Electron API not available' }
  }

  // ==========================================
  // 辅助方法
  // ==========================================

  private formatValidateOutput(result: {
    success: boolean
    valid?: boolean
    errors?: Array<{ path: string; message: string }>
    warnings?: Array<{ path: string; message: string }>
    error?: string
  }): string {
    if (!result.success) return `Validation failed: ${result.error || 'Unknown error'}`
    const lines: string[] = [`[validate] ${result.valid ? 'PASSED' : 'FAILED'}`]
    if (result.errors) {
      result.errors.forEach(e => lines.push(`  ERROR: ${e.path}: ${e.message}`))
    }
    if (result.warnings) {
      result.warnings.forEach(w => lines.push(`  WARN:  ${w.path}: ${w.message}`))
    }
    return lines.join('\n')
  }

  private async handleBuildError(
    record: BuildRecord,
    err: unknown,
    startTime: number,
  ): Promise<BuildRecord> {
    const finishedAt = new Date().toISOString()
    const errorMsg = err instanceof Error ? err.message : String(err)
    const durationMs = Date.now() - startTime

    await this.updateBuildRecord(record.id, {
      status: 'failed',
      exitCode: 1,
      output: errorMsg,
      durationMs,
      finishedAt,
    })

    return { ...record, status: 'failed', exitCode: 1, output: errorMsg, durationMs, finishedAt }
  }

  private mapRowToBuildRecord(row: Record<string, unknown>): BuildRecord {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      buildType: row.build_type as BuildType,
      command: row.command as string,
      status: row.status as BuildStatus,
      exitCode: row.exit_code as number | undefined,
      output: row.output as string,
      durationMs: row.duration_ms as number,
      startedAt: row.started_at as string,
      finishedAt: (row.finished_at as string) || undefined,
    }
  }
}

export const buildService = new BuildService()
