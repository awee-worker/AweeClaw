import { describe, it, expect, beforeEach } from 'vitest'
import { ToolPermissionManager } from '@renderer/agent/harness/permissions/ToolPermissionManager'
import type { ToolPermissionRule } from '@renderer/agent/harness/permissions/ToolPermissionManager'

describe('ToolPermissionManager', () => {
  let manager: ToolPermissionManager

  beforeEach(() => {
    manager = new ToolPermissionManager()
  })

  describe('default rules', () => {
    it('allows read category tools by default', () => {
      const result = manager.check('read_file', 'read')
      expect(result.allowed).toBe(true)
      expect(result.action).toBe('allow')
    })

    it('asks for write category tools by default', () => {
      const result = manager.check('edit_file', 'write')
      expect(result.action).toBe('ask')
    })

    it('asks for terminal category tools by default', () => {
      const result = manager.check('execute_command', 'terminal')
      expect(result.action).toBe('ask')
    })

    it('asks for network category tools by default', () => {
      const result = manager.check('fetch_url', 'network')
      expect(result.action).toBe('ask')
    })
  })

  describe('custom rules', () => {
    it('adds and applies a custom deny rule', () => {
      manager.addRule({ toolName: 'dangerous_tool', action: 'deny' })
      const result = manager.check('dangerous_tool', 'terminal')
      expect(result.allowed).toBe(false)
      expect(result.action).toBe('deny')
    })

    it('applies tool-specific rules over category rules', () => {
      manager.addRule({ toolName: 'safe_write', category: 'write', action: 'allow' })
      const result = manager.check('safe_write', 'write')
      expect(result.allowed).toBe(true)
      expect(result.action).toBe('allow')
    })

    it('applies rules with conditions', () => {
      manager.addRule({
        category: 'write',
        action: 'deny',
        conditions: [{ field: 'path', operator: 'starts_with', value: '/etc/' }],
      })

      const deniedResult = manager.check('edit_file', 'write', { path: '/etc/passwd' })
      expect(deniedResult.allowed).toBe(false)

      const allowedResult = manager.check('edit_file', 'write', { path: '/home/user/file.ts' })
      expect(allowedResult.action).toBe('ask')
    })

    it('removes a rule by index', () => {
      const initialCount = manager.getRules().length
      manager.addRule({ toolName: 'temp_tool', action: 'deny' })
      expect(manager.getRules().length).toBe(initialCount + 1)
      manager.removeRule(initialCount)
      expect(manager.getRules().length).toBe(initialCount)
    })

    it('sets all rules at once', () => {
      const customRules: ToolPermissionRule[] = [
        { category: 'read', action: 'allow' },
        { category: 'write', action: 'deny' },
      ]
      manager.setRules(customRules)
      expect(manager.getRules().length).toBe(2)

      const result = manager.check('edit_file', 'write')
      expect(result.allowed).toBe(false)
    })
  })

  describe('rate limiting', () => {
    it('rate limits write tools', () => {
      for (let i = 0; i < 30; i++) {
        manager.check('edit_file', 'write')
      }

      const result = manager.check('edit_file', 'write')
      expect(result.rateLimited).toBe(true)
      expect(result.retryAfterMs).toBeGreaterThan(0)
    })

    it('resets rate limits for a specific tool', () => {
      for (let i = 0; i < 30; i++) {
        manager.check('edit_file', 'write')
      }

      manager.resetRateLimits('edit_file')

      const result = manager.check('edit_file', 'write')
      expect(result.rateLimited).toBe(false)
    })

    it('resets all rate limits', () => {
      for (let i = 0; i < 30; i++) {
        manager.check('edit_file', 'write')
      }

      manager.resetRateLimits()

      const result = manager.check('edit_file', 'write')
      expect(result.rateLimited).toBe(false)
    })

    it('supports burst size rate limiting', () => {
      const burstManager = new ToolPermissionManager([
        { category: 'write', action: 'allow', rateLimit: { maxCalls: 5, windowMs: 10_000, burstSize: 3 } },
      ])

      for (let i = 0; i < 3; i++) {
        const r = burstManager.check('edit_file', 'write')
        expect(r.rateLimited).toBe(false)
      }
    })
  })

  describe('session decisions', () => {
    it('remembers session approval', () => {
      const result1 = manager.check('edit_file', 'write')
      expect(result1.action).toBe('ask')

      manager.approveSession('edit_file', 'write', 'allow')

      const result2 = manager.check('edit_file', 'write')
      expect(result2.allowed).toBe(true)
      expect(result2.action).toBe('allow')
    })

    it('remembers session denial', () => {
      manager.approveSession('edit_file', 'write', 'deny')

      const result = manager.check('edit_file', 'write')
      expect(result.allowed).toBe(false)
    })

    it('clears all session decisions', () => {
      manager.approveSession('edit_file', 'write', 'allow')
      manager.clearSessionDecisions()

      const result = manager.check('edit_file', 'write')
      expect(result.action).toBe('ask')
    })
  })

  describe('events', () => {
    it('emits allowed events', () => {
      const events: any[] = []
      manager.onEvent(e => events.push(e))

      manager.check('read_file', 'read')

      expect(events.some(e => e.type === 'allowed')).toBe(true)
    })

    it('emits denied events', () => {
      manager.addRule({ toolName: 'blocked', action: 'deny' })

      const events: any[] = []
      manager.onEvent(e => events.push(e))

      manager.check('blocked', 'terminal')

      expect(events.some(e => e.type === 'denied')).toBe(true)
    })

    it('emits rate_limited events', () => {
      const events: any[] = []
      manager.onEvent(e => events.push(e))

      for (let i = 0; i < 31; i++) {
        manager.check('edit_file', 'write')
      }

      expect(events.some(e => e.type === 'rate_limited')).toBe(true)
    })

    it('unsubscribes from events', () => {
      const events: any[] = []
      const unsub = manager.onEvent(e => events.push(e))

      manager.check('read_file', 'read')
      expect(events.length).toBeGreaterThan(0)

      events.length = 0
      unsub()

      manager.check('read_file', 'read')
      expect(events.length).toBe(0)
    })
  })

  describe('condition operators', () => {
    it('evaluates eq condition', () => {
      manager.addRule({ category: 'write', action: 'deny', conditions: [{ field: 'mode', operator: 'eq', value: 'destructive' }] })
      expect(manager.check('edit_file', 'write', { mode: 'destructive' }).allowed).toBe(false)
      expect(manager.check('edit_file', 'write', { mode: 'safe' }).action).toBe('ask')
    })

    it('evaluates contains condition', () => {
      manager.addRule({ category: 'write', action: 'deny', conditions: [{ field: 'path', operator: 'contains', value: '/etc/' }] })
      expect(manager.check('edit_file', 'write', { path: '/usr/local/etc/config' }).allowed).toBe(false)
    })

    it('evaluates matches condition', () => {
      manager.addRule({ category: 'write', action: 'deny', conditions: [{ field: 'path', operator: 'matches', value: '^/etc/' }] })
      expect(manager.check('edit_file', 'write', { path: '/etc/passwd' }).allowed).toBe(false)
      expect(manager.check('edit_file', 'write', { path: '/home/etc/file' }).action).toBe('ask')
    })

    it('evaluates starts_with condition', () => {
      manager.addRule({ category: 'write', action: 'deny', conditions: [{ field: 'path', operator: 'starts_with', value: '/system/' }] })
      expect(manager.check('edit_file', 'write', { path: '/system/library' }).allowed).toBe(false)
    })
  })
})
