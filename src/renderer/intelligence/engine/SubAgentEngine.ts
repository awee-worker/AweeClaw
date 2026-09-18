/**
 * 后台 SubAgent 任务引擎
 *
 * 支持：
 * - 持久化后台任务（IndexedDB）
 * - 进度追踪（0-100）
 * - 完成通知（Toast + 声音）
 * - 任务取消
 *
 * 适用于客户端自定义模式，无需后端依赖
 */

import { logger } from '@toolkit/LogEngine'

// ===== 类型定义 =====

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface BackgroundTask {
  id: string
  status: TaskStatus
  progress: number        // 0-100
  prompt: string
  result?: string
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  agentId?: string        // 关联的 Agent ID
  metadata?: Record<string, unknown>
}

export interface TaskProgressEvent {
  taskId: string
  progress: number
  status: TaskStatus
  timestamp: number
}

export interface TaskResultEvent {
  taskId: string
  success: boolean
  result?: string
  error?: string
  timestamp: number
}

// ===== IndexedDB 存储 =====

const DB_NAME = 'AweeClawBackgroundTasks'
const DB_VERSION = 1
const STORE_NAME = 'background_tasks'

class TaskStore {
  private db: IDBDatabase | null = null

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        this.db = request.result
        resolve()
      }
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          store.createIndex('status', 'status', { unique: false })
          store.createIndex('createdAt', 'createdAt', { unique: false })
        }
      }
    })
  }

  async get(id: string): Promise<BackgroundTask | null> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not initialized'))
      
      const transaction = this.db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.get(id)
      
      request.onsuccess = () => resolve(request.result || null)
      request.onerror = () => reject(request.error)
    })
  }

  async getAll(): Promise<BackgroundTask[]> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not initialized'))
      
      const transaction = this.db.transaction([STORE_NAME], 'readonly')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.getAll()
      
      request.onsuccess = () => resolve(request.result || [])
      request.onerror = () => reject(request.error)
    })
  }

  async put(task: BackgroundTask): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not initialized'))
      
      const transaction = this.db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.put(task)
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async delete(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error('DB not initialized'))
      
      const transaction = this.db.transaction([STORE_NAME], 'readwrite')
      const store = transaction.objectStore(STORE_NAME)
      const request = store.delete(id)
      
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

// ===== SubAgent 任务引擎核心 =====

export class SubAgentEngine {
  private tasks = new Map<string, BackgroundTask>()
  private taskStore: TaskStore
  private runningTasks = new Set<string>()
  
  // 事件回调
  private onProgress?: (event: TaskProgressEvent) => void
  private onResult?: (event: TaskResultEvent) => void
  private onNotification?: (title: string, body: string) => void
  
  // 执行器引用
  private executeTask?: (taskId: string, prompt: string, onProgress?: (progress: number) => void) => Promise<string>

  constructor(taskStore?: TaskStore) {
    this.taskStore = taskStore || new TaskStore()
  }

  /**
   * 初始化引擎
   */
  async init(): Promise<void> {
    await this.taskStore.init()
    await this.loadTasks()
    logger.agent.info('[SubAgentEngine] Initialized')
  }

  /**
   * 设置任务执行器
   */
  setExecutor(executor: (taskId: string, prompt: string, onProgress?: (progress: number) => void) => Promise<string>): void {
    this.executeTask = executor
  }

  /**
   * 设置事件回调
   */
  setCallbacks(
    onProgress?: (event: TaskProgressEvent) => void,
    onResult?: (event: TaskResultEvent) => void,
    onNotification?: (title: string, body: string) => void,
  ): void {
    this.onProgress = onProgress
    this.onResult = onResult
    this.onNotification = onNotification
  }

  /**
   * 创建后台任务
   */
  async createTask(prompt: string, options?: {
    agentId?: string
    metadata?: Record<string, unknown>
  }): Promise<string> {
    const taskId = crypto.randomUUID()
    const task: BackgroundTask = {
      id: taskId,
      status: 'pending',
      progress: 0,
      prompt,
      createdAt: Date.now(),
      agentId: options?.agentId,
      metadata: options?.metadata,
    }
    
    this.tasks.set(taskId, task)
    await this.taskStore.put(task)
    
    logger.agent.info(`[SubAgentEngine] Task created: ${taskId}`)
    return taskId
  }

  /**
   * 启动任务
   */
  async startTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task || task.status !== 'pending') {
      throw new Error(`Task ${taskId} not found or not pending`)
    }
    
    task.status = 'running'
    task.startedAt = Date.now()
    this.runningTasks.add(taskId)
    await this.updateTask(task)
    
    // 异步执行
    this.executeTaskAsync(taskId)
  }

  /**
   * 取消任务
   */
  async cancelTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return
    
    task.status = 'cancelled'
    task.completedAt = Date.now()
    await this.updateTask(task)
    
    this.runningTasks.delete(taskId)
    logger.agent.info(`[SubAgentEngine] Task cancelled: ${taskId}`)
  }

  /**
   * 获取任务
   */
  async getTask(taskId: string): Promise<BackgroundTask | null> {
    const task = this.tasks.get(taskId)
    if (task) return task
    
    // 从 IndexedDB 加载
    const stored = await this.taskStore.get(taskId)
    if (stored) {
      this.tasks.set(taskId, stored)
      return stored
    }
    return null
  }

  /**
   * 获取所有任务
   */
  async getAllTasks(): Promise<BackgroundTask[]> {
    const cached = [...this.tasks.values()]
    const stored = await this.taskStore.getAll()
    
    // 合并缓存和数据库
    const merged = new Map<string, BackgroundTask>()
    for (const task of [...cached, ...stored]) {
      merged.set(task.id, task)
    }
    
    return [...merged.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  /**
   * 获取任务进度
   */
  async getProgress(taskId: string): Promise<number> {
    const task = await this.getTask(taskId)
    return task?.progress ?? 0
  }

  /**
   * 获取运行中的任务数量
   */
  getRunningCount(): number {
    return this.runningTasks.size
  }

  /**
   * 异步执行任务（不阻塞调用栈）
   */
  private async executeTaskAsync(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task || !this.executeTask) {
      await this.failTask(taskId, 'No executor available')
      return
    }
    
    try {
      const result = await this.executeTask(
        taskId,
        task.prompt,
        (progress: number) => this.updateProgress(taskId, progress),
      )
      
      task.result = result
      task.status = 'completed'
      task.progress = 100
      task.completedAt = Date.now()
      await this.updateTask(task)
      
      this.runningTasks.delete(taskId)
      this.emitResult(taskId, true, result)
      this.emitNotification('任务完成', task.prompt.substring(0, 100) + '...')
      
    } catch (error) {
      await this.failTask(taskId, error instanceof Error ? error.message : String(error))
    }
  }

  /**
   * 更新进度
   */
  private async updateProgress(taskId: string, progress: number): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return
    
    task.progress = Math.min(100, Math.max(0, progress))
    await this.updateTask(task)
    this.emitProgress(taskId, progress, task.status)
  }

  /**
   * 失败处理
   */
  private async failTask(taskId: string, error: string): Promise<void> {
    const task = this.tasks.get(taskId)
    if (!task) return
    
    task.status = 'failed'
    task.error = error
    task.completedAt = Date.now()
    await this.updateTask(task)
    
    this.runningTasks.delete(taskId)
    this.emitResult(taskId, false, undefined, error)
    this.emitNotification('任务失败', error)
  }

  /**
   * 更新任务到存储
   */
  private async updateTask(task: BackgroundTask): Promise<void> {
    this.tasks.set(task.id, task)
    await this.taskStore.put(task)
  }

  /**
   * 从 IndexedDB 加载所有任务
   */
  private async loadTasks(): Promise<void> {
    try {
      const tasks = await this.taskStore.getAll()
      for (const task of tasks) {
        this.tasks.set(task.id, task)
        if (task.status === 'running') {
          this.runningTasks.add(task.id)
        }
      }
      logger.agent.info(`[SubAgentEngine] Loaded ${tasks.length} tasks`)
    } catch (err) {
      logger.agent.warn('[SubAgentEngine] Failed to load tasks:', err)
    }
  }

  /**
   * 触发进度事件
   */
  private emitProgress(taskId: string, progress: number, status: TaskStatus): void {
    if (this.onProgress) {
      this.onProgress({ taskId, progress, status, timestamp: Date.now() })
    }
  }

  /**
   * 触发结果事件
   */
  private emitResult(taskId: string, success: boolean, result?: string, error?: string): void {
    if (this.onResult) {
      this.onResult({ taskId, success, result, error, timestamp: Date.now() })
    }
  }

  /**
   * 触发通知
   */
  private emitNotification(title: string, body: string): void {
    if (this.onNotification) {
      this.onNotification(title, body)
    }
    
    // 尝试使用原生通知 API
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      new Notification(title, { body })
    }
  }
}

// ===== 单例导出 =====

let _instance: SubAgentEngine | null = null

export function getSubAgentEngine(): SubAgentEngine {
  if (!_instance) {
    _instance = new SubAgentEngine()
  }
  return _instance
}

/**
 * 注册 / 清除全局单例
 *
 * 允许传 null（dispose 时清空）：否则引擎被销毁后单例仍指向一个
 * 已失效实例，后续 getSubAgentEngine() 的调用方会拿到「看着存在、
 * 实际不可用」的引擎。
 */
export function setSubAgentEngine(engine: SubAgentEngine | null): void {
  _instance = engine
}
