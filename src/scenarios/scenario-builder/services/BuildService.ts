/**
 * 构建服务
 *
 * 负责场景项目的校验、构建、打包。
 * 通过子进程调用 aweeclaw-scenario-cli 执行命令。
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import type { BuildRecord, BuildType, BuildStatus, ValidationResult } from '../types'

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
   * 校验场景配置（基础校验，不调用 CLI）
   */
  validateConfig(config: Record<string, unknown>): ValidationResult {
    const errors: ValidationResult['errors'] = []
    const warnings: ValidationResult['warnings'] = []

    // 必填字段校验
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
    if (!config.type || !['declarative', 'programmatic'].includes(config.type as string)) {
      errors.push({ field: 'type', message: '类型必须为 declarative 或 programmatic', code: 'REQUIRED' })
    }

    // identity 校验
    const identity = config.identity as Record<string, unknown> | undefined
    if (!identity) {
      errors.push({ field: 'identity', message: 'identity 配置不能为空', code: 'REQUIRED' })
    } else {
      if (!identity.systemPrompt && !identity.systemPromptFile) {
        errors.push({ field: 'identity.systemPrompt', message: '系统提示词不能为空', code: 'REQUIRED' })
      }
    }

    // capabilities 校验
    const capabilities = config.capabilities as Record<string, unknown> | undefined
    if (!capabilities) {
      warnings.push({ field: 'capabilities', message: '建议配置 capabilities', code: 'RECOMMENDED' })
    }

    // ui 校验
    const ui = config.ui as Record<string, unknown> | undefined
    if (!ui) {
      warnings.push({ field: 'ui', message: '建议配置 ui 布局', code: 'RECOMMENDED' })
    } else if (!ui.layout) {
      warnings.push({ field: 'ui.layout', message: '建议指定 UI 布局类型', code: 'RECOMMENDED' })
    }

    return { valid: errors.length === 0, errors, warnings }
  }

  /**
   * 执行 CLI 命令（通过 IPC 调用主进程）
   * 实际实现由 IPC handler 桥接到主进程的 child_process
   */
  async executeCliCommand(projectPath: string, command: string, args: string[] = []): Promise<{
    success: boolean
    exitCode: number
    output: string
    durationMs: number
  }> {
    const startTime = Date.now()

    try {
      // 通过 IPC 调用主进程执行命令
      const result = await this.invokeIpc('scenario-builder:executeCli', {
        cwd: projectPath,
        command,
        args,
      })

      const durationMs = Date.now() - startTime
      return {
        success: result.success,
        exitCode: result.exitCode ?? (result.success ? 0 : 1),
        output: result.output ?? '',
        durationMs,
      }
    } catch (err) {
      return {
        success: false,
        exitCode: 1,
        output: `Command execution failed: ${(err as Error).message}`,
        durationMs: Date.now() - startTime,
      }
    }
  }

  /**
   * 构建场景项目
   */
  async buildProject(projectId: string): Promise<BuildRecord> {
    const record = await this.createBuildRecord(projectId, 'build', 'aweeclaw-scenario build')

    try {
      const result = await this.executeCliCommand(record.projectId, 'aweeclaw-scenario', ['build'])
      const finishedAt = new Date().toISOString()

      await this.updateBuildRecord(record.id, {
        status: result.success ? 'success' : 'failed',
        exitCode: result.exitCode,
        output: result.output,
        durationMs: result.durationMs,
        finishedAt,
      })

      return {
        ...record,
        status: result.success ? 'success' : 'failed',
        exitCode: result.exitCode,
        output: result.output,
        durationMs: result.durationMs,
        finishedAt,
      }
    } catch (err) {
      const finishedAt = new Date().toISOString()
      await this.updateBuildRecord(record.id, {
        status: 'failed',
        exitCode: 1,
        output: (err as Error).message,
        durationMs: 0,
        finishedAt,
      })
      return {
        ...record,
        status: 'failed',
        exitCode: 1,
        output: (err as Error).message,
        durationMs: 0,
        finishedAt,
      }
    }
  }

  /**
   * 校验场景项目
   */
  async validateProject(projectId: string): Promise<BuildRecord> {
    const record = await this.createBuildRecord(projectId, 'validate', 'aweeclaw-scenario validate')

    try {
      const result = await this.executeCliCommand(record.projectId, 'aweeclaw-scenario', ['validate'])
      const finishedAt = new Date().toISOString()

      await this.updateBuildRecord(record.id, {
        status: result.success ? 'success' : 'failed',
        exitCode: result.exitCode,
        output: result.output,
        durationMs: result.durationMs,
        finishedAt,
      })

      return {
        ...record,
        status: result.success ? 'success' : 'failed',
        exitCode: result.exitCode,
        output: result.output,
        durationMs: result.durationMs,
        finishedAt,
      }
    } catch (err) {
      const finishedAt = new Date().toISOString()
      await this.updateBuildRecord(record.id, {
        status: 'failed',
        exitCode: 1,
        output: (err as Error).message,
        durationMs: 0,
        finishedAt,
      })
      return {
        ...record,
        status: 'failed',
        exitCode: 1,
        output: (err as Error).message,
        durationMs: 0,
        finishedAt,
      }
    }
  }

  /**
   * 打包场景项目
   */
  async packProject(projectId: string): Promise<BuildRecord> {
    const record = await this.createBuildRecord(projectId, 'pack', 'aweeclaw-scenario pack')

    try {
      const result = await this.executeCliCommand(record.projectId, 'aweeclaw-scenario', ['pack'])
      const finishedAt = new Date().toISOString()

      await this.updateBuildRecord(record.id, {
        status: result.success ? 'success' : 'failed',
        exitCode: result.exitCode,
        output: result.output,
        durationMs: result.durationMs,
        finishedAt,
      })

      return {
        ...record,
        status: result.success ? 'success' : 'failed',
        exitCode: result.exitCode,
        output: result.output,
        durationMs: result.durationMs,
        finishedAt,
      }
    } catch (err) {
      const finishedAt = new Date().toISOString()
      await this.updateBuildRecord(record.id, {
        status: 'failed',
        exitCode: 1,
        output: (err as Error).message,
        durationMs: 0,
        finishedAt,
      })
      return {
        ...record,
        status: 'failed',
        exitCode: 1,
        output: (err as Error).message,
        durationMs: 0,
        finishedAt,
      }
    }
  }

  // ==========================================
  // 辅助方法
  // ==========================================

  private async invokeIpc(channel: string, ...args: unknown[]): Promise<any> {
    // 通过场景上下文注册的 IPC handler 调用
    // 实际由主进程的 IPC handler 处理
    const ctx = this.getContext()
    ctx.getLogger().debug(`Invoking IPC: ${channel}`, args)

    // 使用 window.electronAPI 调用主进程
    if (typeof window !== 'undefined' && (window as any).scenarioBuilderIpc) {
      return await (window as any).scenarioBuilderIpc.executeCli(...args)
    }

    // 降级：返回模拟结果（开发环境）
    return {
      success: false,
      exitCode: 127,
      output: 'CLI not available in current environment',
    }
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
