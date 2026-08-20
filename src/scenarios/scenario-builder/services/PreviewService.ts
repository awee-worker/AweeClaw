/**
 * 预览服务（PreviewService）
 *
 * 封装场景临时预览（tryRun）的完整生命周期管理：
 * - start(projectPath, scenarioId) → 调用 scenarioBuilderTryRunStart
 * - stop(scenarioId) → 调用 scenarioBuilderTryRunStop
 * - restart → 先 stop 再 start（用于热重载）
 * - getStatus(scenarioId) → 调用 scenarioBuilderTryRunStatus
 * - 事件订阅：状态变化通知监听者
 *
 * 设计要点：
 * - 单例模式，跨组件共享同一预览状态
 * - 不直接调用 IPC，全部走 electronAPI（避免在 service 层硬编码 window 类型）
 * - 状态包含：running / scenarioId / projectPath / startedAt / lastError
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'

// ==========================================
// 类型定义
// ==========================================

/** 预览状态 */
export interface PreviewState {
  /** 是否运行中 */
  running: boolean
  /** 当前预览的 scenarioId */
  scenarioId: string | null
  /** 当前预览的项目路径 */
  projectPath: string | null
  /** 启动时间（ISO 字符串） */
  startedAt: string | null
  /** 最近错误信息 */
  lastError: string | null
  /** 最近一次操作（start / stop / restart） */
  lastAction: 'start' | 'stop' | 'restart' | null
  /** 最近一次操作时间 */
  lastActionAt: string | null
}

/** 预览事件 */
export type PreviewEvent =
  | { type: 'state-change'; state: PreviewState }
  | { type: 'action-start'; scenarioId: string }
  | { type: 'action-stop'; scenarioId: string }
  | { type: 'action-restart'; scenarioId: string }
  | { type: 'error'; error: string }

// ==========================================
// 调试数据类型（C1 扩展）
// ==========================================

/** 日志级别 */
export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

/** 单条日志 */
export interface LiveLog {
  /** 时间戳（ISO 字符串） */
  timestamp: string
  /** 日志级别 */
  level: LogLevel
  /** 来源（scenarioId / 工具名 / 模块名） */
  source: string
  /** 日志消息 */
  message: string
  /** 可选附加数据（对象/字符串） */
  meta?: unknown
}

/** 数据库表快照 */
export interface DatabaseTableSnapshot {
  /** 表名 */
  name: string
  /** 行数 */
  rowCount: number
  /** 列定义 */
  columns: Array<{ name: string; type: string; nullable?: boolean; primaryKey?: boolean }>
  /** 样本数据（前 N 行） */
  sampleRows: Record<string, unknown>[]
  /** 索引列表 */
  indexes: Array<{ name: string; columns: string[] }>
}

/** 数据库快照 */
export interface DatabaseSnapshot {
  /** 数据库文件路径 */
  databasePath: string
  /** 表列表 */
  tables: DatabaseTableSnapshot[]
  /** 数据库大小（字节） */
  sizeBytes: number
  /** 查询时间（毫秒） */
  queryDurationMs: number
}

/** 工具调用轨迹 */
export interface ToolCallTrace {
  /** 调用 ID */
  callId: string
  /** 工具名 */
  toolName: string
  /** 调用参数 */
  arguments: Record<string, unknown>
  /** 调用时间（ISO 字符串） */
  startedAt: string
  /** 完成时间（ISO 字符串，未完成为 null） */
  completedAt: string | null
  /** 执行时长（毫秒，未完成为 null） */
  durationMs: number | null
  /** 是否成功 */
  success: boolean | null
  /** 返回结果（已完成） */
  result?: unknown
  /** 错误信息（失败时） */
  error?: string
  /** 是否被审批拒绝 */
  approvalDenied?: boolean
}

/** 性能指标 */
export interface PreviewMetrics {
  /** 预览启动时间（ISO 字符串） */
  startedAt: string
  /** 运行时长（毫秒） */
  uptimeMs: number
  /** 内存占用（字节） */
  memoryUsageBytes: number
  /** 工具调用总数 */
  toolCallCount: number
  /** 工具调用成功数 */
  toolCallSuccessCount: number
  /** 工具调用失败数 */
  toolCallFailureCount: number
  /** 平均工具调用时长（毫秒） */
  avgToolCallDurationMs: number
  /** 数据库查询总数 */
  dbQueryCount: number
  /** 数据库平均查询时长（毫秒） */
  avgDbQueryDurationMs: number
  /** 当前活跃 IPC 处理器数量 */
  activeIpcHandlers: number
  /** 场景数据库大小（字节） */
  databaseSizeBytes: number
  /** 健康检查状态 */
  healthStatus: 'healthy' | 'degraded' | 'unhealthy'
  /** 健康检查消息 */
  healthMessage?: string
}

// ==========================================
// 服务实现
// ==========================================

class PreviewServiceImpl {
  private context: ScenarioModuleContext | null = null
  private state: PreviewState = {
    running: false,
    scenarioId: null,
    projectPath: null,
    startedAt: null,
    lastError: null,
    lastAction: null,
    lastActionAt: null,
  }
  private listeners = new Set<(event: PreviewEvent) => void>()
  /** 状态轮询定时器（运行中时每 3 秒拉取一次状态，确保跨窗口同步） */
  private pollTimer: ReturnType<typeof setInterval> | null = null

  setContext(context: ScenarioModuleContext): void {
    this.context = context
  }

  /** 获取当前状态（只读副本） */
  getState(): PreviewState {
    return { ...this.state }
  }

  /** 订阅事件 */
  subscribe(listener: (event: PreviewEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 通知状态变化 */
  private notifyStateChange(): void {
    const event: PreviewEvent = { type: 'state-change', state: this.getState() }
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        const ctx = this.context
        if (ctx) {
          ctx.getLogger().error('[PreviewService] listener error:', err)
        }
      }
    }
  }

  /** 更新状态并通知 */
  private updateState(patch: Partial<PreviewState>): void {
    this.state = { ...this.state, ...patch }
    this.notifyStateChange()
  }

  /** 通知事件 */
  private notifyEvent(event: PreviewEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (err) {
        const ctx = this.context
        if (ctx) {
          ctx.getLogger().error('[PreviewService] listener error:', err)
        }
      }
    }
  }

  /** 获取 electronAPI（运行时检查） */
  private getElectronAPI(): any {
    if (typeof window === 'undefined') return null
    const api = (window as any).electronAPI
    if (!api) return null
    return api
  }

  // ==========================================
  // 预览生命周期
  // ==========================================

  /**
   * 启动预览
   * @param projectPath 项目路径
   * @param scenarioId 场景 ID（用于状态查询）
   */
  async start(projectPath: string, scenarioId: string): Promise<{ success: boolean; error?: string }> {
    const api = this.getElectronAPI()
    if (!api?.scenarioBuilderTryRunStart) {
      const err = 'IPC scenarioBuilderTryRunStart not available'
      this.updateState({ lastError: err })
      this.notifyEvent({ type: 'error', error: err })
      return { success: false, error: err }
    }
    try {
      const result = await api.scenarioBuilderTryRunStart({ projectPath })
      if (!result?.success) {
        const err = result?.error || '启动预览失败'
        this.updateState({ lastError: err })
        this.notifyEvent({ type: 'error', error: err })
        return { success: false, error: err }
      }
      const actualScenarioId = result.scenarioId || scenarioId
      this.updateState({
        running: true,
        scenarioId: actualScenarioId,
        projectPath,
        startedAt: new Date().toISOString(),
        lastError: null,
        lastAction: 'start',
        lastActionAt: new Date().toISOString(),
      })
      this.notifyEvent({ type: 'action-start', scenarioId: actualScenarioId })
      // 通知客户端场景加载器（可选）
      if (api.scenarioTryRunLoad) {
        try {
          await api.scenarioTryRunLoad({ scenarioId: actualScenarioId, projectPath })
        } catch (err) {
          // 加载失败不影响预览状态，仅记录日志
          const ctx = this.context
          if (ctx) {
            ctx.getLogger().warn('[PreviewService] scenarioTryRunLoad failed:', err)
          }
        }
      }
      this.startPolling(actualScenarioId)
      return { success: true }
    } catch (err) {
      const msg = (err as Error).message || '启动预览失败'
      this.updateState({ lastError: msg })
      this.notifyEvent({ type: 'error', error: msg })
      return { success: false, error: msg }
    }
  }

  /**
   * 停止预览
   */
  async stop(scenarioId?: string): Promise<{ success: boolean; error?: string }> {
    const targetId = scenarioId ?? this.state.scenarioId
    if (!targetId) {
      return { success: true }
    }
    const api = this.getElectronAPI()
    if (!api?.scenarioBuilderTryRunStop) {
      const err = 'IPC scenarioBuilderTryRunStop not available'
      this.updateState({ lastError: err })
      return { success: false, error: err }
    }
    try {
      const result = await api.scenarioBuilderTryRunStop({ scenarioId: targetId })
      if (!result?.success) {
        const err = result?.error || '停止预览失败'
        this.updateState({ lastError: err })
        return { success: false, error: err }
      }
      this.stopPolling()
      this.updateState({
        running: false,
        scenarioId: null,
        projectPath: null,
        startedAt: null,
        lastError: null,
        lastAction: 'stop',
        lastActionAt: new Date().toISOString(),
      })
      this.notifyEvent({ type: 'action-stop', scenarioId: targetId })
      return { success: true }
    } catch (err) {
      const msg = (err as Error).message || '停止预览失败'
      this.updateState({ lastError: msg })
      return { success: false, error: msg }
    }
  }

  /**
   * 重启预览（热重载）：先 stop 再 start
   * 用于文件变化后自动重载，或用户手动触发热重载
   */
  async restart(): Promise<{ success: boolean; error?: string }> {
    const { scenarioId, projectPath } = this.state
    if (!scenarioId || !projectPath) {
      return { success: false, error: '预览未运行，无法重启' }
    }
    // 先停止
    const stopRes = await this.stop(scenarioId)
    if (!stopRes.success) {
      // 停止失败仍尝试启动
      const ctx = this.context
      if (ctx) {
        ctx.getLogger().warn('[PreviewService] restart: stop failed, still trying start')
      }
    }
    // 重新启动
    const startRes = await this.start(projectPath, scenarioId)
    if (!startRes.success) {
      this.updateState({
        lastError: startRes.error || '重启失败',
        lastAction: 'restart',
        lastActionAt: new Date().toISOString(),
      })
      return { success: false, error: startRes.error }
    }
    this.updateState({
      lastAction: 'restart',
      lastActionAt: new Date().toISOString(),
    })
    this.notifyEvent({ type: 'action-restart', scenarioId })
    return { success: true }
  }

  /**
   * 拉取最新状态（从主进程同步）
   */
  async refreshStatus(scenarioId?: string): Promise<PreviewState> {
    const targetId = scenarioId ?? this.state.scenarioId
    if (!targetId) {
      this.updateState({ running: false })
      return this.getState()
    }
    const api = this.getElectronAPI()
    if (!api?.scenarioBuilderTryRunStatus) {
      return this.getState()
    }
    try {
      const status = await api.scenarioBuilderTryRunStatus({ scenarioId: targetId })
      if (!status?.running && this.state.running) {
        // 主进程已停止，同步本地状态
        this.stopPolling()
        this.updateState({
          running: false,
          scenarioId: null,
          projectPath: null,
          startedAt: null,
          lastError: null,
        })
      }
      return this.getState()
    } catch (err) {
      const ctx = this.context
      if (ctx) {
        ctx.getLogger().warn('[PreviewService] refreshStatus failed:', err)
      }
      return this.getState()
    }
  }

  // ==========================================
  // 状态轮询（运行中每 3 秒拉取一次）
  // ==========================================

  private startPolling(scenarioId: string): void {
    this.stopPolling()
    this.pollTimer = setInterval(() => {
      void this.refreshStatus(scenarioId)
    }, 3000)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  // ==========================================
  // 调试数据查询（C1 扩展）
  // ==========================================

  /**
   * 获取实时日志
   * @param limit 最大返回条数（默认 200）
   * @param level 过滤级别（info/warn/error/debug，未指定则返回全部）
   */
  async getLiveLogs(
    limit = 200,
    level?: LogLevel,
  ): Promise<{ success: boolean; logs: LiveLog[]; error?: string }> {
    if (!this.state.running || !this.state.scenarioId) {
      return { success: false, logs: [], error: '预览未运行' }
    }
    const api = this.getElectronAPI()
    if (!api?.scenarioBuilderGetLiveLogs) {
      return { success: false, logs: [], error: 'IPC scenarioBuilderGetLiveLogs not available' }
    }
    try {
      const result = await api.scenarioBuilderGetLiveLogs({
        scenarioId: this.state.scenarioId,
        limit,
        level,
      })
      return {
        success: !!result?.success,
        logs: (result?.logs ?? []) as LiveLog[],
        error: result?.error,
      }
    } catch (err) {
      return { success: false, logs: [], error: (err as Error).message }
    }
  }

  /**
   * 获取数据库快照（表结构 + 样本数据 + 索引）
   * @param tableName 指定表名（未指定则返回所有表概览，每表样本行数较少）
   * @param sampleLimit 每张表返回的样本行数（默认 10）
   */
  async getDatabaseSnapshot(
    tableName?: string,
    sampleLimit = 10,
  ): Promise<{ success: boolean; snapshot: DatabaseSnapshot | null; error?: string }> {
    if (!this.state.running || !this.state.scenarioId) {
      return { success: false, snapshot: null, error: '预览未运行' }
    }
    const api = this.getElectronAPI()
    if (!api?.scenarioBuilderGetDatabaseSnapshot) {
      return { success: false, snapshot: null, error: 'IPC scenarioBuilderGetDatabaseSnapshot not available' }
    }
    try {
      const result = await api.scenarioBuilderGetDatabaseSnapshot({
        scenarioId: this.state.scenarioId,
        tableName,
        sampleLimit,
      })
      return {
        success: !!result?.success,
        snapshot: (result?.snapshot ?? null) as DatabaseSnapshot | null,
        error: result?.error,
      }
    } catch (err) {
      return { success: false, snapshot: null, error: (err as Error).message }
    }
  }

  /**
   * 获取工具调用轨迹
   * @param limit 最大返回条数（默认 100）
   * @param toolName 过滤工具名（未指定则返回全部工具调用）
   */
  async getToolCallTrace(
    limit = 100,
    toolName?: string,
  ): Promise<{ success: boolean; traces: ToolCallTrace[]; error?: string }> {
    if (!this.state.running || !this.state.scenarioId) {
      return { success: false, traces: [], error: '预览未运行' }
    }
    const api = this.getElectronAPI()
    if (!api?.scenarioBuilderGetToolCallTrace) {
      return { success: false, traces: [], error: 'IPC scenarioBuilderGetToolCallTrace not available' }
    }
    try {
      const result = await api.scenarioBuilderGetToolCallTrace({
        scenarioId: this.state.scenarioId,
        limit,
        toolName,
      })
      return {
        success: !!result?.success,
        traces: (result?.traces ?? []) as ToolCallTrace[],
        error: result?.error,
      }
    } catch (err) {
      return { success: false, traces: [], error: (err as Error).message }
    }
  }

  /**
   * 获取性能指标（运行时长 / 内存 / 工具调用统计 / 数据库查询统计 / 健康状态）
   */
  async getMetrics(): Promise<{ success: boolean; metrics: PreviewMetrics | null; error?: string }> {
    if (!this.state.running || !this.state.scenarioId) {
      return { success: false, metrics: null, error: '预览未运行' }
    }
    const api = this.getElectronAPI()
    if (!api?.scenarioBuilderGetMetrics) {
      return { success: false, metrics: null, error: 'IPC scenarioBuilderGetMetrics not available' }
    }
    try {
      const result = await api.scenarioBuilderGetMetrics({
        scenarioId: this.state.scenarioId,
      })
      return {
        success: !!result?.success,
        metrics: (result?.metrics ?? null) as PreviewMetrics | null,
        error: result?.error,
      }
    } catch (err) {
      return { success: false, metrics: null, error: (err as Error).message }
    }
  }

  /**
   * 清理：组件卸载时调用
   */
  dispose(): void {
    this.stopPolling()
    this.listeners.clear()
  }
}

// ==========================================
// 单例
// ==========================================

export const previewService = new PreviewServiceImpl()
