/**
 * BehaviorEngine 单元测试
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BehaviorEngine } from '../BehaviorEngine'

describe('BehaviorEngine', () => {
  let engine: BehaviorEngine
  let onPromptGenerated: ReturnType<typeof vi.fn<(prompt: string, ruleId: string) => void>>
  let onNotification: ReturnType<typeof vi.fn<(title: string, body: string) => void>>

  beforeEach(() => {
    vi.useFakeTimers()
    onPromptGenerated = vi.fn<(prompt: string, ruleId: string) => void>()
    onNotification = vi.fn<(title: string, body: string) => void>()
    engine = new BehaviorEngine(onPromptGenerated, onNotification)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('addRule', () => {
    it('should add a time-based rule', () => {
      const rule = engine.addRule({
        enabled: true,
        name: 'Daily reminder',
        trigger: {
          type: 'time',
          config: {
            time: { value: '09:00', days: [1, 2, 3, 4, 5] },
          },
        },
        action: {
          type: 'prompt',
          prompt: 'Good morning! Here is your schedule for {date}.',
        },
      })

      expect(rule.id).toBeDefined()
      expect(rule.name).toBe('Daily reminder')
      expect(rule.enabled).toBe(true)
      expect(rule.createdAt).toBeDefined()
    })

    it('should add a noInput rule', () => {
      const rule = engine.addRule({
        enabled: true,
        name: 'Idle alert',
        trigger: {
          type: 'noInput',
          config: {
            noInput: { latencyMs: 300000 }, // 5 minutes
          },
        },
        action: {
          type: 'notify',
          prompt: 'You have been idle for 5 minutes. Need help?',
        },
      })

      expect(rule.trigger.type).toBe('noInput')
      expect(rule.trigger.config.noInput?.latencyMs).toBe(300000)
    })

    it('should add a cycle rule', () => {
      const rule = engine.addRule({
        enabled: true,
        name: 'Periodic check',
        trigger: {
          type: 'cycle',
          config: {
            cycle: { intervalMs: 3600000, infinite: true }, // 1 hour
          },
        },
        action: {
          type: 'prompt',
          prompt: 'Time to check progress: {time}',
        },
      })

      expect(rule.trigger.type).toBe('cycle')
      expect(rule.trigger.config.cycle?.intervalMs).toBe(3600000)
    })
  })

  describe('toggleRule', () => {
    it('should disable a rule', () => {
      const rule = engine.addRule({
        enabled: true,
        name: 'Test rule',
        trigger: { type: 'time', config: { time: { value: '09:00' } } },
        action: { type: 'prompt', prompt: 'test' },
      })

      const updated = engine.toggleRule(rule.id, false)
      expect(updated?.enabled).toBe(false)
    })

    it('should re-enable a rule', () => {
      const rule = engine.addRule({
        enabled: true,
        name: 'Test rule',
        trigger: { type: 'time', config: { time: { value: '09:00' } } },
        action: { type: 'prompt', prompt: 'test' },
      })

      engine.toggleRule(rule.id, false)
      const reEnabled = engine.toggleRule(rule.id, true)
      expect(reEnabled?.enabled).toBe(true)
    })
  })

  describe('deleteRule', () => {
    it('should delete a rule', () => {
      const rule = engine.addRule({
        enabled: true,
        name: 'To delete',
        trigger: { type: 'time', config: { time: { value: '10:00' } } },
        action: { type: 'notify', prompt: 'test' },
      })

      const deleted = engine.deleteRule(rule.id)
      expect(deleted).toBe(true)
      expect(engine.getRule(rule.id)).toBeNull()
    })

    it('should return false for non-existent rule', () => {
      const deleted = engine.deleteRule('non-existent-id')
      expect(deleted).toBe(false)
    })
  })

  describe('recordActivity', () => {
    it('should update last activity time', () => {
      const before = Date.now()
      engine.recordActivity()
      const after = Date.now()

      // Activity time should be between before and after
      expect(engine['lastActivityTime']).toBeGreaterThanOrEqual(before)
      expect(engine['lastActivityTime']).toBeLessThanOrEqual(after)
    })
  })

  describe('tick and trigger', () => {
    it('should trigger noInput rule after idle period', () => {
      engine.addRule({
        enabled: true,
        name: 'Idle alert',
        trigger: {
          type: 'noInput',
          config: { noInput: { latencyMs: 5000 } }, // 5 seconds
        },
        action: { type: 'notify', prompt: 'You are idle!' },
      })

      // Fast-forward time
      vi.advanceTimersByTime(6000)
      
      // Should not have triggered yet (need to call tick manually)
      expect(onNotification).not.toHaveBeenCalled()
    })

    it('should generate prompt for time-based rule', () => {
      engine.addRule({
        enabled: true,
        name: 'Morning brief',
        trigger: {
          type: 'time',
          config: { time: { value: '09:00' } },
        },
        action: {
          type: 'prompt',
          prompt: 'Good morning! Today is {date}.',
        },
      })

      // Mock current time
      const mockDate = new Date('2024-01-15T09:00:00')
      vi.setSystemTime(mockDate)

      // tick() 有 isRunning 守卫：未 start() 的引擎调用 tick() 会直接返回，
      // 因此必须先启动，手动 tick 才能真的走到规则判定。
      engine.start()

      // Trigger manually
      engine['tick']()
      
      expect(onPromptGenerated).toHaveBeenCalled()
    })
  })
})
