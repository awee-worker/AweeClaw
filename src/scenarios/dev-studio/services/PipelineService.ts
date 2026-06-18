/**
 * PipelineService - 流水线管理服务
 *
 * 管理流水线配置、运行、构建日志和阶段状态。
 * 支持 Lint → Build → Test → Deploy → Preview 五阶段流水线。
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'
import { projectService } from './ProjectService'
import type { BuildType, BuildStatus, PipelineStageConfig, PipelineConfig } from '../types'

// ==========================================
// 类型扩展
// ==========================================

export interface PipelineRun {
  id: string
  pipelineId: string
  projectId: string
  status: BuildStatus
  stages: PipelineRunStage[]
  startedAt: string
  finishedAt?: string
  totalDurationMs: number
}

export interface PipelineRunStage {
  id: string
  type: BuildType
  label: string
  status: BuildStatus
  exitCode?: number
  output: string
  durationMs: number
  startedAt?: string
  finishedAt?: string
}

export interface PipelineConfigInput {
  name: string
  stages: PipelineStageConfig[]
  trigger?: 'manual' | 'push' | 'schedule'
  schedule?: string
}

// ==========================================
// 默认流水线阶段
// ==========================================

export const DEFAULT_PIPELINE_STAGES: PipelineStageConfig[] = [
  { id: 'lint', type: 'lint', label: 'Lint', labelZh: '代码检查', command: 'npm run lint', enabled: true, timeout: 120000 },
  { id: 'build', type: 'build', label: 'Build', labelZh: '构建', command: 'npm run build', enabled: true, timeout: 300000 },
  { id: 'test', type: 'test', label: 'Test', labelZh: '测试', command: 'npm run test', enabled: true, timeout: 300000 },
  { id: 'deploy', type: 'deploy', label: 'Deploy', labelZh: '部署', command: 'npm run deploy', enabled: false, timeout: 600000 },
  { id: 'preview', type: 'preview', label: 'Preview', labelZh: '预览', command: 'npm run preview', enabled: false, timeout: 120000 },
]

export const PIPELINE_STAGE_LABELS: Record<BuildType, { label: string; labelZh: string }> = {
  lint: { label: 'Lint', labelZh: '代码检查' },
  build: { label: 'Build', labelZh: '构建' },
  test: { label: 'Test', labelZh: '测试' },
  deploy: { label: 'Deploy', labelZh: '部署' },
  preview: { label: 'Preview', labelZh: '预览' },
}

// ==========================================
// PipelineService
// ==========================================

class PipelineService {
  private _context: ScenarioModuleContext | null = null
  private activeRuns = new Map<string, PipelineRun>()

  setContext(ctx: ScenarioModuleContext): void {
    this._context = ctx
  }

  private get context(): ScenarioModuleContext {
    if (!this._context) throw new Error('PipelineService: context not set')
    return this._context
  }

  private get log() {
    return this.context.getLogger()
  }

  // ==========================================
  // 流水线配置 CRUD
  // ==========================================

  async createPipelineConfig(projectId: string, input: PipelineConfigInput): Promise<PipelineConfig> {
    const trimmedName = input.name?.trim()
    if (!trimmedName || trimmedName.length > 100) {
      throw new Error('Pipeline name must be 1-100 characters')
    }
    if (!input.stages || input.stages.length === 0) {
      throw new Error('Pipeline must have at least one stage')
    }
    const id = `pipeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()

    const config: PipelineConfig = {
      id,
      projectId,
      name: trimmedName,
      stages: input.stages,
      trigger: input.trigger ?? 'manual',
      schedule: input.schedule ?? '',
      createdAt: now,
      updatedAt: now,
    }

    await projectService.executeSql(
      `INSERT INTO pipeline_configs (id, project_id, name, stages, trigger, schedule, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, projectId, config.name, JSON.stringify(config.stages), config.trigger, config.schedule, now, now],
    )

    this.log.info(`Pipeline config created: ${id}`)
    return config
  }

  async getPipelineConfig(pipelineId: string): Promise<PipelineConfig | null> {
    const rows = await projectService.executeSql(
      'SELECT * FROM pipeline_configs WHERE id = ?',
      [pipelineId],
    )
    if (rows.length === 0) return null
    return this.mapPipelineConfig(rows[0])
  }

  async getProjectPipelineConfigs(projectId: string): Promise<PipelineConfig[]> {
    const rows = await projectService.executeSql(
      'SELECT * FROM pipeline_configs WHERE project_id = ? ORDER BY created_at DESC',
      [projectId],
    )
    return rows.map(r => this.mapPipelineConfig(r))
  }

  async updatePipelineConfig(pipelineId: string, updates: Partial<PipelineConfigInput>): Promise<void> {
    const fields: string[] = ['updated_at = datetime(\'now\', \'localtime\')']
    const values: unknown[] = []

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.stages !== undefined) { fields.push('stages = ?'); values.push(JSON.stringify(updates.stages)) }
    if (updates.trigger !== undefined) { fields.push('trigger = ?'); values.push(updates.trigger) }
    if (updates.schedule !== undefined) { fields.push('schedule = ?'); values.push(updates.schedule) }

    values.push(pipelineId)
    await projectService.executeSql(
      `UPDATE pipeline_configs SET ${fields.join(', ')} WHERE id = ?`,
      values,
    )
  }

  async deletePipelineConfig(pipelineId: string): Promise<void> {
    await projectService.executeSql('DELETE FROM pipeline_configs WHERE id = ?', [pipelineId])
    this.log.info(`Pipeline config deleted: ${pipelineId}`)
  }

  // ==========================================
  // 流水线运行
  // ==========================================

  async createPipelineRun(projectId: string, pipelineId: string): Promise<PipelineRun> {
    const config = await this.getPipelineConfig(pipelineId)
    if (!config) throw new Error(`Pipeline config not found: ${pipelineId}`)

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()

    const stages: PipelineRunStage[] = config.stages
      .filter(s => s.enabled)
      .map((s, i) => ({
        id: `${runId}-stage-${i}`,
        type: s.type,
        label: s.label,
        status: 'pending' as BuildStatus,
        output: '',
        durationMs: 0,
      }))

    const run: PipelineRun = {
      id: runId,
      pipelineId,
      projectId,
      status: 'pending',
      stages,
      startedAt: now,
      totalDurationMs: 0,
    }

    this.activeRuns.set(runId, run)
    this.log.info(`Pipeline run created: ${runId}`)
    return run
  }

  async startPipelineRun(runId: string): Promise<PipelineRun> {
    const run = this.activeRuns.get(runId)
    if (!run) throw new Error(`Pipeline run not found: ${runId}`)

    run.status = 'running'
    run.startedAt = new Date().toISOString()

    this.log.info(`Pipeline run started: ${runId}`)
    return run
  }

  async updateStageStatus(
    runId: string,
    stageType: BuildType,
    status: BuildStatus,
    updates?: { output?: string; exitCode?: number; durationMs?: number },
  ): Promise<void> {
    const run = this.activeRuns.get(runId)
    if (!run) throw new Error(`Pipeline run not found: ${runId}`)

    const stage = run.stages.find(s => s.type === stageType)
    if (!stage) throw new Error(`Stage not found: ${stageType}`)

    stage.status = status
    if (updates?.output !== undefined) stage.output = updates.output
    if (updates?.exitCode !== undefined) stage.exitCode = updates.exitCode
    if (updates?.durationMs !== undefined) stage.durationMs = updates.durationMs

    const now = new Date().toISOString()
    if (status === 'running') stage.startedAt = now
    if (status === 'success' || status === 'failed' || status === 'cancelled') stage.finishedAt = now

    this.log.info(`Pipeline stage ${stageType}: ${status}`)
  }

  async completePipelineRun(runId: string, status: BuildStatus): Promise<PipelineRun> {
    const run = this.activeRuns.get(runId)
    if (!run) throw new Error(`Pipeline run not found: ${runId}`)

    run.status = status
    run.finishedAt = new Date().toISOString()
    run.totalDurationMs = run.stages.reduce((sum, s) => sum + s.durationMs, 0)

    this.log.info(`Pipeline run completed: ${runId} → ${status} (${run.totalDurationMs}ms)`)
    return run
  }

  getActiveRun(runId: string): PipelineRun | undefined {
    return this.activeRuns.get(runId)
  }

  getProjectActiveRuns(projectId: string): PipelineRun[] {
    return Array.from(this.activeRuns.values()).filter(r => r.projectId === projectId)
  }

  // ==========================================
  // 构建日志（委托给 ProjectService）
  // ==========================================

  async createBuildLog(
    projectId: string,
    buildType: BuildType,
    command: string,
    sessionId?: string,
  ): Promise<string> {
    const log = await projectService.createBuildLog(projectId, buildType, command, sessionId)
    return log.id
  }

  async updateBuildLog(
    buildId: string,
    status: BuildStatus,
    updates?: { output?: string; exitCode?: number; durationMs?: number },
  ): Promise<void> {
    await projectService.updateBuildLog(buildId, { status, ...updates })
  }

  async getBuildLogs(projectId: string, limit = 50): Promise<Record<string, unknown>[]> {
    return projectService.listBuildLogs(projectId, limit) as unknown as Record<string, unknown>[]
  }

  async getBuildLog(buildId: string): Promise<Record<string, unknown> | null> {
    // projectService doesn't have a getBuildLog by id, use listBuildLogs with a direct query
    const rows = await projectService.executeSql(
      'SELECT * FROM build_logs WHERE id = ?',
      [buildId],
    )
    return rows.length > 0 ? rows[0] : null
  }

  // ==========================================
  // 工具方法
  // ==========================================

  getDefaultStages(): PipelineStageConfig[] {
    return DEFAULT_PIPELINE_STAGES
  }

  getStageLabel(type: BuildType): { label: string; labelZh: string } {
    return PIPELINE_STAGE_LABELS[type] ?? { label: type, labelZh: type }
  }

  private mapPipelineConfig(row: Record<string, unknown>): PipelineConfig {
    return {
      id: row.id as string,
      projectId: row.project_id as string,
      name: row.name as string,
      stages: this.safeParseArray(row.stages as string),
      trigger: (row.trigger as 'manual' | 'push' | 'schedule') ?? 'manual',
      schedule: (row.schedule as string) || '',
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }
  }

  private safeParseArray(str: string): PipelineStageConfig[] {
    try { return JSON.parse(str) as PipelineStageConfig[] } catch { return [] }
  }
}

export const pipelineService = new PipelineService()