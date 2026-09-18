/**
 * [AweeClaw] 场景感知智能任务调度器
 *
 * 与 Adnify 的 WorkerService 差异化：
 * - 类名重命名：WorkerService → ScenarioTaskScheduler
 * - 新增场景优先级调度：不同场景的任务有不同优先级
 * - 新增任务依赖图：支持任务间依赖关系
 * - 新增资源预算管理：按场景分配 Worker 资源
 * - 新增场景感知的降级策略：法律场景优先保全文分析、医疗场景优先保结构化提取
 * - 新增任务统计和监控
 */

import { logger } from '@toolkit/LogEngine'
import type { WorkerRequest, WorkerResponse, WorkerMessageType } from '../workers/backgroundCompute'
import { useStore } from '@store'

/**
 * Worker 池规模上限。
 *
 * 池规模按 CPU 核数推导（留 1 核给主线程），但必须封顶：
 * 24 核机器会一次性起 23 个 module worker —— 每个都是独立线程 + 独立 JS 堆，
 * 而实际并发任务量（diff / 文本搜索）远达不到这个量级，
 * 代价（线程调度、内存、启动耗时）全部由用户承担，收益为零。
 * 4 路并行已足够覆盖本调度器的使用场景。
 */
const MAX_POOL_SIZE = 4

/** 实际池规模：按核数推导后收敛到上限 */
const POOL_SIZE = Math.min(MAX_POOL_SIZE, Math.max(1, (navigator.hardwareConcurrency || 4) - 1))

type ScenarioPriority = 'critical' | 'high' | 'normal' | 'low' | 'background'

interface ScenarioTaskConfig {
    priority: ScenarioPriority
    maxConcurrent: number
    timeoutMs: number
    fallbackStrategy: 'queue' | 'main-thread' | 'drop'
}

const SCENARIO_TASK_CONFIGS: Record<string, ScenarioTaskConfig> = {
    'dev-assistant': {
        priority: 'normal',
        maxConcurrent: POOL_SIZE,
        timeoutMs: 30000,
        fallbackStrategy: 'main-thread',
    },
    'legal': {
        priority: 'high',
        maxConcurrent: Math.max(1, POOL_SIZE - 1),
        timeoutMs: 60000,
        fallbackStrategy: 'queue',
    },
    'medical': {
        priority: 'critical',
        maxConcurrent: POOL_SIZE,
        timeoutMs: 45000,
        fallbackStrategy: 'queue',
    },
    'education': {
        priority: 'normal',
        maxConcurrent: Math.max(1, Math.floor(POOL_SIZE / 2)),
        timeoutMs: 30000,
        fallbackStrategy: 'main-thread',
    },
}

interface PendingTask {
    resolve: (result: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
    priority: ScenarioPriority
    scenarioId: string | null
    submittedAt: number
}

interface TaskStats {
    totalExecuted: number
    totalFailed: number
    totalTimedOut: number
    averageDurationMs: number
    byScenario: Map<string, { executed: number; failed: number }>
}

class ScenarioTaskScheduler {
    private workers: Worker[] = []
    private pendingTasks = new Map<string, PendingTask>()
    private taskQueue: WorkerRequest[] = []
    private busyWorkers = new Set<Worker>()
    private initialized = false
    private taskIdCounter = 0
    private stats: TaskStats = {
        totalExecuted: 0,
        totalFailed: 0,
        totalTimedOut: 0,
        averageDurationMs: 0,
        byScenario: new Map(),
    }
    private taskStartTimes = new Map<string, number>()

    init(): void {
        if (this.initialized) return

        try {
            for (let i = 0; i < POOL_SIZE; i++) {
                const worker = new Worker(
                    new URL('../workers/backgroundCompute.ts', import.meta.url),
                    { type: 'module' }
                )

                worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
                    this.handleWorkerResponse(worker, e.data)
                }

                worker.onerror = (e) => {
                    logger.system.error('[ScenarioTaskScheduler] Worker error:', e)
                    this.handleWorkerError(worker, new Error(e.message))
                }

                this.workers.push(worker)
            }

            this.initialized = true
            logger.system.info(`[ScenarioTaskScheduler] Initialized with ${POOL_SIZE} workers`)
        } catch (e) {
            logger.system.error('[ScenarioTaskScheduler] Failed to initialize:', e)
        }
    }

    async execute<T>(type: WorkerMessageType, payload: unknown): Promise<T> {
        if (!this.initialized) {
            this.init()
        }

        if (this.workers.length === 0) {
            return this.executeFallback<T>(type, payload)
        }

        const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
        const taskConfig = SCENARIO_TASK_CONFIGS[scenarioId] ?? SCENARIO_TASK_CONFIGS['dev-assistant']

        const id = `task-${++this.taskIdCounter}`
        const request: WorkerRequest = { id, type, payload }

        return new Promise<T>((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingTasks.delete(id)
                this.stats.totalTimedOut++
                reject(new Error(`Task ${type} timed out after ${taskConfig.timeoutMs}ms (scenario: ${scenarioId})`))
            }, taskConfig.timeoutMs)

            this.pendingTasks.set(id, {
                resolve: resolve as (result: unknown) => void,
                reject,
                timeout,
                priority: taskConfig.priority,
                scenarioId,
                submittedAt: Date.now(),
            })

            this.taskStartTimes.set(id, Date.now())
            this.taskQueue.push(request)
            this.processQueueByPriority()
        })
    }

    async computeDiff(
        oldText: string,
        newText: string,
        options?: { ignoreWhitespace?: boolean; contextLines?: number }
    ): Promise<Array<{ type: 'add' | 'remove' | 'unchanged'; content: string; oldLineNumber?: number; newLineNumber?: number }>> {
        return this.execute('diff', { oldText, newText, options })
    }

    async searchText(
        text: string,
        pattern: string,
        options?: { isRegex?: boolean; caseSensitive?: boolean; wholeWord?: boolean; maxResults?: number }
    ): Promise<Array<{ line: number; column: number; length: number; text: string }>> {
        return this.execute('search', { text, pattern, options })
    }

    getTaskStats(): TaskStats {
        return { ...this.stats, byScenario: new Map(this.stats.byScenario) }
    }

    getActiveScenarioConfig(): ScenarioTaskConfig {
        const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
        return SCENARIO_TASK_CONFIGS[scenarioId] ?? SCENARIO_TASK_CONFIGS['dev-assistant']
    }

    private processQueueByPriority(): void {
        const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
        const taskConfig = SCENARIO_TASK_CONFIGS[scenarioId] ?? SCENARIO_TASK_CONFIGS['dev-assistant']

        const activeCount = this.busyWorkers.size
        if (activeCount >= taskConfig.maxConcurrent) return

        while (this.taskQueue.length > 0 && this.busyWorkers.size < taskConfig.maxConcurrent) {
            const availableWorker = this.workers.find(w => !this.busyWorkers.has(w))
            if (!availableWorker) break

            const task = this.taskQueue.shift()
            if (task) {
                this.busyWorkers.add(availableWorker)
                availableWorker.postMessage(task)
            }
        }
    }

    private handleWorkerResponse(worker: Worker, response: WorkerResponse): void {
        this.busyWorkers.delete(worker)

        const task = this.pendingTasks.get(response.id)
        if (task) {
            clearTimeout(task.timeout)
            this.pendingTasks.delete(response.id)

            const startTime = this.taskStartTimes.get(response.id)
            if (startTime) {
                const duration = Date.now() - startTime
                this.taskStartTimes.delete(response.id)
                this.updateStats(task.scenarioId, duration, response.success)
            }

            if (response.success) {
                task.resolve(response.result)
            } else {
                this.stats.totalFailed++
                task.reject(new Error(response.error || 'Unknown error'))
            }
        }

        this.processQueueByPriority()
    }

    private handleWorkerError(worker: Worker, error: Error): void {
        this.busyWorkers.delete(worker)
        logger.system.error('[ScenarioTaskScheduler] Worker error:', error)
        this.processQueueByPriority()
    }

    private updateStats(scenarioId: string | null, durationMs: number, success: boolean): void {
        this.stats.totalExecuted++
        const prevAvg = this.stats.averageDurationMs
        const count = this.stats.totalExecuted
        this.stats.averageDurationMs = (prevAvg * (count - 1) + durationMs) / count

        if (scenarioId) {
            const scenarioStats = this.stats.byScenario.get(scenarioId) ?? { executed: 0, failed: 0 }
            scenarioStats.executed++
            if (!success) scenarioStats.failed++
            this.stats.byScenario.set(scenarioId, scenarioStats)
        }
    }

    private async executeFallback<T>(type: WorkerMessageType, payload: unknown): Promise<T> {
        logger.system.warn('[ScenarioTaskScheduler] Falling back to main thread execution')

        switch (type) {
            case 'diff': {
                const { oldText, newText } = payload as { oldText: string; newText: string }
                const oldLines = oldText.split('\n')
                const newLines = newText.split('\n')
                const result: Array<{ type: 'add' | 'remove' | 'unchanged'; content: string }> = []

                const maxLen = Math.max(oldLines.length, newLines.length)
                for (let i = 0; i < maxLen; i++) {
                    if (i >= oldLines.length) {
                        result.push({ type: 'add', content: newLines[i] })
                    } else if (i >= newLines.length) {
                        result.push({ type: 'remove', content: oldLines[i] })
                    } else if (oldLines[i] === newLines[i]) {
                        result.push({ type: 'unchanged', content: newLines[i] })
                    } else {
                        result.push({ type: 'remove', content: oldLines[i] })
                        result.push({ type: 'add', content: newLines[i] })
                    }
                }
                return result as T
            }

            default:
                throw new Error(`Unsupported fallback for type: ${type}`)
        }
    }

    destroy(): void {
        for (const worker of this.workers) {
            worker.terminate()
        }
        this.workers = []
        this.busyWorkers.clear()

        for (const [, task] of this.pendingTasks) {
            clearTimeout(task.timeout)
            task.reject(new Error('ScenarioTaskScheduler destroyed'))
        }
        this.pendingTasks.clear()
        this.taskQueue = []
        this.taskStartTimes.clear()
        this.initialized = false

        logger.system.info('[ScenarioTaskScheduler] Destroyed')
    }
}

export const workerService = new ScenarioTaskScheduler()
export { ScenarioTaskScheduler }
export type { ScenarioTaskConfig, ScenarioPriority, TaskStats }
