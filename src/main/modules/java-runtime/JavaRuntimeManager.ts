/**
 * Java 环境管理器
 *
 * 功能：
 * - 自动检测系统 JDK（JAVA_HOME / PATH / macOS java_home / 常见安装目录）
 * - 系统未安装时，自动下载 Temurin JDK（Adoptium 官方分发，后端可登记镜像源）
 * - 为脚本执行、MCP 工具、编译任务提供统一的 java / javac 路径
 * - 持久化路径缓存，避免重复下载
 *
 * 设计：与 NodeRuntimeManager 架构对齐
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
    _store = new Store({ name: 'java-config' })
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

const CONFIG_KEY_JAVA_PATH = 'javaPath'
const CONFIG_KEY_JAVAC_PATH = 'javacPath'
const CONFIG_KEY_JAVA_HOME = 'javaHome'
const CONFIG_KEY_VERSION = 'version'

/** 托管 JDK 安装目录：{userData}/java-env/（懒求值） */
let _defaultJavaDir: string | null = null
function getDefaultJavaDir(): string {
  if (!_defaultJavaDir) {
    _defaultJavaDir = path.join(app.getPath('userData'), 'java-env')
  }
  return _defaultJavaDir
}

/** 下载的 JDK 大版本，LTS 版本稳定性更好；升级只需修改此常量 */
const JAVA_FEATURE_VERSION = 21

/** 下载超时（5 分钟） */
const DOWNLOAD_TIMEOUT_MS = 300_000

/** 解压超时（2 分钟） */
const EXTRACT_TIMEOUT_MS = 120_000

// ============================================
// 类型定义
// ============================================

export interface JavaStatus {
  /** 运行时是否就绪（java 可执行） */
  ready: boolean
  /** java 可执行文件绝对路径 */
  javaPath: string | null
  /** javac 可执行文件绝对路径（仅 JDK 提供，JRE 为 null） */
  javacPath: string | null
  /** JDK 根目录（JAVA_HOME 语义） */
  javaHome: string | null
  /** 来源：system（系统已安装）/ managed（自动下载）/ none */
  source: 'system' | 'managed' | 'none'
  /** Java 版本号（如 21.0.2） */
  version: string | null
  /** 是否为完整 JDK（含 javac） */
  isJdk: boolean
  /** 已配置的环境变量取值（JAVA_HOME） */
  javaHomeEnv: string | null
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

/** Adoptium 的 OS 标识 */
function getAdoptiumOs(): string {
  if (process.platform === 'darwin') return 'mac'
  if (process.platform === 'win32') return 'windows'
  return 'linux'
}

/** Adoptium 的架构标识 */
function getAdoptiumArch(): string {
  if (process.arch === 'arm64') return 'aarch64'
  if (process.arch === 'ia32') return 'x86'
  return 'x64'
}

/** 获取常见的 Java 搜索目录（JDK 根目录，而非 bin 目录） */
function getCommonJavaHomeDirs(): string[] {
  if (process.platform === 'win32') {
    const dirs: string[] = []
    for (const base of ['C:\\Program Files\\Java', 'C:\\Program Files\\Eclipse Adoptium', 'C:\\Program Files\\Microsoft']) {
      dirs.push(base)
    }
    if (process.env.LOCALAPPDATA) dirs.push(path.join(process.env.LOCALAPPDATA, 'Programs', 'Eclipse Adoptium'))
    return dirs
  }

  // 用户级包管理器目录：sdkman / jenv / asdf 是最常见的 JDK 安装方式，
  // 它们都不会把 java 注册到 /Library/Java 或系统 PATH 里
  const home = os.homedir()
  const userDirs = [
    path.join(home, '.sdkman', 'candidates', 'java'),
    path.join(home, '.jenv', 'versions'),
    path.join(home, '.asdf', 'installs', 'java'),
    path.join(home, '.jdks'),
  ]

  if (process.platform === 'darwin') {
    return [
      // 用户级安装（Oracle / Temurin / Corretto / Microsoft 的安装器默认落在这里）
      path.join(home, 'Library', 'Java', 'JavaVirtualMachines'),
      '/Library/Java/JavaVirtualMachines',
      '/System/Library/Java/JavaVirtualMachines',
      '/opt/homebrew/opt',
      '/usr/local/opt',
      '/opt/java',
      ...userDirs,
    ]
  }

  return ['/usr/lib/jvm', '/usr/java', '/opt/java', '/opt/jdk', ...userDirs]
}

/**
 * 获取增强后的 PATH 环境变量字符串。
 * 合并系统 PATH 与常见二进制目录，确保能找到系统 java。
 */
function getAugmentedPathEnv(): string {
  const home = os.homedir()
  const extra = process.platform === 'win32'
    ? [path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Common Files', 'Oracle', 'Java', 'javapath')]
    : [
        path.join(home, '.sdkman', 'candidates', 'java', 'current', 'bin'),
        path.join(home, '.jenv', 'shims'),
        path.join(home, '.asdf', 'shims'),
        '/opt/homebrew/bin',
        '/usr/local/bin',
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
 * 判断一个目录是否真的是 JDK/JRE 根目录。
 *
 * 只校验 bin/java 不够：系统转发用的包装器会让反推结果为 /usr、/usr/local 这类
 * 上级目录，那里同样有 bin/java 与 bin/javac（系统 stub），会被误判成 JDK。
 * 因此额外要求存在 `release` 文件（标准 JDK/JRE 都带），或目录名本身是 JDK 命名。
 */
function looksLikeJavaHome(home: string): boolean {
  if (!home) return false
  if (!fs.existsSync(path.join(home, 'bin', getExecutableName('java')))) return false
  if (fs.existsSync(path.join(home, 'release'))) return true

  const segments = home.split(path.sep).filter(Boolean)
  const tail = segments[segments.length - 1] || ''
  const parent = segments[segments.length - 2] || ''
  // macOS 的 JDK 包根目录形如 xxx.jdk/Contents/Home，命名特征落在 .jdk 那层
  if (tail === 'Home' && parent === 'Contents') {
    return /\.jdk$/i.test(segments[segments.length - 3] || '')
  }
  return /^(jdk|jre)|openjdk|java/i.test(path.basename(home))
}

/** 异步执行命令，返回 stdout/stderr/exitCode */function execCommandAsync(
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

/** 下载文件（支持 HTTPS 重定向） */
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
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            res.resume()
            request(redirectUrl, redirectCount + 1)
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
 * 从后端 /api/v1/runtime-assets/resolve 解析 JDK 推荐下载源。
 * 管理员在后台登记后客户端可走内网镜像；未登记则返回 null，回退 Adoptium 官方。
 */
async function resolveBackendAssetUrl(): Promise<string | null> {
  const serverUrl = getBackendServerUrl()
  if (!serverUrl) return null

  const platform = `${getAdoptiumOs()}-${getAdoptiumArch()}`
  const url = `${serverUrl}/api/v1/runtime-assets/resolve?assetKey=java&platform=${platform}`

  try {
    const response = await fetch(url, { method: 'GET' })
    if (!response.ok) {
      logger.system.warn(`[JavaManager] Backend resolve java HTTP ${response.status}`)
      return null
    }
    const data = await response.json()
    if (data && data.downloadUrl) {
      logger.system.info(`[JavaManager] Backend resolved java: ${data.downloadUrl}`)
      return data.downloadUrl as string
    }
    return null
  } catch (err) {
    logger.system.warn('[JavaManager] Backend resolve java failed:', err)
    return null
  }
}

// ============================================
// JavaManager 单例
// ============================================

class JavaManager {
  private static instance: JavaManager | null = null

  private _status: JavaStatus = {
    ready: false,
    javaPath: null,
    javacPath: null,
    javaHome: null,
    source: 'none',
    version: null,
    isJdk: false,
    javaHomeEnv: process.env.JAVA_HOME || null,
  }

  /** 初始化进行中标志，防止并发调用 */
  private initializing = false

  /** 是否已完成过一次检测，避免状态查询反复触发探测 */
  private detected = false

  /** 进行中的轻量检测，防止并发重复探测 */
  private detectPromise: Promise<JavaStatus> | null = null

  /** 安装进度回调，供 EnvironmentSetupService / 设置页订阅 */
  private statusCallback: ((message: string) => void) | null = null

  private constructor() {}

  static getInstance(): JavaManager {
    if (!JavaManager.instance) {
      JavaManager.instance = new JavaManager()
    }
    return JavaManager.instance
  }

  /** 当前状态快照（只读） */
  get status(): JavaStatus {
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

  /** java 可执行文件路径 */
  getJavaPath(): string | null {
    return this._status.javaPath
  }

  /** javac 可执行文件路径（JRE 下为 null） */
  getJavacPath(): string | null {
    return this._status.javacPath
  }

  /** JAVA_HOME 语义的 JDK 根目录 */
  getJavaHome(): string | null {
    return this._status.javaHome
  }

  /**
   * 轻量检测：只看本机已有的 JDK/JRE，不下载、不安装。
   *
   * 状态查询必须经过这里。否则从未初始化过的实例会一直返回初始快照
   * （ready=false），把"还没检测"误报成"Java 不可用"。
   */
  async detect(): Promise<JavaStatus> {
    if (this.detected) return this.status
    if (this.detectPromise) return this.detectPromise

    this.detectPromise = (async () => {
      try {
        const local = await this._resolveLocalJava()
        this._status = local ?? this._unavailableStatus(
          '未检测到可用的 Java 运行环境，可点击"重新安装"自动下载 Temurin JDK，或手动指定本机 java 路径'
        )
      } catch (err) {
        logger.system.error('[JavaManager] detect failed:', err)
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
   * 强制重新探测本机 Java（不做安装）。
   * 用户刚装完 JDK、或在终端配置好环境后，用它刷新状态而不必重新下载。
   */
  async redetect(): Promise<JavaStatus> {
    // 不清缓存：缓存里的 java 仍可用时优先沿用（含用户手动指定的路径），
    // 已失效时 _resolveLocalJava 会自行清理后重新探测系统 JDK
    this.detected = false
    this.detectPromise = null
    return this.detect()
  }

  /** 未找到 Java 时的状态快照 */
  private _unavailableStatus(error: string): JavaStatus {
    return {
      ready: false,
      javaPath: null,
      javacPath: null,
      javaHome: null,
      source: 'none',
      version: null,
      isJdk: false,
      javaHomeEnv: process.env.JAVA_HOME || null,
      error,
    }
  }

  /**
   * 解析本机已有的 Java：缓存路径 → 系统 JDK。
   * 找不到返回 null，由调用方决定是安装还是标记不可用。
   */
  private async _resolveLocalJava(): Promise<JavaStatus | null> {
    // 步骤 1：缓存
    const cachedJava = store.get(CONFIG_KEY_JAVA_PATH) as string | undefined
    if (cachedJava && fs.existsSync(cachedJava)) {
      const version = await this._getJavaVersion(cachedJava)
      if (version) {
        logger.system.info(`[JavaManager] Found cached Java: ${cachedJava} (${version})`)
        this.notifyStatus(`已检测到缓存的 Java (${version})`)
        const storedHome = (store.get(CONFIG_KEY_JAVA_HOME) as string) || null
        const javaHome = storedHome && looksLikeJavaHome(storedHome)
          ? storedHome
          : this._safeJavaHome(cachedJava)
        const cachedJavac = (store.get(CONFIG_KEY_JAVAC_PATH) as string) || null
        const javacPath = cachedJavac && fs.existsSync(cachedJavac) ? cachedJavac : this._resolveJavac(javaHome)
        return {
          ready: true,
          javaPath: cachedJava,
          javacPath,
          javaHome,
          source: javaHome?.includes(getDefaultJavaDir()) ? 'managed' : 'system',
          version,
          isJdk: Boolean(javacPath),
          javaHomeEnv: process.env.JAVA_HOME || null,
        }
      }
      store.delete(CONFIG_KEY_JAVA_PATH)
      store.delete(CONFIG_KEY_JAVAC_PATH)
      store.delete(CONFIG_KEY_JAVA_HOME)
      store.delete(CONFIG_KEY_VERSION)
    }

    // 步骤 2：系统 JDK
    const systemJava = await this._detectSystemJava()
    if (!systemJava) return null

    logger.system.info(`[JavaManager] Found system Java: ${systemJava.javaPath} (${systemJava.version})`)
    this.notifyStatus(`已检测到系统 Java (${systemJava.version})`)
    store.set(CONFIG_KEY_JAVA_PATH, systemJava.javaPath)
    store.set(CONFIG_KEY_JAVAC_PATH, systemJava.javacPath || '')
    if (systemJava.javaHome) store.set(CONFIG_KEY_JAVA_HOME, systemJava.javaHome)
    store.set(CONFIG_KEY_VERSION, systemJava.version)

    return {
      ready: true,
      javaPath: systemJava.javaPath,
      javacPath: systemJava.javacPath,
      javaHome: systemJava.javaHome,
      source: 'system',
      version: systemJava.version,
      isJdk: Boolean(systemJava.javacPath),
      javaHomeEnv: process.env.JAVA_HOME || null,
    }
  }

  /**
   * 确保 Java 运行时就绪。
   * 已就绪直接返回；正在初始化则等待；否则执行检测与按需安装。幂等可重入。
   */
  async ensureReady(): Promise<JavaStatus> {
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
      logger.system.error('[JavaManager] ensureReady failed:', err)
      this._status.error = toAppError(err).message
    } finally {
      this.initializing = false
    }
    return this.status
  }

  /**
   * 初始化流程：
   * 1. 缓存路径有效 → 直接使用
   * 2. 检测系统 JDK → 找到则使用
   * 3. 自动下载 Temurin JDK → 安装到 {userData}/java-env/jdk
   * 4. 全部失败 → 标记不可用
   */
  private async _ensureReady(): Promise<void> {
    logger.system.info('[JavaManager] Starting Java environment setup...')
    this.notifyStatus('正在检查 Java 运行环境...')

    // 步骤 1 + 2：缓存 / 系统 JDK
    const local = await this._resolveLocalJava()
    if (local) {
      this._status = local
      this.detected = true
      return
    }

    // 步骤 3：托管安装
    logger.system.info('[JavaManager] No system Java found, attempting managed installation...')
    this.notifyStatus('未检测到 Java，正在自动下载 Temurin JDK...')

    const managed = await this._installManagedJava()
    if (managed) {
      this.notifyStatus(`Java 安装完成 (${managed.version})`)
      this._status = {
        ready: true,
        javaPath: managed.javaPath,
        javacPath: managed.javacPath,
        javaHome: managed.javaHome,
        source: 'managed',
        version: managed.version,
        isJdk: Boolean(managed.javacPath),
        javaHomeEnv: process.env.JAVA_HOME || null,
      }
      store.set(CONFIG_KEY_JAVA_PATH, managed.javaPath)
      store.set(CONFIG_KEY_JAVAC_PATH, managed.javacPath || '')
      store.set(CONFIG_KEY_JAVA_HOME, managed.javaHome)
      store.set(CONFIG_KEY_VERSION, managed.version)
      this.detected = true
      return
    }

    // 步骤 4：失败
    logger.system.warn('[JavaManager] Java environment setup failed - Java features will be unavailable')
    this._status = this._unavailableStatus(
      '未找到 Java 环境且自动安装失败，可从 https://adoptium.net 手动安装 JDK 后指定路径'
    )
    this.detected = true
  }
  /**
   * 通过用户的登录 shell 探测 java 路径与 JAVA_HOME。
   *
   * Electron 主进程的环境变量来自 launchd，不包含 ~/.zshrc / ~/.bash_profile
   * 里配置的 PATH 与 JAVA_HOME，导致终端可用的 Java 在应用内探测不到。
   * 这里先尝试登录 shell，再退到交互式登录 shell（部分配置只在交互模式加载）。
   */
  private async _probeShellJava(): Promise<{ javaPath: string | null; javaHome: string | null }> {
    const empty = { javaPath: null, javaHome: null }
    if (process.platform === 'win32') return empty

    const shell = process.env.SHELL
    if (!shell || !fs.existsSync(shell)) return empty

    const script = 'echo "__AC_JH__${JAVA_HOME}"; echo "__AC_JP__$(command -v java 2>/dev/null)"'

    for (const flags of [['-lc'], ['-lic']]) {
      const { stdout } = await execCommandAsync(shell, [...flags, script], { timeout: 15_000 })
      const javaHomeRaw = stdout.match(/__AC_JH__(.*)/)?.[1]?.trim() || ''
      const javaPathRaw = stdout.match(/__AC_JP__(.*)/)?.[1]?.trim() || ''
      if (!javaHomeRaw && !javaPathRaw) continue

      const javaPath = javaPathRaw && fs.existsSync(javaPathRaw) ? javaPathRaw : null
      const javaHome = javaHomeRaw && looksLikeJavaHome(javaHomeRaw) ? javaHomeRaw : null
      if (javaPath || javaHome) {
        logger.system.info(`[JavaManager] Shell probe: javaHome=${javaHome || '-'} java=${javaPath || '-'}`)
        return { javaPath, javaHome }
      }
    }
    return empty
  }

  /**
   * 检测系统已安装的 JDK。
   * 搜索顺序：JAVA_HOME → PATH → 平台专用探测（macOS java_home）→ 常见安装目录
   */
  private async _detectSystemJava(): Promise<{
    javaPath: string
    javacPath: string | null
    javaHome: string | null
    version: string
  } | null> {
    const candidates: string[] = []

    const javaHomeEnv = process.env.JAVA_HOME
    if (javaHomeEnv) {
      candidates.push(path.join(javaHomeEnv, 'bin', getExecutableName('java')))
    }

    const onPath = resolveCommandPath('java')
    if (onPath) candidates.push(onPath)

    // 图形界面启动的应用只继承 launchd 的最小环境，用户在 shell 配置里
    // 声明的 PATH / JAVA_HOME（sdkman、jenv、brew openjdk 等）读不到，
    // 会出现"终端里 java 可用、应用里找不到 Java"的偏差，这里向登录 shell 借一次环境
    const shellJava = await this._probeShellJava()
    if (shellJava.javaHome) {
      candidates.push(path.join(shellJava.javaHome, 'bin', getExecutableName('java')))
    }
    if (shellJava.javaPath) candidates.push(shellJava.javaPath)

    // macOS：/usr/libexec/java_home 能拿到当前注册的 JDK 根目录
    if (process.platform === 'darwin') {
      const { stdout, code } = await execCommandAsync('/usr/libexec/java_home', [], { timeout: 10_000 })
      const home = stdout.trim()
      if (code === 0 && home) {
        candidates.push(path.join(home, 'bin', 'java'))
      }
    }

    // 常见安装目录：扫描 JDK 根目录
    for (const dir of getCommonJavaHomeDirs()) {
      candidates.push(...this._scanJavaHomes(dir))
    }

    // 逐个验证版本；全部收集后优先选完整 JDK（含 javac），避免命中
    // macOS /usr/bin/java 这类转发到 JRE 的包装器而错过真正的 JDK
    const collected: Array<{
      javaPath: string
      javacPath: string | null
      javaHome: string | null
      version: string
    }> = []

    for (const candidate of Array.from(new Set(candidates))) {
      if (!candidate || !fs.existsSync(candidate)) continue
      const version = await this._getJavaVersion(candidate)
      if (!version) continue
      const javaHome = this._safeJavaHome(candidate)
      collected.push({
        javaPath: candidate,
        javacPath: this._resolveJavac(javaHome),
        javaHome,
        version,
      })
    }

    if (collected.length === 0) return null
    return collected.find((c) => c.javacPath) || collected[0]
  }

  /**
   * 扫描目录下的 JDK 根目录，返回其中的 bin/java 路径。
   * 兼容 macOS 的 *.jdk/Contents/Home 结构。
   */
  private _scanJavaHomes(dir: string): string[] {
    const javaExe = getExecutableName('java')
    const found: string[] = []

    const pushIfJavaHome = (home: string) => {
      if (!looksLikeJavaHome(home)) return
      found.push(path.join(home, 'bin', javaExe))
    }

    try {
      if (!fs.existsSync(dir)) return found
      // 目录本身可能就是 JDK 根目录
      pushIfJavaHome(dir)

      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const child = path.join(dir, entry.name)
        pushIfJavaHome(child)
        // macOS：xxx.jdk/Contents/Home
        pushIfJavaHome(path.join(child, 'Contents', 'Home'))
      }
    } catch {
      // 目录不可读时忽略
    }
    return found
  }

  /** 从 java 可执行路径反推 JDK 根目录（macOS 的 Contents/Home 结构同样适用） */
  private _resolveHomeFromJavaBinary(javaPath: string): string {
    const marker = `${path.sep}bin${path.sep}${getExecutableName('java')}`
    if (javaPath.endsWith(marker)) {
      const home = javaPath.slice(0, -marker.length)
      if (home) return home
    }
    return path.dirname(path.dirname(javaPath))
  }

  /**
   * 反推 java 所属的 JDK 根目录，并对结果做校验。
   *
   * 系统 java 常是转发用的包装器（macOS 的 /usr/bin/java、Windows 的
   * C:\Program Files\Common Files\Oracle\Java\javapath\java.exe），
   * 按路径反推会得到 /usr 这类无效根目录，因此：
   * 1. 反推目录下必须真的存在 bin/java；
   * 2. 否则按 realpath 解析符号链接后再推一次；
   * 3. 仍不可信则返回 null（不知道就说不知道，不编一个假 JAVA_HOME）。
   */
  private _safeJavaHome(javaPath: string): string | null {
    const guessed = this._resolveHomeFromJavaBinary(javaPath)
    if (looksLikeJavaHome(guessed)) return guessed

    try {
      const real = fs.realpathSync(javaPath)
      if (real !== javaPath) {
        const realHome = this._resolveHomeFromJavaBinary(real)
        if (looksLikeJavaHome(realHome)) return realHome
      }
    } catch {
      // realpath 失败时保持 null
    }
    return null
  }

  /** 在 JDK 根目录中定位 javac，找不到返回 null */
  private _resolveJavac(javaHome: string | null): string | null {
    if (!javaHome) return null
    const javac = path.join(javaHome, 'bin', getExecutableName('javac'))
    return fs.existsSync(javac) ? javac : null
  }

  /** 获取 Java 版本号，如 '21.0.2'；失败返回 null */
  private async _getJavaVersion(javaPath: string): Promise<string | null> {
    try {
      // java -version 把版本信息写到 stderr
      const { stderr, stdout, code } = await execCommandAsync(javaPath, ['-version'], { timeout: 10_000 })
      const output = `${stderr}\n${stdout}`
      if (code !== 0 && !output.trim()) return null
      const quoted = output.match(/version "([^"]+)"/)
      if (quoted) return quoted[1]
      const plain = output.match(/openjdk\s+([\d._]+)/)
      return plain ? plain[1] : null
    } catch {
      return null
    }
  }

  /**
   * 下载并安装 Temurin JDK 到 {userData}/java-env/jdk
   * @returns 安装结果，失败返回 null
   */
  private async _installManagedJava(): Promise<{
    javaPath: string
    javacPath: string | null
    javaHome: string
    version: string
  } | null> {
    const os = getAdoptiumOs()
    const arch = getAdoptiumArch()
    const ext = process.platform === 'win32' ? '.zip' : '.tar.gz'
    const officialUrl =
      `https://api.adoptium.net/v3/binary/latest/${JAVA_FEATURE_VERSION}/ga/${os}/${arch}/jdk/hotspot/normal/eclipse`

    this.notifyStatus('正在获取 JDK 推荐下载源...')
    const backendUrl = await resolveBackendAssetUrl()
    const downloadUrl = backendUrl || officialUrl
    const sourceName = backendUrl ? '后端托管源' : 'Adoptium 官方'

    logger.system.info(`[JavaManager] Downloading JDK ${JAVA_FEATURE_VERSION} from: ${downloadUrl} (${sourceName})`)
    this.notifyStatus(`正在下载 JDK ${JAVA_FEATURE_VERSION}（${sourceName}）...`)

    const tmpDir = path.join(getDefaultJavaDir(), 'tmp')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
    const archivePath = path.join(tmpDir, `temurin-jdk-${JAVA_FEATURE_VERSION}${ext}`)
    const extractDir = path.join(tmpDir, 'extract')

    try {
      try {
        await downloadFile(downloadUrl, archivePath)
      } catch (downloadErr) {
        if (backendUrl) {
          logger.system.warn('[JavaManager] Backend download failed, falling back to Adoptium:', downloadErr)
          this.notifyStatus('后端源下载失败，回退到 Adoptium 官方...')
          await downloadFile(officialUrl, archivePath)
        } else {
          throw downloadErr
        }
      }

      logger.system.info('[JavaManager] Download complete, extracting...')
      this.notifyStatus('下载完成，正在解压...')
      await extractArchive(archivePath, extractDir)

      const extractedRoot = this._findExtractedRoot(extractDir)
      if (!extractedRoot) {
        logger.system.error('[JavaManager] Cannot find JDK root directory in extracted archive')
        return null
      }

      const finalDir = path.join(getDefaultJavaDir(), 'jdk')
      if (fs.existsSync(finalDir)) {
        fs.rmSync(finalDir, { recursive: true, force: true })
      }
      if (!fs.existsSync(getDefaultJavaDir())) {
        fs.mkdirSync(getDefaultJavaDir(), { recursive: true })
      }
      // 保留压缩包里的完整目录结构（macOS 的 jdk-xxx.jdk/Contents/Home 结构不能被拉平）
      // rename 跨设备可能失败，回退到递归复制
      try {
        fs.renameSync(extractedRoot, finalDir)
      } catch {
        this._copyDirRecursive(extractedRoot, finalDir)
      }

      const javaHome = this._findHomeInside(finalDir)
      if (!javaHome) {
        logger.system.error(`[JavaManager] Installed JDK is missing java binary under ${finalDir}`)
        return null
      }

      const javaExe = path.join(javaHome, 'bin', getExecutableName('java'))
      const javacExe = path.join(javaHome, 'bin', getExecutableName('javac'))

      // Unix 下恢复可执行权限（tar 解压通常保留，复制兜底时会丢）
      if (process.platform !== 'win32') {
        const binDir = path.join(javaHome, 'bin')
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

      const version = (await this._getJavaVersion(javaExe)) || String(JAVA_FEATURE_VERSION)
      logger.system.info(`[JavaManager] JDK installed at: ${finalDir} (${version})`)

      return {
        javaPath: javaExe,
        javacPath: fs.existsSync(javacExe) ? javacExe : null,
        javaHome,
        version,
      }
    } catch (err) {
      logger.system.error('[JavaManager] JDK installation failed:', err)
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      return null
    }
  }

  /**
   * 找出解压结果中的顶层目录。
   * Adoptium 包解压后通常是单一目录：jdk-21.0.2+13/
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

  /**
   * 在给定目录中定位真正的 JDK 根目录（含 bin/java）。
   * 兼容 macOS 的 Contents/Home 结构。
   */
  private _findHomeInside(dir: string): string | null {
    const candidates = [dir, path.join(dir, 'Contents', 'Home')]
    const hit = candidates.find((candidate) => looksLikeJavaHome(candidate))
    return hit || null
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
   * 重新安装 Java 运行时（清除缓存与托管目录后重新检测/下载）
   */
  async reinstall(): Promise<JavaStatus> {
    logger.system.info('[JavaManager] Reinstalling Java environment...')

    store.delete(CONFIG_KEY_JAVA_PATH)
    store.delete(CONFIG_KEY_JAVAC_PATH)
    store.delete(CONFIG_KEY_JAVA_HOME)
    store.delete(CONFIG_KEY_VERSION)

    try {
      if (fs.existsSync(getDefaultJavaDir())) {
        fs.rmSync(getDefaultJavaDir(), { recursive: true, force: true })
      }
    } catch (err) {
      logger.system.warn('[JavaManager] Failed to clean java-env dir:', err)
    }

    this._status = {
      ready: false,
      javaPath: null,
      javacPath: null,
      javaHome: null,
      source: 'none',
      version: null,
      isJdk: false,
      javaHomeEnv: process.env.JAVA_HOME || null,
    }
    this.detected = false

    return this.ensureReady()
  }

  /**
   * 设置自定义 Java 路径。
   * @param customPath java 可执行文件路径或 JDK 根目录，传 null 清除自定义路径
   */
  async setCustomJavaPath(customPath: string | null): Promise<JavaStatus> {
    if (customPath) {
      const javaPath = this._normalizeJavaBinary(customPath)
      if (!javaPath) {
        return { ...this._status, ready: false, error: `无效的 Java 路径：${customPath}` }
      }
      const version = await this._getJavaVersion(javaPath)
      if (!version) {
        return { ...this._status, ready: false, error: `无法执行该 java 可执行文件：${javaPath}` }
      }
      const javaHome = this._safeJavaHome(javaPath)
      const javacPath = this._resolveJavac(javaHome)
      this._status = {
        ready: true,
        javaPath,
        javacPath,
        javaHome,
        source: 'system',
        version,
        isJdk: Boolean(javacPath),
        javaHomeEnv: process.env.JAVA_HOME || null,
      }
      store.set(CONFIG_KEY_JAVA_PATH, javaPath)
      store.set(CONFIG_KEY_JAVAC_PATH, javacPath || '')
      store.set(CONFIG_KEY_JAVA_HOME, javaHome || '')
      store.set(CONFIG_KEY_VERSION, version)
      this.detected = true
      return this.status
    }

    store.delete(CONFIG_KEY_JAVA_PATH)
    store.delete(CONFIG_KEY_JAVAC_PATH)
    store.delete(CONFIG_KEY_JAVA_HOME)
    store.delete(CONFIG_KEY_VERSION)
    this._status = {
      ready: false,
      javaPath: null,
      javacPath: null,
      javaHome: null,
      source: 'none',
      version: null,
      isJdk: false,
      javaHomeEnv: process.env.JAVA_HOME || null,
    }
    this.detected = false
    return this.status
  }

  /** 把用户选择的路径规范化为 java 可执行文件路径 */
  private _normalizeJavaBinary(input: string): string | null {
    const javaExe = getExecutableName('java')
    if (!fs.existsSync(input)) return null

    const stat = fs.statSync(input)
    if (stat.isDirectory()) {
      const candidates = [
        path.join(input, javaExe),
        path.join(input, 'bin', javaExe),
        path.join(input, 'Contents', 'Home', 'bin', javaExe),
      ]
      return candidates.find((p) => fs.existsSync(p)) || null
    }
    return input
  }
}

/** 单例 */
export const javaManager = JavaManager.getInstance()
