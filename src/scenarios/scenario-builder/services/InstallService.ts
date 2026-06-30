/**
 * 安装服务
 *
 * 将构建好的场景安装到本地客户端。
 * 复用客户端现有的 scenario:installFromLocal IPC 通道。
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import type { InstallRecord, InstallStatus } from '../types'
import { registerInstalledScenario } from '@renderer/components/scenario/scenarioInstallUtils'

/** scenario:installFromLocal IPC 返回结果 */
interface InstallIpcResult {
  success: boolean
  error?: string
  scenarioId?: string
  config?: Record<string, unknown>
}

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
   *
   * 注意：IPC 期望接收「源目录」（含 config/scenario.json 等结构），
   * 而非 .aweeclawpkg 压缩包文件。因此当传入的是打包产物文件路径时，
   * 需要解析为其所在的 dist/ 目录。
   */
  async installScenario(projectId: string, version: string, packagePath: string): Promise<InstallRecord> {
    const id = generateId()
    const now = new Date().toISOString()

    // 解析安装源目录：IPC 需要的是包含 config/ 等结构的目录
    const sourceDir = await this.resolveInstallSourceDir(packagePath)

    // 创建安装记录（package_path 保留原始产物路径用于审计）
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
      if (!sourceDir) {
        throw new Error('Invalid install source directory')
      }
      // 调用客户端 IPC 安装场景（传入源目录而非打包文件）
      const result = await this.invokeInstallIpc(sourceDir)

      if (!result.success) {
        await this.executeSql(
          `UPDATE install_records SET status = 'failed', error = ? WHERE id = ?`,
          [result.error ?? '', id],
        )
        return { ...record, status: 'failed', error: result.error }
      }

      // 关键：IPC 仅完成文件拷贝，还需在场景注册中心注册，否则场景管理界面看不到。
      // 复用客户端市场/本地安装共用流程 registerInstalledScenario：
      //   1. 读取已拷贝目录的文件 → 构造 DeclarativeScenarioModule → scenarioLoader.register
      //   2. scenarioRegistry.registerAndPersist（持久化到场景列表）
      //   3. 执行 installScripts 初始化场景数据库
      const scenarioId = result.scenarioId || ''
      const config = result.config || {}
      if (scenarioId && Object.keys(config).length > 0) {
        try {
          await registerInstalledScenario(config as never, {
            scenarioId,
            source: 'local',
            version: (config.version as string) || version,
          })
        } catch (regErr) {
          // 注册失败不阻塞安装记录，但需标记错误供用户排查
          const regMsg = `Scenario files copied but registry failed: ${(regErr as Error).message}`
          await this.executeSql(
            `UPDATE install_records SET status = 'failed', error = ? WHERE id = ?`,
            [regMsg, id],
          )
          return { ...record, status: 'failed', error: regMsg }
        }
      }

      await this.executeSql(
        `UPDATE install_records SET status = 'installed', error = '' WHERE id = ?`,
        [id],
      )
      return { ...record, status: 'installed', scenarioId }
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
   * 解析安装源目录。
   *
   * IPC scenario:installFromLocal 期望接收一个包含 config/scenario.json 的目录，
   * 而非 .aweeclawpkg 压缩包文件。因此：
   * - 若 packagePath 指向 .aweeclawpkg 文件 → 取其所在目录（即 dist/）
   * - 若 packagePath 本身就是目录 → 直接使用
   * - 路径不存在 → 返回 null（由调用方处理）
   *
   * 注意：渲染进程无法直接使用 Node 的 fs/path 模块，路径存在性校验
   * 通过 file:exists IPC 完成；目录名提取用纯字符串操作（兼容 / 与 \）。
   */
  private async resolveInstallSourceDir(packagePath: string): Promise<string | null> {
    try {
      const exists = await this.fileExists(packagePath)
      if (!exists) return null

      // 纯字符串方式提取目录名（等价于 path.dirname），兼容 POSIX 与 Windows 分隔符
      const norm = packagePath.replace(/[\\/]+$/, '')
      const sepIdx = Math.max(norm.lastIndexOf('/'), norm.lastIndexOf('\\'))
      const dir = sepIdx >= 0 ? norm.substring(0, sepIdx) : norm
      // 若入参本身指向目录（无 .aweeclawpkg 后缀），直接返回
      if (packagePath.toLowerCase().endsWith('.aweeclawpkg')) {
        return dir
      }
      return packagePath
    } catch {
      return null
    }
  }

  /**
   * 通过 IPC 校验路径是否存在（渲染进程不可直接访问 fs）。
   */
  private async fileExists(targetPath: string): Promise<boolean> {
    if (typeof window === 'undefined') return false
    const electronAPI = (window as any).electronAPI
    if (!electronAPI?.fileExists) return false
    try {
      return Boolean(await electronAPI.fileExists(targetPath))
    } catch {
      return false
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

  private async invokeInstallIpc(sourceDir: string): Promise<InstallIpcResult> {
    // 复用客户端现有的 scenario:installFromLocal IPC（命名方法）
    if (typeof window !== 'undefined' && (window as any).electronAPI?.scenarioInstallFromLocal) {
      try {
        // installFromLocal 接收 sourceDir 参数，应当指向项目的 dist/ 目录
        const result = await (window as any).electronAPI.scenarioInstallFromLocal(sourceDir)
        return {
          success: result?.success === true,
          error: result?.error,
          scenarioId: result?.scenarioId,
          config: result?.config,
        }
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
