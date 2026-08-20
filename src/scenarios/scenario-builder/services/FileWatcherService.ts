/**
 * 文件监听服务（FileWatcherService）
 *
 * 监听场景项目目录的文件变化，触发自动热重载链路：
 *   文件变化 → 防抖聚合 → onFileChange 回调 → PreviewService.restart()
 *
 * 数据流：
 *   watch(projectPath) → electronAPI.scenarioBuilderWatchProject
 *   主进程通过 fs.watch 递归监听 → IPC 事件 'scenario-builder:fileChange' 推送
 *   → 渲染进程 onFileChange 监听 → 防抖 500ms → 通知订阅者
 *   unwatch() → electronAPI.scenarioBuilderUnwatchProject
 *
 * 设计要点：
 * - 单例模式，跨组件共享监听状态
 * - 防抖 500ms，避免编辑器连续保存触发多次重载
 * - 支持 ignore 模式（node_modules / dist / .git 等）
 * - 通过 IPC 事件接收变化，避免渲染进程直接访问 fs
 *
 * 注意：主进程需要实现 scenario-builder:watchProject / unwatchProject IPC 与
 *      'scenario-builder:fileChange' 事件推送（见 main/bridge/scenario/scenarioBuilder.ts）
 */
import type { ScenarioModuleContext } from '@shared/protocols/scenario-arch'

// ==========================================
// 类型定义
// ==========================================

/** 文件变化事件 */
export interface FileChangeEvent {
  /** 项目路径 */
  projectPath: string
  /** 相对路径（相对项目根目录） */
  relativePath: string
  /** 变化类型：add / change / unlink */
  type: 'add' | 'change' | 'unlink'
}

/** 监听选项 */
export interface WatchOptions {
  /** 项目根路径（必填） */
  projectPath: string
  /** 忽略的相对路径前缀（默认包含 node_modules / dist / .git） */
  ignore?: string[]
  /** 防抖延迟（毫秒，默认 500） */
  debounceMs?: number
}

/** 监听状态 */
export interface WatchState {
  /** 是否监听中 */
  watching: boolean
  /** 监听的项目路径 */
  projectPath: string | null
  /** 最近一次变化时间 */
  lastChangeAt: string | null
  /** 最近一次变化的文件 */
  lastChangedFile: string | null
  /** 最近错误 */
  lastError: string | null
}

// ==========================================
// 默认忽略规则
// ==========================================

const DEFAULT_IGNORE = [
  'node_modules/',
  'dist/',
  '.git/',
  '.aweeclaw/',
  '*.log',
  '.DS_Store',
]

// ==========================================
// 服务实现
// ==========================================

class FileWatcherServiceImpl {
  private context: ScenarioModuleContext | null = null
  private state: WatchState = {
    watching: false,
    projectPath: null,
    lastChangeAt: null,
    lastChangedFile: null,
    lastError: null,
  }
  private listeners = new Set<(event: FileChangeEvent) => void>()
  private stateListeners = new Set<(state: WatchState) => void>()
  /** 防抖定时器 */
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  /** 防抖期间累积的变化事件 */
  private pendingEvents: FileChangeEvent[] = []
  /** 当前防抖延迟 */
  private debounceMs = 500
  /** IPC 事件监听器是否已注册 */
  private ipcListenerRegistered = false
  /** IPC 事件监听器卸载函数 */
  private ipcUnsub: (() => void) | null = null
  /** 当前监听的项目路径（用于校验 IPC 事件归属） */
  private currentProjectPath: string | null = null

  setContext(context: ScenarioModuleContext): void {
    this.context = context
  }

  /** 获取当前状态 */
  getState(): WatchState {
    return { ...this.state }
  }

  /** 订阅文件变化事件 */
  onFileChange(listener: (event: FileChangeEvent) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 订阅状态变化 */
  onStateChange(listener: (state: WatchState) => void): () => void {
    this.stateListeners.add(listener)
    return () => {
      this.stateListeners.delete(listener)
    }
  }

  /** 更新状态并通知 */
  private updateState(patch: Partial<WatchState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.stateListeners) {
      try {
        listener(this.getState())
      } catch (err) {
        const ctx = this.context
        if (ctx) {
          ctx.getLogger().error('[FileWatcherService] state listener error:', err)
        }
      }
    }
  }

  /** 获取 electronAPI */
  private getElectronAPI(): any {
    if (typeof window === 'undefined') return null
    const api = (window as any).electronAPI
    if (!api) return null
    return api
  }

  /** 注册 IPC 事件监听（仅一次） */
  private ensureIpcListener(): void {
    if (this.ipcListenerRegistered) return
    const api = this.getElectronAPI()
    if (!api?.onScenarioBuilderFileChange) {
      // 主进程未提供文件变化 IPC，降级为不监听
      return
    }
    try {
      this.ipcUnsub = api.onScenarioBuilderFileChange((payload: FileChangeEvent) => {
        if (!payload || payload.projectPath !== this.currentProjectPath) {
          // 不属于当前监听项目的事件，忽略
          return
        }
        this.handleFileChange(payload)
      })
      this.ipcListenerRegistered = true
    } catch (err) {
      const ctx = this.context
      if (ctx) {
        ctx.getLogger().error('[FileWatcherService] register IPC listener failed:', err)
      }
    }
  }

  // ==========================================
  // 监听控制
  // ==========================================

  /**
   * 启动监听
   */
  async watch(options: WatchOptions): Promise<{ success: boolean; error?: string }> {
    const { projectPath, ignore, debounceMs } = options
    if (!projectPath) {
      return { success: false, error: 'projectPath is required' }
    }
    // 若已在监听其他项目，先停止
    if (this.state.watching && this.currentProjectPath !== projectPath) {
      await this.unwatch()
    }
    this.debounceMs = debounceMs ?? 500
    this.ensureIpcListener()
    const api = this.getElectronAPI()
    if (!api?.scenarioBuilderWatchProject) {
      const err = 'IPC scenarioBuilderWatchProject not available（需主进程实现）'
      this.updateState({ lastError: err })
      return { success: false, error: err }
    }
    try {
      const result = await api.scenarioBuilderWatchProject({
        projectPath,
        ignore: [...DEFAULT_IGNORE, ...(ignore ?? [])],
      })
      if (!result?.success) {
        const err = result?.error || '启动监听失败'
        this.updateState({ lastError: err })
        return { success: false, error: err }
      }
      this.currentProjectPath = projectPath
      this.updateState({
        watching: true,
        projectPath,
        lastError: null,
      })
      return { success: true }
    } catch (err) {
      const msg = (err as Error).message || '启动监听失败'
      this.updateState({ lastError: msg })
      return { success: false, error: msg }
    }
  }

  /**
   * 停止监听
   */
  async unwatch(): Promise<{ success: boolean; error?: string }> {
    if (!this.state.watching) {
      return { success: true }
    }
    const api = this.getElectronAPI()
    if (!api?.scenarioBuilderUnwatchProject) {
      // 主进程未提供，本地状态重置即可
      this.resetLocalState()
      return { success: true }
    }
    try {
      const result = await api.scenarioBuilderUnwatchProject({
        projectPath: this.currentProjectPath,
      })
      if (!result?.success) {
        // 即使停止失败也重置本地状态
        const ctx = this.context
        if (ctx) {
          ctx.getLogger().warn('[FileWatcherService] unwatch failed:', result?.error)
        }
      }
      this.resetLocalState()
      return { success: true }
    } catch (err) {
      const msg = (err as Error).message || '停止监听失败'
      this.updateState({ lastError: msg })
      this.resetLocalState()
      return { success: false, error: msg }
    }
  }

  /** 重置本地状态（不调用 IPC） */
  private resetLocalState(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.pendingEvents = []
    this.currentProjectPath = null
    this.updateState({
      watching: false,
      projectPath: null,
      lastChangeAt: null,
      lastChangedFile: null,
    })
  }

  // ==========================================
  // 文件变化处理（防抖聚合）
  // ==========================================

  private handleFileChange(event: FileChangeEvent): void {
    this.updateState({
      lastChangeAt: new Date().toISOString(),
      lastChangedFile: event.relativePath,
    })
    this.pendingEvents.push(event)
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.flushPendingEvents()
    }, this.debounceMs)
  }

  /** 提交累积的变化事件到订阅者 */
  private flushPendingEvents(): void {
    if (this.pendingEvents.length === 0) return
    // 取最后一个事件作为代表（防抖后的最终状态）
    const lastEvent = this.pendingEvents[this.pendingEvents.length - 1]
    this.pendingEvents = []
    this.debounceTimer = null
    for (const listener of this.listeners) {
      try {
        listener(lastEvent)
      } catch (err) {
        const ctx = this.context
        if (ctx) {
          ctx.getLogger().error('[FileWatcherService] listener error:', err)
        }
      }
    }
  }

  /**
   * 清理：组件卸载时调用
   */
  dispose(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    this.pendingEvents = []
    this.listeners.clear()
    this.stateListeners.clear()
    if (this.ipcUnsub) {
      try {
        this.ipcUnsub()
      } catch {
        // ignore
      }
      this.ipcUnsub = null
    }
    // 不在此处调用 unwatch IPC，由 PreviewPanel 卸载时显式调用
  }
}

// ==========================================
// 单例
// ==========================================

export const fileWatcherService = new FileWatcherServiceImpl()
