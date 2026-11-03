/**
 * 内置 LSP 管理器
 * 支持多根目录工作空间（为每个根目录启动独立的服务器实例）
 * 
 * 增强功能：
 * - 智能根目录检测
 * - Call Hierarchy 支持
 * - waitForDiagnostics 机制
 * - 更多语言服务器支持
 * - 自动下载安装 LSP 服务器
 */

import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import { getExecutableName } from '@shared/toolkit/pathHelper'
import { normalizeLspUri } from '@shared/toolkit/uriHelper'
import { spawn, ChildProcess } from 'child_process'
import { hardKillProcessTree } from '../process/processTree'
import * as path from 'path'
import * as fs from 'fs'
import { BrowserWindow } from 'electron'
import { LanguageId } from '@shared/languageRegistry'
import { LSP_DEFAULTS } from '@shared/configuration/defaultProfile'
import { CacheService } from '@shared/toolkit/CacheManager'
import { getCacheConfig } from '@configuration/agentProfile'
import {
  getInstalledServerPath,
  commandExists,
  isServerRuntimeBroken,
  getLspBinDir,
} from './serverInstaller'
import { pythonManager } from '../modules/python-runtime'

// 重新导出 LanguageId 供其他模块使用
export type { LanguageId } from '@shared/languageRegistry'

// ============ 类型定义 ============

interface LspServerConfig {
  name: string
  languages: LanguageId[]
  getCommand: () => Promise<{ command: string; args: string[] } | null>
  /** 智能根目录检测函数，返回 null 表示不应该使用此服务器 */
  findRoot?: (filePath: string, workspacePath: string) => Promise<string | null>
  /** 自动安装函数 */
  install?: () => Promise<{ success: boolean; path?: string; error?: string }>
}

interface LspServerInstance {
  config: LspServerConfig
  process: ChildProcess | null
  requestId: number
  pendingRequests: Map<number, { resolve: Function; reject: Function; timeout: NodeJS.Timeout }>
  buffer: Buffer
  contentLength: number
  initialized: boolean
  workspacePath: string
  // 自动重启相关
  crashCount: number
  lastCrashTime: number
}

// ============ 智能根目录检测辅助函数 ============

/**
 * 向上查找包含指定文件的目录
 */
async function findNearestRoot(
  startDir: string,
  stopDir: string,
  patterns: string[],
  excludePatterns?: string[]
): Promise<string | undefined> {
  let currentDir = startDir

  while (currentDir.length >= stopDir.length) {
    // 检查排除模式
    if (excludePatterns) {
      for (const pattern of excludePatterns) {
        const excludePath = path.join(currentDir, pattern)
        if (fs.existsSync(excludePath)) {
          return undefined // 被排除
        }
      }
    }

    // 检查目标模式（支持 glob-like *.ext 匹配）
    for (const pattern of patterns) {
      if (pattern.includes('*')) {
        try {
          const entries = fs.readdirSync(currentDir)
          const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$')
          if (entries.some(entry => re.test(entry))) {
            return currentDir
          }
        } catch {
          // directory not readable, skip
        }
      } else {
        const targetPath = path.join(currentDir, pattern)
        if (fs.existsSync(targetPath)) {
          return currentDir
        }
      }
    }

    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) break
    currentDir = parentDir
  }

  return undefined
}

// ============ TypeScript SDK 解析 ============

/**
 * 解析 Volar 需要的 TypeScript SDK 目录
 *
 * Volar（vue-language-server）不内置 TypeScript，而是通过
 * initializationOptions.typescript.tsdk 定位一份 tsserverlibrary.js 所在目录。
 * 解析不到 tsdk 时它内部的 tsserver 起不来，hover / 补全 / 跳转的请求会一直
 * 挂在等待初始化上，直到客户端超时 —— 表现是编辑器对这些操作毫无反应，
 * 而且不会报「找不到 tsserver」，只会看到请求超时。
 *
 * 优先级：工作区（含上溯多级，兼容 monorepo）自带的 typescript →
 * 托管 LSP 目录下的 typescript 运行时 → 应用自身。都没有时返回 null。
 */
function resolveTypeScriptTsdk(workspacePath: string): string | null {
  const isSdkDir = (dir: string): boolean =>
    fs.existsSync(path.join(dir, 'tsserverlibrary.js')) ||
    fs.existsSync(path.join(dir, 'typescript.js'))

  const candidates: string[] = []

  let dir = workspacePath
  for (let depth = 0; depth < 6 && dir; depth++) {
    candidates.push(path.join(dir, 'node_modules', 'typescript', 'lib'))
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  try {
    candidates.push(path.join(getLspBinDir(), 'node_modules', 'typescript', 'lib'))
  } catch {
    // 托管目录不可用（权限 / 创建失败）时跳过，不影响其它候选
  }

  candidates.push(path.join(process.cwd(), 'node_modules', 'typescript', 'lib'))

  for (const candidate of candidates) {
    if (candidate && isSdkDir(candidate)) {
      return candidate.replace(/\\/g, '/')
    }
  }

  logger.lsp.warn('[LSP vue] No TypeScript SDK found, Volar may have no type service', {
    workspacePath,
    tried: candidates.length,
  })
  return null
}

/**
 * Volar 的初始化配置
 *
 * 同时用于 initialize 的 initializationOptions 与 workspace/configuration 的回包：
 * 两处必须给出同样的形状，否则 Volar 会在其中一次读到空配置并把 tsserver 关掉。
 */
function buildVueConfig(workspacePath: string): Record<string, unknown> {
  const tsdk = resolveTypeScriptTsdk(workspacePath)
  return {
    ...(tsdk ? { typescript: { tsdk } } : {}),
    vue: {
      hybridMode: false,
    },
  }
}

// ============ 服务器命令获取函数 ============
// 使用 installer.ts 中的 getInstalledServerPath 统一查找路径

async function getTypeScriptServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('typescript')
  if (serverPath) {
    logger.lsp.debug('[LSP Manager] TypeScript server path:', serverPath)
    return { command: process.execPath, args: [serverPath, '--stdio'] }
  }
  return null
}

async function getHtmlServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('html')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }
  return null
}

async function getCssServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('css')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }
  return null
}

async function getJsonServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('json')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }
  return null
}

// Python LSP (pyright)
async function getPythonServerCommand(): Promise<{ command: string; args: string[] } | null> {
  // 优先使用 pyright（通过 npm 安装）
  const serverPath = getInstalledServerPath('python')

  if (serverPath) {
    return { command: process.execPath, args: [serverPath, '--stdio'] }
  }

  // 检查系统是否有 pylsp
  if (commandExists('pylsp')) {
    return { command: 'pylsp', args: [] }
  }

  return null
}

// Go LSP (gopls)
async function getGoplsCommand(): Promise<{ command: string; args: string[] } | null> {
  // 检查已安装的 gopls
  const goplsPath = getInstalledServerPath('go')

  if (goplsPath) {
    return { command: goplsPath, args: [] }
  }

  // 检查系统 PATH
  if (commandExists('gopls')) {
    return { command: 'gopls', args: [] }
  }

  // 检查 GOPATH/bin
  const goplsName = getExecutableName('gopls')
  const goPathBin = process.env.GOPATH ? path.join(process.env.GOPATH, 'bin', goplsName) : null

  if (goPathBin && fs.existsSync(goPathBin)) {
    return { command: goPathBin, args: [] }
  }

  return null
}

// Rust LSP (rust-analyzer)
async function getRustAnalyzerCommand(): Promise<{ command: string; args: string[] } | null> {
  if (commandExists('rust-analyzer')) {
    return { command: 'rust-analyzer', args: [] }
  }

  const raName = getExecutableName('rust-analyzer')
  const cargoHome =
    process.env.CARGO_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '', '.cargo')
  const raPath = path.join(cargoHome, 'bin', raName)

  if (fs.existsSync(raPath)) {
    return { command: raPath, args: [] }
  }

  return null
}

// C/C++ LSP (clangd)
async function getClangdCommand(): Promise<{ command: string; args: string[] } | null> {
  if (commandExists('clangd')) {
    return { command: 'clangd', args: ['--background-index', '--clang-tidy'] }
  }

  return null
}

// Vue LSP (vue-language-server)
async function getVueServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('vue')
  if (serverPath) return { command: process.execPath, args: [serverPath, '--stdio'] }

  // 尝试全局安装的 vue-language-server
  if (commandExists('vue-language-server')) {
    return { command: 'vue-language-server', args: ['--stdio'] }
  }

  return null
}

// Zig LSP (zls)
async function getZlsCommand(): Promise<{ command: string; args: string[] } | null> {
  const zlsPath = getInstalledServerPath('zig')
  if (zlsPath) return { command: zlsPath, args: [] }

  if (commandExists('zls')) {
    return { command: 'zls', args: [] }
  }

  return null
}

// C# LSP (csharp-ls)
async function getCsharpLsCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('csharp')
  if (serverPath) return { command: serverPath, args: [] }

  if (commandExists('csharp-ls')) {
    return { command: 'csharp-ls', args: [] }
  }

  return null
}

// Deno LSP
async function getDenoCommand(): Promise<{ command: string; args: string[] } | null> {
  if (commandExists('deno')) {
    return { command: 'deno', args: ['lsp'] }
  }

  return null
}

// PHP LSP (intelephense)
async function getPhpServerCommand(): Promise<{ command: string; args: string[] } | null> {
  const serverPath = getInstalledServerPath('php')
  if (serverPath) {
    return { command: process.execPath, args: [serverPath, '--stdio'] }
  }

  // 检查全局安装的 intelephense
  if (commandExists('intelephense')) {
    return { command: 'intelephense', args: ['--stdio'] }
  }

  return null
}

// ============ 服务器配置 ============

const LSP_SERVERS: LspServerConfig[] = [
  {
    name: 'typescript',
    languages: ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'],
    getCommand: getTypeScriptServerCommand,
    // 智能根目录检测：查找 package.json 或 lock 文件，排除 deno 项目
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['package-lock.json', 'bun.lockb', 'bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package.json'],
        ['deno.json', 'deno.jsonc'] // 排除 Deno 项目
      )
      return root || workspacePath
    },
  },
  {
    name: 'html',
    languages: ['html'],
    getCommand: getHtmlServerCommand,
  },
  {
    name: 'css',
    languages: ['css', 'scss', 'less'],
    getCommand: getCssServerCommand,
  },
  {
    name: 'json',
    languages: ['json', 'jsonc'],
    getCommand: getJsonServerCommand,
  },
  {
    name: 'python',
    languages: ['python'],
    getCommand: getPythonServerCommand,
    // 智能根目录检测：查找 Python 项目配置文件
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile', 'pyrightconfig.json']
      )
      return root || workspacePath
    },
  },
  {
    name: 'go',
    languages: ['go'],
    getCommand: getGoplsCommand,
    // 智能根目录检测：优先查找 go.work，然后 go.mod
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      // 先查找 go.work（工作空间模式）
      const workRoot = await findNearestRoot(fileDir, workspacePath, ['go.work'])
      if (workRoot) return workRoot
      // 再查找 go.mod
      const modRoot = await findNearestRoot(fileDir, workspacePath, ['go.mod', 'go.sum'])
      return modRoot || workspacePath
    },
  },
  {
    name: 'rust',
    languages: ['rust'],
    getCommand: getRustAnalyzerCommand,
    // 智能根目录检测：查找 Cargo.toml，优先查找 workspace
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const crateRoot = await findNearestRoot(fileDir, workspacePath, ['Cargo.toml', 'Cargo.lock'])
      if (!crateRoot) return workspacePath

      // 向上查找 workspace 根目录
      let currentDir = crateRoot
      while (currentDir.length >= workspacePath.length) {
        const cargoTomlPath = path.join(currentDir, 'Cargo.toml')
        if (fs.existsSync(cargoTomlPath)) {
          try {
            const content = fs.readFileSync(cargoTomlPath, 'utf-8')
            if (content.includes('[workspace]')) {
              return currentDir
            }
          } catch (e) { logger.lsp.debug('Failed to find .git directory:', e) }
        }
        const parentDir = path.dirname(currentDir)
        if (parentDir === currentDir) break
        currentDir = parentDir
      }

      return crateRoot
    },
  },
  {
    name: 'clangd',
    languages: ['cpp', 'c'],
    getCommand: getClangdCommand,
    // 智能根目录检测：查找编译数据库或构建配置
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['compile_commands.json', 'compile_flags.txt', '.clangd', 'CMakeLists.txt', 'Makefile']
      )
      return root || workspacePath
    },
  },
  {
    name: 'vue',
    languages: ['vue'],
    getCommand: getVueServerCommand,
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['package-lock.json', 'bun.lockb', 'bun.lock', 'pnpm-lock.yaml', 'yarn.lock', 'package.json']
      )
      return root || workspacePath
    },
  },
  {
    name: 'zig',
    languages: ['zig'],
    getCommand: getZlsCommand,
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(fileDir, workspacePath, ['build.zig', 'build.zig.zon'])
      return root || workspacePath
    },
  },
  {
    name: 'csharp',
    languages: ['csharp'],
    getCommand: getCsharpLsCommand,
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(fileDir, workspacePath, ['*.sln', '*.csproj'])
      return root || workspacePath
    },
  },
  {
    name: 'deno',
    languages: [], // 不注册为默认服务器，通过 findBestRoot 动态选择
    getCommand: getDenoCommand,
    // Deno 项目检测：查找 deno.json 或 deno.jsonc
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(fileDir, workspacePath, ['deno.json', 'deno.jsonc'])
      return root || null // 找不到 deno.json 返回 null，表示不应该使用 Deno LSP
    },
  },
  {
    name: 'php',
    languages: ['php'],
    getCommand: getPhpServerCommand,
    // 智能根目录检测：查找 PHP 项目配置文件
    findRoot: async (filePath, workspacePath) => {
      const fileDir = path.dirname(filePath)
      const root = await findNearestRoot(
        fileDir,
        workspacePath,
        ['composer.json', 'composer.lock', 'phpunit.xml', 'phpstan.neon']
      )
      return root || workspacePath
    },
  },
]

// ============ LSP 管理器 ============

class LspManager {
  private servers: Map<string, LspServerInstance> = new Map() // key: serverName:workspacePath
  private languageToServer: Map<LanguageId, string> = new Map()
  private documentVersions: Map<string, number> = new Map() // 启用文档版本管理
  private diagnosticsCache: CacheService<any[]>
  private startingServers: Set<string> = new Set()

  // 主动停止中的服务器：close 回调据此跳过自动重启，避免「停掉又拉起」的抖动
  private stoppingServers: Set<string> = new Set()

  // 跟踪每个服务器打开的文档
  private serverOpenedDocuments: Map<string, Map<string, { languageId: string; version: number; text: string }>> = new Map()

  // 空闲关闭配置
  private serverLastActivity: Map<string, number> = new Map()
  private idleCheckInterval: NodeJS.Timeout | null = null
  private static readonly IDLE_TIMEOUT_MS = 2 * 60 * 1000 // 2 分钟无活动则关闭

  // 自动重启配置
  private static readonly MAX_CRASH_COUNT = 3
  private static readonly CRASH_COOLDOWN_MS = LSP_DEFAULTS.crashCooldownMs

  // 崩溃计数按 key 跨实例保存：重启会新建 instance，计数若只挂在实例上
  // 就永远是 1，MAX_CRASH_COUNT 形同虚设，坏掉的服务器会被无限重启
  private crashHistory: Map<string, { count: number; lastTime: number }> = new Map()

  /**
   * 同时运行的 LSP 进程上限。
   *
   * 语言服务器的 key 含根目录，monorepo 里每个子项目都有自己的 package.json /
   * tsconfig.json，同一语言会被拆成多个实例，而每个实例都是完整的语言服务进程
   * （单个 tsserver 常在 150MB 以上）。AI 在一次任务里跨子项目读写文件时，
   * 这些实例会一个接一个地被拉起并长期保活，任务管理器里就会出现八九个主程序
   * 子进程、内存一路走高。这里统一收敛为「每种语言一个实例 + 全局上限」。
   */
  private static readonly MAX_RUNNING_SERVERS = 4

  // waitForDiagnostics 相关
  private diagnosticsWaiters: Map<string, { resolve: () => void; timeout: NodeJS.Timeout }[]> = new Map()
  private static readonly DIAGNOSTICS_DEBOUNCE_MS = 100
  private static readonly DIAGNOSTICS_TIMEOUT_MS = 3000

  // 记录启动失败的冷却时间（防止无限重试轰炸日志）
  private unavailableServers: Map<string, number> = new Map()

  constructor() {
    // 初始化诊断缓存
    const cacheConfig = getCacheConfig('lspDiagnostics')
    this.diagnosticsCache = new CacheService<any[]>('LspDiagnostics', {
      maxSize: cacheConfig.maxSize,
      defaultTTL: cacheConfig.ttlMs,
      evictionPolicy: cacheConfig.evictionPolicy || 'lru',
      cleanupInterval: cacheConfig.cleanupInterval || 0,
    })

    for (const config of LSP_SERVERS) {
      for (const lang of config.languages) {
        this.languageToServer.set(lang, config.name)
      }
    }

    // 启动空闲检查定时器
    this.startIdleCheck()
  }

  /**
   * 设置诊断缓存
   */
  private setDiagnosticsCache(uri: string, diagnostics: any[]): void {
    this.diagnosticsCache.set(uri, diagnostics)
  }

  private startIdleCheck() {
    if (this.idleCheckInterval) return

    this.idleCheckInterval = setInterval(() => {
      const now = Date.now()
      for (const [key, lastActivity] of this.serverLastActivity) {
        if (now - lastActivity > LspManager.IDLE_TIMEOUT_MS) {
          const instance = this.servers.get(key)
          if (instance && instance.initialized) {
            logger.lsp.info(`[LSP ${key}] Stopping idle server (inactive for ${Math.round((now - lastActivity) / 1000)}s)`)
            this.stopServerByKey(key)
          }
        }
      }
    }, 30000) // 每 30s 巡检一次，让空闲阈值在实际释放时点上不被巡检间隔明显放大
  }

  private updateActivity(key: string) {
    this.serverLastActivity.set(key, Date.now())
  }

  private getInstanceKey(serverName: string, workspacePath: string): string {
    return `${serverName}:${workspacePath.replace(/\\/g, '/')}`
  }

  /**
   * 查找该语言已就绪的实例 key。
   *
   * 语言服务的 key 带根目录，但一个进程完全可以服务同一语言的多个根目录，
   * 而多开一个进程的代价是多一份完整语言服务的常驻内存。这里按语言收敛。
   */
  private findReusableServerKey(serverName: string): string | null {
    for (const [key, instance] of this.servers) {
      if (
        instance.config.name === serverName &&
        instance.initialized &&
        instance.process &&
        instance.process.exitCode === null &&
        !instance.process.killed
      ) {
        return key
      }
    }
    return null
  }

  /**
   * 计算调用方应使用的实例 key：已有同语言实例就用它的 key，否则按根目录新建。
   *
   * startServer 内部会在复用时跳过 spawn，但 key 仍按传入的根目录算，
   * 调用方拿这个 key 发通知就会打到一个不存在的实例上，因此必须统一在这里解析。
   */
  private resolveServerKey(serverName: string, workspacePath: string): string {
    return this.findReusableServerKey(serverName) ?? this.getInstanceKey(serverName, workspacePath)
  }

  /**
   * 回收最久未活动的实例，把运行中的 LSP 进程数压到上限以内。
   *
   * 只在新进程即将拉起时触发，且挑的是最久没人用的那个，不会打断正在服务请求的实例。
   */
  private async evictLeastActiveServer(): Promise<void> {
    if (this.servers.size < LspManager.MAX_RUNNING_SERVERS) return

    let victimKey: string | null = null
    let victimActivity = Number.POSITIVE_INFINITY

    for (const [key, instance] of this.servers) {
      // 正在启动的不动，避免刚起来就被回收
      if (!instance.initialized || this.startingServers.has(key)) continue
      const activity = this.serverLastActivity.get(key) ?? 0
      if (activity < victimActivity) {
        victimActivity = activity
        victimKey = key
      }
    }

    if (!victimKey) return

    logger.lsp.info(
      `[LSP ${victimKey}] Evicting least-recently-used server (limit ${LspManager.MAX_RUNNING_SERVERS})`,
    )
    await this.stopServerByKey(victimKey)
  }

  getServerForLanguage(languageId: LanguageId): string | undefined {
    return this.languageToServer.get(languageId)
  }

  /** 同语言启动请求的串行队列：并发请求排队，避免各自拉起一个进程 */
  private startQueues: Map<string, Promise<boolean>> = new Map()

  async startServer(serverName: string, workspacePath: string): Promise<boolean> {
    const previous = this.startQueues.get(serverName)
    const task = (previous ?? Promise.resolve(false))
      .catch(() => false)
      .then(() => this.startServerCore(serverName, workspacePath))

    this.startQueues.set(serverName, task)
    try {
      return await task
    } finally {
      if (this.startQueues.get(serverName) === task) {
        this.startQueues.delete(serverName)
      }
    }
  }

  private async startServerCore(serverName: string, workspacePath: string): Promise<boolean> {
    const key = this.getInstanceKey(serverName, workspacePath)
    const existing = this.servers.get(key)

    if (existing?.process && existing.initialized) {
      this.updateActivity(key)
      return true
    }

    // 同一语言已有可用实例 → 复用，不再按根目录分裂出第二个进程
    const reusableKey = this.findReusableServerKey(serverName)
    if (reusableKey) {
      this.updateActivity(reusableKey)
      return true
    }

    // 如果最近短时间内启动失败过，直接返回避免刷日志 (冷却时间 60s)
    const lastFailed = this.unavailableServers.get(key)
    if (lastFailed && Date.now() - lastFailed < 60000) {
      return false
    }

    if (this.startingServers.has(key)) {
      await new Promise(resolve => setTimeout(resolve, 200))
      return this.servers.get(key)?.initialized || false
    }

    const config = LSP_SERVERS.find(c => c.name === serverName)
    if (!config) return false

    // 拉起新进程前先确保没有超出全局上限，避免语言种类多时进程堆积
    await this.evictLeastActiveServer()

    this.startingServers.add(key)
    try {
      const success = await this.spawnServer(config, workspacePath)
      if (!success) {
        this.unavailableServers.set(key, Date.now())
      } else {
        this.unavailableServers.delete(key)
      }
      return success
    } finally {
      this.startingServers.delete(key)
    }
  }

  private async spawnServer(config: LspServerConfig, workspacePath: string): Promise<boolean> {
    const cmdInfo = await config.getCommand()
    if (!cmdInfo) {
      logger.lsp.warn(`[LSP ${config.name}] No command available for server`)
      return false
    }

    const { command, args } = cmdInfo
    const key = this.getInstanceKey(config.name, workspacePath)

    // TS 系服务器的运行时预检：typescript 7 起不再提供 tsserverlibrary.js，
    // 服务端会在打开文件时抛 TypeError 退出。这里提前拦下，给出可执行的提示，
    // 而不是让它反复崩溃重启刷日志
    if (isServerRuntimeBroken(config.name, args[0] ?? null)) {
      logger.lsp.error(
        `[LSP ${config.name}] TypeScript runtime is unusable (missing tsserverlibrary.js). ` +
          `请到「设置 → 语言服务器」重新安装该服务。`,
        { command, script: args[0] },
      )
      return false
    }

    // 使用 ELECTRON_RUN_AS_NODE=1 让 Electron 作为纯 Node.js 运行时工作
    const proc = spawn(command, args, {
      cwd: workspacePath,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
      // GUI 进程没有控制台可继承，不显式隐藏会在 Windows 上闪出子进程控制台窗口
      windowsHide: true,
    })

    if (!proc.stdout || !proc.stdin) return false

    // 冷却窗口内的历史崩溃次数要继承下来，否则重启后的新实例总是从 0 开始，
    // 崩溃上限永远达不到，进程会被无限拉起
    const prevCrash = this.crashHistory.get(key)
    const inheritedCrash =
      prevCrash && Date.now() - prevCrash.lastTime <= LspManager.CRASH_COOLDOWN_MS
        ? prevCrash.count
        : 0

    const instance: LspServerInstance = {
      config,
      process: proc,
      requestId: 0,
      pendingRequests: new Map(),
      buffer: Buffer.alloc(0),
      contentLength: -1,
      initialized: false,
      workspacePath,
      crashCount: inheritedCrash,
      lastCrashTime: inheritedCrash > 0 ? prevCrash!.lastTime : 0,
    }

    this.servers.set(key, instance)
    // 启动即写入活动时间：否则该 key 不会进入空闲巡检，进程将永远不被回收
    this.serverLastActivity.set(key, Date.now())

    logger.lsp.debug(`[LSP ${key}] Starting process: ${command} ${args.join(' ')}`)

    proc.on('error', (err) => {
      logger.lsp.error(`[LSP ${key}] Process spawn error:`, toAppError(err).message)
    })

    proc.stdout.on('data', (data: Buffer) => this.handleServerOutput(key, data))
    proc.stderr?.on('data', (data: Buffer) => {
      const msg = data.toString().trim()
      if (msg) logger.lsp.warn(`[LSP ${key}] STDERR:`, msg)
    })

    proc.on('close', (code, signal) => {
      logger.lsp.debug(`[LSP ${key}] Closed with code: ${code}, signal: ${signal ?? 'none'}`)

      const current = this.servers.get(key)
      const isCurrent = current === instance
      if (isCurrent) {
        this.servers.delete(key)
        this.serverLastActivity.delete(key)
        this.serverOpenedDocuments.delete(key)
      }

      // 主动停止（空闲回收 / 工作空间切换 / 初始化失败）不重启，
      // 否则 kill 出来的非零退出码会让进程刚停就被拉回来
      const wasStopping = this.stoppingServers.delete(key)
      if (wasStopping || !isCurrent) return

      // 自动重启逻辑
      if (code !== 0 && code !== null) {
        const now = Date.now()

        // 如果距离上次崩溃超过冷却时间，重置计数
        if (now - instance.lastCrashTime > LspManager.CRASH_COOLDOWN_MS) {
          instance.crashCount = 1
        } else {
          instance.crashCount++
        }
        instance.lastCrashTime = now

        // 计数写回 key 级别，供下一次 spawn 继承
        this.crashHistory.set(key, { count: instance.crashCount, lastTime: now })

        // 只有在崩溃次数未超限时才重启
        if (instance.crashCount <= LspManager.MAX_CRASH_COUNT) {
          const delay = Math.min(1000 * instance.crashCount, 5000) // 递增延迟，最大 5 秒
          logger.lsp.warn(
            `[LSP ${key}] Server crashed (${instance.crashCount}/${LspManager.MAX_CRASH_COUNT}, ` +
              `code=${code}, signal=${signal ?? 'none'}), restarting in ${delay}ms...`,
          )

          setTimeout(() => {
            // 再次检查是否应该重启（可能已换成另一个实例）
            if (!this.servers.has(key)) {
              this.startServer(instance.config.name, instance.workspacePath).catch(e => {
                logger.lsp.error(`[LSP ${key}] Restart failed:`, e)
              })
            }
          }, delay)
        } else {
          // 放弃重启后清掉计数，下一次显式请求重新获得完整的重试额度
          this.crashHistory.delete(key)
          logger.lsp.error(
            `[LSP ${key}] Server crashed ${instance.crashCount} times, giving up. ` +
              `最后一次退出码 code=${code}，请检查该语言服务器安装是否完整。`,
          )
        }
      } else {
        // 正常退出（code 0 或收到信号）不累计崩溃，避免把主动回收算成故障
        this.crashHistory.delete(key)
      }
    })

    proc.stdin.on('error', (err) => logger.lsp.warn(`[LSP ${key}] stdin error:`, toAppError(err).message))

    try {
      await this.initializeServer(key, workspacePath)
      instance.initialized = true
      // 初始化成功即视为健康，清掉历史崩溃计数，避免偶发失败长期占用重试额度
      this.crashHistory.delete(key)
      logger.lsp.debug(`[LSP ${key}] Initialized successfully`)
      return true
    } catch (err) {
      logger.lsp.error(`[LSP ${key}] Init failed:`, toAppError(err).message)
      this.stopServerByKey(key)
      return false
    }
  }

  private handleServerOutput(key: string, data: Buffer): void {
    const instance = this.servers.get(key)
    if (!instance) return

    instance.buffer = Buffer.concat([instance.buffer, data])

    while (true) {
      if (instance.contentLength === -1) {
        const headerEnd = instance.buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return

        const header = instance.buffer.slice(0, headerEnd).toString('utf8')
        const match = header.match(/Content-Length:\s*(\d+)/i)
        if (match) {
          instance.contentLength = parseInt(match[1], 10)
          instance.buffer = instance.buffer.slice(headerEnd + 4)
        } else {
          instance.buffer = instance.buffer.slice(headerEnd + 4)
          continue
        }
      }

      if (instance.contentLength === -1 || instance.buffer.length < instance.contentLength) return

      const message = instance.buffer.slice(0, instance.contentLength).toString('utf8')
      instance.buffer = instance.buffer.slice(instance.contentLength)
      instance.contentLength = -1

      try {
        this.handleServerMessage(key, JSON.parse(message))
      } catch (e) { logger.lsp.warn('Failed to parse LSP message:', e) }
    }
  }

  private handleServerMessage(key: string, message: any): void {
    const instance = this.servers.get(key)
    if (!instance) return

    // 带 method 的一律是服务器发起的消息，不带 method 才是我们请求的响应。
    // 必须先按 method 分流：两台机器的 id 各自从 0 自增，服务器请求的 id 很容易
    // 撞上某个在途客户端请求的 id，此时若先按 id 匹配，configuration 这类请求会被
    // 当成响应吞掉且永不回包 —— 服务端在等它，hover 就永远停在加载态。
    if (message.method !== undefined) {
      if (message.id !== undefined) {
        this.handleServerRequest(key, instance, message)
      } else {
        this.handleNotification(key, message)
      }
      return
    }

    if (message.id !== undefined && instance.pendingRequests.has(message.id)) {
      const { resolve, reject, timeout } = instance.pendingRequests.get(message.id)!
      instance.pendingRequests.delete(message.id)
      clearTimeout(timeout)
      if (message.error) reject(message.error)
      else resolve(message.result)
    }
  }

  /**
   * 回应服务器发起的请求。
   *
   * 服务器在等客户端回包期间会阻塞相关能力（vscode-jsonrpc 里这类请求的
   * promise 不 resolve，后续依赖它的请求就不会返回），所以这里的原则是：
   * 认识的给出配置，不认识的也必须回一个 null，绝不静默丢弃。
   */
  private handleServerRequest(key: string, instance: LspServerInstance, message: any): void {
    const respond = (result: unknown): void => {
      const body = JSON.stringify({ jsonrpc: '2.0', id: message.id, result })
      const responseMessage = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
      try {
        if (instance.process?.stdin) {
          instance.process.stdin.write(responseMessage)
        }
      } catch (e) {
        logger.lsp.error(`[LSP ${key}] Failed to respond to ${message.method}:`, e)
      }
    }

    if (message.method === 'workspace/configuration') {
      const items = message.params?.items || []
      const settings = items.map((item: any) => {
        const section = item.section || ''

        // Python (Pyright)
        if (section === 'python' || section.startsWith('python.')) {
          return {
            pythonPath: pythonManager.getPythonPath() || (process.platform === 'win32' ? 'python' : 'python3'),
            analysis: {
              typeCheckingMode: 'basic',
              diagnosticMode: 'openFilesOnly',
              autoSearchPaths: true,
              useLibraryCodeForTypes: true,
              diagnosticSeverityOverrides: {}
            }
          }
        }

        // Rust (rust-analyzer)
        if (section === 'rust-analyzer' || section.startsWith('rust-analyzer.')) {
          return {
            checkOnSave: {
              command: 'clippy'
            },
            cargo: {
              allFeatures: false
            },
            procMacro: {
              enable: true
            }
          }
        }

        // PHP (Intelephense)
        if (section === 'intelephense' || section.startsWith('intelephense.')) {
          return {
            files: {
              maxSize: 1000000
            },
            diagnostics: {
              enable: true
            },
            completion: {
              insertUseDeclaration: true,
              fullyQualifyGlobalConstantsAndFunctions: false
            }
          }
        }

        // Vue (Volar)：tsdk 必须指向真实的 TypeScript lib 目录，
        // 否则内部 tsserver 起不来，hover / 补全 / 跳转全部无响应直到超时
        if (
          instance.config.name === 'vue' &&
          (section === 'vue' || section.startsWith('volar.') ||
            section === 'typescript' || section.startsWith('typescript.'))
        ) {
          return buildVueConfig(instance.workspacePath)
        }

        return null
      })

      respond(settings)
      return
    }

    // workspace/workspaceFolders：回当前实例绑定的工作空间
    if (message.method === 'workspace/workspaceFolders') {
      const rootPath = instance.workspacePath?.replace(/\\/g, '/')
      respond(rootPath ? [{ uri: `file://${rootPath}`, name: path.basename(rootPath) }] : null)
      return
    }

    // 其余请求（client/registerCapability、window/workDoneProgress/create、
    // window/showMessageRequest 等）不需要额外处理，但必须回包解除阻塞
    logger.lsp.debug(`[LSP ${key}] Unhandled server request, replied null: ${message.method}`)
    respond(null)
  }

  private handleNotification(key: string, message: any): void {
    if (message.method === 'textDocument/publishDiagnostics') {
      let { uri, diagnostics } = message.params

      // 规范化 URI：处理不同 LSP 服务器返回的 URI 格式差异
      uri = normalizeLspUri(uri)

      this.setDiagnosticsCache(uri, diagnostics)

      // 通知等待诊断的调用者
      this.notifyDiagnosticsWaiters(uri)

      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          try {
            win.webContents.send('lsp:diagnostics', { uri, diagnostics, serverKey: key })
          } catch (e) { logger.lsp.debug('Failed to send diagnostics to renderer:', e) }
        }
      })
    }
  }

  /**
   * 通知等待诊断的调用者（带防抖）
   */
  private notifyDiagnosticsWaiters(uri: string): void {
    const waiters = this.diagnosticsWaiters.get(uri)
    if (!waiters || waiters.length === 0) return

    // 使用防抖，等待 LSP 发送后续诊断（如语义诊断在语法诊断之后）
    for (const waiter of waiters) {
      clearTimeout(waiter.timeout)
      waiter.timeout = setTimeout(() => {
        waiter.resolve()
        // 从等待列表中移除
        const idx = waiters.indexOf(waiter)
        if (idx >= 0) waiters.splice(idx, 1)
        if (waiters.length === 0) this.diagnosticsWaiters.delete(uri)
      }, LspManager.DIAGNOSTICS_DEBOUNCE_MS)
    }
  }

  /**
   * 等待指定文件的诊断信息
   */
  async waitForDiagnostics(uri: string): Promise<void> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // 超时后自动 resolve
        const waiters = this.diagnosticsWaiters.get(uri)
        if (waiters) {
          const idx = waiters.findIndex(w => w.resolve === resolve)
          if (idx >= 0) waiters.splice(idx, 1)
          if (waiters.length === 0) this.diagnosticsWaiters.delete(uri)
        }
        resolve()
      }, LspManager.DIAGNOSTICS_TIMEOUT_MS)

      if (!this.diagnosticsWaiters.has(uri)) {
        this.diagnosticsWaiters.set(uri, [])
      }
      this.diagnosticsWaiters.get(uri)!.push({ resolve, timeout })
    })
  }

  sendRequest(key: string, method: string, params: any, timeoutMs = 30000): Promise<any> {
    // 更新活动时间
    this.updateActivity(key)

    return new Promise((resolve, reject) => {
      const instance = this.servers.get(key)
      if (!instance?.process?.stdin || !instance.process.stdin.writable) {
        reject(new Error(`Server ${key} not running`))
        return
      }

      const id = ++instance.requestId
      const timeout = setTimeout(() => {
        instance.pendingRequests.delete(id)
        reject(new Error(`Request ${method} timed out`))
      }, timeoutMs)

      instance.pendingRequests.set(id, { resolve, reject, timeout })
      const body = JSON.stringify({ jsonrpc: '2.0', id, method, params })
      const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`

      try {
        instance.process.stdin.write(message)
      } catch (err) {
        instance.pendingRequests.delete(id)
        clearTimeout(timeout)
        reject(err)
      }
    })
  }

  sendNotification(key: string, method: string, params: any): void {
    // 更新活动时间
    this.updateActivity(key)

    const instance = this.servers.get(key)
    if (!instance?.process?.stdin || !instance.process.stdin.writable) return

    const body = JSON.stringify({ jsonrpc: '2.0', method, params })
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`

    try { instance.process.stdin.write(message) } catch (e) { logger.lsp.warn('Failed to write to LSP stdin:', e) }
  }

  private async initializeServer(key: string, workspacePath: string): Promise<void> {
    const normalizedPath = workspacePath.replace(/\\/g, '/')
    const rootUri = /^[a-zA-Z]:/.test(normalizedPath) ? `file:///${normalizedPath}` : `file://${normalizedPath}`

    const instance = this.servers.get(key)
    const serverName = instance?.config.name

    // 为 Pyright 添加 Python 解释器配置；为 Volar 指定 TypeScript SDK
    const initializationOptions = serverName === 'python' ? {
      python: {
        pythonPath: pythonManager.getPythonPath() || (process.platform === 'win32' ? 'python' : 'python3'),
      },
    } : serverName === 'vue' ? buildVueConfig(workspacePath) : undefined

    await this.sendRequest(key, 'initialize', {
      processId: process.pid,
      rootUri,
      capabilities: this.getClientCapabilities(),
      workspaceFolders: [{ uri: rootUri, name: path.basename(workspacePath) }],
      ...(initializationOptions && { initializationOptions }),
    }, 60000)

    this.sendNotification(key, 'initialized', {})

    // 为 Pyright 发送配置
    if (serverName === 'python') {
      this.sendNotification(key, 'workspace/didChangeConfiguration', {
        settings: {
          python: {
            pythonPath: pythonManager.getPythonPath() || (process.platform === 'win32' ? 'python' : 'python3'),
            analysis: {
              typeCheckingMode: 'basic',
              diagnosticMode: 'openFilesOnly',
              autoSearchPaths: true,
              useLibraryCodeForTypes: true,
              diagnosticSeverityOverrides: {}
            }
          }
        }
      })
    }

    // Volar 在 initialized 之后还会再读一次配置，两处保持一致
    if (serverName === 'vue') {
      this.sendNotification(key, 'workspace/didChangeConfiguration', {
        settings: buildVueConfig(workspacePath),
      })
    }
  }

  private getClientCapabilities(): any {
    return {
      textDocument: {
        synchronization: { openClose: true, change: 2, save: { includeText: true } },
        completion: { completionItem: { snippetSupport: true, documentationFormat: ['markdown', 'plaintext'] }, contextSupport: true },
        hover: { contentFormat: ['markdown', 'plaintext'] },
        signatureHelp: { signatureInformation: { documentationFormat: ['markdown', 'plaintext'] } },
        definition: { linkSupport: true },
        typeDefinition: { linkSupport: true },
        implementation: { linkSupport: true },
        references: {},
        documentHighlight: {},
        documentSymbol: { hierarchicalDocumentSymbolSupport: true },
        codeAction: { codeActionLiteralSupport: { codeActionKind: { valueSet: ['quickfix', 'refactor', 'source'] } } },
        formatting: {},
        rangeFormatting: {},
        rename: { prepareSupport: true },
        foldingRange: {},
        publishDiagnostics: { relatedInformation: true },
        // Call Hierarchy 支持
        callHierarchy: {
          dynamicRegistration: false,
        },
        // Inlay Hints 支持
        inlayHint: {
          dynamicRegistration: false,
        },
      },
      workspace: {
        workspaceFolders: true,
        applyEdit: true,
        configuration: true,
        // 文件监视支持
        didChangeWatchedFiles: {
          dynamicRegistration: false,
        },
      },
    }
  }

  async stopServerByKey(key: string): Promise<void> {
    const instance = this.servers.get(key)
    if (!instance?.process) return

    // 清除该服务器相关的诊断缓存（按前缀删除）
    const workspaceUri = `file:///${instance.workspacePath.replace(/\\/g, '/')}`
    const altUri = workspaceUri.replace('file:///', 'file://')

    // 获取要删除的 URI 列表
    const urisToDelete = this.diagnosticsCache.keys().filter(
      uri => uri.startsWith(workspaceUri) || uri.startsWith(altUri)
    )

    for (const uri of urisToDelete) {
      this.diagnosticsCache.delete(uri)
      // 通知前端清除诊断
      BrowserWindow.getAllWindows().forEach((win) => {
        if (!win.isDestroyed()) {
          try {
            win.webContents.send('lsp:diagnostics', { uri, diagnostics: [], serverKey: key })
          } catch { }
        }
      })
    }

    // 清除文档跟踪（服务器关闭后文档状态无效）
    this.serverOpenedDocuments.delete(key)

    // 标记为主动停止：kill 产生的非零退出码不应触发自动重启
    this.stoppingServers.add(key)

    try {
      await this.sendRequest(key, 'shutdown', null, 3000)
      this.sendNotification(key, 'exit', null)
    } catch (e) { logger.lsp.debug('LSP shutdown failed:', e) }
    // 必须按进程树终止：typescript-language-server 启动后还会 fork 出
    // tsserver（可能有多个实例）与 typingsInstaller，只 kill 直接子进程时
    // 这些孙进程会被 init 收养继续存活。Windows 上它们与主程序同名，
    // 表现为任务管理器里「任务已完成但 AweeClaw 进程不消失」。
    hardKillProcessTree(instance.process.pid)
    // 进程早已退出时不会再触发 close 回调，这里兜底清掉标记，避免集合里留下死 key
    if (instance.process.exitCode !== null) {
      this.stoppingServers.delete(key)
    }
    this.servers.delete(key)
    this.serverLastActivity.delete(key)
    this.serverOpenedDocuments.delete(key)

    logger.lsp.info(`[LSP ${key}] Server stopped and diagnostics cleared`)
  }

  async stopAllServers(): Promise<void> {
    // 停止空闲检查
    if (this.idleCheckInterval) {
      clearInterval(this.idleCheckInterval)
      this.idleCheckInterval = null
    }
    await Promise.all(Array.from(this.servers.keys()).map(key => this.stopServerByKey(key)))
  }

  async ensureServerForLanguage(languageId: LanguageId, workspacePath: string): Promise<string | null> {
    const serverName = this.getServerForLanguage(languageId)
    if (!serverName) return null
    const success = await this.startServer(serverName, workspacePath)
    return success ? this.resolveServerKey(serverName, workspacePath) : null
  }

  getRunningServers(): string[] {
    return Array.from(this.servers.keys())
  }

  getDiagnostics(uri: string): any[] {
    return this.diagnosticsCache.get(uri) ?? []
  }

  getDiagnosticsCacheStats() {
    return this.diagnosticsCache.getStats()
  }

  // 文档版本管理
  getDocumentVersion(uri: string): number {
    return this.documentVersions.get(uri) || 0
  }

  incrementDocumentVersion(uri: string): number {
    const current = this.documentVersions.get(uri) || 0
    const next = current + 1
    this.documentVersions.set(uri, next)
    return next
  }

  resetDocumentVersion(uri: string): void {
    this.documentVersions.delete(uri)
  }

  // 跟踪文档打开状态
  trackDocumentOpen(serverKey: string, uri: string, languageId: string, version: number, text: string): void {
    if (!this.serverOpenedDocuments.has(serverKey)) {
      this.serverOpenedDocuments.set(serverKey, new Map())
    }
    this.serverOpenedDocuments.get(serverKey)!.set(uri, { languageId, version, text })
  }

  trackDocumentChange(serverKey: string, uri: string, version: number, text: string): void {
    const docs = this.serverOpenedDocuments.get(serverKey)
    if (docs?.has(uri)) {
      const doc = docs.get(uri)!
      doc.version = version
      doc.text = text
    }
  }

  trackDocumentClose(serverKey: string, uri: string): void {
    this.serverOpenedDocuments.get(serverKey)?.delete(uri)
  }

  // 检查文档是否已在服务器上打开
  isDocumentOpen(serverKey: string, uri: string): boolean {
    return this.serverOpenedDocuments.get(serverKey)?.has(uri) || false
  }

  // 获取服务器打开的所有文档（用于重启后恢复）
  getOpenedDocuments(serverKey: string): Map<string, { languageId: string; version: number; text: string }> | undefined {
    return this.serverOpenedDocuments.get(serverKey)
  }

  // ============ Call Hierarchy 支持 ============

  /**
   * 准备调用层次结构
   * 返回指定位置的调用层次项
   */
  async prepareCallHierarchy(
    key: string,
    uri: string,
    line: number,
    character: number
  ): Promise<any[] | null> {
    try {
      const result = await this.sendRequest(key, 'textDocument/prepareCallHierarchy', {
        textDocument: { uri },
        position: { line, character },
      })
      return result || null
    } catch {
      return null
    }
  }

  /**
   * 获取调用当前函数的所有位置（谁调用了我）
   */
  async getIncomingCalls(key: string, item: any): Promise<any[] | null> {
    try {
      const result = await this.sendRequest(key, 'callHierarchy/incomingCalls', { item })
      return result || null
    } catch {
      return null
    }
  }

  /**
   * 获取当前函数调用的所有位置（我调用了谁）
   */
  async getOutgoingCalls(key: string, item: any): Promise<any[] | null> {
    try {
      const result = await this.sendRequest(key, 'callHierarchy/outgoingCalls', { item })
      return result || null
    } catch {
      return null
    }
  }

  // ============ 智能根目录检测 ============

  /**
   * 根据文件路径和语言获取最佳的工作空间根目录
   */
  async findBestRoot(filePath: string, languageId: LanguageId, workspacePath: string): Promise<string> {
    const serverName = this.getServerForLanguage(languageId)
    if (!serverName) return workspacePath

    const config = LSP_SERVERS.find(c => c.name === serverName)
    if (!config?.findRoot) return workspacePath

    try {
      const root = await config.findRoot(filePath, workspacePath)
      return root || workspacePath
    } catch {
      return workspacePath
    }
  }

  /**
   * 为指定文件启动 LSP 服务器（使用智能根目录检测）
   */
  async ensureServerForFile(filePath: string, languageId: LanguageId, workspacePath: string): Promise<string | null> {
    const serverName = this.getServerForLanguage(languageId)
    if (!serverName) return null

    // 使用智能根目录检测
    const bestRoot = await this.findBestRoot(filePath, languageId, workspacePath)
    const success = await this.startServer(serverName, bestRoot)
    // 复用已有实例时返回的是那个实例的 key，调用方据此发通知/请求
    return success ? this.resolveServerKey(serverName, bestRoot) : null
  }

  // ============ 文件监视通知 ============

  /**
   * 通知服务器文件变化
   */
  notifyDidChangeWatchedFiles(key: string, changes: Array<{ uri: string; type: number }>): void {
    this.sendNotification(key, 'workspace/didChangeWatchedFiles', { changes })
  }

  /**
   * 获取服务器配置
   */
  getServerConfig(serverName: string): LspServerConfig | undefined {
    return LSP_SERVERS.find(c => c.name === serverName)
  }

  /**
   * 获取所有支持的语言
   */
  getSupportedLanguages(): LanguageId[] {
    return Array.from(this.languageToServer.keys())
  }
}

export const lspManager = new LspManager()
