/**
 * 发布服务
 *
 * 将场景发布到开发者中心市场。
 * 复用开发者中心的认证 token 和发布 API。
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import type { PublishRecord, PublishStatus } from '../types'

function generateId(): string {
  return `pub-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
}

export class PublishService {
  private context: ScenarioModuleContext | null = null

  setContext(context: ScenarioModuleContext): void {
    this.context = context
  }

  private getContext(): ScenarioModuleContext {
    if (!this.context) {
      throw new Error('PublishService: context not set')
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
   * 发布场景到开发者中心
   *
   * 流程：
   * 1. 检查登录状态（获取 token）
   * 2. 上传打包文件
   * 3. 等待审核结果
   */
  async publishScenario(
    projectId: string,
    version: string,
    packageName: string,
    packagePath: string,
  ): Promise<PublishRecord> {
    const id = generateId()
    const now = new Date().toISOString()

    // 创建发布记录
    await this.executeSql(
      `INSERT INTO publish_records (id, project_id, version, package_name, status, published_at)
       VALUES (?, ?, ?, ?, 'uploading', ?)`,
      [id, projectId, version, packageName, now],
    )

    const record: PublishRecord = {
      id,
      projectId,
      version,
      packageName,
      status: 'uploading',
      publishedAt: now,
    }

    try {
      // 调用发布 API（复用开发者中心认证）
      const result = await this.invokePublishApi(packageName, packagePath, version)

      const status: PublishStatus = result.success ? 'published' : 'failed'
      await this.executeSql(
        `UPDATE publish_records SET status = ?, marketplace_id = ?, download_url = ?, error = ? WHERE id = ?`,
        [status, result.marketplaceId ?? '', result.downloadUrl ?? '', result.error ?? '', id],
      )

      return {
        ...record,
        status,
        marketplaceId: result.marketplaceId,
        downloadUrl: result.downloadUrl,
        error: result.error,
      }
    } catch (err) {
      const errorMsg = (err as Error).message
      await this.executeSql(
        `UPDATE publish_records SET status = 'failed', error = ? WHERE id = ?`,
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
   * 获取发布历史
   */
  async getPublishHistory(projectId: string): Promise<PublishRecord[]> {
    const rows = await this.executeSql(
      `SELECT * FROM publish_records WHERE project_id = ? ORDER BY published_at DESC`,
      [projectId],
    )
    return rows.map((row) => this.mapRowToPublishRecord(row))
  }

  /**
   * 获取最新发布记录
   */
  async getLatestPublish(projectId: string): Promise<PublishRecord | null> {
    const rows = await this.executeSql(
      `SELECT * FROM publish_records WHERE project_id = ? ORDER BY published_at DESC LIMIT 1`,
      [projectId],
    )
    if (rows.length === 0) return null
    return this.mapRowToPublishRecord(rows[0])
  }

  /**
   * 检查发布前状态（是否已登录、是否有新版本等）
   */
  async checkPublishStatus(): Promise<{
    loggedIn: boolean
    developerName?: string
    error?: string
  }> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.developerCheckAuth) {
      try {
        const result = await (window as any).electronAPI.developerCheckAuth()
        return {
          loggedIn: result.loggedIn === true,
          developerName: result.developerName,
        }
      } catch (err) {
        return { loggedIn: false, error: (err as Error).message }
      }
    }
    return { loggedIn: false, error: 'Electron API not available' }
  }

  // ==========================================
  // API 调用
  // ==========================================

  private async invokePublishApi(
    packageName: string,
    packagePath: string,
    version: string,
  ): Promise<{
    success: boolean
    marketplaceId?: string
    downloadUrl?: string
    error?: string
  }> {
    if (typeof window !== 'undefined' && (window as any).electronAPI?.developerPublishScenario) {
      try {
        const result = await (window as any).electronAPI.developerPublishScenario({
          packageName,
          packagePath,
          version,
        })
        return {
          success: result.success === true,
          marketplaceId: result.marketplaceId,
          downloadUrl: result.downloadUrl,
          error: result.error,
        }
      } catch (err) {
        return { success: false, error: (err as Error).message }
      }
    }

    return { success: false, error: 'Electron API not available' }
  }

  private mapRowToPublishRecord(row: Record<string, unknown>): PublishRecord {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      version: row.version as string,
      packageName: row.package_name as string,
      status: row.status as PublishStatus,
      marketplaceId: (row.marketplace_id as string) || undefined,
      downloadUrl: (row.download_url as string) || undefined,
      error: (row.error as string) || undefined,
      publishedAt: row.published_at as string,
    }
  }
}

export const publishService = new PublishService()
