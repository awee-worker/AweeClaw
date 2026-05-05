import { describe, it, expect, beforeEach } from 'vitest'
import { PluginRegistry } from '@renderer/agent/plugins/PluginRegistry'
import type { PluginManifest } from '@renderer/agent/plugins/types'

const createManifest = (id: string, overrides?: Partial<PluginManifest>): PluginManifest => ({
  id,
  name: `Test Plugin ${id}`,
  version: '1.0.0',
  description: 'A test plugin',
  author: 'test',
  permissions: [{ type: 'file_read' }, { type: 'file_write' }],
  contributes: {},
  enabled: true,
  installedAt: Date.now(),
  updatedAt: Date.now(),
  ...overrides,
})

describe('PluginRegistry', () => {
  let registry: PluginRegistry

  beforeEach(() => {
    registry = new PluginRegistry()
  })

  describe('registration', () => {
    it('registers a plugin', () => {
      const instance = registry.register(createManifest('test-plugin'))
      expect(instance).toBeDefined()
      expect(instance!.manifest.id).toBe('test-plugin')
      expect(instance!.status).toBe('active')
    })

    it('does not register duplicate plugins', () => {
      registry.register(createManifest('test-plugin'))
      const second = registry.register(createManifest('test-plugin'))
      expect(second!.manifest.version).toBe('1.0.0')
    })

    it('registers disabled plugin as disabled', () => {
      const instance = registry.register(createManifest('disabled-plugin', { enabled: false }))
      expect(instance!.status).toBe('disabled')
    })

    it('unregisters a plugin', () => {
      registry.register(createManifest('test-plugin'))
      expect(registry.unregister('test-plugin')).toBe(true)
      expect(registry.get('test-plugin')).toBeUndefined()
    })

    it('returns false for unregistering non-existent plugin', () => {
      expect(registry.unregister('nonexistent')).toBe(false)
    })
  })

  describe('tool handlers', () => {
    it('registers and executes a tool handler', async () => {
      registry.register(createManifest('tool-plugin'))
      registry.registerToolHandler('tool-plugin', 'my_tool', async (params) => {
        return `Result: ${params.input}`
      })

      const result = await registry.executeTool('my_tool', { input: 'hello' })
      expect(result).toBe('Result: hello')
    })

    it('throws for unknown tool', async () => {
      await expect(registry.executeTool('unknown_tool', {})).rejects.toThrow('No plugin provides tool')
    })

    it('does not register tool for disabled plugin', () => {
      registry.register(createManifest('disabled-plugin', { enabled: false }))
      expect(registry.registerToolHandler('disabled-plugin', 'tool1', async () => null)).toBe(false)
    })
  })

  describe('command handlers', () => {
    it('registers and executes a command handler', async () => {
      registry.register(createManifest('cmd-plugin'))
      registry.registerCommandHandler('cmd-plugin', 'my_command', async (params) => {
        return `Command executed: ${params.action}`
      })

      const result = await registry.executeCommand('my_command', { action: 'test' })
      expect(result).toBe('Command executed: test')
    })

    it('throws for unknown command', async () => {
      await expect(registry.executeCommand('unknown_cmd', {})).rejects.toThrow('No plugin provides command')
    })
  })

  describe('hook handlers', () => {
    it('registers and emits hook handlers', async () => {
      const calls: unknown[] = []
      registry.register(createManifest('hook-plugin'))
      registry.registerHookHandler('hook-plugin', 'on_message_sent', async (data) => {
        calls.push(data)
      })

      await registry.emitHook('on_message_sent', { message: 'hello' })
      expect(calls.length).toBe(1)
      expect((calls[0] as any).message).toBe('hello')
    })

    it('handles hook handler errors gracefully', async () => {
      registry.register(createManifest('error-plugin'))
      registry.registerHookHandler('error-plugin', 'on_message_sent', async () => {
        throw new Error('Hook error')
      })

      await expect(registry.emitHook('on_message_sent', {})).resolves.toBeUndefined()
    })
  })

  describe('enable/disable', () => {
    it('enables a disabled plugin', () => {
      registry.register(createManifest('test-plugin', { enabled: false }))
      expect(registry.enable('test-plugin')).toBe(true)

      const instance = registry.get('test-plugin')
      expect(instance!.status).toBe('active')
      expect(instance!.manifest.enabled).toBe(true)
    })

    it('disables an active plugin', () => {
      registry.register(createManifest('test-plugin'))
      expect(registry.disable('test-plugin')).toBe(true)

      const instance = registry.get('test-plugin')
      expect(instance!.status).toBe('disabled')
      expect(instance!.manifest.enabled).toBe(false)
    })

    it('returns false for non-existent plugin', () => {
      expect(registry.enable('nonexistent')).toBe(false)
      expect(registry.disable('nonexistent')).toBe(false)
    })
  })

  describe('querying', () => {
    it('returns all plugins', () => {
      registry.register(createManifest('plugin-1'))
      registry.register(createManifest('plugin-2'))

      expect(registry.getAll().length).toBe(2)
    })

    it('returns only active plugins', () => {
      registry.register(createManifest('active-plugin'))
      registry.register(createManifest('inactive-plugin', { enabled: false }))

      expect(registry.getActive().length).toBe(1)
      expect(registry.getActive()[0].manifest.id).toBe('active-plugin')
    })
  })

  describe('events', () => {
    it('emits registration events', () => {
      const events: any[] = []
      registry.onEvent(e => events.push(e))

      registry.register(createManifest('test-plugin'))
      expect(events.some(e => e.type === 'registered')).toBe(true)
    })

    it('emits enable/disable events', () => {
      const events: any[] = []
      registry.register(createManifest('test-plugin'))
      registry.onEvent(e => events.push(e))

      registry.disable('test-plugin')
      registry.enable('test-plugin')

      expect(events.some(e => e.type === 'disabled')).toBe(true)
      expect(events.some(e => e.type === 'enabled')).toBe(true)
    })

    it('unsubscribes from events', () => {
      const events: any[] = []
      const unsub = registry.onEvent(e => events.push(e))

      registry.register(createManifest('test-plugin'))
      expect(events.length).toBeGreaterThan(0)

      events.length = 0
      unsub()

      registry.register(createManifest('test-plugin-2'))
      expect(events.length).toBe(0)
    })
  })

  describe('plugin context', () => {
    it('provides storage to plugin context', () => {
      const instance = registry.register(createManifest('storage-plugin'))
      instance!.context.storage.set('key', 'value')
      expect(instance!.context.storage.get('key')).toBe('value')
    })

    it('provides logger to plugin context', () => {
      const instance = registry.register(createManifest('logger-plugin'))
      expect(instance!.context.logger).toBeDefined()
      expect(typeof instance!.context.logger.info).toBe('function')
    })

    it('provides sandbox to plugin context', () => {
      const instance = registry.register(createManifest('sandbox-plugin'))
      expect(instance!.context.sandbox).toBeDefined()
      expect(typeof instance!.context.sandbox.readFile).toBe('function')
    })
  })
})
