/**
 * dev-studio 预览 + 部署服务
 *
 * 管理预览服务器和部署流程：
 * - 开发服务器启停（dev server）
 * - 预览 URL 管理
 * - 部署记录 CRUD（deployments 表）
 * - 部署目标平台管理
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import { projectService } from './ProjectService'

// ==========================================
// 类型定义
// ==========================================

export type DeployTarget = 'vercel' | 'netlify' | 'cloudflare' | 'github-pages' | 'docker' | 'custom'

export type DeployStatus = 'pending' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled'

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile'

export interface PreviewServerState {
  running: boolean
  port?: number
  url?: string
  projectId?: string
  startedAt?: number
  pid?: number
}

export interface DeployRecord {
  id: string
  projectId: string
  sessionId?: string
  target: DeployTarget
  status: DeployStatus
  url: string
  config: DeployConfig
  log: string
  durationMs: number
  startedAt: string
  finishedAt?: string
}

export interface DeployConfig {
  target: DeployTarget
  env?: Record<string, string>
  buildCommand?: string
  outputDir?: string
  apiToken?: string
  projectName?: string
  branch?: string
  [key: string]: unknown
}

export interface DeployTargetInfo {
  id: DeployTarget
  name: string
  icon: string
  description: string
  urlTemplate: string
  requiresToken: boolean
  free: boolean
}

// ==========================================
// 部署目标定义
// ==========================================

export const DEPLOY_TARGETS: DeployTargetInfo[] = [
  {
    id: 'vercel',
    name: 'Vercel',
    icon: 'Vercel',
    description: 'Best for Next.js, SvelteKit, and static sites',
    urlTemplate: 'https://{project}.vercel.app',
    requiresToken: true,
    free: true,
  },
  {
    id: 'netlify',
    name: 'Netlify',
    icon: 'Netlify',
    description: 'Great for static sites and serverless functions',
    urlTemplate: 'https://{project}.netlify.app',
    requiresToken: true,
    free: true,
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Pages',
    icon: 'Cloudflare',
    description: 'Edge deployment with global CDN',
    urlTemplate: 'https://{project}.pages.dev',
    requiresToken: true,
    free: true,
  },
  {
    id: 'github-pages',
    name: 'GitHub Pages',
    icon: 'GitHub',
    description: 'Free hosting for static sites from GitHub repos',
    urlTemplate: 'https://{user}.github.io/{project}',
    requiresToken: false,
    free: true,
  },
  {
    id: 'docker',
    name: 'Docker',
    icon: 'Docker',
    description: 'Container-based deployment',
    urlTemplate: '',
    requiresToken: false,
    free: false,
  },
  {
    id: 'custom',
    name: 'Custom Server',
    icon: 'Server',
    description: 'Deploy to your own server via SSH/FTP',
    urlTemplate: '',
    requiresToken: false,
    free: false,
  },
]

// ==========================================
// PreviewService
// ==========================================

class PreviewService {
  private _context: ScenarioModuleContext | null = null
  private serverState: PreviewServerState = { running: false }

  setContext(ctx: ScenarioModuleContext): void {
    this._context = ctx
  }

  private get context(): ScenarioModuleContext {
    if (!this._context) throw new Error('PreviewService: context not set')
    return this._context
  }

  private get log() {
    return this.context.getLogger()
  }

  // ==========================================
  // 预览服务器
  // ==========================================

  getServerState(): PreviewServerState {
    return { ...this.serverState }
  }

  async startDevServer(projectId: string, port?: number, command?: string): Promise<PreviewServerState> {
    const project = await projectService.getProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    const actualPort = port ?? 3000
    const actualCommand = command ?? 'npm run dev'

    this.serverState = {
      running: true,
      port: actualPort,
      url: `http://localhost:${actualPort}`,
      projectId,
      startedAt: Date.now(),
    }

    this.log.info(`Dev server started: ${actualCommand} on port ${actualPort}`)
    return this.getServerState()
  }

  async stopDevServer(): Promise<PreviewServerState> {
    this.serverState = { running: false }
    this.log.info('Dev server stopped')
    return this.getServerState()
  }

  /**
   * 获取预览设备尺寸
   */
  getDeviceDimensions(device: PreviewDevice): { width: number; height: number } {
    switch (device) {
      case 'mobile': return { width: 375, height: 812 }
      case 'tablet': return { width: 768, height: 1024 }
      case 'desktop': return { width: 1280, height: 720 }
    }
  }

  /**
   * 构建 iframe 预览 URL
   */
  getPreviewUrl(_projectId: string, port?: number): string {
    const p = port ?? this.serverState.port ?? 3000
    return `http://localhost:${p}`
  }

  // ==========================================
  // 部署管理
  // ==========================================

  async deploy(
    projectId: string,
    target: DeployTarget,
    config: Partial<DeployConfig> = {},
  ): Promise<DeployRecord> {
    const project = await projectService.getProject(projectId)
    if (!project) throw new Error(`Project not found: ${projectId}`)

    const id = `deploy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()

    const deployConfig: DeployConfig = {
      target,
      projectName: project.name,
      ...config,
    }

    const record: DeployRecord = {
      id,
      projectId,
      target,
      status: 'pending',
      url: this.buildDeployUrl(target, project.name),
      config: deployConfig,
      log: '',
      durationMs: 0,
      startedAt: now,
    }

    // 持久化到数据库
    await projectService.executeSql(
      `INSERT INTO deployments (id, project_id, target, status, url, config, log, duration_ms, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, target, 'pending', record.url, JSON.stringify(deployConfig), '', 0, now],
    )

    this.log.info(`Deployment initiated: ${id} → ${target}`)
    return record
  }

  async updateDeployStatus(
    deployId: string,
    status: DeployStatus,
    updates?: { url?: string; log?: string; durationMs?: number },
  ): Promise<void> {
    const fields: string[] = ['status = ?']
    const values: unknown[] = [status]

    if (updates?.url !== undefined) { fields.push('url = ?'); values.push(updates.url) }
    if (updates?.log !== undefined) { fields.push('log = ?'); values.push(updates.log) }
    if (updates?.durationMs !== undefined) { fields.push('duration_ms = ?'); values.push(updates.durationMs) }

    if (status === 'success' || status === 'failed' || status === 'cancelled') {
      fields.push("finished_at = datetime('now', 'localtime')")
    }

    values.push(deployId)

    await projectService.executeSql(
      `UPDATE deployments SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )

    this.log.info(`Deployment ${deployId} status: ${status}`)
  }

  async getDeployHistory(projectId: string, limit = 20): Promise<DeployRecord[]> {
    const rows = await projectService.executeSql(
      'SELECT * FROM deployments WHERE project_id = ? ORDER BY started_at DESC LIMIT ?',
      [projectId, limit],
    )
    return rows.map(r => this.mapDeployRecord(r))
  }

  async getDeployRecord(deployId: string): Promise<DeployRecord | null> {
    const rows = await projectService.executeSql(
      'SELECT * FROM deployments WHERE id = ?',
      [deployId],
    )
    if (rows.length === 0) return null
    return this.mapDeployRecord(rows[0])
  }

  // ==========================================
  // 部署目标
  // ==========================================

  getDeployTargets(): DeployTargetInfo[] {
    return DEPLOY_TARGETS
  }

  getDeployTarget(target: DeployTarget): DeployTargetInfo | undefined {
    return DEPLOY_TARGETS.find(t => t.id === target)
  }

  // ==========================================
  // 工具方法
  // ==========================================

  private buildDeployUrl(target: DeployTarget, projectName: string): string {
    const info = DEPLOY_TARGETS.find(t => t.id === target)
    if (!info?.urlTemplate) return ''
    return info.urlTemplate.replace('{project}', projectName.toLowerCase().replace(/\s+/g, '-'))
  }

  private mapDeployRecord(row: Record<string, unknown>): DeployRecord {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      sessionId: (row.session_id as string) || undefined,
      target: row.target as DeployTarget,
      status: row.status as DeployStatus,
      url: (row.url as string) || '',
      config: this.safeJson<DeployConfig>(row.config as string, { target: 'custom' }),
      log: (row.log as string) || '',
      durationMs: (row.duration_ms as number) || 0,
      startedAt: row.started_at as string,
      finishedAt: (row.finished_at as string) || undefined,
    }
  }

  private safeJson<T>(str: string, fallback: T): T {
    try { return JSON.parse(str) as T } catch { return fallback }
  }
}

export const previewService = new PreviewService()