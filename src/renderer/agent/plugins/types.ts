import type { ToolCategory } from '@shared/config/tools'

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  icon?: string
  permissions: PluginPermission[]
  contributes: PluginContributes
  enabled: boolean
  installedAt: number
  updatedAt: number
}

export interface PluginPermission {
  type: 'file_read' | 'file_write' | 'shell_execute' | 'network' | 'clipboard' | 'notification'
  description?: string
  restricted?: boolean
}

export interface PluginContributes {
  tools?: PluginToolDefinition[]
  commands?: PluginCommandDefinition[]
  hooks?: PluginHookDefinition[]
  settings?: PluginSettingDefinition[]
}

export interface PluginToolDefinition {
  name: string
  displayName: string
  description: string
  category: ToolCategory
  parameters: Record<string, PluginParameterDef>
  handler: string
}

export interface PluginParameterDef {
  type: 'string' | 'number' | 'boolean' | 'array'
  description: string
  required?: boolean
  default?: unknown
}

export interface PluginCommandDefinition {
  id: string
  title: string
  handler: string
  shortcut?: string
}

export interface PluginHookDefinition {
  event: PluginHookEvent
  handler: string
  priority?: number
}

export type PluginHookEvent =
  | 'on_message_sent'
  | 'on_message_received'
  | 'on_tool_executed'
  | 'on_file_changed'
  | 'on_session_start'
  | 'on_session_end'

export interface PluginSettingDefinition {
  key: string
  type: 'string' | 'number' | 'boolean' | 'select'
  label: string
  default?: unknown
  options?: Array<{ value: unknown; label: string }>
}

export interface PluginContext {
  pluginId: string
  storage: PluginStorage
  logger: PluginLogger
  sandbox: PluginSandbox
}

export interface PluginStorage {
  get<T = unknown>(key: string): T | undefined
  set(key: string, value: unknown): void
  delete(key: string): void
  clear(): void
}

export interface PluginLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

export interface PluginSandbox {
  readFile(path: string): Promise<string | null>
  writeFile(path: string, content: string): Promise<boolean>
  executeCommand(command: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }>
  fetch(url: string, options?: Record<string, unknown>): Promise<unknown>
}

export type PluginExecuteHandler = (params: Record<string, unknown>, context: PluginContext) => Promise<unknown>
export type PluginHookHandler = (data: unknown, context: PluginContext) => Promise<unknown>

export interface PluginInstance {
  manifest: PluginManifest
  context: PluginContext
  toolHandlers: Map<string, PluginExecuteHandler>
  commandHandlers: Map<string, PluginExecuteHandler>
  hookHandlers: Map<string, PluginHookHandler[]>
  status: 'active' | 'disabled' | 'error'
  error?: string
}
