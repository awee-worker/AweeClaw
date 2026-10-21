/**
 * Go 环境管理器
 *
 * 功能：
 * - 自动检测系统 Go（GOROOT / PATH / 登录 shell / 常见安装目录）
 * - 系统未安装时，自动下载 Go 官方发行包（go.dev，后端可登记镜像源）
 * - 为脚本执行、代码生成、MCP 工具提供统一的 go / gofmt 路径
 * - 持久化路径缓存，避免重复下载
 *
 * 设计：与 JavaRuntimeManager 架构对齐
 * - 单例模式
 * - ensureReady() 异步初始化，幂等可重入
 * - electron-store 持久化缓存
 */

import { app } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import * as https from 'https'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import Store from 'electron-store'

// ============================================
// 常量
// ============================================

/**
 * 懒初始化 electron-store
 *
 * electron-store 依赖 Electron `app`，模块顶层实例化会让任何 import 本模块的代码
 * 在非 Electron 环境（单测 / CLI）直接崩溃。
 */
let _store: Store | null = null
function getStore(): Store<Record<string, unknown>> {
  if (!_store) {
    _store = new Store({ name: 'go-config' })
  }
  return _store as Store<Record<string, unknown>>
}
const store = new Proxy({} as Store<Record<string, unknown>>, {
  get(_target, prop) {
    const instance = getStore() as unknown as Record<string | symbol, unknown>
    const value = instance[prop as string]
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

const CONFIG_KEY_GO_PATH = 'goPath'
const CONFIG_KEY_GOFMT_PATH = 'gofmtPath'
const CONFIG_KEY_GO_ROOT = 'goRoot'
const CONFIG_KEY_VERSION = 'version'

/** 托管 Go 安装目录：{userData}/go-env/（懒求值） */
let _defaultGoDir: string | null = null
function getDefaultGoDir(): string {
  if (!_defaultGoDir) {
    _defaultGoDir = path.join(app.getPath('userData'), 'go-env')
  }
  return _defaultGoDir
}

/**
 * 兜底版本号：仅在拿不到官方版本清单时使用。
 * 正常情况下走 go.dev/dl/?mode=json 取当前稳定版，无需手工升级此常量。
 */
const GO_FALLBACK_VERSION = '1.23.4'

/** 下载超时（5 分钟） */
const DOWNLOAD_TIMEOUT_MS = 300_000

/** 解压超时（2 分钟） */
const EXTRACT_TIMEOUT_MS = 120_000

// ============================================
// 类型定义
// ============================================

export interface GoStatus {
  /** 运行时是否就绪（go 可执行） */
  ready: boolean
  /** go 可执行文件绝对路径 */
  goPath: string | null
  /** gofmt 可执行文件绝对路径 */
  gofmtPath: string | null
  /** GOROOT 语义的 Go 安装根目录 */
  goRoot: string | null
  /** 来源：system（系统已安装）/ managed（自动下载）/ none */
  source: 'system' | 'managed' | 'none'
  /** Go 版本号（如 1.22.3） */
  version: string | null
  /** 已配置的环境变量取值（GOROOT） */
  goRootEnv: string | null
  /** 错误信息 */
  error?: string
}

// ============================================
// 平台工具函数
// ============================================

/** 可执行文件名（Windows 带 .exe） */
function getExecutableName(base: string): string {
  return process.platform === 'win32' ? `${base}.exe` : base
}

/** Go 官方包中使用的 OS 标识 */
function getGoOs(): string {
  if (process.platform === 'darwin') return 'darwin'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

/** Go 官方包中使用的架构标识 */
function getGoArch(): string {
  if (process.arch === 'arm64') return 'arm64'
  if (process.arch === 'ia32') return '386'
  return 'amd64'
}

/** 平台标识，用于向后端登记/查询对应发行包 */
function getPlatformKey(): string {
  return `${getGoOs()}-${getGoArch()}`
}

/** 获取平台对应的下载包扩展名 */
function getArchiveExtension(): '.tar.gz' | '.zip' {
  return process.platform === 'win32' ? '.zip' : '.tar.gz'
}

/** 获取常见的 Go 安装根目录 */
function getCommonGoRootDirs(): string[] {
  const home = os.homedir()

  if (process.platform === 'win32') {
    const dirs = ['C:\\Go', 'C:\\Program Files\\Go']
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Go'))
    if (process.env.USERPROFILE) dirs.push(path.join(process.env.USERPROFILE, 'go'))
    return dirs
  }

  // 用户级包管理器目录：gvm / goenv / asdf 都不会把 go 注册到系统 PATH 的固定位置
  const userDirs = [
    path.join(home, '.gvm', 'gos'),
    path.join(home, '.goenv', 'versions'),
    path.join(home, '.asdf', 'installs', 'go'),
    path.join(home, 'sdk'),
  ]

  if (process.platform === 'darwin') {
    return [
      '/usr/local/go',
      '/opt/homebrew/opt/go/libexec',
      '/usr/local/opt/go/libexec',
      '/opt/go',
      ...userDirs,
    ]
  }

  return ['/usr/local/go', '/usr/lib/go', '/usr/lib/go-1.22', '/opt/go', '/snap/go/current', ...userDirs]
}

/**
 * 获取增强后的 PATH 环境变量字符串。
 * 合并系统 PATH 与常见二进制目录，确保能找到系统 go。
 */
function getAugmentedPathEnv(): string {
  const home = os.homedir()
  const extra = process.platform === 'win32'
    ? ['C:\\Go\\bin', 'C:\\Program Files\\Go\\bin']
    : [
        '/usr/local/go/bin',
        '/opt/homebrew/bin',
        '/usr/local/bin',
        path.join(home, 'go', 'bin'),
        path.join(home, '.local', 'bin'),
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
      ]

  const existing = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  return Array.from(new Set([...existing, ...extra])).join(path.delimiter)
}

/** 在搜索目录中查找命令的完整路径 */
function resolveCommandPath(cmd: string): string | null {
  if (!cmd) return null
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return cmd

  const searchDirs = getAugmentedPathEnv().split(path.delimiter).filter(Boolean)
  const candidates = process.platform === 'win32'
    ? Array.from(new Set([`${cmd}.exe`, cmd]))
    : [cmd]

  for (const dir of searchDirs) {
    for (const candidate of candidates) {
      const fullPath = path.join(dir, candidate)
      if (fs.existsSync(fullPath)) return fullPath
    }
  }
  return null
}

/**
 * 判断一个目录是否真的是 GOROOT。
 *
 * 只校验 bin/go 不够：/usr/bin/go（部分发行版是转发包装器）会让反推结果为 /usr，
 * 那里同样有 bin/go，会被误判成 Go 安装根目录。因此额外要求存在 `VERSION` 文件
 * （官方发行包都带），或目录名本身就是 Go 命名。
 */
function looksLikeGoRoot(root: string): boolean {
  if (!root) return false
  if (!fs.existsSync(path.join(root, 'bin', getExecutableName('go')))) return false
  if (fs.existsSync(path.join(root, 'VERSION'))) return true

  const name = path.basename(root)
  return /^go$/i.test(name) || /^go[\d.]+$/i.test(name) || /^golang$/i.test(name)
}

/** 异步执行命令，返回 stdout/stderr/exitCode */
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
      windowsHide: true,
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

/** 下载文件（支持 HTTPS 重定向，兼容相对跳转地址） */
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
      https.get(targetUrl, { timeout: DOWNLOAD_TIMEOUT_MS, headers: { 'User-Agent': 'AweeClaw' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode || 0)) {
          const location = res.headers.location
          if (location) {
            res.resume()
            request(new URL(location, targetUrl).toString(), redirectCount + 1)
            return
          }
        }
        if (res.statusCode !== 200) {
          res.resume()
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

/** 解压 .tar.gz 或 .zip 到目标目录（复用系统 tar，Windows 10+ 自带） */
function extractArchive(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

    const proc = spawn('tar', ['-xf', archivePath, '-C', destDir], {
      timeout: EXTRACT_TIMEOUT_MS,
      env: { ...process.env, PATH: getAugmentedPathEnv() },
      windowsHide: true,
    })
    let stderr = ''
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`tar extract failed (code ${code}): ${stderr}`))
    })
    proc.on('error', (err) => {
      if (archivePath.endsWith('.zip')) {
        const unzipProc = spawn('unzip', ['-o', archivePath, '-d', destDir], {
          timeout: EXTRACT_TIMEOUT_MS,
          windowsHide: true,
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

/** 后端服务器地址（从 aweeclaw-config.json 读取） */
function getBackendServerUrl(): string | null {
  try {
    const configPath = path.join(app.getPath('home'), '.aweeclaw', 'aweeclaw-config.json')
    if (!fs.existsSync(configPath)) return null
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
    return config.serverUrl || null
  } catch {
    return null
  }
}

/**
 * 从后端 /api/v1/runtime-assets/resolve 解析 Go 推荐下载源。
 * 管理员在后台登记后客户端可走内网镜像；未登记则返回 null，回退 go.dev 官方。
 */
async function resolveBackendAssetUrl(): Promise<string | null> {
  const serverUrl = getBackendServerUrl()
  if (!serverUrl) return null

  const url = `${serverUrl}/api/v1/runtime-assets/resolve?assetKey=go&platform=${getPlatformKey()}`

  try {
    const response = await fetch(url, { method: 'GET' })
    if (!response.ok) {
      logger.system.warn(`[GoManager] Backend resolve go HTTP ${response.status}`)
      return null
    }
    const data = await response.json()
    if (data && data.downloadUrl) {
      logger.system.info(`[GoManager] Backend resolved go: ${data.downloadUrl}`)
      return data.downloadUrl as string
    }
    return null
  } catch (err) {
    logger.system.warn('[GoManager] Backend resolve go failed:', err)
    return null
  }
}

/**
 * 从 go.dev 的版本清单里挑出当前稳定版对应的发行包地址。
 *
 * 官方发行包文件名随版本变化，硬拼 URL 会在版本升级后失效，
 * 因此优先走 https://go.dev/dl/?mode=json 精确匹配 os/arch。
 */
async function resolveOfficialGoPackage(): Promise<{ url: string; version: string } | null> {
  const targetOs = getGoOs()
  const targetArch = getGoArch()

  try {
    const response = await fetch('https://go.dev/dl/?mode=json', { method: 'GET' })
    if (!response.ok) {
      logger.system.warn(`[GoManager] Fetch go release list HTTP ${response.status}`)
      return null
    }
    const releases = (await response.json()) as Array<{
      version?: string
      stable?: boolean
      files?: Array<{ filename?: string; os?: string; arch?: string; kind?: string }>
    }>
    if (!Array.isArray(releases) || releases.length === 0) return null

    const stable = releases.find((r) => r.stable !== false) || releases[0]
    const file = (stable.files || []).find(
      (f) => f.os === targetOs && f.arch === targetArch && f.kind === 'archive' && f.filename
    )
    if (!file?.filename) return null

    const version = String(stable.version || '').replace(/^go/, '')
    return { url: `https://go.dev/dl/${file.filename}`, version }
  } catch (err) {
    logger.system.warn('[GoManager] Fetch go release list failed:', err)
    return null
  }
}

// ============================================
// GoManager 单例
// ============================================

class GoManager {
  private static instance: GoManager | null = null

  private _status: GoStatus = {
    ready: false,
    goPath: null,
    gofmtPath: null,
    goRoot: null,
    source: 'none',
    version: null,
    goRootEnv: process.env.GOROOT || null,
  }

  /** 初始化进行中标志，防止并发调用 */
  private initializing = false

  /** 是否已完成过一次检测，避免状态查询反复触发探测 */
  private detected = false

  /** 进行中的轻量检测，防止并发重复探测 */
  private detectPromise: Promise<GoStatus> | null = null

  /** 安装进度回调，供 EnvironmentSetupService / 设置页订阅 */
  private statusCallback: ((message: string) => void) | null = null

  private constructor() {}

  static getInstance(): GoManager {
    if (!GoManager.instance) {
      GoManager.instance = new GoManager()
    }
    return GoManager.instance
  }

  /** 当前状态快照（只读） */
  get status(): GoStatus {
    return { ...this._status }
  }

  /** 设置安装进度回调，传 null 取消订阅 */
  setStatusCallback(callback: ((message: string) => void) | null): void {
    this.statusCallback = callback
  }

  private notifyStatus(message: string): void {
    if (this.statusCallback) {
      try {
        this.statusCallback(message)
      } catch {
        // 忽略回调错误
      }
    }
  }

  /** go 可执行文件路径 */
  getGoPath(): string | null {
    return this._status.goPath
  }

  /** gofmt 可执行文件路径 */
  getGofmtPath(): string | null {
    return this._status.gofmtPath
  }

  /** GOROOT 语义的 Go 安装根目录 */
  getGoRoot(): string | null {
    return this._status.goRoot
  }

  /**
   * 轻量检测：只看本机已有的 Go，不下载、不安装。
   *
   * 状态查询必须经过这里。否则从未初始化过的实例会一直返回初始快照
   * （ready=false），把"还没检测"误报成"Go 不可用"。
   */
  async detect(): Promise<GoStatus> {
    if (this.detected) return this.status
    if (this.detectPromise) return this.detectPromise

    this.detectPromise = (async () => {
      try {
        const local = await this._resolveLocalGo()
        this._status = local ?? this._unavailableStatus(
          '未检测到可用的 Go 运行环境，可点击"重新安装"自动下载 Go，或手动指定本机 go 路径'
        )
      } catch (err) {
        logger.system.error('[GoManager] detect failed:', err)
        this._status = this._unavailableStatus(toAppError(err).message)
      } finally {
        this.detected = true
        this.detectPromise = null
      }
      return this.status
    })()

    return this.detectPromise
  }

  /**
   * 强制重新探测本机 Go（不做安装）。
   * 用户刚装完 Go、或在终端配置好环境后，用它刷新状态而不必重新下载。
   */
  async redetect(): Promise<GoStatus> {
    // 不清缓存：缓存里的 go 仍可用时优先沿用（含用户手动指定的路径），
    // 已失效时 _resolveLocalGo 会自行清理后重新探测系统 Go
    this.detected = false
    this.detectPromise = null
    return this.detect()
  }

  /** 未找到 Go 时的状态快照 */
  private _unavailableStatus(error: string): GoStatus {
    return {
      ready: false,
      goPath: null,
      gofmtPath: null,
      goRoot: null,
      source: 'none',
      version: null,
      goRootEnv: process.env.GOROOT || null,
      error,
    }
  }

  /**
   * 解析本机已有的 Go：缓存路径 → 系统安装。
   * 找不到返回 null，由调用方决定是安装还是标记不可用。
   */
  private async _resolveLocalGo(): Promise<GoStatus | null> {
    // 步骤 1：缓存
    const cachedGo = store.get(CONFIG_KEY_GO_PATH) as string | undefined
    if (cachedGo && fs.existsSync(cachedGo)) {
      const version = await this._getGoVersion(cachedGo)
      if (version) {
        logger.system.info(`[GoManager] Found cached Go: ${cachedGo} (${version})`)
        this.notifyStatus(`已检测到缓存的 Go (${version})`)
        const storedRoot = (store.get(CONFIG_KEY_GO_ROOT) as string) || null
        const goRoot = storedRoot && looksLikeGoRoot(storedRoot)
          ? storedRoot
          : this._safeGoRoot(cachedGo)
        const cachedGofmt = (store.get(CONFIG_KEY_GOFMT_PATH) as string) || null
        const gofmtPath = cachedGofmt && fs.existsSync(cachedGofmt)
          ? cachedGofmt
          : this._resolveGofmt(goRoot)
        return {
          ready: true,
          goPath: cachedGo,
          gofmtPath,
          goRoot,
          source: goRoot?.includes(getDefaultGoDir()) ? 'managed' : 'system',
          version,
          goRootEnv: process.env.GOROOT || null,
        }
      }
      store.delete(CONFIG_KEY_GO_PATH)
      store.delete(CONFIG_KEY_GOFMT_PATH)
      store.delete(CONFIG_KEY_GO_ROOT)
      store.delete(CONFIG_KEY_VERSION)
    }

    // 步骤 2：系统 Go
    const systemGo = await this._detectSystemGo()
    if (!systemGo) return null

    logger.system.info(`[GoManager] Found system Go: ${systemGo.goPath} (${systemGo.version})`)
    this.notifyStatus(`已检测到系统 Go (${systemGo.version})`)
    store.set(CONFIG_KEY_GO_PATH, systemGo.goPath)
    store.set(CONFIG_KEY_GOFMT_PATH, systemGo.gofmtPath || '')
    if (systemGo.goRoot) store.set(CONFIG_KEY_GO_ROOT, systemGo.goRoot)
    store.set(CONFIG_KEY_VERSION, systemGo.version)

    return {
      ready: true,
      goPath: systemGo.goPath,
      gofmtPath: systemGo.gofmtPath,
      goRoot: systemGo.goRoot,
      source: 'system',
      version: systemGo.version,
      goRootEnv: process.env.GOROOT || null,
    }
  }

  /**
   * 确保 Go 运行时就绪。
   * 已就绪直接返回；正在初始化则等待；否则执行检测与按需安装。幂等可重入。
   */
  async ensureReady(): Promise<GoStatus> {
    if (this._status.ready) return this.status

    if (this.initializing) {
      while (this.initializing) {
        await new Promise((r) => setTimeout(r, 200))
      }
      return this.status
    }

    this.initializing = true
    try {
      await this._ensureReady()
    } catch (err) {
      logger.system.error('[GoManager] ensureReady failed:', err)
      this._status.error = toAppError(err).message
    } finally {
      this.initializing = false
    }
    return this.status
  }

  /**
   * 初始化流程：
   * 1. 缓存路径有效 → 直接使用
   * 2. 检测系统 Go → 找到则使用
   * 3. 自动下载 Go 官方发行包 → 安装到 {userData}/go-env/go
   * 4. 全部失败 → 标记不可用
   */
  private async _ensureReady(): Promise<void> {
    logger.system.info('[GoManager] Starting Go environment setup...')
    this.notifyStatus('正在检查 Go 运行环境...')

    // 步骤 1 + 2：缓存 / 系统 Go
    const local = await this._resolveLocalGo()
    if (local) {
      this._status = local
      this.detected = true
      return
    }

    // 步骤 3：托管安装
    logger.system.info('[GoManager] No system Go found, attempting managed installation...')
    this.notifyStatus('未检测到 Go，正在自动下载官方发行包...')

    const managed = await this._installManagedGo()
    if (managed) {
      this.notifyStatus(`Go 安装完成 (${managed.version})`)
      this._status = {
        ready: true,
        goPath: managed.goPath,
        gofmtPath: managed.gofmtPath,
        goRoot: managed.goRoot,
        source: 'managed',
        version: managed.version,
        goRootEnv: process.env.GOROOT || null,
      }
      store.set(CONFIG_KEY_GO_PATH, managed.goPath)
      store.set(CONFIG_KEY_GOFMT_PATH, managed.gofmtPath || '')
      store.set(CONFIG_KEY_GO_ROOT, managed.goRoot)
      store.set(CONFIG_KEY_VERSION, managed.version)
      this.detected = true
      return
    }

    // 步骤 4：失败
    logger.system.warn('[GoManager] Go environment setup failed - Go features will be unavailable')
    this._status = this._unavailableStatus(
      '未找到 Go 环境且自动安装失败，可从 https://go.dev/dl 手动安装后指定路径'
    )
    this.detected = true
  }

  /**
   * 通过用户的登录 shell 探测 go 路径与 GOROOT。
   *
   * Electron 主进程的环境变量来自 launchd，不包含 ~/.zshrc / ~/.bash_profile
   * 里配置的 PATH 与 GOROOT，导致终端可用的 Go 在应用内探测不到。
   */
  private async _probeShellGo(): Promise<{ goPath: string | null; goRoot: string | null }> {
    const empty = { goPath: null, goRoot: null }
    if (process.platform === 'win32') return empty

    const shell = process.env.SHELL
    if (!shell || !fs.existsSync(shell)) return empty

    const script = 'echo "__AC_GR__${GOROOT}"; echo "__AC_GP__$(command -v go 2>/dev/null)"'

    for (const flags of [['-lc'], ['-lic']]) {
      const { stdout } = await execCommandAsync(shell, [...flags, script], { timeout: 15_000 })
      const goRootRaw = stdout.match(/__AC_GR__(.*)/)?.[1]?.trim() || ''
      const goPathRaw = stdout.match(/__AC_GP__(.*)/)?.[1]?.trim() || ''
      if (!goRootRaw && !goPathRaw) continue

      const goPath = goPathRaw && fs.existsSync(goPathRaw) ? goPathRaw : null
      const goRoot = goRootRaw && looksLikeGoRoot(goRootRaw) ? goRootRaw : null
      if (goPath || goRoot) {
        logger.system.info(`[GoManager] Shell probe: goRoot=${goRoot || '-'} go=${goPath || '-'}`)
        return { goPath, goRoot }
      }
    }
    return empty
  }

  /**
   * 检测系统已安装的 Go。
   * 搜索顺序：GOROOT → PATH → 登录 shell → 常见安装目录
   */
  private async _detectSystemGo(): Promise<{
    goPath: string
    gofmtPath: string | null
    goRoot: string | null
    version: string
  } | null> {
    const candidates: string[] = []

    const goRootEnv = process.env.GOROOT
    if (goRootEnv) {
      candidates.push(path.join(goRootEnv, 'bin', getExecutableName('go')))
    }

    const onPath = resolveCommandPath('go')
    if (onPath) candidates.push(onPath)

    // 图形界面启动的应用只继承 launchd 的最小环境，用户在 shell 配置里
    // 声明的 PATH / GOROOT 读不到，会出现"终端里 go 可用、应用里找不到"的偏差
    const shellGo = await this._probeShellGo()
    if (shellGo.goRoot) {
      candidates.push(path.join(shellGo.goRoot, 'bin', getExecutableName('go')))
    }
    if (shellGo.goPath) candidates.push(shellGo.goPath)

    // 常见安装目录：扫描 Go 根目录
    for (const dir of getCommonGoRootDirs()) {
      candidates.push(...this._scanGoRoots(dir))
    }

    // 逐个验证版本；全部收集后优先选带 gofmt 的完整发行包，避免命中
    // 系统转发包装器而错过真正的 Go 安装
    const collected: Array<{
      goPath: string
      gofmtPath: string | null
      goRoot: string | null
      version: string
    }> = []

    for (const candidate of Array.from(new Set(candidates))) {
      if (!candidate || !fs.existsSync(candidate)) continue
      const version = await this._getGoVersion(candidate)
      if (!version) continue
      const goRoot = this._safeGoRoot(candidate)
      collected.push({
        goPath: candidate,
        gofmtPath: this._resolveGofmt(goRoot),
        goRoot,
        version,
      })
    }

    if (collected.length === 0) return null
    return collected.find((c) => c.gofmtPath) || collected[0]
  }

  /**
   * 扫描目录下的 Go 根目录，返回其中的 bin/go 路径。
   * 兼容 brew 的 Cellar 版本目录结构与 gvm/goenv 的多版本结构。
   */
  private _scanGoRoots(dir: string): string[] {
    const goExe = getExecutableName('go')
    const found: string[] = []

    const pushIfGoRoot = (root: string) => {
      if (!looksLikeGoRoot(root)) return
      found.push(path.join(root, 'bin', goExe))
    }

    try {
      if (!fs.existsSync(dir)) return found
      // 目录本身可能就是 Go 根目录
      pushIfGoRoot(dir)

      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const child = path.join(dir, entry.name)
        pushIfGoRoot(child)
        // brew：Cellar/go/<version>/libexec 才是 GOROOT
        pushIfGoRoot(path.join(child, 'libexec'))
      }
    } catch {
      // 目录不可读时忽略
    }
    return found
  }

  /** 从 go 可执行路径反推 GOROOT */
  private _resolveRootFromGoBinary(goPath: string): string {
    const marker = `${path.sep}bin${path.sep}${getExecutableName('go')}`
    if (goPath.endsWith(marker)) {
      const root = goPath.slice(0, -marker.length)
      if (root) return root
    }
    return path.dirname(path.dirname(goPath))
  }

  /**
   * 反推 go 所属的 GOROOT，并对结果做校验。
   *
   * 系统 go 常是转发用的包装器（/usr/bin/go 等），按路径反推会得到 /usr
   * 这类无效根目录，因此：
   * 1. 反推目录下必须真的存在 bin/go；
   * 2. 否则按 realpath 解析符号链接后再推一次；
   * 3. 仍不可信则返回 null（不编一个假 GOROOT）。
   */
  private _safeGoRoot(goPath: string): string | null {
    const guessed = this._resolveRootFromGoBinary(goPath)
    if (looksLikeGoRoot(guessed)) return guessed

    try {
      const real = fs.realpathSync(goPath)
      if (real !== goPath) {
        const realRoot = this._resolveRootFromGoBinary(real)
        if (looksLikeGoRoot(realRoot)) return realRoot
      }
    } catch {
      // realpath 失败时保持 null
    }
    return null
  }

  /** 在 GOROOT 中定位 gofmt，找不到返回 null */
  private _resolveGofmt(goRoot: string | null): string | null {
    if (!goRoot) return null
    const gofmt = path.join(goRoot, 'bin', getExecutableName('gofmt'))
    return fs.existsSync(gofmt) ? gofmt : null
  }

  /** 获取 Go 版本号，如 '1.22.3'；失败返回 null */
  private async _getGoVersion(goPath: string): Promise<string | null> {
    try {
      // go version 输出：go version go1.22.3 darwin/arm64
      const { stdout, stderr, code } = await execCommandAsync(goPath, ['version'], { timeout: 10_000 })
      const output = `${stdout}\n${stderr}`
      if (code !== 0 && !output.trim()) return null
      const matched = output.match(/go version go([\w.\-]+)/)
      return matched ? matched[1] : null
    } catch {
      return null
    }
  }

  /**
   * 下载并安装 Go 到 {userData}/go-env/go
   * @returns 安装结果，失败返回 null
   */
  private async _installManagedGo(): Promise<{
    goPath: string
    gofmtPath: string | null
    goRoot: string
    version: string
  } | null> {
    this.notifyStatus('正在获取 Go 推荐下载源...')
    const backendUrl = await resolveBackendAssetUrl()

    let downloadUrl = backendUrl
    let sourceName = '后端托管源'
    let versionHint = ''

    if (!downloadUrl) {
      const official = await resolveOfficialGoPackage()
      if (official) {
        downloadUrl = official.url
        versionHint = official.version
        sourceName = 'go.dev 官方'
      } else {
        // 版本清单拿不到时按官方命名规则拼接兜底地址
        const version = GO_FALLBACK_VERSION
        downloadUrl =
          `https://go.dev/dl/go${version}.${getPlatformKey()}${getArchiveExtension()}`
        versionHint = version
        sourceName = 'go.dev 官方（兜底地址）'
      }
    }

    const ext = downloadUrl.endsWith('.zip') ? '.zip' : '.tar.gz'
    logger.system.info(`[GoManager] Downloading Go from: ${downloadUrl} (${sourceName})`)
    this.notifyStatus(`正在下载 Go（${sourceName}）...`)

    const tmpDir = path.join(getDefaultGoDir(), 'tmp')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const archivePath = path.join(tmpDir, `go${versionHint ? `-${versionHint}` : ''}${ext}`)
    const extractDir = path.join(tmpDir, 'extract')

    try {
      try {
        await downloadFile(downloadUrl, archivePath)
      } catch (downloadErr) {
        if (backendUrl) {
          logger.system.warn('[GoManager] Backend download failed, falling back to go.dev:', downloadErr)
          this.notifyStatus('后端源下载失败，回退到 go.dev 官方...')
          const official = await resolveOfficialGoPackage()
          const fallbackUrl = official?.url
            || `https://go.dev/dl/go${GO_FALLBACK_VERSION}.${getPlatformKey()}${getArchiveExtension()}`
          await downloadFile(fallbackUrl, archivePath)
        } else {
          throw downloadErr
        }
      }

      logger.system.info('[GoManager] Download complete, extracting...')
      this.notifyStatus('下载完成，正在解压...')
      // 上一次中断残留的解压目录会和本次结果混在一起，先清掉
      try { fs.rmSync(extractDir, { recursive: true, force: true }) } catch { /* ignore */ }
      await extractArchive(archivePath, extractDir)

      const extractedRoot = this._findExtractedRoot(extractDir)
      if (!extractedRoot) {
        logger.system.error('[GoManager] Cannot find Go root directory in extracted archive')
        return null
      }

      const finalDir = path.join(getDefaultGoDir(), 'go')
      if (fs.existsSync(finalDir)) {
        fs.rmSync(finalDir, { recursive: true, force: true })
      }
      if (!fs.existsSync(getDefaultGoDir())) {
        fs.mkdirSync(getDefaultGoDir(), { recursive: true })
      }
      // 保留压缩包里的完整目录结构；rename 跨设备可能失败，回退到递归复制
      try {
        fs.renameSync(extractedRoot, finalDir)
      } catch {
        this._copyDirRecursive(extractedRoot, finalDir)
      }

      const goRoot = this._findRootInside(finalDir)
      if (!goRoot) {
        logger.system.error(`[GoManager] Installed Go is missing go binary under ${finalDir}`)
        return null
      }

      const goExe = path.join(goRoot, 'bin', getExecutableName('go'))
      const gofmtExe = path.join(goRoot, 'bin', getExecutableName('gofmt'))

      // Unix 下恢复可执行权限（tar 解压通常保留，复制兜底时会丢）
      if (process.platform !== 'win32') {
        const binDir = path.join(goRoot, 'bin')
        try {
          for (const name of fs.readdirSync(binDir)) {
            const full = path.join(binDir, name)
            if (fs.statSync(full).isFile()) fs.chmodSync(full, 0o755)
          }
        } catch {
          // 权限设置失败不影响主流程
        }
      }

      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }

      const version = (await this._getGoVersion(goExe)) || versionHint || 'unknown'
      logger.system.info(`[GoManager] Go installed at: ${finalDir} (${version})`)

      return {
        goPath: goExe,
        gofmtPath: fs.existsSync(gofmtExe) ? gofmtExe : null,
        goRoot,
        version,
      }
    } catch (err) {
      logger.system.error('[GoManager] Go installation failed:', err)
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      return null
    }
  }

  /**
   * 找出解压结果中的顶层目录。
   * 官方包解压后通常是单一目录：go/
   */
  private _findExtractedRoot(extractDir: string): string | null {
    try {
      const entries = fs.readdirSync(extractDir, { withFileTypes: true })
      const dirs = entries.filter((e) => e.isDirectory())
      if (dirs.length === 1) return path.join(extractDir, dirs[0].name)
      // 多个顶层项或直接摊平时，直接把解压目录当作根
      if (entries.length > 0) return extractDir
    } catch {
      // ignore
    }
    return null
  }

  /** 在给定目录中定位真正的 GOROOT（含 bin/go） */
  private _findRootInside(dir: string): string | null {
    const candidates = [dir, path.join(dir, 'go')]
    return candidates.find((candidate) => looksLikeGoRoot(candidate)) || null
  }

  /** 递归复制目录（rename 跨设备回退路径） */
  private _copyDirRecursive(src: string, dest: string): void {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
      const from = path.join(src, entry.name)
      const to = path.join(dest, entry.name)
      if (entry.isDirectory()) {
        this._copyDirRecursive(from, to)
      } else if (entry.isSymbolicLink()) {
        try {
          fs.symlinkSync(fs.readlinkSync(from), to)
        } catch {
          fs.copyFileSync(from, to)
        }
      } else {
        fs.copyFileSync(from, to)
      }
    }
  }

  /**
   * 重新安装 Go 运行时（清除缓存与托管目录后重新检测/下载）
   */
  async reinstall(): Promise<GoStatus> {
    logger.system.info('[GoManager] Reinstalling Go environment...')

    store.delete(CONFIG_KEY_GO_PATH)
    store.delete(CONFIG_KEY_GOFMT_PATH)
    store.delete(CONFIG_KEY_GO_ROOT)
    store.delete(CONFIG_KEY_VERSION)

    try {
      if (fs.existsSync(getDefaultGoDir())) {
        fs.rmSync(getDefaultGoDir(), { recursive: true, force: true })
      }
    } catch (err) {
      logger.system.warn('[GoManager] Failed to clean go-env dir:', err)
    }

    this._status = {
      ready: false,
      goPath: null,
      gofmtPath: null,
      goRoot: null,
      source: 'none',
      version: null,
      goRootEnv: process.env.GOROOT || null,
    }
    this.detected = false

    return this.ensureReady()
  }

  /**
   * 设置自定义 Go 路径。
   * @param customPath go 可执行文件路径或 GOROOT 目录，传 null 清除自定义路径
   */
  async setCustomGoPath(customPath: string | null): Promise<GoStatus> {
    if (customPath) {
      const goPath = this._normalizeGoBinary(customPath)
      if (!goPath) {
        return { ...this._status, ready: false, error: `无效的 Go 路径：${customPath}` }
      }
      const version = await this._getGoVersion(goPath)
      if (!version) {
        return { ...this._status, ready: false, error: `无法执行该 go 可执行文件：${goPath}` }
      }
      const goRoot = this._safeGoRoot(goPath)
      const gofmtPath = this._resolveGofmt(goRoot)
      this._status = {
        ready: true,
        goPath,
        gofmtPath,
        goRoot,
        source: 'system',
        version,
        goRootEnv: process.env.GOROOT || null,
      }
      store.set(CONFIG_KEY_GO_PATH, goPath)
      store.set(CONFIG_KEY_GOFMT_PATH, gofmtPath || '')
      store.set(CONFIG_KEY_GO_ROOT, goRoot || '')
      store.set(CONFIG_KEY_VERSION, version)
      this.detected = true
      return this.status
    }

    store.delete(CONFIG_KEY_GO_PATH)
    store.delete(CONFIG_KEY_GOFMT_PATH)
    store.delete(CONFIG_KEY_GO_ROOT)
    store.delete(CONFIG_KEY_VERSION)
    this._status = {
      ready: false,
      goPath: null,
      gofmtPath: null,
      goRoot: null,
      source: 'none',
      version: null,
      goRootEnv: process.env.GOROOT || null,
    }
    this.detected = false
    return this.status
  }

  /** 把用户选择的路径规范化为 go 可执行文件路径 */
  private _normalizeGoBinary(input: string): string | null {
    const goExe = getExecutableName('go')
    if (!fs.existsSync(input)) return null

    const stat = fs.statSync(input)
    if (stat.isDirectory()) {
      const candidates = [
        path.join(input, goExe),
        path.join(input, 'bin', goExe),
        path.join(input, 'libexec', 'bin', goExe),
      ]
      return candidates.find((p) => fs.existsSync(p)) || null
    }
    return input
  }
}

/** 单例 */
export const goManager = GoManager.getInstance()
