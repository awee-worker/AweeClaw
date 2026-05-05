import { logger } from '@utils/Logger'
import type {
  PluginManifest,
  PluginInstance,
  PluginContext,
  PluginStorage,
  PluginLogger,
  PluginSandbox,
  PluginExecuteHandler,
  PluginHookHandler,
  PluginHookEvent,
} from './types'

class PluginStorageImpl implements PluginStorage {
  private data = new Map<string, unknown>()

  constructor(_pluginId: string) {
  }

  get<T = unknown>(key: string): T | undefined {
    return this.data.get(key) as T | undefined
  }

  set(key: string, value: unknown): void {
    this.data.set(key, value)
  }

  delete(key: string): void {
    this.data.delete(key)
  }

  clear(): void {
    this.data.clear()
  }

  export(): Record<string, unknown> {
    return Object.fromEntries(this.data)
  }

  import(data: Record<string, unknown>): void {
    for (const [key, value] of Object.entries(data)) {
      this.data.set(key, value)
    }
  }
}

class PluginLoggerImpl implements PluginLogger {
  private prefix: string

  constructor(pluginId: string) {
    this.prefix = `[Plugin:${pluginId}]`
  }

  info(message: string, ...args: unknown[]): void {
    logger.agent.info(this.prefix, message, ...args)
  }

  warn(message: string, ...args: unknown[]): void {
    logger.agent.warn(this.prefix, message, ...args)
  }

  error(message: string, ...args: unknown[]): void {
    logger.agent.error(this.prefix, message, ...args)
  }
}

class PluginSandboxImpl implements PluginSandbox {
  private allowedPaths: Set<string>
  private allowedCommands: Set<string>

  constructor(permissions: PluginManifest['permissions']) {
    this.allowedPaths = new Set()
    this.allowedCommands = new Set()

    for (const perm of permissions) {
      if (perm.type === 'file_read' || perm.type === 'file_write') {
        this.allowedPaths.add(perm.type)
      }
      if (perm.type === 'shell_execute') {
        this.allowedCommands.add(perm.type)
      }
    }
  }

  async readFile(path: string): Promise<string | null> {
    if (!this.allowedPaths.has('file_read')) {
      throw new Error('Plugin does not have file_read permission')
    }
    try {
      const { api } = await import('@/renderer/services/electronAPI')
      return await api.file.read(path)
    } catch {
      return null
    }
  }

  async writeFile(path: string, content: string): Promise<boolean> {
    if (!this.allowedPaths.has('file_write')) {
      throw new Error('Plugin does not have file_write permission')
    }
    try {
      const { api } = await import('@/renderer/services/electronAPI')
      await api.file.write(path, content)
      return true
    } catch {
      return false
    }
  }

  async executeCommand(_command: string, _args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!this.allowedCommands.has('shell_execute')) {
      throw new Error('Plugin does not have shell_execute permission')
    }
    return { stdout: '', stderr: 'Command execution not available in sandbox', exitCode: 1 }
  }

  async fetch(url: string, _options?: Record<string, unknown>): Promise<unknown> {
    try {
      const response = await fetch(url)
      return await response.json()
    } catch (error) {
      throw new Error(`Plugin fetch failed: ${error}`)
    }
  }
}

export class PluginRegistry {
  private plugins = new Map<string, PluginInstance>()
  private listeners = new Set<(event: PluginRegistryEvent) => void>()

  register(manifest: PluginManifest): PluginInstance | null {
    if (this.plugins.has(manifest.id)) {
      logger.agent.warn(`[PluginRegistry] Plugin ${manifest.id} is already registered`)
      return this.plugins.get(manifest.id)!
    }

    const storage = new PluginStorageImpl(manifest.id)
    const pluginLogger = new PluginLoggerImpl(manifest.id)
    const sandbox = new PluginSandboxImpl(manifest.permissions)

    const context: PluginContext = {
      pluginId: manifest.id,
      storage,
      logger: pluginLogger,
      sandbox,
    }

    const instance: PluginInstance = {
      manifest,
      context,
      toolHandlers: new Map(),
      commandHandlers: new Map(),
      hookHandlers: new Map(),
      status: manifest.enabled ? 'active' : 'disabled',
    }

    this.plugins.set(manifest.id, instance)
    this.emit({ type: 'registered', pluginId: manifest.id })

    logger.agent.info(`[PluginRegistry] Registered plugin: ${manifest.id} v${manifest.version}`)
    return instance
  }

  unregister(pluginId: string): boolean {
    const instance = this.plugins.get(pluginId)
    if (!instance) return false

    this.plugins.delete(pluginId)
    this.emit({ type: 'unregistered', pluginId })
    logger.agent.info(`[PluginRegistry] Unregistered plugin: ${pluginId}`)
    return true
  }

  get(pluginId: string): PluginInstance | undefined {
    return this.plugins.get(pluginId)
  }

  getAll(): PluginInstance[] {
    return Array.from(this.plugins.values())
  }

  getActive(): PluginInstance[] {
    return Array.from(this.plugins.values()).filter(p => p.status === 'active')
  }

  registerToolHandler(pluginId: string, toolName: string, handler: PluginExecuteHandler): boolean {
    const instance = this.plugins.get(pluginId)
    if (!instance || instance.status !== 'active') return false

    instance.toolHandlers.set(toolName, handler)
    this.emit({ type: 'tool_registered', pluginId, toolName })
    return true
  }

  registerCommandHandler(pluginId: string, commandId: string, handler: PluginExecuteHandler): boolean {
    const instance = this.plugins.get(pluginId)
    if (!instance || instance.status !== 'active') return false

    instance.commandHandlers.set(commandId, handler)
    this.emit({ type: 'command_registered', pluginId, commandId })
    return true
  }

  registerHookHandler(pluginId: string, event: PluginHookEvent, handler: PluginHookHandler): boolean {
    const instance = this.plugins.get(pluginId)
    if (!instance || instance.status !== 'active') return false

    const key = `${pluginId}:${event}`
    const handlers = instance.hookHandlers.get(key) ?? []
    handlers.push(handler)
    instance.hookHandlers.set(key, handlers)
    return true
  }

  async executeTool(toolName: string, params: Record<string, unknown>): Promise<unknown> {
    for (const instance of this.getActive()) {
      const handler = instance.toolHandlers.get(toolName)
      if (handler) {
        try {
          return await handler(params, instance.context)
        } catch (error) {
          instance.context.logger.error(`Tool execution failed: ${toolName}`, error)
          throw error
        }
      }
    }
    throw new Error(`No plugin provides tool: ${toolName}`)
  }

  async executeCommand(commandId: string, params: Record<string, unknown>): Promise<unknown> {
    for (const instance of this.getActive()) {
      const handler = instance.commandHandlers.get(commandId)
      if (handler) {
        try {
          return await handler(params, instance.context)
        } catch (error) {
          instance.context.logger.error(`Command execution failed: ${commandId}`, error)
          throw error
        }
      }
    }
    throw new Error(`No plugin provides command: ${commandId}`)
  }

  async emitHook(event: PluginHookEvent, data: unknown): Promise<void> {
    const promises: Promise<unknown>[] = []

    for (const instance of this.getActive()) {
      const key = `${instance.manifest.id}:${event}`
      const handlers = instance.hookHandlers.get(key) ?? []
      for (const handler of handlers) {
        promises.push(
          handler(data, instance.context).catch(error => {
            instance.context.logger.error(`Hook handler failed: ${event}`, error)
          })
        )
      }
    }

    await Promise.all(promises)
  }

  enable(pluginId: string): boolean {
    const instance = this.plugins.get(pluginId)
    if (!instance) return false
    instance.status = 'active'
    instance.manifest.enabled = true
    this.emit({ type: 'enabled', pluginId })
    return true
  }

  disable(pluginId: string): boolean {
    const instance = this.plugins.get(pluginId)
    if (!instance) return false
    instance.status = 'disabled'
    instance.manifest.enabled = false
    this.emit({ type: 'disabled', pluginId })
    return true
  }

  onEvent(listener: (event: PluginRegistryEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: PluginRegistryEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // ignore
      }
    }
  }

  clear(): void {
    this.plugins.clear()
    this.listeners.clear()
  }
}

export type PluginRegistryEvent =
  | { type: 'registered'; pluginId: string }
  | { type: 'unregistered'; pluginId: string }
  | { type: 'enabled'; pluginId: string }
  | { type: 'disabled'; pluginId: string }
  | { type: 'tool_registered'; pluginId: string; toolName: string }
  | { type: 'command_registered'; pluginId: string; commandId: string }

export const pluginRegistry = new PluginRegistry()
