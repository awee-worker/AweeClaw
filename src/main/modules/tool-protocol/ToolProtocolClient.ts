/**
 * MCP 客户端（使用官方 SDK）
 * 支持本地（stdio）和远程（HTTP/SSE）MCP 服务器
 */

import { EventEmitter } from 'events'
import path from 'path'
import fs from 'fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { BRAND } from '@shared/brand'
import { UnauthorizedError } from '@modelcontextprotocol/sdk/client/auth.js'
import * as cp from 'child_process'
import {
  CallToolResultSchema,
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { pickLatestVersionDir } from '@shared/toolkit/versionHelper'
import { McpOAuthProvider } from './ToolOAuthProvider'
import { mcpManager } from './ToolProtocolManager'
import { pythonManager } from '../python-runtime'
import { nodeManager } from '../node-runtime'
import { createComputerUseMcpServer } from './builtin/ComputerUseMcpServer'
import type {
  McpServerConfig,
  McpLocalServerConfig,
  McpRemoteServerConfig,
  McpBuiltinServerConfig,
  McpPluginServerConfig,
  McpTool,
  McpResource,
  McpPrompt,
  McpServerStatus,
  McpContent,
  McpOAuthTokens,
} from '@shared/protocols/toolProtocolBridge'
import { isRemoteConfig, isBuiltinConfig, isPluginConfig } from '@shared/protocols/toolProtocolBridge'

const DEFAULT_TIMEOUT = 30000
const NPX_TIMEOUT = 60000  // npx/uvx 首次需要下载包，给更长超时

/**
 * Windows 命令解析：将裸命令名（如 npx、uvx）解析为可被 spawn 直接执行的完整路径。
 *
 * Windows 上 npx/uvx/pnpm 等工具是 .cmd 批处理文件，
 * child_process.spawn 不带 shell:true 时无法找到它们（报 ENOENT）。
 * 此函数在 PATH 中搜索对应的 .cmd/.bat/.exe 文件并返回完整路径。
 *
 * @param command 裸命令名（如 'npx'、'uvx'、'node'）
 * @returns 解析后的命令路径（如 'C:\\...\\npx.cmd'）；找不到则原样返回
 */
function resolveWindowsCommand(command: string): string {
  // 已经是绝对路径或包含扩展名，直接返回
  if (path.isAbsolute(command) || /\.(cmd|bat|exe|com)$/i.test(command)) {
    return command
  }

  const extensions = ['.cmd', '.bat', '.exe', '.com']
  const pathEnv = process.env.PATH || ''
  const dirs = pathEnv.split(path.delimiter).filter(Boolean)

  for (const dir of dirs) {
    for (const ext of extensions) {
      const fullPath = path.join(dir, command + ext)
      try {
        if (fs.existsSync(fullPath)) {
          return fullPath
        }
      } catch {
        // 忽略访问权限错误，继续搜索
      }
    }
  }

  // 找不到则追加 .cmd 后缀作为 fallback（让系统去报更准确的错误）
  return command + '.cmd'
}

/**
 * 解析 uvx 命令为可执行的命令和参数。
 *
 * uvx 是 uv 工具的子命令快捷方式（等同于 `uv tool run`）。
 * 此函数按以下优先级解析：
 *   1. 通过 pythonManager.getUvxPath() 获取 uvx 二进制路径（含缓存 + PATH 搜索 + 同级推断）
 *   2. 若 uvx 不存在但 uv 存在，使用 `uv tool run <原args>` 作为等价命令
 *   3. 若 uv 也未安装，调用 pythonManager.ensureUvx() 触发 uv 安装后重试
 *   4. 仍失败则抛出明确错误（不再回退到不存在的 uvx.cmd）
 *
 * 注意：此函数是异步的，因为可能需要触发 uv 安装。
 * 此函数永远不会返回 null — 找不到时抛出包含安装提示的错误。
 */
async function resolveUvxCommand(originalArgs: string[]): Promise<{ command: string; args: string[] }> {
  // 优先使用 uvx 二进制（getUvxPath 内部有缓存 + PATH 搜索 + 同级推断）
  const uvxPath = pythonManager.getUvxPath()
  if (uvxPath) {
    return { command: uvxPath, args: originalArgs }
  }

  // uvx 不存在，尝试使用 uv tool run 等价命令
  const uvPath = pythonManager.getUvPath()
  if (uvPath) {
    return { command: uvPath, args: ['tool', 'run', ...originalArgs] }
  }

  // uv/uvx 都未安装，触发 ensureUvx 安装 uv（独立于 Python 安装状态）
  logger.mcp?.info('[MCP] uvx/uv not found, triggering PythonRuntimeManager.ensureUvx()...')
  try {
    const result = await pythonManager.ensureUvx()
    if (result) {
      // 如果返回的 uvxPath 和 uvPath 相同，说明 uvx 二进制不存在，需要用 uv tool run
      if (result.uvxPath === result.uvPath) {
        return { command: result.uvPath, args: ['tool', 'run', ...originalArgs] }
      }
      return { command: result.uvxPath, args: originalArgs }
    }
  } catch (err) {
    logger.mcp?.warn('[MCP] ensureUvx failed:', err)
  }

  // 所有安装方式均失败，抛出明确错误，不再回退到不存在的 uvx.cmd
  const hint = process.platform === 'win32'
    ? 'uv/uvx installation failed. Please install uv manually: pip install uv or download from https://github.com/astral-sh/uv/releases'
    : 'uv/uvx installation failed. Please install uv manually: curl -LsSf https://astral.sh/uv/install.sh | sh'
  throw new Error(hint)
}

/**
 * 国内 PyPI 镜像源（首选清华，兼顾阿里云、华为云）。
 * 用于 uvx/npx 命令安装 Python 依赖时加速下载。
 */
const PYPI_MIRROR_URL = 'https://pypi.tuna.tsinghua.edu.cn/simple'

/**
 * 为 uvx 命令注入国内 PyPI 镜像源环境变量，加速依赖下载。
 *
 * uv/uvx 读取以下环境变量确定包索引：
 * - UV_INDEX_URL：等价于 --index-url，设置主索引
 * - PIP_INDEX_URL：兼容 MCP 服务器内部可能调用的 pip
 *
 * 仅在用户未手动设置时注入，避免覆盖用户自定义配置。
 */
function injectMirrorEnv(
  env: Record<string, string>,
  command: string,
): Record<string, string> {
  if (command !== 'uvx') return env
  const patched: Record<string, string> = { ...env }
  if (!patched.UV_INDEX_URL) {
    patched.UV_INDEX_URL = PYPI_MIRROR_URL
  }
  if (!patched.PIP_INDEX_URL) {
    patched.PIP_INDEX_URL = PYPI_MIRROR_URL
  }
  return patched
}

type Transport = StdioClientTransport | StreamableHTTPClientTransport | SSEClientTransport | InMemoryTransport

interface ClientState {
  config: McpServerConfig
  client: Client | null
  transport: Transport | null
  status: McpServerStatus
  error?: string
  tools: McpTool[]
  resources: McpResource[]
  prompts: McpPrompt[]
  authUrl?: string
  oauthProvider?: McpOAuthProvider
}

export class McpClient extends EventEmitter {
  private state: ClientState
  private reconnectAttempts = 0
  private readonly maxReconnectAttempts = 5
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** 插件目录映射表（pluginKey -> 绝对路径），由 PluginInstaller 维护 */
  static pluginDirs = new Map<string, string>()

  /** 注册/更新插件目录映射 */
  static registerPluginDir(pluginKey: string, dir: string): void {
    McpClient.pluginDirs.set(pluginKey, dir)
  }

  /** 移除插件目录映射 */
  static unregisterPluginDir(pluginKey: string): void {
    McpClient.pluginDirs.delete(pluginKey)
  }

  /**
   * 内置插件 MCP 工厂映射表（pluginKey -> 工厂函数）。
   * 用于随应用打包的内置插件（如 computer-use），避免依赖磁盘文件 import。
   * 工厂函数返回 { server, clientTransport }，与 in-process 插件入口签名一致。
   */
  static builtinPluginFactories = new Map<string, () => { server: { close(): Promise<void> }; clientTransport: InMemoryTransport }>()

  /** 注册内置插件 MCP 工厂（应用启动时由各内置插件调用） */
  static registerBuiltinPluginFactory(pluginKey: string, factory: () => { server: { close(): Promise<void> }; clientTransport: InMemoryTransport }): void {
    McpClient.builtinPluginFactories.set(pluginKey, factory)
  }

  /** 注销内置插件 MCP 工厂 */
  static unregisterBuiltinPluginFactory(pluginKey: string): void {
    McpClient.builtinPluginFactories.delete(pluginKey)
  }

  constructor(config: McpServerConfig) {
    super()
    this.state = {
      config,
      client: null,
      transport: null,
      status: 'disconnected',
      tools: [],
      resources: [],
      prompts: [],
    }
  }

  get id(): string {
    return this.state.config.id
  }
  get config(): McpServerConfig {
    return this.state.config
  }
  get status(): McpServerStatus {
    return this.state.status
  }
  get tools(): McpTool[] {
    return this.state.tools
  }
  get resources(): McpResource[] {
    return this.state.resources
  }
  get prompts(): McpPrompt[] {
    return this.state.prompts
  }
  get error(): string | undefined {
    return this.state.error
  }
  get authUrl(): string | undefined {
    return this.state.authUrl
  }

  /** 连接到 MCP 服务器 */
  async connect(): Promise<void> {
    // 清理已有的重连 timer，防止多个 timer 并行
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.state.status === 'connected' || this.state.status === 'connecting') {
      return
    }

    this.updateStatus('connecting')
    const { config } = this.state

    try {
      if (isRemoteConfig(config)) {
        await this.connectRemote(config)
      } else if (isBuiltinConfig(config)) {
        await this.connectBuiltin(config)
      } else if (isPluginConfig(config)) {
        await this.connectPlugin(config)
      } else {
        await this.connectLocal(config)
      }
    } catch (err) {
      // 保留原始错误消息，不使用 toAppError 转换（避免 stderr 中的关键词被误判为 network error）
      const errorMsg = err instanceof Error ? err.message : String(err)
      const errorCode = (err as NodeJS.ErrnoException)?.code || ''
      logger.mcp?.error(`[MCP:${config.id}] Connection failed: ${errorCode || 'unknown'}`, err)
      if (this.state.status !== 'needs_auth' && this.state.status !== 'needs_registration') {
        this.updateStatus('error', errorMsg)
        this.scheduleReconnect()
      }
      // 重新抛出原始错误，保留完整的诊断信息（包括 stderr）
      throw err
    }
  }

  /** 连接本地服务器 */
  private async connectLocal(config: McpLocalServerConfig): Promise<void> {
    let command = config.command
    let args = config.args || []

    // uvx 命令解析：uvx 是独立可执行文件，但 PythonRuntimeManager 可能只安装了 uv。
    // 优先使用 uvx 二进制，其次回退到 `uv tool run` 等价命令。
    // 如果 uv/uvx 都未安装，resolveUvxCommand 会自动安装或抛出明确错误。
    if (command === 'uvx') {
      const resolved = await resolveUvxCommand(args)
      command = resolved.command
      args = resolved.args
    } else {
      // node/npx 命令优先使用内置 Node 运行时管理器解析的路径，
      // 确保用户未安装系统 Node.js 时 MCP 服务器仍可启动
      if (command === 'npx') {
        const npxPath = nodeManager.getNpxPath()
        if (npxPath) command = npxPath
      } else if (command === 'node') {
        const nodePath = nodeManager.getNodePath()
        if (nodePath) command = nodePath
      }
      // Windows 兼容：npx/uvx/bunx 等命令实际是 .cmd 批处理文件，
      // spawn 不带 shell:true 时无法找到，需要解析为完整路径或追加 .cmd 后缀
      if (process.platform === 'win32') {
        command = resolveWindowsCommand(command)
      }
    }

    const transport = new StdioClientTransport({
      command,
      args,
      env: injectMirrorEnv({ ...process.env, ...config.env } as Record<string, string>, config.command),
      cwd: config.cwd,
      stderr: 'pipe',
    })

    // 捕获子进程 stderr 输出，用于诊断启动失败原因
    let stderrOutput = ''
    transport.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) {
        stderrOutput += text + '\n'
        logger.mcp?.warn(`[MCP:${config.id}] stderr: ${text}`)
      }
    })

    const client = new Client({
      name: BRAND.mcp.clientId,
      version: process.env.npm_package_version || '1.0.0',
    })

    this.registerNotificationHandlers(client)

    // 智能超时：npx/uvx 命令给更长超时（首次需要下载包）
    const isPackageRunner = ['npx', 'uvx', 'bunx'].includes(config.command)
    const timeout = config.timeout || (isPackageRunner ? NPX_TIMEOUT : DEFAULT_TIMEOUT)
    try {
      await this.withTimeout(client.connect(transport), timeout)
    } catch (err) {
      // 连接失败时，附带 stderr 信息以便诊断
      if (stderrOutput) {
        logger.mcp?.error(`[MCP:${config.id}] Process stderr output:\n${stderrOutput}`)
        // 将 stderr 尾部附加到错误消息，让用户在 UI 上看到真正的失败原因
        const stderrTail = stderrOutput.split('\n').slice(-5).join('\n').trim()
        if (stderrTail) {
          const baseMsg = err instanceof Error ? err.message : String(err)
          const enhanced = new Error(`${baseMsg}\n[stderr] ${stderrTail}`)
          ;(enhanced as Error & { cause?: unknown }).cause = err
          throw enhanced
        }
      }
      throw err
    }

    this.state.client = client
    this.state.transport = transport

    await this.refreshCapabilities()
    this.reconnectAttempts = 0
    this.updateStatus('connected')
    logger.mcp?.info(`[MCP:${config.id}] Connected (local)`)
  }

  /**
   * 连接内置进程内 MCP 服务器
   * 不拉起子进程，直接通过 InMemoryTransport 与主进程内的服务器通信
   */
  private async connectBuiltin(config: McpBuiltinServerConfig): Promise<void> {
    if (config.builtin !== 'computer-use') {
      throw new Error(`Unsupported builtin MCP server: ${config.builtin}`)
    }

    // 创建进程内服务器，返回已配对的 InMemoryTransport
    const { server, clientTransport } = createComputerUseMcpServer()

    const client = new Client({
      name: BRAND.mcp.clientId,
      version: process.env.npm_package_version || '1.0.0',
    })

    this.registerNotificationHandlers(client)

    try {
      await this.withTimeout(client.connect(clientTransport), DEFAULT_TIMEOUT)
    } catch (err) {
      // 关闭服务器，避免泄漏
      await server.close().catch(() => {})
      throw err
    }

    // 保存 server 实例以便断开时清理
    ;(this as unknown as { _builtinServer?: typeof server })._builtinServer = server

    this.state.client = client
    this.state.transport = clientTransport

    await this.refreshCapabilities()
    this.reconnectAttempts = 0
    this.updateStatus('connected')
    logger.mcp?.info(`[MCP:${config.id}] Connected (builtin: ${config.builtin})`)
  }

  /**
   * 连接插件型 MCP 服务器
   * 支持三种传输模式：
   * - in-process：动态 import 插件入口模块，调用工厂函数创建 McpServer + InMemoryTransport
   * - stdio：以子进程方式启动插件提供的命令
   * - sse：连接插件提供的 HTTP/SSE 服务
   */
  private async connectPlugin(config: McpPluginServerConfig): Promise<void> {
    if (config.transport === 'in-process') {
      await this.connectPluginInProcess(config)
    } else if (config.transport === 'stdio') {
      await this.connectPluginStdio(config)
    } else if (config.transport === 'sse') {
      await this.connectPluginSse(config)
    } else {
      throw new Error(`Unsupported plugin transport: ${config.transport}`)
    }
  }

  /** 插件 in-process 模式：动态加载插件入口模块 */
  private async connectPluginInProcess(config: McpPluginServerConfig): Promise<void> {
    // 注入插件配置到 process.env（与 stdio 模式对齐）。
    // stdio 模式通过子进程 env 注入 config.env；in-process 插件共享主进程，
    // 必须显式写入 process.env，否则插件代码无法读取用户在 configSchema 中填写的配置。
    // 始终用最新配置覆盖，确保用户修改插件配置后重连能生效。
    // config.env 的键来自 manifest configSchema 字段名（如 stability_api_key），
    // 不会与 PATH/HOME 等系统环境变量冲突。
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        if (typeof value === 'string') {
          process.env[key] = value
        }
      }
      logger.mcp?.debug?.(`[MCP:${config.id}] Injected ${Object.keys(config.env).length} config env vars for in-process plugin`)
    }

    // 优先使用内置插件工厂（随应用打包的插件，如 computer-use）
    const builtinFactory = McpClient.builtinPluginFactories.get(config.pluginKey)
    let server: { close(): Promise<void> }
    let clientTransport: InMemoryTransport

    if (builtinFactory) {
      const result = await builtinFactory()
      server = result.server
      clientTransport = result.clientTransport
    } else {
      // 外部插件：从磁盘动态 import 入口模块
      if (!config.inProcessEntry) {
        throw new Error(`Plugin ${config.pluginKey} in-process mode requires inProcessEntry`)
      }

      const entryPath = path.isAbsolute(config.inProcessEntry)
        ? config.inProcessEntry
        : path.join(this.resolvePluginDir(config), config.inProcessEntry)

      if (!fs.existsSync(entryPath)) {
        throw new Error(`Plugin entry not found: ${entryPath}`)
      }

      // 动态加载入口模块
      const factoryModule = await import(entryPath)
      const factory = factoryModule.default || factoryModule.createMcpServer || factoryModule.create
      if (typeof factory !== 'function') {
        throw new Error(
          `Plugin ${config.pluginKey} entry must export default function or createMcpServer() returning { server, clientTransport }`,
        )
      }

      const result = await factory() as {
        server: { close(): Promise<void> }
        clientTransport: InMemoryTransport
      }
      server = result.server
      clientTransport = result.clientTransport
    }

    const client = new Client({
      name: BRAND.mcp.clientId,
      version: process.env.npm_package_version || '1.0.0',
    })

    this.registerNotificationHandlers(client)

    try {
      await this.withTimeout(client.connect(clientTransport), DEFAULT_TIMEOUT)
    } catch (err) {
      await server.close().catch(() => {})
      throw err
    }

    ;(this as unknown as { _builtinServer?: typeof server })._builtinServer = server

    this.state.client = client
    this.state.transport = clientTransport

    await this.refreshCapabilities()
    this.reconnectAttempts = 0
    this.updateStatus('connected')
    logger.mcp?.info(`[MCP:${config.id}] Connected (plugin in-process: ${config.pluginKey})`)
  }

  /** 插件 stdio 模式：启动子进程 */
  private async connectPluginStdio(config: McpPluginServerConfig): Promise<void> {
    if (!config.command) {
      throw new Error(`Plugin ${config.pluginKey} stdio mode requires command`)
    }

    const pluginDir = this.resolvePluginDir(config)
    const baseArgs = (config.args || []).map((a) => a.replace('{{pluginDir}}', pluginDir))
    const env = injectMirrorEnv(
      { ...process.env, ...config.env, PLUGIN_DIR: pluginDir } as Record<string, string>,
      config.command,
    )

    // 工作目录优先使用当前工作区路径，使插件生成的文件默认输出到工作区
    // fallback 到插件目录（无工作区时）
    const workspaceDir = mcpManager.getWorkspaceRoot()
    const cwd = workspaceDir || pluginDir
    logger.mcp?.info(`[MCP:${config.id}] Plugin stdio cwd: ${cwd}${workspaceDir ? ' (workspace)' : ' (pluginDir)'}`)

    // 命令解析：uvx 需要特殊处理（可能只有 uv 而没有 uvx）
    let command = config.command
    let args = baseArgs

    if (command === 'uvx') {
      const resolved = await resolveUvxCommand(baseArgs)
      command = resolved.command
      args = resolved.args
    } else if (command === 'npx') {
      const npxPath = nodeManager.getNpxPath()
      if (npxPath) {
        command = npxPath
      } else if (process.platform === 'win32') {
        command = resolveWindowsCommand(command)
      }
    } else if (command === 'node') {
      const nodePath = nodeManager.getNodePath()
      if (nodePath) {
        command = nodePath
      } else if (process.platform === 'win32') {
        command = resolveWindowsCommand(command)
      }
    } else if (process.platform === 'win32') {
      // Windows 兼容：解析 .cmd 命令
      command = resolveWindowsCommand(command)
    }

    const transport = new StdioClientTransport({
      command,
      args,
      env,
      cwd,
      stderr: 'pipe',
    })

    let stderrOutput = ''
    transport.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) {
        stderrOutput += text + '\n'
        logger.mcp?.warn(`[MCP:${config.id}] stderr: ${text}`)
      }
    })

    const client = new Client({
      name: BRAND.mcp.clientId,
      version: process.env.npm_package_version || '1.0.0',
    })

    this.registerNotificationHandlers(client)

    // 智能超时：npx/uvx 命令给更长超时（首次需要下载包）
    const isPackageRunner = ['npx', 'uvx', 'bunx'].includes(config.command)
    const timeout = isPackageRunner ? NPX_TIMEOUT : DEFAULT_TIMEOUT
    try {
      await this.withTimeout(client.connect(transport), timeout)
    } catch (err) {
      if (stderrOutput) {
        logger.mcp?.error(`[MCP:${config.id}] Process stderr output:\n${stderrOutput}`)
        // 将 stderr 尾部附加到错误消息，让用户在 UI 上看到真正的失败原因
        const stderrTail = stderrOutput.split('\n').slice(-5).join('\n').trim()
        if (stderrTail) {
          const baseMsg = err instanceof Error ? err.message : String(err)
          const enhanced = new Error(`${baseMsg}\n[stderr] ${stderrTail}`)
          ;(enhanced as Error & { cause?: unknown }).cause = err
          throw enhanced
        }
      }
      throw err
    }

    this.state.client = client
    this.state.transport = transport

    await this.refreshCapabilities()
    this.reconnectAttempts = 0
    this.updateStatus('connected')
    logger.mcp?.info(`[MCP:${config.id}] Connected (plugin stdio: ${config.pluginKey})`)
  }

  /** 插件 sse 模式：连接 HTTP/SSE 服务 */
  private async connectPluginSse(config: McpPluginServerConfig): Promise<void> {
    if (!config.url) {
      throw new Error(`Plugin ${config.pluginKey} sse mode requires url`)
    }

    const transports: Array<{ name: string; create: () => Transport }> = [
      {
        name: 'StreamableHTTP',
        create: () => new StreamableHTTPClientTransport(new URL(config.url!)),
      },
      {
        name: 'SSE',
        create: () => new SSEClientTransport(new URL(config.url!)),
      },
    ]

    let lastError: Error | undefined
    for (const { name, create } of transports) {
      const transport = create()
      const client = new Client({
        name: BRAND.mcp.clientId,
        version: process.env.npm_package_version || '1.0.0',
      })

      this.registerNotificationHandlers(client)

      try {
        await this.withTimeout(client.connect(transport), DEFAULT_TIMEOUT)
        this.state.client = client
        this.state.transport = transport
        await this.refreshCapabilities()
        this.reconnectAttempts = 0
        this.updateStatus('connected')
        logger.mcp?.info(`[MCP:${config.id}] Connected (plugin sse via ${name}: ${config.pluginKey})`)
        return
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        logger.mcp?.warn(`[MCP:${config.id}] Plugin SSE ${name} failed: ${lastError.message}`)
      }
    }

    throw lastError || new Error(`Failed to connect plugin SSE: ${config.pluginKey}`)
  }

  /** 解析插件根目录 */
  private resolvePluginDir(config: McpPluginServerConfig): string {
    // 通过 PluginInstaller 注入的目录映射获取
    const dir = McpClient.pluginDirs.get(config.pluginKey)
    if (dir) return dir

    // fallback：扫描 userData/plugins/<pluginKey>/ 下的版本号子目录
    // 应用重启后 pluginDirs Map 可能在 MCP 自动连接时尚未注册，
    // 此时自动查找最新的版本子目录，避免路径缺少版本号导致 "Plugin entry not found"
    const { app } = require('electron') as { app: Electron.App }
    const baseDir = path.join(app.getPath('userData'), 'plugins', config.pluginKey)

    if (fs.existsSync(baseDir)) {
      try {
        const subdirs = fs
          .readdirSync(baseDir)
          .filter((d) => fs.statSync(path.join(baseDir, d)).isDirectory())
        // 按语义版本挑最新的版本目录，不能用字典序：
        // 字典序下 "1.10.0" 小于 "1.9.0"，跨十位版本号时会把旧目录当成最新
        const latest = pickLatestVersionDir(subdirs)
        if (latest) {
          const resolved = path.join(baseDir, latest)
          // 顺带补登记到 pluginDirs，后续连接直接命中缓存
          McpClient.registerPluginDir(config.pluginKey, resolved)
          return resolved
        }
      } catch {
        // 目录读取失败时回退到 baseDir
      }
    }

    return baseDir
  }

  /** 连接远程服务器 */
  private async connectRemote(config: McpRemoteServerConfig): Promise<void> {
    const oauthDisabled = config.oauth === false
    const oauthConfig = typeof config.oauth === 'object' ? config.oauth : undefined
    let authProvider: McpOAuthProvider | undefined
    let capturedAuthUrl: string | undefined

    if (!oauthDisabled) {
      authProvider = new McpOAuthProvider(config.id, config.url, {
        clientId: oauthConfig?.clientId,
        clientSecret: oauthConfig?.clientSecret,
        scope: oauthConfig?.scope,
        onRedirect: (url: URL) => {
          capturedAuthUrl = url.toString()
        },
      })
      this.state.oauthProvider = authProvider
    }

    // 尝试 StreamableHTTP 和 SSE 两种传输方式
    const transports: Array<{ name: string; create: () => Transport }> = [
      {
        name: 'StreamableHTTP',
        create: () =>
          new StreamableHTTPClientTransport(new URL(config.url), {
            authProvider,
            requestInit: config.headers ? { headers: config.headers } : undefined,
          }),
      },
      {
        name: 'SSE',
        create: () =>
          new SSEClientTransport(new URL(config.url), {
            authProvider,
            requestInit: config.headers ? { headers: config.headers } : undefined,
          }),
      },
    ]

    let lastError: Error | undefined
    const timeout = config.timeout || DEFAULT_TIMEOUT

    for (const { name, create } of transports) {
      // 提升到 try 块外，使 catch 块中也能访问（用于保存 OAuth 等待状态）
      let transport: Transport | undefined
      let client: Client | undefined
      try {
        transport = create()
        client = new Client({
          name: BRAND.mcp.clientId,
          version: process.env.npm_package_version || '1.0.0',
        })

        this.registerNotificationHandlers(client)
        await this.withTimeout(client.connect(transport), timeout)

        this.state.client = client
        this.state.transport = transport

        await this.refreshCapabilities()
        this.reconnectAttempts = 0
        this.updateStatus('connected')
        logger.mcp?.info(`[MCP:${config.id}] Connected (${name})`)
        return
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))

        // 处理 OAuth 认证错误
        // 注意：bundler 环境下 ESM/CJS 双路径导致 instanceof 跨模块失效，
        // 需同时兼容 constructor.name 判断
        const isUnauthorized = err instanceof UnauthorizedError ||
          (err instanceof Error && err.constructor.name === 'UnauthorizedError')

        if (isUnauthorized) {
          logger.mcp?.info(`[MCP:${config.id}] Requires authentication`)

          // 必须保存 transport/client，后续 finishAuth() 需要在这个实例上调用
          // 如果不保存，finishAuth 会拿到 null transport 导致无法完成 token 交换
          this.state.client = client ?? null
          this.state.transport = transport ?? null

          if (lastError.message.includes('registration') || lastError.message.includes('client_id')) {
            this.updateStatus('needs_registration', 'Server requires pre-registered client ID')
          } else {
            this.state.authUrl = capturedAuthUrl
            this.updateStatus('needs_auth')
          }
          return
        }

        logger.mcp?.warn(`[MCP:${config.id}] ${name} transport failed [${lastError.constructor.name}]: ${lastError.message}`)

        // 若 StreamableHTTP 触发了 OAuth 重定向 URL（说明服务器有响应且需要认证），
        // 不要继续 fallback 到 SSE，直接标记为 needs_auth
        if (name === 'StreamableHTTP' && capturedAuthUrl) {
          logger.mcp?.info(`[MCP:${config.id}] OAuth URL captured, marking as needs_auth`)
          this.state.client = client ?? null
          this.state.transport = transport ?? null
          this.state.authUrl = capturedAuthUrl
          this.updateStatus('needs_auth')
          return
        }

        // 若 StreamableHTTP 报的是 OAuth/认证相关的错误（但未到 redirect 阶段），
        // 也不应 fallback 到 SSE
        // 若 OAuth 已禁用（使用 header 认证），StreamableHTTP 失败即终止，不 fallback 到 SSE
        // StreamableHTTPError 表示服务器已响应（只是返回了 4xx），SSE 无法解决认证问题
        if (name === 'StreamableHTTP' && oauthDisabled) {
          const errMsg = lastError.message.toLowerCase()
          const isCredentialError = errMsg.includes('unauthorized') || errMsg.includes('forbidden') ||
            errMsg.includes('401') || errMsg.includes('403')
          const errorDetail = isCredentialError
            ? 'Access token invalid or missing — check your credentials'
            : lastError.message
          logger.mcp?.warn(`[MCP:${config.id}] OAuth disabled, stopping after StreamableHTTP failure`)
          this.updateStatus('error', errorDetail)
          return
        }

        const isOAuthSetupError = lastError.message.includes('client registration') ||
          lastError.message.includes('Protected Resource') ||
          lastError.message.includes('auth server') ||
          lastError.message.includes('OAuth') ||
          lastError.message.includes('registration_endpoint')
        if (name === 'StreamableHTTP' && isOAuthSetupError) {
          logger.mcp?.warn(`[MCP:${config.id}] OAuth setup error, skipping SSE fallback`)
          this.state.client = client ?? null
          this.state.transport = transport ?? null
          this.updateStatus('needs_registration', lastError.message)
          return
        }
      }
    }

    throw lastError || new Error('All transports failed')
  }

  /** 断开连接 */
  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = 0

    if (this.state.status === 'disconnected') {
      return
    }

    logger.mcp?.info(`[MCP:${this.id}] Disconnecting...`)

    if (this.state.client) {
      await this.state.client.close().catch((err) => {
        logger.mcp?.error(`[MCP:${this.id}] Close error:`, err)
      })
      this.state.client = null
    }

    // 显式关闭 transport 确保子进程被终止
    if (this.state.transport) {
      if (this.state.transport instanceof StdioClientTransport) {
        try {
          // StdioClientTransport 的 _process 是私有的，但我们可以通过这种方式获取
          // @ts-ignore
          const subProcess = this.state.transport._process
          if (subProcess && subProcess.pid) {
            logger.mcp?.info(`[MCP:${this.id}] Force killing process tree for PID ${subProcess.pid}`)
            if (process.platform === 'win32') {
              // Windows: 使用 taskkill /F /T 杀死整个进程树
              cp.execSync(`taskkill /F /T /PID ${subProcess.pid}`, { stdio: 'ignore' })
            } else {
              subProcess.kill('SIGKILL')
            }
          }
        } catch (err) {
          logger.mcp?.warn(`[MCP:${this.id}] Force kill error:`, err)
        }
      }

      try {
        await this.state.transport.close()
      } catch {
        // ignore close errors
      }
      this.state.transport = null
    }

    // 关闭内置进程内服务器（仅 builtin 类型有）
    const builtinServer = (this as unknown as { _builtinServer?: { close: () => Promise<void> } })._builtinServer
    if (builtinServer) {
      await builtinServer.close().catch(() => {
        // ignore close errors
      })
      ;(this as unknown as { _builtinServer?: unknown })._builtinServer = undefined
    }

    this.state.tools = []
    this.state.resources = []
    this.state.prompts = []
    this.updateStatus('disconnected')
    this.emit('disconnected')
  }

  /** 调用工具 */
  async callTool(
    toolName: string,
    args: Record<string, unknown>
  ): Promise<{ content: McpContent[]; isError?: boolean }> {
    this.ensureConnected()

    const result = await this.state.client!.callTool(
      { name: toolName, arguments: args },
      CallToolResultSchema,
      { timeout: this.resolveToolTimeout() }
    )

    return {
      content: (result.content as any[]).map((c) => ({
        type: c.type as 'text' | 'image' | 'resource',
        text: c.text,
        data: c.data,
        mimeType: c.mimeType,
      })),
      isError: result.isError as boolean | undefined,
    }
  }

  /** 读取资源 */
  async readResource(
    uri: string
  ): Promise<{ contents: Array<{ uri: string; mimeType?: string; text?: string; blob?: string }> }> {
    this.ensureConnected()
    return this.state.client!.readResource({ uri })
  }

  /** 获取提示 */
  async getPrompt(
    name: string,
    args?: Record<string, string>
  ): Promise<{
    description?: string
    messages: Array<{ role: 'user' | 'assistant'; content: McpContent }>
  }> {
    this.ensureConnected()
    return this.state.client!.getPrompt({ name, arguments: args }) as any
  }

  /** 刷新能力列表 */
  async refreshCapabilities(): Promise<void> {
    if (!this.state.client) {
      throw new Error(`MCP server ${this.id} is not connected`)
    }

    const timeout = (this.state.config as { timeout?: number }).timeout || DEFAULT_TIMEOUT

    try {
      // 获取工具
      const toolsResult = await this.withTimeout(this.state.client.listTools(), timeout)
      this.state.tools = (toolsResult.tools || []).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as McpTool['inputSchema'],
      }))
      this.emit('toolsUpdated', this.state.tools)

      // 获取资源
      try {
        const resourcesResult = await this.withTimeout(this.state.client.listResources(), timeout)
        this.state.resources = (resourcesResult.resources || []).map((r) => ({
          uri: r.uri,
          name: r.name,
          description: r.description,
          mimeType: r.mimeType,
        }))
        this.emit('resourcesUpdated', this.state.resources)
      } catch {
        this.state.resources = []
      }

      // 获取提示
      try {
        const promptsResult = await this.withTimeout(this.state.client.listPrompts(), timeout)
        this.state.prompts = (promptsResult.prompts || []).map((p) => ({
          name: p.name,
          description: p.description,
          arguments: p.arguments?.map((a) => ({
            name: a.name,
            description: a.description,
            required: a.required,
          })),
        }))
        this.emit('promptsUpdated', this.state.prompts)
      } catch {
        this.state.prompts = []
      }

      logger.mcp?.info(
        `[MCP:${this.id}] Capabilities: ${this.state.tools.length} tools, ${this.state.resources.length} resources, ${this.state.prompts.length} prompts`
      )
    } catch (err) {
      const error = toAppError(err)
      logger.mcp?.error(`[MCP:${this.id}] Failed to refresh capabilities: ${error.code}`, error)
      throw error
    }
  }

  /** 设置 OAuth tokens */
  setTokens(tokens: McpOAuthTokens): void {
    if (this.state.oauthProvider) {
      this.state.oauthProvider.setTokens(tokens)
    }
    this.state.authUrl = undefined
  }

  /** 获取 OAuth tokens */
  getTokens(): McpOAuthTokens | undefined {
    return this.state.oauthProvider?.getTokens()
  }

  /** 检查 token 是否过期 */
  isTokenExpired(): boolean {
    return this.state.oauthProvider?.isTokenExpired() ?? false
  }

  /** 完成 OAuth 认证 */
  async finishAuth(authorizationCode: string): Promise<void> {
    const transport = this.state.transport as StreamableHTTPClientTransport | SSEClientTransport
    if (transport && 'finishAuth' in transport) {
      await transport.finishAuth(authorizationCode)
    }
  }

  // =================== 私有方法 ===================

  /** 指数退避自动重连 */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.mcp?.warn(`[MCP:${this.id}] Max reconnect attempts reached (${this.maxReconnectAttempts})`)
      return
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 60000) // 1s, 2s, 4s, 8s, 16s, max 60s
    this.reconnectAttempts++

    logger.mcp?.info(`[MCP:${this.id}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`)

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect()
        this.reconnectAttempts = 0 // 成功后重置
      } catch (err) {
        logger.mcp?.error(`[MCP:${this.id}] Reconnect failed:`, err)
        this.scheduleReconnect() // 继续尝试
      }
    }, delay)
  }

  private registerNotificationHandlers(client: Client): void {
    client.setNotificationHandler(ToolListChangedNotificationSchema, async () => {
      logger.mcp?.info(`[MCP:${this.id}] Tools list changed`)
      await this.refreshCapabilities().catch(() => { })
    })

    client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      logger.mcp?.info(`[MCP:${this.id}] Resources list changed`)
      await this.refreshCapabilities().catch(() => { })
    })

    client.setNotificationHandler(PromptListChangedNotificationSchema, async () => {
      logger.mcp?.info(`[MCP:${this.id}] Prompts list changed`)
      await this.refreshCapabilities().catch(() => { })
    })
  }

  private updateStatus(status: McpServerStatus, error?: string): void {
    this.state.status = status
    this.state.error = error
    this.emit('statusChanged', { status, error, authUrl: this.state.authUrl })
  }

  private ensureConnected(): void {
    if (this.state.status !== 'connected' || !this.state.client) {
      throw new Error(`MCP server ${this.id} is not connected`)
    }
  }

  /**
   * 解析工具调用超时
   *
   * 优先级：
   * 1. config.timeout（插件 manifest capabilities.mcp.timeout 声明的值）
   * 2. in-process 插件默认 600000ms（10 分钟）— 视频生成等长时间任务需要
   * 3. DEFAULT_TIMEOUT（30000ms = 30 秒）— 本地/远程 MCP 服务器
   */
  private resolveToolTimeout(): number {
    const configTimeout = (this.state.config as { timeout?: number }).timeout
    if (typeof configTimeout === 'number' && configTimeout > 0) {
      return configTimeout
    }
    // in-process 插件可能执行长时间任务（如视频生成异步轮询），使用更大的默认超时
    if (this.state.config.type === 'plugin' && (this.state.config as { transport?: string }).transport === 'in-process') {
      return 600000 // 10 分钟
    }
    return DEFAULT_TIMEOUT
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout>
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timeout')), ms)
      }),
    ]).finally(() => clearTimeout(timer!))
  }

  async forceCleanupAndSetError(errorMessage: string): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this.reconnectAttempts = 0

    if (this.state.transport) {
      if (this.state.transport instanceof StdioClientTransport) {
        try {
          // @ts-ignore
          const subProcess = this.state.transport._process
          if (subProcess && subProcess.pid) {
            logger.mcp?.info(`[MCP:${this.id}] Force killing process tree for PID ${subProcess.pid}`)
            if (process.platform === 'win32') {
              cp.execSync(`taskkill /F /T /PID ${subProcess.pid}`, { stdio: 'ignore' })
            } else {
              subProcess.kill('SIGKILL')
            }
          }
        } catch (err) {
          logger.mcp?.warn(`[MCP:${this.id}] Force kill error:`, err)
        }
      }
      try {
        await this.state.transport.close()
      } catch { /* ignore */ }
      this.state.transport = null
    }

    if (this.state.client) {
      await this.state.client.close().catch(() => { })
      this.state.client = null
    }

    this.state.tools = []
    this.state.resources = []
    this.state.prompts = []
    this.updateStatus('error', errorMessage)
  }
}
