/**
 * Node.js 环境管理器
 *
 * 功能：
 * - 自动检测系统 Node.js（node / npx / npm）
 * - 系统未安装时，自动下载官方便携版 Node.js（从 nodejs.org）
 * - 提供统一的 node / npx / npm 路径给各消费方（MCP、终端、AI 脚本执行）
 * - 持久化路径缓存，避免重复下载
 *
 * 设计参考：与 PythonRuntimeManager 架构对齐
 * - 单例模式
 * - ensureReady() 异步初始化，幂等可重入
 * - electron-store 持久化缓存
 */

import { app } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import Store from 'electron-store'

// ============================================
// 常量
// ============================================

const store = new Store({ name: 'node-config' })

const CONFIG_KEY_NODE_PATH = 'nodePath'
const CONFIG_KEY_NPM_PATH = 'npmPath'
const CONFIG_KEY_NPX_PATH = 'npxPath'
const CONFIG_KEY_NODE_DIR = 'nodeDir'
const CONFIG_KEY_VERSION = 'version'

/** 便携版 Node.js 安装目录：{userData}/node-env/ */
const DEFAULT_NODE_DIR = path.join(app.getPath('userData'), 'node-env')

/**
 * 下载的 Node.js 大版本。
 * 使用 LTS 版本确保稳定性。如需升级，修改此常量即可。
 * 下载时取该大版本最新的小版本号（通过 index.json 解析）。
 */
const NODE_MAJOR_VERSION = 22

/** nodejs.org 官方索引文件，用于解析大版本对应的最新小版本号 */
const NODE_INDEX_URL = 'https://nodejs.org/dist/index.json'

/**
 * 后端服务器地址（从 aweeclaw-config.json 读取）
 *
 * 与 PythonRuntimeManager 共用同一份配置文件，
 * 客户端首次启动时由 appBootstrap 创建。
 */
function getBackendServerUrl(): string | null {
  try {
    const configPath = path.join(
      app.getPath('home'),
      '.aweeclaw',
      'aweeclaw-config.json',
    )
    if (!fs.existsSync(configPath)) return null
    const raw = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(raw)
    return config.serverUrl || null
  } catch {
    return null
  }
}

/**
 * 从后端 /api/v1/runtime-assets/resolve 解析推荐下载源
 *
 * 管理员在后台管理上传 Node.js 二进制到对象存储后，在此登记下载地址。
 * 客户端优先使用后端返回的地址，失败后回退到 nodejs.org 官方。
 *
 * @returns 下载地址（后端未登记则返回 null）
 */
async function resolveBackendAssetUrl(): Promise<string | null> {
  const serverUrl = getBackendServerUrl()
  if (!serverUrl) return null

  const platform = getPlatformKey()
  const url = `${serverUrl}/api/v1/runtime-assets/resolve?assetKey=node&platform=${platform}`

  try {
    const response = await fetch(url, { method: 'GET' })
    if (!response.ok) {
      logger.system.warn(`[NodeManager] Backend resolve node HTTP ${response.status}`)
      return null
    }
    const data = await response.json()
    if (data && data.downloadUrl) {
      logger.system.info(`[NodeManager] Backend resolved node: ${data.downloadUrl}`)
      return data.downloadUrl as string
    }
    return null
  } catch (err) {
    logger.system.warn(`[NodeManager] Backend resolve node failed:`, err)
    return null
  }
}

/** 下载超时（5 分钟），覆盖慢速网络场景 */
const DOWNLOAD_TIMEOUT_MS = 300_000

/** 解压超时（2 分钟） */
const EXTRACT_TIMEOUT_MS = 120_000

// ============================================
// 类型定义
// ============================================

export interface NodeStatus {
  /** 运行时是否就绪 */
  ready: boolean
  /** node 可执行文件绝对路径 */
  nodePath: string | null
  /** npm 可执行文件绝对路径 */
  npmPath: string | null
  /** npx 可执行文件绝对路径 */
  npxPath: string | null
  /** Node.js 来源：system（系统已安装）/ managed（自动下载）/ none */
  source: 'system' | 'managed' | 'none'
  /** Node.js 版本号（如 v22.11.0） */
  version: string | null
  /** 便携版 Node.js 根目录（bin 目录的父目录） */
  nodeDir: string | null
  /** bin 目录路径（包含 node/npm/npx 可执行文件） */
  binDir: string | null
  /** 已安装的全局 npm 包列表 */
  installedPackages: string[]
  /** 错误信息 */
  error?: string
}

// ============================================
// 平台工具函数
// ============================================

/** 获取平台标识，用于选择正确的下载包 */
function getPlatformKey(): string {
  const platform = process.platform
  const arch = process.arch
  // Node.js 官方包命名规则：
  // - darwin-arm64 / darwin-x64
  // - win-x64 / win-arm64（zip 包）
  // - linux-x64 / linux-arm64 / linux-armv7l
  if (platform === 'darwin') return `darwin-${arch}`
  if (platform === 'win32') return `win-${arch}`
  if (platform === 'linux') {
    if (arch === 'arm') return 'linux-armv7l'
    return `linux-${arch}`
  }
  return `${platform}-${arch}`
}

/** 获取平台对应的下载包扩展名 */
function getArchiveExtension(): '.tar.gz' | '.zip' {
  return process.platform === 'win32' ? '.zip' : '.tar.gz'
}

/** 获取可执行文件名（带扩展名） */
function getExecutableName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

/** 获取 npm/npx 的实际文件名（Windows 下是 .cmd 批处理） */
function getScriptName(base: string): string {
  return process.platform === 'win32' ? `${base}.cmd` : base
}

/**
 * 获取常见的二进制搜索目录。
 * 与 PythonRuntimeManager 保持一致，确保能找到系统安装的 Node.js。
 */
function getCommonBinaryDirs(): string[] {
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files\\nodejs',
      'C:\\Program Files (x86)\\nodejs',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs'),
      path.join(process.env.APPDATA || '', 'npm'),
    ]
  }
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/opt/local/bin',
    '/usr/bin',
    '/bin',
  ]
}

/**
 * 获取增强后的 PATH 环境变量字符串。
 * 合并系统 PATH 和常见二进制目录，确保能找到系统 Node.js。
 */
function getAugmentedPathEnv(): string {
  const existing = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const merged = [...existing, ...getCommonBinaryDirs()]
  return Array.from(new Set(merged)).join(path.delimiter)
}

/**
 * 在搜索目录中查找命令的完整路径
 * @param cmd 命令名（如 'node'、'npx'）
 * @returns 找到则返回绝对路径，否则返回 null
 */
function resolveCommandPath(cmd: string): string | null {
  if (!cmd) return null
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return cmd

  const searchDirs = getAugmentedPathEnv().split(path.delimiter).filter(Boolean)
  const executableCandidates = process.platform === 'win32'
    ? Array.from(new Set([cmd, `${cmd}.cmd`, `${cmd}.exe`, `${cmd}.bat`]))
    : [cmd]

  for (const dir of searchDirs) {
    for (const candidate of executableCandidates) {
      const fullPath = path.join(dir, candidate)
      if (fs.existsSync(fullPath)) return fullPath
    }
  }
  return null
}

/**
 * 异步执行命令，返回 stdout/stderr/exitCode
 * 统一使用增强后的 PATH，确保能找到系统工具
 */
function execCommandAsync(
  command: string,
  args: string[],
  options?: { cwd?: string; timeout?: number; env?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      timeout: options?.timeout || 60_000,
      env: { ...process.env, PATH: getAugmentedPathEnv(), ...options?.env },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }))
    proc.on('error', (err) => resolve({ stdout, stderr: err.message, code: 1 }))
  })
}

// ============================================
// 下载与解压
// ============================================

/**
 * 下载文件（支持 HTTPS 重定向）
 * @param url 下载地址
 * @param destPath 目标文件路径
 */
function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const file = fs.createWriteStream(destPath)
    const request = (targetUrl: string, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'))
        return
      }
      https.get(targetUrl, { timeout: DOWNLOAD_TIMEOUT_MS }, (res) => {
        // 处理重定向（3xx）
        if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            res.resume()
            request(redirectUrl, redirectCount + 1)
            return
          }
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode} for ${targetUrl}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
      }).on('error', (err) => {
        try { fs.unlinkSync(destPath) } catch { /* ignore */ }
        reject(err)
      }).on('timeout', () => {
        try { fs.unlinkSync(destPath) } catch { /* ignore */ }
        reject(new Error('Download timeout'))
      })
    }
    request(url)
  })
}

/**
 * 获取指定大版本下最新的小版本号
 * 通过解析 nodejs.org/dist/index.json 实现
 * @param majorVersion 大版本号（如 22）
 * @returns 完整版本号（如 'v22.11.0'），失败返回 null
 */
async function fetchLatestVersion(majorVersion: number): Promise<string | null> {
  return new Promise((resolve) => {
    https.get(NODE_INDEX_URL, { timeout: 30_000 }, (res) => {
      if (res.statusCode !== 200) {
        resolve(null)
        return
      }
      let data = ''
      res.on('data', (chunk) => { data += chunk.toString() })
      res.on('end', () => {
        try {
          const versions: Array<{ version: string; lts: false | string }> = JSON.parse(data)
          // 优先选择 LTS 版本，其次选择该大版本最新的稳定版
          // versions 数组按发布时间倒序排列（最新在前）
          const candidates = versions.filter(v => {
            const ver = v.version
            const match = ver.match(/^v(\d+)\./)
            return match && parseInt(match[1], 10) === majorVersion
          })
          // 优先 LTS
          const ltsVersion = candidates.find(v => v.lts !== false)
          resolve(ltsVersion?.version || candidates[0]?.version || null)
        } catch {
          resolve(null)
        }
      })
    }).on('error', () => resolve(null))
      .on('timeout', () => resolve(null))
  })
}

/**
 * 解压 .tar.gz 或 .zip 到目标目录
 * Windows 使用内置 tar 命令（Windows 10+ 自带），macOS/Linux 使用系统 tar
 */
function extractArchive(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

    // Windows 10+ 自带 tar.exe，能同时处理 .zip 和 .tar.gz
    // macOS/Linux 的 tar 也能处理两种格式（bsdtar）
    const proc = spawn('tar', ['-xf', archivePath, '-C', destDir], {
      timeout: EXTRACT_TIMEOUT_MS,
      env: { ...process.env, PATH: getAugmentedPathEnv() },
    })
    let stderr = ''
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar extract failed (code ${code}): ${stderr}`))
    })
    proc.on('error', (err) => {
      // tar 命令不存在时，尝试使用 unzip（仅 Windows .zip 场景）
      if (archivePath.endsWith('.zip')) {
        const unzipProc = spawn('unzip', ['-o', archivePath, '-d', destDir], {
          timeout: EXTRACT_TIMEOUT_MS,
        })
        let unzipStderr = ''
        unzipProc.stderr?.on('data', (data: Buffer) => { unzipStderr += data.toString() })
        unzipProc.on('close', (unzipCode) => {
          if (unzipCode === 0) resolve()
          else reject(new Error(`Both tar and unzip failed. tar: ${err.message}; unzip: ${unzipStderr}`))
        })
        unzipProc.on('error', () => {
          reject(new Error(`Extraction failed: tar not found (${err.message}) and unzip not available`))
        })
      } else {
        reject(new Error(`tar extraction failed: ${err.message}`))
      }
    })
  })
}

// ============================================
// NodeManager 单例
// ============================================

class NodeManager {
  private static instance: NodeManager | null = null

  private _status: NodeStatus = {
    ready: false,
    nodePath: null,
    npmPath: null,
    npxPath: null,
    source: 'none',
    version: null,
    nodeDir: null,
    binDir: null,
    installedPackages: [],
  }

  /** 初始化进行中标志，防止并发调用 */
  private initializing = false

  /**
   * 状态回调，用于监听 Node.js 安装过程中的进度消息。
   *
   * EnvironmentSetupService 会注册此回调，把安装进度推送到渲染进程，
   * 让首次启动弹窗能显示"正在下载 Node.js..."等阶段性反馈，
   * 避免用户在长时间安装过程中以为应用卡死。
   */
  private statusCallback: ((message: string) => void) | null = null

  private constructor() {}

  static getInstance(): NodeManager {
    if (!NodeManager.instance) {
      NodeManager.instance = new NodeManager()
    }
    return NodeManager.instance
  }

  /** 当前状态快照（只读） */
  get status(): NodeStatus {
    return { ...this._status }
  }

  /**
   * 设置状态回调，用于监听 Node.js 安装过程中的进度消息。
   * 传 null 可取消订阅。
   */
  setStatusCallback(callback: ((message: string) => void) | null): void {
    this.statusCallback = callback
  }

  /** 内部方法：发送状态消息到回调 */
  private notifyStatus(message: string): void {
    if (this.statusCallback) {
      try {
        this.statusCallback(message)
      } catch {
        // 忽略回调错误
      }
    }
  }

  /** 获取 node 可执行文件路径 */
  getNodePath(): string | null {
    return this._status.nodePath
  }

  /** 获取 npm 路径 */
  getNpmPath(): string | null {
    return this._status.npmPath
  }

  /** 获取 npx 路径 */
  getNpxPath(): string | null {
    return this._status.npxPath
  }

  /** 获取 bin 目录路径（包含 node/npm/npx） */
  getBinDir(): string | null {
    return this._status.binDir
  }

  /**
   * 确保 Node.js 运行时就绪。
   * - 已就绪则直接返回
   * - 正在初始化则等待
   * - 未就绪则执行初始化流程
   *
   * 此方法是幂等的，可安全多次调用。
   */
  async ensureReady(): Promise<NodeStatus> {
    if (this._status.ready) return this.status

    if (this.initializing) {
      // 等待正在进行的初始化完成
      while (this.initializing) {
        await new Promise((r) => setTimeout(r, 200))
      }
      return this.status
    }

    this.initializing = true
    try {
      await this._ensureReady()
    } catch (err) {
      logger.system.error('[NodeManager] ensureReady failed:', err)
      this._status.error = toAppError(err).message
    } finally {
      this.initializing = false
    }
    return this.status
  }

  /**
   * 实际的初始化逻辑
   *
   * 流程：
   * 1. 检查 electron-store 缓存 → 有效则直接使用
   * 2. 检测系统 Node.js → 找到则使用
   * 3. 自动下载便携版 Node.js → 安装到 {userData}/node-env/
   * 4. 全部失败 → 标记为不可用
   */
  private async _ensureReady(): Promise<void> {
    logger.system.info('[NodeManager] Starting Node.js environment setup...')
    this.notifyStatus('正在检查 Node.js 运行环境...')

    // 步骤 1：检查缓存
    const cachedNode = store.get(CONFIG_KEY_NODE_PATH) as string | undefined
    if (cachedNode && fs.existsSync(cachedNode)) {
      const version = await this._getNodeVersion(cachedNode)
      if (version) {
        logger.system.info(`[NodeManager] Found cached Node.js: ${cachedNode} (${version})`)
        this.notifyStatus(`已检测到缓存的 Node.js (${version})`)
        const cachedNpm = (store.get(CONFIG_KEY_NPM_PATH) as string) || null
        const cachedNpx = (store.get(CONFIG_KEY_NPX_PATH) as string) || null
        const cachedDir = (store.get(CONFIG_KEY_NODE_DIR) as string) || null
        this._status = {
          ready: true,
          nodePath: cachedNode,
          npmPath: cachedNpm && fs.existsSync(cachedNpm) ? cachedNpm : null,
          npxPath: cachedNpx && fs.existsSync(cachedNpx) ? cachedNpx : null,
          source: cachedDir && cachedDir.includes(DEFAULT_NODE_DIR) ? 'managed' : 'system',
          version,
          nodeDir: cachedDir,
          binDir: path.dirname(cachedNode),
          installedPackages: [],
        }
        // 尝试补全 npm/npx 路径
        this._resolveNpmNpxPaths()
        return
      }
      // 缓存失效，清除
      store.delete(CONFIG_KEY_NODE_PATH)
      store.delete(CONFIG_KEY_NPM_PATH)
      store.delete(CONFIG_KEY_NPX_PATH)
      store.delete(CONFIG_KEY_NODE_DIR)
      store.delete(CONFIG_KEY_VERSION)
    }

    // 步骤 2：检测系统 Node.js
    const systemNode = await this._detectSystemNode()
    if (systemNode) {
      logger.system.info(`[NodeManager] Found system Node.js: ${systemNode.path} (${systemNode.version})`)
      this.notifyStatus(`已检测到系统 Node.js (${systemNode.version})`)
      this._status.nodePath = systemNode.path
      this._status.version = systemNode.version
      this._status.source = 'system'
      this._status.ready = true
      this._status.binDir = path.dirname(systemNode.path)
      this._resolveNpmNpxPaths()
      store.set(CONFIG_KEY_NODE_PATH, systemNode.path)
      store.set(CONFIG_KEY_VERSION, systemNode.version)
      return
    }

    // 步骤 3：自动下载便携版 Node.js
    logger.system.info('[NodeManager] No system Node.js found, attempting managed installation...')
    this.notifyStatus('未检测到 Node.js，正在自动下载便携版...')

    const managedResult = await this._installManagedNode()
    if (managedResult) {
      this.notifyStatus(`Node.js 安装完成 (${managedResult.version})`)
      this._status = {
        ready: true,
        nodePath: managedResult.nodePath,
        npmPath: managedResult.npmPath,
        npxPath: managedResult.npxPath,
        source: 'managed',
        version: managedResult.version,
        nodeDir: managedResult.nodeDir,
        binDir: managedResult.binDir,
        installedPackages: [],
      }
      store.set(CONFIG_KEY_NODE_PATH, managedResult.nodePath)
      store.set(CONFIG_KEY_NPM_PATH, managedResult.npmPath)
      store.set(CONFIG_KEY_NPX_PATH, managedResult.npxPath)
      store.set(CONFIG_KEY_NODE_DIR, managedResult.nodeDir)
      store.set(CONFIG_KEY_VERSION, managedResult.version)
      return
    }

    // 步骤 4：全部失败
    logger.system.warn('[NodeManager] Node.js environment setup failed - Node features will be unavailable')
    this._status.ready = false
    this._status.source = 'none'
    this._status.error = 'Node.js not found and auto-installation failed. Please install Node.js manually from https://nodejs.org'
  }

  /**
   * 检测系统已安装的 Node.js
   * @returns 找到则返回 { path, version }，否则返回 null
   */
  private async _detectSystemNode(): Promise<{ path: string; version: string } | null> {
    const resolved = resolveCommandPath('node')
    if (!resolved) return null

    const version = await this._getNodeVersion(resolved)
    if (version) return { path: resolved, version }
    return null
  }

  /**
   * 获取 Node.js 版本号
   * @param nodePath node 可执行文件路径
   * @returns 版本号字符串（如 'v22.11.0'），失败返回 null
   */
  private async _getNodeVersion(nodePath: string): Promise<string | null> {
    try {
      const { stdout, code } = await execCommandAsync(nodePath, ['--version'], { timeout: 10_000 })
      if (code === 0 && stdout) {
        const match = stdout.match(/(v\d+\.\d+\.\d+)/)
        return match ? match[1] : null
      }
    } catch {
      // ignore
    }
    return null
  }

  /**
   * 补全 npm/npx 路径
   * 在已知 node 路径和 binDir 的情况下，推断 npm/npx 的位置
   */
  private _resolveNpmNpxPaths(): void {
    if (!this._status.binDir) return

    const npmName = getScriptName('npm')
    const npxName = getScriptName('npx')

    // 在 binDir 中查找
    const npmInBinDir = path.join(this._status.binDir, npmName)
    const npxInBinDir = path.join(this._status.binDir, npxName)

    if (!this._status.npmPath && fs.existsSync(npmInBinDir)) {
      this._status.npmPath = npmInBinDir
      store.set(CONFIG_KEY_NPM_PATH, npmInBinDir)
    }
    if (!this._status.npxPath && fs.existsSync(npxInBinDir)) {
      this._status.npxPath = npxInBinDir
      store.set(CONFIG_KEY_NPX_PATH, npxInBinDir)
    }

    // Windows 下 npm/npx 可能在 nodejs 目录或 %APPDATA%\npm
    if (process.platform === 'win32' && this._status.nodeDir) {
      const npmInNodeDir = path.join(this._status.nodeDir, npmName)
      const npxInNodeDir = path.join(this._status.nodeDir, npxName)
      if (!this._status.npmPath && fs.existsSync(npmInNodeDir)) {
        this._status.npmPath = npmInNodeDir
        store.set(CONFIG_KEY_NPM_PATH, npmInNodeDir)
      }
      if (!this._status.npxPath && fs.existsSync(npxInNodeDir)) {
        this._status.npxPath = npxInNodeDir
        store.set(CONFIG_KEY_NPX_PATH, npxInNodeDir)
      }
    }
  }

  /**
   * 下载并安装便携版 Node.js
   * @returns 安装结果，失败返回 null
   */
  private async _installManagedNode(): Promise<{
    nodePath: string
    npmPath: string
    npxPath: string
    nodeDir: string
    binDir: string
    version: string
  } | null> {
    const platformKey = getPlatformKey()
    const ext = getArchiveExtension()

    // 获取最新版本号
    const version = await fetchLatestVersion(NODE_MAJOR_VERSION)
    if (!version) {
      logger.system.error(`[NodeManager] Failed to fetch latest version for major ${NODE_MAJOR_VERSION}`)
      return null
    }

    // 构造下载 URL
    // 示例：https://nodejs.org/dist/v22.11.0/node-v22.11.0-darwin-arm64.tar.gz
    //       https://nodejs.org/dist/v22.11.0/node-v22.11.0-win-x64.zip
    const archiveName = `node-${version}-${platformKey}${ext}`
    const officialUrl = `https://nodejs.org/dist/${version}/${archiveName}`

    // 优先从后端获取推荐下载源（管理员在后台管理上传的二进制）
    // 后端未登记则回退到 nodejs.org 官方地址
    this.notifyStatus('正在从后端获取 Node.js 推荐下载源...')
    const backendUrl = await resolveBackendAssetUrl()
    const downloadUrl = backendUrl || officialUrl
    const sourceName = backendUrl ? '后端托管源' : 'nodejs.org 官方'

    logger.system.info(`[NodeManager] Downloading Node.js ${version} from: ${downloadUrl} (${sourceName})`)
    this.notifyStatus(`正在下载 Node.js ${version}（${sourceName}）...`)

    // 准备临时目录
    const tmpDir = path.join(DEFAULT_NODE_DIR, 'tmp')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

    const archivePath = path.join(tmpDir, archiveName)
    const extractDir = path.join(tmpDir, 'extract')

    try {
      // 下载（若后端源失败且不是官方地址，回退到官方重试）
      try {
        await downloadFile(downloadUrl, archivePath)
      } catch (downloadErr) {
        if (backendUrl && officialUrl !== downloadUrl) {
          logger.system.warn('[NodeManager] Backend download failed, falling back to nodejs.org:', downloadErr)
          this.notifyStatus('后端源下载失败，回退到 nodejs.org 官方...')
          await downloadFile(officialUrl, archivePath)
        } else {
          throw downloadErr
        }
      }
      logger.system.info('[NodeManager] Download complete, extracting...')
      this.notifyStatus('下载完成，正在解压...')

      // 解压
      await extractArchive(archivePath, extractDir)

      // 查找解压后的根目录（node-v22.11.0-darwin-arm64/）
      const extractedRoot = this._findExtractedRoot(extractDir, version, platformKey)
      if (!extractedRoot) {
        logger.system.error('[NodeManager] Cannot find Node.js root directory in extracted archive')
        return null
      }

      // 移动到最终位置
      const finalDir = path.join(DEFAULT_NODE_DIR, 'node')
      // 清理可能存在的旧目录
      if (fs.existsSync(finalDir)) {
        fs.rmSync(finalDir, { recursive: true, force: true })
      }

      // 确保 DEFAULT_NODE_DIR 存在
      if (!fs.existsSync(DEFAULT_NODE_DIR)) {
        fs.mkdirSync(DEFAULT_NODE_DIR, { recursive: true })
      }

      fs.renameSync(extractedRoot, finalDir)

      // 定位可执行文件
      const binDir = process.platform === 'win32'
        ? finalDir  // Windows: node.exe 在根目录
        : path.join(finalDir, 'bin')  // Unix: 在 bin/ 子目录

      const nodeExe = path.join(binDir, getExecutableName('node'))
      if (!fs.existsSync(nodeExe)) {
        logger.system.error(`[NodeManager] node executable not found at: ${nodeExe}`)
        return null
      }

      // 设置可执行权限（Unix）
      if (process.platform !== 'win32') {
        fs.chmodSync(nodeExe, 0o755)
      }

      // 查找 npm/npx
      const npmExe = path.join(binDir, getScriptName('npm'))
      const npxExe = path.join(binDir, getScriptName('npx'))

      // npm/npx 脚本需要可执行权限
      if (process.platform !== 'win32') {
        if (fs.existsSync(npmExe)) fs.chmodSync(npmExe, 0o755)
        if (fs.existsSync(npxExe)) fs.chmodSync(npxExe, 0o755)
      }

      // 清理临时文件
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true })
      } catch {
        // 清理失败不影响主流程
      }

      logger.system.info(`[NodeManager] Node.js installed at: ${finalDir}`)
      logger.system.info(`[NodeManager] node: ${nodeExe}, npm: ${npmExe}, npx: ${npxExe}`)

      return {
        nodePath: nodeExe,
        npmPath: fs.existsSync(npmExe) ? npmExe : '',
        npxPath: fs.existsSync(npxExe) ? npxExe : '',
        nodeDir: finalDir,
        binDir,
        version,
      }
    } catch (err) {
      logger.system.error('[NodeManager] Node.js installation failed:', err)
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      return null
    }
  }

  /**
   * 在解压目录中查找 Node.js 的根目录
   * 解压后通常有一个顶层目录：node-v22.11.0-darwin-arm64/
   */
  private _findExtractedRoot(extractDir: string, version: string, _platformKey: string): string | null {
    // 直接检查 extractDir 本身
    const dirName = path.basename(extractDir)
    if (dirName.startsWith(`node-${version}-`)) {
      return extractDir
    }

    // 检查子目录
    try {
      const entries = fs.readdirSync(extractDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.startsWith(`node-${version}-`)) {
          return path.join(extractDir, entry.name)
        }
      }
      // 如果只有一个子目录，直接使用它
      if (entries.length === 1 && entries[0].isDirectory()) {
        return path.join(extractDir, entries[0].name)
      }
    } catch {
      // ignore
    }
    return null
  }

  /**
   * 安装全局 npm 包
   * @param packageName 包名（可带版本号，如 'typescript@5.0.0'）
   */
  async installPackage(packageName: string): Promise<{ success: boolean; error?: string }> {
    const npmPath = this._status.npmPath
    if (!npmPath || !fs.existsSync(npmPath)) {
      return { success: false, error: 'npm not available' }
    }

    try {
      const { code, stderr } = await execCommandAsync(
        npmPath,
        ['install', '-g', '--quiet', packageName],
        { timeout: 120_000 }
      )
      if (code !== 0) return { success: false, error: stderr }

      if (!this._status.installedPackages.includes(packageName)) {
        this._status.installedPackages.push(packageName)
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: toAppError(err).message }
    }
  }

  /**
   * 执行 Node.js 脚本
   * @param params 脚本路径、参数、工作目录、超时
   */
  async executeScript(params: {
    scriptPath: string
    args?: string[]
    cwd?: string
    timeout?: number
  }): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string }> {
    const { scriptPath, args = [], cwd, timeout = 120_000 } = params

    if (!fs.existsSync(scriptPath)) {
      return { success: false, stdout: '', stderr: '', exitCode: null, error: `Script file not found: ${scriptPath}` }
    }

    const nodePath = this._status.nodePath
    if (!nodePath || !fs.existsSync(nodePath)) {
      return {
        success: false,
        stdout: '',
        stderr: '',
        exitCode: null,
        error: 'No Node.js runtime available. Please ensure Node.js environment is set up.',
      }
    }

    logger.system.info(`[NodeManager] Executing script: ${scriptPath}`)
    try {
      const result = await execCommandAsync(
        nodePath,
        [scriptPath, ...args],
        { cwd: cwd || path.dirname(scriptPath), timeout }
      )
      return {
        success: result.code === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
        error: result.code !== 0 ? result.stderr : undefined,
      }
    } catch (err) {
      const errMsg = toAppError(err).message
      logger.system.error('[NodeManager] Script execution failed:', errMsg)
      return { success: false, stdout: '', stderr: errMsg, exitCode: null, error: errMsg }
    }
  }

  /**
   * 重新安装 Node.js 运行时（清除缓存并重新下载）
   */
  async reinstall(): Promise<NodeStatus> {
    logger.system.info('[NodeManager] Reinstalling Node.js environment...')

    // 清除缓存
    store.delete(CONFIG_KEY_NODE_PATH)
    store.delete(CONFIG_KEY_NPM_PATH)
    store.delete(CONFIG_KEY_NPX_PATH)
    store.delete(CONFIG_KEY_NODE_DIR)
    store.delete(CONFIG_KEY_VERSION)

    // 清除安装目录
    try {
      if (fs.existsSync(DEFAULT_NODE_DIR)) {
        fs.rmSync(DEFAULT_NODE_DIR, { recursive: true, force: true })
      }
    } catch (err) {
      logger.system.warn('[NodeManager] Failed to clean node-env dir:', err)
    }

    // 重置状态
    this._status = {
      ready: false,
      nodePath: null,
      npmPath: null,
      npxPath: null,
      source: 'none',
      version: null,
      nodeDir: null,
      binDir: null,
      installedPackages: [],
    }

    return this.ensureReady()
  }

  /**
   * 设置自定义 Node.js 路径（用户手动指定）
   * @param customPath node 可执行文件路径，传 null 则清除自定义路径
   */
  setCustomNodePath(customPath: string | null): void {
    if (customPath && fs.existsSync(customPath)) {
      store.set(CONFIG_KEY_NODE_PATH, customPath)
      this._status.nodePath = customPath
      this._status.source = 'system'
      this._status.ready = true
      this._status.binDir = path.dirname(customPath)
      // 异步获取版本
      this._getNodeVersion(customPath).then((v) => {
        this._status.version = v
      })
      this._resolveNpmNpxPaths()
    } else if (customPath === null) {
      store.delete(CONFIG_KEY_NODE_PATH)
      store.delete(CONFIG_KEY_NPM_PATH)
      store.delete(CONFIG_KEY_NPX_PATH)
      store.delete(CONFIG_KEY_NODE_DIR)
      this._status.nodePath = null
      this._status.npmPath = null
      this._status.npxPath = null
      this._status.ready = false
      this._status.source = 'none'
    }
  }

  /**
   * 获取增强后的 PATH（包含便携版 Node.js 的 bin 目录）
   * 供外部子进程注入 PATH 使用
   */
  getAugmentedPath(): string {
    const existing = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
    const extra: string[] = [...getCommonBinaryDirs()]

    // 将便携版 bin 目录放到最前面，确保优先使用
    if (this._status.binDir && fs.existsSync(this._status.binDir)) {
      extra.unshift(this._status.binDir)
    }

    return Array.from(new Set([...extra, ...existing])).join(path.delimiter)
  }
}

// ============================================
// 导出单例
// ============================================

export const nodeManager = NodeManager.getInstance()
