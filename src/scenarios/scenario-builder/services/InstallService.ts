/**
 * 安装服务
 *
 * 将构建好的场景安装到本地客户端。
 * 复用客户端现有的 scenario:installFromLocal IPC 通道。
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import type { InstallRecord, InstallStatus } from '../types'

function generateId(): string {
  return `inst-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export class InstallService {
  private context: ScenarioModuleContext | null = null

  setContext(context: ScenarioModuleContext): void {
    this.context = context
  }

  private getContext(): ScenarioModuleContext {
    if (!this.context) {
      throw new Error('InstallService: context not set')
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
   * 安装场景到本地客户端
   *
   * 调用客户端现有的 scenario:installFromLocal IPC，
   * 将 dist/ 目录安装到本地场景目录。
   */
  async installScenario(projectId: string, version: string, packagePath: string): Promise<InstallRecord> {
    const id = generateId()
    const now = new Date().toISOString()

    // 创建安装记录
    await this.executeSql(
      `INSERT INTO install_records (id, project_id, version, package_path, status, installed_at)
       VALUES (?, ?, ?, ?, 'installing', ?)`,
      [id, projectId, version, packagePath, now],
    )

    const record: InstallRecord = {
      id,
      projectId,
      version,
      packagePath,
      status: 'installing',
      installedAt: now,
    }

    try {
      // 调用客户端 IPC 安装场景
      const result = await this.invokeInstallIpc(packagePath)

      const status: InstallStatus = result.success ? 'installed' : 'failed'
      await this.executeSql(
        `UPDATE install_records SET status = ?, error = ? WHERE id = ?`,
        [status, result.error ?? '', id],
      )

      return {
        ...record,
        status,
        error: result.error,
      }
    } catch (err) {
      const errorMsg = (err as Error).message
      await this.executeSql(
        `UPDATE install_records SET status = 'failed', error = ? WHERE id = ?`,
        [errorMsg, id],
      )

      return {
        ...record,
        status: 'failed',
        error: errorMsg,
      }
    }
  }

  /**
   * 卸载已安装的场景
   */
  async uninstallScenario(scenarioId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const result = await this.invokeUninstallIpc(scenarioId)
      return result
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  /**
   * 获取安装历史
   */
  async getInstallHistory(projectId: string): Promise<InstallRecord[]> {
    const rows = await this.executeSql(
      `SELECT * FROM install_records WHERE project_id = ? ORDER BY installed_at DESC`,
      [projectId],
    )
    return rows.map((row) => this.mapRowToInstallRecord(row))
  }

  /**
   * 获取最新安装记录
   */
  async getLatestInstall(projectId: string): Promise<InstallRecord | null> {
    const rows = await this.executeSql(
      `SELECT * FROM install_records WHERE project_id = ? ORDER BY installed_at DESC LIMIT 1`,
      [projectId],
    )
    if (rows.length === 0) return null
    return this.mapRowToInstallRecord(rows[0])
  }

  // ==========================================
  // IPC 桥接
  // ==========================================

  private async invokeInstallIpc(packagePath: string): Promise<{ success: boolean; error?: string }> {
    // 复用客户端现有的 scenario:installFromLocal IPC（命名方法）
    if (typeof window !== 'undefined' && (window as any).electronAPI?.scenarioInstallFromLocal) {
      try {
        // installFromLocal 接收 sourceDir 参数，应当指向项目的 dist/ 目录
        const result = await (window as any).electronAPI.scenarioInstallFromLocal(packagePath)
        return { success: result.success === true, error: result.error }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
    return { success: false, error: 'Electron API not available' }
  }

  private async invokeUninstallIpc(scenarioId: string): Promise<{ success: boolean; error?: string }> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.scenarioUninstall) {
      try {
        const result = await (window as any).electronAPI.scenarioUninstall(scenarioId)
        return { success: result.success === true, error: result.error }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }
    return { success: false, error: 'Electron API not available' }
  }

  private mapRowToInstallRecord(row: Record<string, unknown>): InstallRecord {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      scenarioId: (row.scenario_id as string) || undefined,
      version: row.version as string,
      packagePath: row.package_path as string,
      status: row.status as InstallStatus,
      error: (row.error as string) || undefined,
      installedAt: row.installed_at as string,
    }
  }
}

export const installService = new InstallService()
