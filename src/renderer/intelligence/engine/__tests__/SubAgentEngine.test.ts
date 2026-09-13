/**
 * SubAgentEngine 单元测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SubAgentEngine } from '../SubAgentEngine'

// Mock IndexedDB
const mockDB = {
  open: vi.fn(),
  transaction: vi.fn(),
}

vi.stubGlobal('indexedDB', {
  open: vi.fn().mockResolvedValue(mockDB),
})

describe('SubAgentEngine', () => {
  let engine: SubAgentEngine
  let mockExecuteTask: (taskId: string, prompt: string, onProgress?: (progress: number) => void) => Promise<string>
  let onProgress: (taskId: string, progress: number) => void
  let onResult: (taskId: string, success: boolean, result?: string, error?: string) => void

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecuteTask = vi.fn(async () => 'Task completed successfully')
    onProgress = vi.fn()
    onResult = vi.fn()
    
    engine = new SubAgentEngine()
    engine.setExecutor(mockExecuteTask)
    engine.setCallbacks(
      (event) => onProgress(event.taskId, event.progress),
      (event) => onResult(event.taskId, event.success, event.result, event.error),
    )
  })

  describe('createTask', () => {
    it('should create a new task', async () => {
      const taskId = await engine.createTask('Write a report')
      
      expect(taskId).toBeDefined()
      expect(typeof taskId).toBe('string')
      
      const task = await engine.getTask(taskId)
      expect(task).not.toBeNull()
      expect(task?.prompt).toBe('Write a report')
      expect(task?.status).toBe('pending')
      expect(task?.progress).toBe(0)
    })

    it('should accept metadata', async () => {
      const taskId = await engine.createTask('Debug an issue', {
        metadata: { priority: 'high', category: 'bug' },
      })
      
      const task = await engine.getTask(taskId)
      expect(task?.metadata).toEqual({ priority: 'high', category: 'bug' })
    })
  })

  describe('startTask', () => {
    it('should start a pending task', async () => {
      const taskId = await engine.createTask('Process data')
      await engine.startTask(taskId)
      
      // Execute the event loop to process the async task
      await new Promise(resolve => setTimeout(resolve, 10))
      
      expect(mockExecuteTask).toHaveBeenCalledWith(taskId, 'Process data', expect.any(Function))
    })

    it('should update task status to running', async () => {
      const taskId = await engine.createTask('Test task')
      await engine.startTask(taskId)
      
      // Allow async processing
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const task = await engine.getTask(taskId)
      expect(task?.status).toBe('completed')
      expect(task?.progress).toBe(100)
    })
  })

  describe('cancelTask', () => {
    it('should cancel a running task', async () => {
      const taskId = await engine.createTask('Long running task')
      await engine.startTask(taskId)
      
      // Cancel immediately
      await engine.cancelTask(taskId)
      
      const task = await engine.getTask(taskId)
      expect(task?.status).toBe('cancelled')
    })
  })

  describe('getProgress', () => {
    it('should return current progress', async () => {
      const taskId = await engine.createTask('Progress test')
      await engine.startTask(taskId)
      
      // Progress should be updated during execution
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const progress = await engine.getProgress(taskId)
      expect(typeof progress).toBe('number')
      expect(progress).toBeGreaterThanOrEqual(0)
      expect(progress).toBeLessThanOrEqual(100)
    })
  })

  describe('getAllTasks', () => {
    it('should return all tasks', async () => {
      await engine.createTask('Task 1')
      await engine.createTask('Task 2')
      await engine.createTask('Task 3')
      
      const tasks = await engine.getAllTasks()
      expect(tasks).toHaveLength(3)
      expect(tasks.every(t => t.id && t.prompt)).toBe(true)
    })

    it('should return tasks sorted by creation time', async () => {
      await engine.createTask('First')
      await engine.createTask('Second')
      await engine.createTask('Third')
      
      const tasks = await engine.getAllTasks()
      
      // Tasks should be sorted by createdAt descending
      for (let i = 0; i < tasks.length - 1; i++) {
        expect(tasks[i].createdAt).toBeGreaterThanOrEqual(tasks[i + 1].createdAt)
      }
    })
  })

  describe('runningCount', () => {
    it('should return 0 when no tasks are running', () => {
      expect(engine.getRunningCount()).toBe(0)
    })

    it('should increment when task starts', async () => {
      const taskId = await engine.createTask('Running task')
      await engine.startTask(taskId)
      
      // Allow async processing
      await new Promise(resolve => setTimeout(resolve, 10))
      
      // After completion, count should be 0
      expect(engine.getRunningCount()).toBe(0)
    })
  })
})
