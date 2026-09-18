/**
 * Python 环境管理器
 *
 * 功能：
 * - 自动检测系统 Python
 * - 自动下载安装 uv 工具
 * - 通过 uv 安装 Python 运行时
 * - 创建虚拟环境并安装基础包（debugpy、pylint）
 * - 提供统一的 Python/uv 路径给各消费方
 */

import { app } from 'electron'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as https from 'https'
import { logger } from '@shared/toolkit/LogEngine'
import { toAppError } from '@shared/toolkit/errorCatalog'
import Store from 'electron-store'
import { BRAND } from '@shared/brand'

/**
 * 懒初始化 electron-store
 *
 * 不能在模块顶层直接 `new Store(...)`：electron-store 依赖 Electron `app`，
 * 而 `app` 只在 Electron 主进程里存在。顶层实例化会让任何 import 本模块的代码
 * （例如 terminalSandbox → python-runtime）在普通 Node 环境（单测、CLI 工具）
 * 直接抛 "Cannot read properties of undefined (reading 'getPath')"。
 * 用 Proxy 把构造推迟到首次真正读写配置时，调用点写法保持不变。
 */
let _store: Store | null = null
function getStore(): Store<Record<string, unknown>> {
  if (!_store) {
    _store = new Store({ name: 'python-config' })
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

const CONFIG_KEY_PYTHON_PATH = 'pythonPath'
const CONFIG_KEY_UV_PATH = 'uvPath'
const CONFIG_KEY_UVX_PATH = 'uvxPath'
const CONFIG_KEY_VENV_DIR = 'venvDir'
const CONFIG_KEY_VENV_BASE_VERSION = 'venvBaseVersion'
const CONFIG_KEY_STATUS = 'status'

/**
 * 受管 Python 根目录（懒求值）
 *
 * 同样不能在模块顶层调用 `app.getPath()`：`app` 在非 Electron 环境不存在。
 * 改为首次使用时解析并缓存，保证 import 本模块无副作用。
 */
let _defaultPythonDir: string | null = null
function getDefaultPythonDir(): string {
  if (!_defaultPythonDir) {
    _defaultPythonDir = path.join(app.getPath('userData'), 'python-env')
  }
  return _defaultPythonDir
}
const PYTHON_VERSION = '3.11'
const BASE_PACKAGES = ['debugpy', 'pylint']

/**
 * 受管 venv 基底的最低 Python 版本
 *
 * 为什么是 3.10 而不是「跟随系统」：
 * 插件的 Python 工具链（img2threejs 的 forge 等）普遍使用 3.10+ 语法
 * （`match`、`X | Y` 类型标注、`dataclass(slots=True)`、`zip(strict=True)`），
 * 而 macOS 自带的 /usr/bin/python3 是 3.9，用它建的 venv 会让这些脚本直接
 * SyntaxError。抬高下限对所有消费方都是安全的——3.10+ 是 3.9 的严格超集，
 * 本地 ASR/TTS 等既有功能不会因此失去任何能力。
 */
const MIN_VENV_BASE_VERSION: readonly [number, number] = [3, 10]

/** `[major, minor]` 版本元组 */
export type VersionTuple = readonly [number, number]

/** 解析 `"3.11.16"` / `"3.9"` → `[3, 11]` / `[3, 9]`；无法解析返回 null */
function parseVersionTuple(version: string | null | undefined): VersionTuple | null {
  if (typeof version !== 'string') return null
  const m = version.match(/^(\d+)\.(\d+)/)
  if (!m) return null
  return [Number(m[1]), Number(m[2])]
}

/** 判断版本是否满足下限（主版本不同时以主版本为准，如 4.0 ≥ 3.10） */
function isVersionSatisfied(
  version: string | null | undefined,
  required: VersionTuple,
): boolean {
  const parsed = parseVersionTuple(version)
  if (!parsed) return false
  if (parsed[0] !== required[0]) return parsed[0] > required[0]
  return parsed[1] >= required[1]
}

/** 取两个版本元组中较严者 */
function maxVersion(a: VersionTuple, b: VersionTuple): VersionTuple {
  if (a[0] !== b[0]) return a[0] > b[0] ? a : b
  return a[1] >= b[1] ? a : b
}

/** `[3, 10]` → `"3.10"` */
function formatVersion(v: VersionTuple): string {
  return `${v[0]}.${v[1]}`
}


/**
 * uv 下载源列表（按优先级排序）
 *
 * 国内网络优化策略：
 * 1. ghfast.top（GitHub 加速，稳定性和速度较好）
 * 2. gh-proxy.com（GitHub 加速镜像）
 * 3. ghproxy.net（GitHub 加速，备选）
 * 4. GitHub 官方（海外用户/直连可用时）
 *
 * 注意：镜像源 URL 格式为 https://镜像域名/https://github.com/...
 */
const UV_DOWNLOAD_URLS: Record<string, string[]> = {
  'darwin-arm64': [
    'https://ghfast.top/https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz',
    'https://gh-proxy.com/https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz',
    'https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-apple-darwin.tar.gz',
  ],
  'darwin-x64': [
    'https://ghfast.top/https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-apple-darwin.tar.gz',
    'https://gh-proxy.com/https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-apple-darwin.tar.gz',
    'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-apple-darwin.tar.gz',
  ],
  'win32-x64': [
    'https://ghfast.top/https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip',
    'https://gh-proxy.com/https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip',
    'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-pc-windows-msvc.zip',
  ],
  'linux-x64': [
    'https://ghfast.top/https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz',
    'https://gh-proxy.com/https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz',
    'https://github.com/astral-sh/uv/releases/latest/download/uv-x86_64-unknown-linux-gnu.tar.gz',
  ],
  'linux-arm64': [
    'https://ghfast.top/https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-unknown-linux-gnu.tar.gz',
    'https://gh-proxy.com/https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-unknown-linux-gnu.tar.gz',
    'https://github.com/astral-sh/uv/releases/latest/download/uv-aarch64-unknown-linux-gnu.tar.gz',
  ],
}

/**
 * Python 下载镜像源列表（用于 UV_PYTHON_INSTALL_MIRROR 环境变量）
 *
 * uv python install 默认从 GitHub python-build-standalone 下载 Python，
 * 国内直连 GitHub 极慢或失败。通过 UV_PYTHON_INSTALL_MIRROR 环境变量
 * 指定镜像前缀，让 uv 从国内镜像下载。
 *
 * python-build-standalone 仓库已从 indygreg 迁移到 astral-sh（2024年），
 * uv 0.12+ 已同步更新，请使用 astral-sh 路径。
 *
 * 镜像 URL 格式：https://镜像域名/https://github.com/astral-sh/python-build-standalone/releases/download
 * uv 会自动拼接 /<tag>/cpython-<version>+<date>-<platform>.tar.gz
 *
 * 依次尝试，任一成功即可。
 */
const PYTHON_DOWNLOAD_MIRRORS: string[] = [
  'https://ghfast.top/https://github.com/astral-sh/python-build-standalone/releases/download',
  'https://gh-proxy.com/https://github.com/astral-sh/python-build-standalone/releases/download',
  // GitHub 官方（海外用户/直连可用时的最终回退）
  'https://github.com/astral-sh/python-build-standalone/releases/download',
]

/**
 * 解释器候选链的单条诊断
 *
 * 存在的意义：`_ensureReady` 会依次尝试「缓存 → 系统 → 受管目录 → uv 安装」，
 * 每步都可能因版本或路径被否决。以前这些否决只写进日志，调用方（设置页、插件）
 * 看到的只是一个 `ready: false` 或一个版本不明的解释器，无法回答
 * 「我的 3.11 明明装好了，为什么还在用 3.9」。
 */
export interface PythonCandidateDiagnostic {
  /** 候选来源 */
  kind: 'cached' | 'system' | 'managed' | 'uv-install' | 'manual'
  /** 候选解释器绝对路径（uv-install 失败时为空串） */
  path: string
  version: string | null
  accepted: boolean
  /** 被接受的原因，或被否决的具体理由 */
  reason: string
}

/** 一次解释器解析的完整候选链诊断 */
export interface PythonSelectionDiagnostic {
  /** 本次要求的最低版本，如 "3.10" */
  requiredVersion: string
  candidates: PythonCandidateDiagnostic[]
  /** 最终结论（成功选用哪个，或失败原因） */
  outcome: string
}

/** `ensureReady` 的可选参数 */
export interface PythonReadyOptions {
  /**
   * 调用方要求的最低 Python 版本，如 `[3, 10]`。
   *
   * 与全局下限 `MIN_VENV_BASE_VERSION` 取较严者——传一个更低的版本**不会**降级环境，
   * 只会让调用方以更宽松的要求复用同一个 venv（venv 是全局共享的，不能因人而降级）。
   */
  minVersion?: VersionTuple
  /** 忽略已缓存的解释器，强制按当前要求重新解析（设置页「切换到受管运行时」用） */
  forceRefresh?: boolean
}

export interface PythonStatus {
  ready: boolean
  pythonPath: string | null
  uvPath: string | null
  uvxPath: string | null
  source: 'system' | 'managed' | 'none'
  version: string | null
  venvDir: string | null
  /**
   * venv 基底解释器版本
   *
   * `version` 是 venv 内 python 的版本，两者通常一致；分开记录是为了让
   * 「venv 建立在 3.9 之上」这种状态可以被直接观察到，而不是从路径去猜。
   */
  venvBaseVersion?: string | null
  installedPackages: string[]
  /** 最近一次解释器解析的候选链诊断 */
  diagnostics?: PythonSelectionDiagnostic
  error?: string
}

function getPlatformKey(): string {
  return `${process.platform}-${process.arch}`
}

function getUvDownloadUrls(): string[] {
  return UV_DOWNLOAD_URLS[getPlatformKey()] || []
}

/**
 * 后端服务器地址（从 aweeclaw-config.json 读取）
 *
 * 客户端首次启动时由 appBootstrap 创建配置文件，
 * 包含 serverUrl 字段（默认 https://gateway.aweeclaw.com）。
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
 * 管理员在后台管理上传二进制到对象存储后，在此登记下载地址。
 * 客户端优先使用后端返回的地址，失败后回退到 GitHub 镜像列表。
 *
 * @param assetKey 工具包标识：'uv' | 'python' | 'node'
 * @returns 下载地址（后端未登记则返回 null）
 */
async function resolveBackendAssetUrl(assetKey: 'uv' | 'python' | 'node'): Promise<string | null> {
  const serverUrl = getBackendServerUrl()
  if (!serverUrl) return null

  const platform = getPlatformKey()
  const url = `${serverUrl}/api/v1/runtime-assets/resolve?assetKey=${assetKey}&platform=${platform}`

  try {
    const response = await fetch(url, { method: 'GET' })
    if (!response.ok) {
      logger.system.warn(`[PythonManager] Backend resolve ${assetKey} HTTP ${response.status}`)
      return null
    }
    const data = await response.json()
    if (data && data.downloadUrl) {
      logger.system.info(`[PythonManager] Backend resolved ${assetKey}: ${data.downloadUrl}`)
      return data.downloadUrl as string
    }
    return null
  } catch (err) {
    logger.system.warn(`[PythonManager] Backend resolve ${assetKey} failed:`, err)
    return null
  }
}

function getCommonBinaryDirs(): string[] {
  if (process.platform === 'win32') {
    return [
      'C:\\Python312',
      'C:\\Python311',
      'C:\\Python310',
      'C:\\Python39',
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python312'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python311'),
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python310'),
      // uv 官方安装程序（Windows）： %USERPROFILE%\.local\bin
      path.join(process.env.USERPROFILE || '', '.local', 'bin'),
      // Scoop 安装路径
      path.join(process.env.USERPROFILE || '', 'scoop', 'shims'),
      // Chocolatey 安装路径
      'C:\\ProgramData\\chocolatey\\bin',
    ]
  }
  const home = process.env.HOME || ''
  return [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/opt/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    // uv 官方安装程序（curl -LsSf https://astral.sh/uv/install.sh | sh）安装位置
    path.join(home, '.local', 'bin'),
    // cargo 安装的 uv 位置
    path.join(home, '.cargo', 'bin'),
    // bun 安装位置（未来兼容）
    path.join(home, '.bun', 'bin'),
    // nvm 默认路径（部分用户 uv 通过 npm 全局安装）
    path.join(home, '.nvm', 'versions', 'node'),
    // asdf 版本管理器
    path.join(home, '.asdf', 'shims'),
    // volta
    path.join(home, '.volta', 'bin'),
  ]
}

/**
 * 缓存的用户完整 PATH（从登录 shell 解析）
 *
 * macOS GUI 应用从 launchd 继承精简的 PATH（通常只有 /usr/bin:/bin:/usr/sbin:/sbin），
 * 不包含 ~/.local/bin、~/.cargo/bin 等用户自定义路径。
 * 这导致用户在终端安装的 uv/uvx 无法被客户端检测到。
 *
 * 解决方案：通过登录 shell（-l -i）解析用户完整的 PATH 环境变量。
 */
let cachedUserPath: string | null = null
let userPathResolvePromise: Promise<string | null> | null = null

/**
 * 通过登录 shell 解析用户完整的 PATH 环境变量。
 *
 * macOS GUI 应用从 launchd 继承的 PATH 通常只有 /usr/bin:/bin:/usr/sbin:/sbin，
 * 不包含 ~/.local/bin（uv 官方安装位置）、~/.cargo/bin（cargo 安装位置）等路径。
 * 这导致用户在终端 `uv --version` 能用，但客户端无法检测到 uv。
 *
 * 解决方案：以登录交互式 shell 方式运行 echo $PATH，获取用户 shell 配置
 * （.zshrc/.bashrc/.zprofile/.bash_profile）中定义的完整 PATH。
 *
 * @returns 用户完整 PATH，或 null（解析失败）
 */
function resolveUserShellPath(): Promise<string | null> {
  if (cachedUserPath !== null) return Promise.resolve(cachedUserPath)
  if (userPathResolvePromise) return userPathResolvePromise

  userPathResolvePromise = new Promise((resolve) => {
    // Windows 没有 shell PATH 问题，直接返回 null
    if (process.platform === 'win32') {
      cachedUserPath = null
      resolve(null)
      return
    }

    // 用户的默认 shell（$SHELL），回退到 /bin/zsh（macOS 默认）或 /bin/bash
    const userShell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')

    // 使用 -l（登录 shell）+ -i（交互式）确保加载 .zprofile/.zshrc 或 .bash_profile/.bashrc
    // 通过 echo $PATH 获取完整 PATH
    const proc = spawn(userShell, ['-l', '-i', '-c', 'echo $PATH'], {
      timeout: 5000,
      env: { ...process.env },
    })

    let stdout = ''
    let settled = false

    const finish = (result: string | null) => {
      if (settled) return
      settled = true
      cachedUserPath = result
      userPathResolvePromise = null
      resolve(result)
    }

    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.on('close', (code) => {
      if (code === 0 && stdout.trim()) {
        const resolvedPath = stdout.trim()
        logger.system.info(`[PythonManager] Resolved user shell PATH: ${resolvedPath}`)
        finish(resolvedPath)
      } else {
        logger.system.warn(`[PythonManager] Shell PATH resolution failed (code=${code}), using common dirs only`)
        finish(null)
      }
    })
    proc.on('error', (err) => {
      logger.system.warn(`[PythonManager] Shell PATH resolution error: ${err.message}`)
      finish(null)
    })
    proc.on('timeout', () => {
      logger.system.warn('[PythonManager] Shell PATH resolution timed out')
      try { proc.kill() } catch { /* ignore */ }
      finish(null)
    })
  })

  return userPathResolvePromise
}

/**
 * 获取增强后的 PATH 环境变量。
 *
 * 合并三个来源：
 * 1. 当前进程 PATH（launchd 继承的精简 PATH）
 * 2. 用户登录 shell 解析的完整 PATH（含 ~/.local/bin 等）
 * 3. 预定义的常见二进制目录（getCommonBinaryDirs）
 *
 * @param userShellPath 可选：已解析的用户 shell PATH（避免重复解析）
 */
function getAugmentedPathEnv(userShellPath?: string | null): string {
  const existing = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  const shellPath = userShellPath
    ? userShellPath.split(path.delimiter).filter(Boolean)
    : []
  const common = getCommonBinaryDirs()
  const merged = [...existing, ...shellPath, ...common]
  return Array.from(new Set(merged)).join(path.delimiter)
}

function resolveCommandPath(cmd: string, augmentedPath?: string): string | null {
  if (!cmd) return null
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return cmd

  const searchDirs = (augmentedPath || getAugmentedPathEnv()).split(path.delimiter).filter(Boolean)
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
 * 异步解析命令路径（含用户 shell PATH）。
 *
 * 先解析用户登录 shell 的完整 PATH，再合并预定义目录搜索。
 * 用于 uv/uvx/python 等命令的检测，解决 macOS GUI 应用 PATH 不完整问题。
 *
 * @param cmd 命令名（如 'uv'、'python3'）
 * @returns 命令绝对路径，或 null（未找到）
 */
async function resolveCommandPathAsync(cmd: string): Promise<string | null> {
  if (!cmd) return null
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return cmd

  const userShellPath = await resolveUserShellPath()
  const augmentedPath = getAugmentedPathEnv(userShellPath)
  return resolveCommandPath(cmd, augmentedPath)
}

/**
 * 预初始化：提前解析用户 shell PATH 并缓存。
 *
 * 在应用启动时调用，避免首次 uv 检测时的 5 秒等待。
 * 解析结果缓存在 cachedUserPath 中，后续调用立即返回。
 */
async function prewarmUserShellPath(): Promise<void> {
  await resolveUserShellPath()
}

function execCommandAsync(command: string, args: string[], options?: { cwd?: string; timeout?: number; env?: Record<string, string> }): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    // timeout = 0 表示不限制超时（AI 执行命令时取消超时限制）
    // 仅在显式指定正数超时的情况下才设置定时器
    const effectiveTimeout = options?.timeout && options.timeout > 0 ? options.timeout : undefined
    const proc = spawn(command, args, {
      cwd: options?.cwd,
      timeout: effectiveTimeout,
      env: { ...process.env, ...(options?.env || {}), PATH: getAugmentedPathEnv(cachedUserPath) },
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (data: Buffer) => { stdout += data.toString() })
    proc.stderr?.on('data', (data: Buffer) => { stderr += data.toString() })
    proc.on('close', (code) => resolve({ stdout, stderr, code: code ?? 1 }))
    proc.on('error', (err) => resolve({ stdout, stderr: err.message, code: 1 }))
  })
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const file = fs.createWriteStream(destPath)
    const request = (targetUrl: string) => {
      https.get(targetUrl, { timeout: 120000 }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          const redirectUrl = res.headers.location
          if (redirectUrl) {
            res.resume()
            request(redirectUrl)
            return
          }
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`))
          return
        }
        res.pipe(file)
        file.on('finish', () => {
          file.close()
          resolve()
        })
      }).on('error', (err) => {
        fs.unlinkSync(destPath)
        reject(err)
      }).on('timeout', () => {
        fs.unlinkSync(destPath)
        reject(new Error('Download timeout'))
      })
    }
    request(url)
  })
}

function extractArchive(archivePath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })

    if (archivePath.endsWith('.zip')) {
      const proc = spawn('unzip', ['-o', archivePath, '-d', destDir], { timeout: 60000 })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`unzip failed with code ${code}`))
      })
      proc.on('error', reject)
    } else {
      const proc = spawn('tar', ['-xzf', archivePath, '-C', destDir], { timeout: 60000 })
      proc.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`tar failed with code ${code}`))
      })
      proc.on('error', reject)
    }
  })
}

class PythonManager {
  private static instance: PythonManager | null = null
  private _status: PythonStatus = {
    ready: false,
    pythonPath: null,
    uvPath: null,
    uvxPath: null,
    source: 'none',
    version: null,
    venvDir: null,
    venvBaseVersion: null,
    installedPackages: [],
  }
  private initializing = false
  /**
   * 已经失败过的版本要求（形如 "3.12"）
   *
   * 作用是把「失败」变成一个可记忆的结论：调用方（插件每次执行前都会 resolve）在
   * 环境装不上时会反复触发 ensureReady，没有这道闸门，每次调用都会重新下载一遍
   * Python，把一次失败放大成持续的带宽与磁盘消耗。
   */
  private readonly _failedRequirements = new Set<string>()

  /**
   * 状态回调：用于向外部（如 PluginInstaller）报告 uv/Python 安装进度。
   * 设置后，_ensureUv / _installUv / _installUvViaPip 等方法会通过此回调发送状态消息。
   */
  private statusCallback: ((message: string) => void) | null = null

  private constructor() {}

  /**
   * 设置状态回调，用于监听 uv/Python 安装过程中的进度消息。
   * 传入 null 清除回调。
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

  static getInstance(): PythonManager {
    if (!PythonManager.instance) {
      PythonManager.instance = new PythonManager()
    }
    return PythonManager.instance
  }

  get status(): PythonStatus {
    return { ...this._status }
  }

  getPythonPath(): string | null {
    return this._status.pythonPath
  }

  getUvPath(): string | null {
    // 优先返回缓存的 uv 路径
    if (this._status.uvPath && fs.existsSync(this._status.uvPath)) {
      return this._status.uvPath
    }
    // 从 PATH 搜索 uv
    const systemUv = resolveCommandPath('uv')
    if (systemUv) {
      this._status.uvPath = systemUv
      store.set(CONFIG_KEY_UV_PATH, systemUv)
      return systemUv
    }
    return null
  }

  getUvxPath(): string | null {
    // 优先返回缓存的 uvx 路径
    if (this._status.uvxPath && fs.existsSync(this._status.uvxPath)) {
      return this._status.uvxPath
    }
    // 从 uv 路径推断 uvx 同级路径
    const uvPath = this._status.uvPath
    if (uvPath) {
      const uvxName = process.platform === 'win32' ? 'uvx.exe' : 'uvx'
      const uvxPath = path.join(path.dirname(uvPath), uvxName)
      if (fs.existsSync(uvxPath)) {
        this._status.uvxPath = uvxPath
        store.set(CONFIG_KEY_UVX_PATH, uvxPath)
        return uvxPath
      }
    }
    // 从 PATH 搜索 uvx
    const systemUvx = resolveCommandPath('uvx')
    if (systemUvx) {
      this._status.uvxPath = systemUvx
      store.set(CONFIG_KEY_UVX_PATH, systemUvx)
      return systemUvx
    }
    return null
  }

  /**
   * 只读检测 uv：搜索系统/缓存中的 uv/uvx 路径，不触发安装。
   *
   * 与 ensureUvx() 的区别：
   * - ensureUvx()：找不到就触发 _installUv() 安装
   * - detectUvAsync()：只搜索，找不到返回 null，用于"只读检测"场景（如环境检测弹窗）
   *
   * 搜索优先级：
   * 1. 已缓存的 status.uvPath（之前找到过）
   * 2. electron-store 持久化缓存的 uv 路径
   * 3. 用户 shell PATH 异步搜索（resolveCommandPathAsync，支持 ~/.local/bin 等非标准路径）
   *
   * 解决问题：首次启动时 status.uvPath 可能为空（ensureReady 未执行），
   * 但用户系统中实际已安装 uv（如通过 brew/pip 安装），此时应主动搜索而不是直接判定为未安装。
   *
   * @returns uv/uvx 路径信息，或 null（未找到）
   */
  async detectUvAsync(): Promise<{ uvPath: string; uvxPath: string } | null> {
    // 1. 已缓存的 status.uvPath
    if (this._status.uvPath && fs.existsSync(this._status.uvPath)) {
      return { uvPath: this._status.uvPath, uvxPath: this._status.uvxPath || this._status.uvPath }
    }

    // 2. electron-store 持久化缓存
    const cachedUv = store.get(CONFIG_KEY_UV_PATH) as string | undefined
    if (cachedUv && fs.existsSync(cachedUv)) {
      this._status.uvPath = cachedUv
      // 同步解析 uvx 路径
      this._resolveUvxPath(cachedUv)
      store.set(CONFIG_KEY_UV_PATH, cachedUv)
      logger.system.info(`[PythonManager] detectUvAsync: found cached uv: ${cachedUv}`)
      return { uvPath: cachedUv, uvxPath: this._status.uvxPath || cachedUv }
    }

    // 3. 异步搜索系统 PATH（含用户 shell PATH，如 ~/.local/bin）
    await prewarmUserShellPath()

    const existingUv = await resolveCommandPathAsync('uv')
    if (existingUv) {
      this._status.uvPath = existingUv
      store.set(CONFIG_KEY_UV_PATH, existingUv)
      // 解析同目录下的 uvx
      this._resolveUvxPath(existingUv)
      logger.system.info(`[PythonManager] detectUvAsync: found system uv: ${existingUv}`)
      return { uvPath: existingUv, uvxPath: this._status.uvxPath || existingUv }
    }

    // 4. 直接搜索 uvx（某些安装方式可能只有 uvx 符号链接）
    const existingUvx = await resolveCommandPathAsync('uvx')
    if (existingUvx) {
      this._status.uvxPath = existingUvx
      store.set(CONFIG_KEY_UVX_PATH, existingUvx)
      // 尝试解析同目录下的 uv
      const uvSibling = path.join(path.dirname(existingUvx), process.platform === 'win32' ? 'uv.exe' : 'uv')
      if (fs.existsSync(uvSibling)) {
        this._status.uvPath = uvSibling
        store.set(CONFIG_KEY_UV_PATH, uvSibling)
      }
      logger.system.info(`[PythonManager] detectUvAsync: found system uvx: ${existingUvx}`)
      return { uvPath: this._status.uvPath || existingUvx, uvxPath: existingUvx }
    }

    logger.system.info('[PythonManager] detectUvAsync: uv not found in system PATH')
    return null
  }

  /**
   * 确保 uv/uvx 可用，独立于 Python 安装状态。
   *
   * ensureReady() 只在需要安装 Python 时才会安装 uv。
   * 如果用户已有系统 Python 但没有 uv/uvx，ensureReady() 会跳过 uv 安装。
   * 此方法专门用于 MCP 插件等需要 uvx 但不需要 Python 的场景。
   *
   * 优化：使用 resolveCommandPathAsync 解析用户 shell PATH，
   * 解决 macOS GUI 应用 PATH 不完整导致检测不到用户手动安装的 uv 的问题。
   *
   * @returns uvx 命令路径（优先 uvx 二进制，其次 uv 路径用于 `uv tool run` 等价命令），或 null 表示安装失败
   */
  async ensureUvx(): Promise<{ uvxPath: string; uvPath: string } | null> {
    // 预热用户 shell PATH 缓存（首次调用时解析，后续使用缓存）
    await prewarmUserShellPath()

    // 先检查缓存的 uvx 路径
    if (this._status.uvxPath && fs.existsSync(this._status.uvxPath)) {
      return { uvxPath: this._status.uvxPath, uvPath: this._status.uvPath || this._status.uvxPath }
    }

    // 异步搜索 uvx（含用户 shell PATH，如 ~/.local/bin）
    const existingUvx = await resolveCommandPathAsync('uvx')
    if (existingUvx) {
      this._status.uvxPath = existingUvx
      store.set(CONFIG_KEY_UVX_PATH, existingUvx)
      // 同时解析 uv 路径（uvx 和 uv 通常在同一目录）
      const uvSibling = path.join(path.dirname(existingUvx), process.platform === 'win32' ? 'uv.exe' : 'uv')
      if (fs.existsSync(uvSibling)) {
        this._status.uvPath = uvSibling
        store.set(CONFIG_KEY_UV_PATH, uvSibling)
      }
      return { uvxPath: existingUvx, uvPath: this._status.uvPath || existingUvx }
    }

    // 检查是否已有 uv（可以用 uv tool run 替代）
    const existingUv = await resolveCommandPathAsync('uv')
    if (existingUv) {
      this._status.uvPath = existingUv
      store.set(CONFIG_KEY_UV_PATH, existingUv)
      logger.system.info(`[PythonManager] Found system uv (will use as uvx fallback): ${existingUv}`)
      return { uvxPath: existingUv, uvPath: existingUv }
    }

    // uv/uvx 都不存在，触发安装
    logger.system.info('[PythonManager] uvx requested but uv/uvx not found, installing uv...')
    const installedUv = await this._ensureUv()
    if (!installedUv) {
      logger.system.error('[PythonManager] Failed to install uv for uvx support')
      return null
    }

    // 安装后解析 uvx
    this._resolveUvxPath(installedUv)
    const uvxPath = this.getUvxPath()
    if (uvxPath) {
      return { uvxPath, uvPath: installedUv }
    }

    // uvx 二进制不存在，但 uv 已安装，可以用 uv tool run 替代
    return { uvxPath: installedUv, uvPath: installedUv }
  }

  /**
   * 确保 Python 环境就绪
   *
   * 与旧版的差别：**「就绪」现在带版本条件**。
   * 旧实现只要 `_status.ready` 为真就直接返回，于是「用系统 3.9 建好的环境」
   * 会一直被认为可用，永远没有机会换成满足 3.10+ 的解释器——这正是
   * 「机器上明明装着 3.11，插件却仍跑在 3.9 上」的根因。
   *
   * @param options.minVersion 调用方要求的最低版本；与全局下限取较严者
   * @param options.forceRefresh 忽略缓存强制重新解析
   */
  async ensureReady(options: PythonReadyOptions = {}): Promise<PythonStatus> {
    const required = maxVersion(MIN_VENV_BASE_VERSION, options.minVersion ?? MIN_VENV_BASE_VERSION)

    if (options.forceRefresh) {
      // 显式要求重来：清掉「失败记忆」与解释器缓存，但**不动** venv——
      // 是否重建由 _ensureVenv 按基底版本判断，避免把一次刷新升级成完整重装
      this._failedRequirements.clear()
      store.delete(CONFIG_KEY_PYTHON_PATH)
    } else if (this._status.ready && isVersionSatisfied(this._status.version, required)) {
      return this.status
    }

    if (this.initializing) {
      while (this.initializing) {
        await new Promise((r) => setTimeout(r, 200))
      }
      if (!options.forceRefresh && this._status.ready && isVersionSatisfied(this._status.version, required)) {
        return this.status
      }
      // 别人刚跑完但仍不满足本次要求（例如他的要求更低）→ 继续往下自己再试一次
    }

    const requiredText = formatVersion(required)
    if (this._failedRequirements.has(requiredText)) {
      logger.system.debug(
        `[PythonManager] 已记录过 ${requiredText}+ 的安装失败，跳过重复尝试`,
      )
      return this.status
    }

    this.initializing = true
    try {
      await this._ensureReady(required)
    } catch (err) {
      logger.system.error('[PythonManager] ensureReady failed:', err)
      this._status.error = toAppError(err).message
    } finally {
      this.initializing = false
    }

    if (!this._status.ready || !isVersionSatisfied(this._status.version, required)) {
      this._failedRequirements.add(requiredText)
    }
    return this.status
  }

  /**
   * 解释器候选链：缓存 → 系统 → 受管目录 → uv 安装
   *
   * 顺序刻意如此：越靠前代价越低。第 3 步（受管目录）是本次新增的——此前系统 Python
   * 之后直接跳到 uv 安装，完全没检查受管目录里是否已有解释器，导致「上一次装好的
   * 3.11」既不被复用、也不会被重装（uv 发现目标已存在会直接返回成功但不改版本）。
   */
  private async _ensureReady(required: VersionTuple): Promise<void> {
    const requiredText = formatVersion(required)
    logger.system.info(
      `[PythonManager] Starting Python environment setup (required >= ${requiredText})...`,
    )

    const candidates: PythonCandidateDiagnostic[] = []
    this._status.diagnostics = { requiredVersion: requiredText, candidates, outcome: '' }

    // ── 1) 缓存解释器：版本不满足即视为失效 ──
    const cachedPython = store.get(CONFIG_KEY_PYTHON_PATH) as string | undefined
    if (cachedPython && fs.existsSync(cachedPython)) {
      const version = await this._getPythonVersion(cachedPython)
      if (version && isVersionSatisfied(version, required)) {
        logger.system.info(`[PythonManager] Found cached Python: ${cachedPython} (${version})`)
        candidates.push({
          kind: 'cached',
          path: cachedPython,
          version,
          accepted: true,
          reason: `缓存命中且 ${version} ≥ ${requiredText}`,
        })
        this._markReady(cachedPython, version)
        this._status.diagnostics.outcome = `使用缓存解释器 ${cachedPython}（${version}）`
        return
      }
      candidates.push({
        kind: 'cached',
        path: cachedPython,
        version,
        accepted: false,
        reason: version ? `版本 ${version} 低于要求 ${requiredText}` : '无法读取版本号',
      })
      logger.system.warn(
        `[PythonManager] Cached Python rejected: ${cachedPython} ` +
          `(version=${version ?? 'unknown'}, required >= ${requiredText})`,
      )
      store.delete(CONFIG_KEY_PYTHON_PATH)
    }

    // ── 2) 系统 Python ──
    const system = await this._detectSystemPython(required)
    candidates.push(...system.rejections)
    if (system.python) {
      logger.system.info(
        `[PythonManager] Found system Python: ${system.python.path} (${system.python.version})`,
      )
      candidates.push({
        kind: 'system',
        path: system.python.path,
        version: system.python.version,
        accepted: true,
        reason: `版本 ${system.python.version} 满足 ${requiredText}+`,
      })
      this._markReady(system.python.path, system.python.version, 'system')
      await this._ensureVenv(system.python.path, required)
      this._status.diagnostics.outcome = `系统 Python ${system.python.path}（${system.python.version}）`
      return
    }

    // ── 3) 受管目录中已安装的解释器（复用已下载的，避免重复下载）──
    const managed = await this._detectManagedPython(required)
    candidates.push(...managed.rejections)
    if (managed.python) {
      logger.system.info(
        `[PythonManager] Found managed Python on disk: ${managed.python.path} (${managed.python.version})`,
      )
      candidates.push({
        kind: 'managed',
        path: managed.python.path,
        version: managed.python.version,
        accepted: true,
        reason: `受管目录已有 ${managed.python.version}，无需下载`,
      })
      this._markReady(managed.python.path, managed.python.version, 'managed')
      await this._ensureVenv(managed.python.path, required)
      this._status.diagnostics.outcome = `受管解释器 ${managed.python.path}（${managed.python.version}）`
      return
    }

    // ── 4) 通过 uv 安装受管 Python ──
    logger.system.info('[PythonManager] No usable interpreter found, attempting managed installation...')

    const uvPath = await this._ensureUv()
    if (uvPath) {
      this._status.uvPath = uvPath
      store.set(CONFIG_KEY_UV_PATH, uvPath)

      const managedPython = await this._installPythonViaUv(uvPath, required)
      if (managedPython) {
        const version = (await this._getPythonVersion(managedPython)) ?? requiredText
        candidates.push({
          kind: 'uv-install',
          path: managedPython,
          version,
          accepted: true,
          reason: 'uv 安装成功',
        })
        this._markReady(managedPython, version, 'managed')
        await this._ensureVenv(managedPython, required)
        this._status.diagnostics.outcome = `uv 新装解释器 ${managedPython}（${version}）`
        return
      }
      candidates.push({
        kind: 'uv-install',
        path: '',
        version: null,
        accepted: false,
        reason: 'uv 安装失败（后端源与所有镜像源均不可用）',
      })
    } else {
      candidates.push({
        kind: 'uv-install',
        path: '',
        version: null,
        accepted: false,
        reason: 'uv 工具不可用，无法自动安装 Python',
      })
    }

    logger.system.warn('[PythonManager] Python environment setup failed - Python features will be unavailable')
    this._status.ready = false
    this._status.source = 'none'
    this._status.error =
      `未找到满足 ${requiredText}+ 的 Python 解释器，自动安装也失败。` +
      `请手动安装 Python ${requiredText}+ 后重试（设置 → 运行环境 → 设置 Python 路径）。`
    this._status.diagnostics.outcome = `失败：无可用候选（要求 ${requiredText}+）`
  }

  /**
   * 检测系统 Python
   *
   * 关键修正：过滤条件从「major >= 3」改为「满足 required」。
   * macOS 自带的 /usr/bin/python3 是 3.9，旧条件会放行，于是它被当作可用环境、
   * 并用它建了 venv，插件的 3.10+ 脚本随后全部 SyntaxError。
   * 被否决的候选连原因一起返回，供 diagnostics 呈现。
   */
  private async _detectSystemPython(required: VersionTuple): Promise<{
    python: { path: string; version: string } | null
    rejections: PythonCandidateDiagnostic[]
  }> {
    // 预热用户 shell PATH，确保能检测到用户手动安装的 Python
    await prewarmUserShellPath()

    const commands = process.platform === 'win32'
      ? ['python', 'python3', 'py']
      : ['python3', 'python']

    const rejections: PythonCandidateDiagnostic[] = []
    const seen = new Set<string>()

    for (const cmd of commands) {
      // 使用异步解析（含用户 shell PATH，如 ~/.local/bin、pyenv shims 等）
      const resolved = await resolveCommandPathAsync(cmd)
      // 同一台机器上 python3 与 python 常指向同一个二进制，去重避免重复探测
      if (!resolved || seen.has(resolved)) continue
      seen.add(resolved)

      const version = await this._getPythonVersion(resolved)
      if (!version) {
        rejections.push({
          kind: 'system',
          path: resolved,
          version: null,
          accepted: false,
          reason: '无法读取版本号（可能不是可用的 Python）',
        })
        continue
      }
      if (isVersionSatisfied(version, required)) {
        return { python: { path: resolved, version }, rejections }
      }
      rejections.push({
        kind: 'system',
        path: resolved,
        version,
        accepted: false,
        reason: `版本 ${version} 低于要求 ${formatVersion(required)}`,
      })
    }
    return { python: null, rejections }
  }

  /**
   * 在受管目录里查找已安装的解释器
   *
   * 与 `_findPythonInDir` 的区别：这里返回**全部**候选，并让带小版本号的名字排前面。
   * 同一受管目录下可能共存多个版本（uv 为每个版本建独立的
   * `cpython-x.y.z-<platform>/` 子目录），只取第一个可能正好拿到不满足要求的那个。
   */
  private async _detectManagedPython(required: VersionTuple): Promise<{
    python: { path: string; version: string } | null
    rejections: PythonCandidateDiagnostic[]
  }> {
    const rejections: PythonCandidateDiagnostic[] = []
    const installDir = path.join(getDefaultPythonDir(), 'python')
    if (!fs.existsSync(installDir)) return { python: null, rejections }

    for (const candidate of this._listPythonsInDir(installDir)) {
      const version = await this._getPythonVersion(candidate)
      if (version && isVersionSatisfied(version, required)) {
        return { python: { path: candidate, version }, rejections }
      }
      rejections.push({
        kind: 'managed',
        path: candidate,
        version,
        accepted: false,
        reason: version
          ? `版本 ${version} 低于要求 ${formatVersion(required)}`
          : '无法读取版本号',
      })
    }
    return { python: null, rejections }
  }

  /**
   * 列出目录下所有 Python 解释器（递归深度 ≤ 4）
   *
   * 识别两类命名：`python3` / `python`（venv 与多数安装）与 `python3.11`
   * （uv 的 python-build-standalone 布局）。带小版本号的名字排在前面——它们
   * 指向具体版本，而 `python3` 可能是任意版本的符号链接。
   */
  private _listPythonsInDir(searchDir: string): string[] {
    const isWin = process.platform === 'win32'
    const plainNames = new Set(isWin ? ['python.exe', 'python3.exe'] : ['python3', 'python'])
    const versionedRe = isWin ? /^python3\.\d+\.exe$/ : /^python3\.\d+$/

    const found: string[] = []
    const walk = (dir: string, depth: number): void => {
      if (depth > 4) return
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        // 跳过隐藏目录（.git 等），它们不可能含解释器
        if (entry.name.startsWith('.')) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full, depth + 1)
        } else if (entry.isFile() && (plainNames.has(entry.name) || versionedRe.test(entry.name))) {
          found.push(full)
        }
      }
    }
    walk(searchDir, 0)

    return found.sort((a, b) => {
      const aVersioned = versionedRe.test(path.basename(a)) ? 0 : 1
      const bVersioned = versionedRe.test(path.basename(b)) ? 0 : 1
      return aVersioned - bVersioned
    })
  }

  /**
   * 标注解释器来源
   *
   * 用「路径前缀」而非 `includes`：`includes(getDefaultPythonDir())` 会把形如
   * `.../python-env-backup/bin/python3` 的路径也判成受管，而 dirname 之后再比字符串，
   * 很容易被相似的目录名骗过。
   */
  private _classifySource(pythonPath: string): 'managed' | 'system' {
    const resolved = path.resolve(pythonPath)
    const managedRoot = path.resolve(getDefaultPythonDir())
    return resolved.startsWith(managedRoot + path.sep) ? 'managed' : 'system'
  }

  /**
   * 标记环境就绪并落盘缓存
   *
   * 所有「选定解释器」的分支都收敛到这里，避免像以前那样在多处手写 `_status` 赋值
   * ——那些赋值里有一处漏了 venvDir，另一处的 source 判定也是错的。
   */
  private _markReady(pythonPath: string, version: string, source?: 'managed' | 'system'): void {
    this._status.ready = true
    this._status.pythonPath = pythonPath
    this._status.version = version
    this._status.source = source ?? this._classifySource(pythonPath)
    this._status.error = undefined
    // uv 路径可能来自上次会话（缓存分支直接返回时内存里还没有），从 store 补回
    if (!this._status.uvPath) {
      this._status.uvPath = (store.get(CONFIG_KEY_UV_PATH) as string) || null
    }
    if (!this._status.uvxPath) {
      this._status.uvxPath = (store.get(CONFIG_KEY_UVX_PATH) as string) || null
    }
    store.set(CONFIG_KEY_PYTHON_PATH, pythonPath)
  }

  private async _getPythonVersion(pythonPath: string): Promise<string | null> {
    try {
      const { stdout, code } = await execCommandAsync(pythonPath, ['--version'], { timeout: 10000 })
      if (code === 0 && stdout) {
        const match = stdout.match(/Python\s+(\d+\.\d+\.\d+)/i)
        return match ? match[1] : null
      }
    } catch {
      // ignore
    }
    return null
  }

  private async _ensureUv(): Promise<string | null> {
    this.notifyStatus('正在检查 uv 运行环境...')

    // 预热用户 shell PATH，确保能检测到用户手动安装的 uv
    // 解决 macOS GUI 应用 PATH 不完整导致检测不到 ~/.local/bin/uv 的问题
    await prewarmUserShellPath()

    // 异步搜索 uv（含用户 shell PATH）
    const systemUv = await resolveCommandPathAsync('uv')
    if (systemUv) {
      logger.system.info(`[PythonManager] Found system uv: ${systemUv}`)
      this.notifyStatus('已检测到系统 uv')
      // 同时解析 uvx 路径（系统安装的 uv 通常在同目录有 uvx）
      this._resolveUvxPath(systemUv)
      return systemUv
    }

    const cachedUv = store.get(CONFIG_KEY_UV_PATH) as string | undefined
    if (cachedUv && fs.existsSync(cachedUv)) {
      logger.system.info(`[PythonManager] Found cached uv: ${cachedUv}`)
      this.notifyStatus('已检测到缓存的 uv')
      // 同时解析 uvx 路径
      this._resolveUvxPath(cachedUv)
      return cachedUv
    }

    // 安装策略（按优先级）：
    // 1. pip install uv + 国内镜像源（最快，依赖系统 Python）
    // 2. GitHub 二进制下载 + 镜像加速（不依赖 Python，但下载较慢）
    const installedUv = await this._installUv()
    if (installedUv) {
      // 安装完成后尝试解析 uvx
      this._resolveUvxPath(installedUv)
    }
    return installedUv
  }

  /**
   * 解析 uvx 二进制路径并缓存。
   * uv 发布包中 uv 和 uvx 通常在同一目录下。
   */
  private _resolveUvxPath(uvPath: string): void {
    const uvxName = process.platform === 'win32' ? 'uvx.exe' : 'uvx'
    const uvxPath = path.join(path.dirname(uvPath), uvxName)
    if (fs.existsSync(uvxPath)) {
      this._status.uvxPath = uvxPath
      store.set(CONFIG_KEY_UVX_PATH, uvxPath)
      logger.system.info(`[PythonManager] Resolved uvx path: ${uvxPath}`)
    } else {
      // 从 PATH 搜索 uvx
      const systemUvx = resolveCommandPath('uvx')
      if (systemUvx) {
        this._status.uvxPath = systemUvx
        store.set(CONFIG_KEY_UVX_PATH, systemUvx)
        logger.system.info(`[PythonManager] Found system uvx: ${systemUvx}`)
      }
    }
  }

  private async _installUv(): Promise<string | null> {
    // 安装策略（按优先级，国内网络优化）：
    // 0. 后端托管下载源（管理员在后台管理上传的二进制，最优、最稳定）
    // 1. pip install uv + 国内 PyPI 镜像源（清华/阿里云，最快最可靠）
    // 2. GitHub 二进制下载 + ghproxy.net 镜像加速（不依赖 Python）

    // 策略 0：优先从后端解析推荐下载源
    this.notifyStatus('正在从后端获取 uv 推荐下载源...')
    const backendUrl = await resolveBackendAssetUrl('uv')
    if (backendUrl) {
      this.notifyStatus('已获取后端推荐下载源，开始下载 uv...')
      const tmpDir = path.join(getDefaultPythonDir(), 'tmp')
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
      const ext = backendUrl.endsWith('.zip') ? '.zip' : '.tar.gz'
      const archivePath = path.join(tmpDir, `uv-backend${ext}`)
      const extractDir = path.join(tmpDir, 'uv-extract-backend')

      try {
        await downloadFile(backendUrl, archivePath)
        this.notifyStatus('uv 下载完成（后端源），正在解压...')
        await extractArchive(archivePath, extractDir)
        this.notifyStatus('正在安装 uv 和 uvx 二进制文件...')

        const uvBinary = this._findBinary(extractDir, 'uv')
        if (uvBinary) {
          const uvDestDir = path.join(getDefaultPythonDir(), 'bin')
          if (!fs.existsSync(uvDestDir)) fs.mkdirSync(uvDestDir, { recursive: true })
          const uvDest = path.join(uvDestDir, process.platform === 'win32' ? 'uv.exe' : 'uv')
          fs.copyFileSync(uvBinary, uvDest)
          if (process.platform !== 'win32') fs.chmodSync(uvDest, 0o755)

          const uvxBinary = this._findBinary(extractDir, 'uvx')
          if (uvxBinary) {
            const uvxDest = path.join(uvDestDir, process.platform === 'win32' ? 'uvx.exe' : 'uvx')
            fs.copyFileSync(uvxBinary, uvxDest)
            if (process.platform !== 'win32') fs.chmodSync(uvxDest, 0o755)
            this._status.uvxPath = uvxDest
            store.set(CONFIG_KEY_UVX_PATH, uvxDest)
          }

          try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
          logger.system.info(`[PythonManager] uv installed from backend at: ${uvDest}`)
          this.notifyStatus('uv 工具安装完成（后端源）')
          return uvDest
        }
      } catch (err) {
        logger.system.warn('[PythonManager] Backend uv download failed:', err)
        this.notifyStatus('后端源下载失败，回退到 pip 安装...')
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    }

    // 策略 1：优先通过 pip + 国内镜像源安装
    this.notifyStatus('正在通过 pip 安装 uv（使用国内镜像源）...')
    const pipResult = await this._installUvViaPip()
    if (pipResult) {
      return pipResult
    }

    // 策略 2：pip 安装失败，回退到 GitHub 二进制下载
    this.notifyStatus('pip 安装失败，正在通过 GitHub 下载 uv 二进制...')
    const urls = getUvDownloadUrls()
    if (urls.length === 0) {
      logger.system.error(`[PythonManager] No uv download URL for platform: ${getPlatformKey()}`)
      this.notifyStatus('uv 安装失败：当前平台不支持且 pip 安装也失败')
      return null
    }

    const tmpDir = path.join(getDefaultPythonDir(), 'tmp')
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })

    // 依次尝试所有下载源（GitHub + 镜像）
    let lastError: unknown = null
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]
      const sourceName = i === 0 ? 'GitHub' : '镜像源'
      const ext = url.endsWith('.zip') ? '.zip' : '.tar.gz'
      const archivePath = path.join(tmpDir, `uv-download${ext}`)
      const extractDir = path.join(tmpDir, 'uv-extract')

      try {
        this.notifyStatus(`正在从${sourceName}下载 uv 工具...`)
        logger.system.info(`[PythonManager] Downloading uv from: ${url}`)
        await downloadFile(url, archivePath)
        this.notifyStatus('uv 下载完成，正在解压...')
        logger.system.info('[PythonManager] uv download complete, extracting...')

        await extractArchive(archivePath, extractDir)
        this.notifyStatus('正在安装 uv 和 uvx 二进制文件...')

        const uvBinary = this._findBinary(extractDir, 'uv')
        if (!uvBinary) {
          logger.system.error('[PythonManager] uv binary not found in extracted archive')
          continue
        }

        const uvDestDir = path.join(getDefaultPythonDir(), 'bin')
        if (!fs.existsSync(uvDestDir)) fs.mkdirSync(uvDestDir, { recursive: true })

        const uvDest = path.join(uvDestDir, process.platform === 'win32' ? 'uv.exe' : 'uv')
        fs.copyFileSync(uvBinary, uvDest)

        if (process.platform !== 'win32') {
          fs.chmodSync(uvDest, 0o755)
        }

        // 同时安装 uvx 二进制（uv 发布包中包含 uvx）
        const uvxBinary = this._findBinary(extractDir, 'uvx')
        if (uvxBinary) {
          const uvxDest = path.join(uvDestDir, process.platform === 'win32' ? 'uvx.exe' : 'uvx')
          fs.copyFileSync(uvxBinary, uvxDest)
          if (process.platform !== 'win32') {
            fs.chmodSync(uvxDest, 0o755)
          }
          this._status.uvxPath = uvxDest
          store.set(CONFIG_KEY_UVX_PATH, uvxDest)
          logger.system.info(`[PythonManager] uvx installed at: ${uvxDest}`)
        } else {
          logger.system.warn('[PythonManager] uvx binary not found in archive, will use `uv tool run` fallback')
        }

        try {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        } catch {
          // ignore cleanup errors
        }

        logger.system.info(`[PythonManager] uv installed at: ${uvDest}`)
        this.notifyStatus('uv 工具安装完成')
        return uvDest
      } catch (err) {
        logger.system.warn(`[PythonManager] Download failed from ${url}:`, err)
        this.notifyStatus(`${sourceName}下载失败，尝试下一个源...`)
        lastError = err
        // 清理本次失败的临时文件，尝试下一个 URL
        try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      }
    }

    // 提供详细的手动安装指引（含平台特定命令）
    const installGuide = process.platform === 'win32'
      ? 'PowerShell: irm https://astral.sh/uv/install.ps1 | iex'
      : '终端: curl -LsSf https://astral.sh/uv/install.sh | sh'
    this.notifyStatus(`uv 自动安装失败。请手动安装 uv 后重启客户端：\n${installGuide}\n安装后客户端会自动检测到 uv。`)
    logger.system.error('[PythonManager] uv installation failed (all methods exhausted):', lastError)
    return null
  }

  /**
   * 国内 PyPI 镜像源列表（按优先级排序）。
   * 依次尝试，任一成功即可。
   */
  private static readonly PYPI_MIRRORS = [
    { name: '清华', url: 'https://pypi.tuna.tsinghua.edu.cn/simple' },
    { name: '阿里云', url: 'https://mirrors.aliyun.com/pypi/simple' },
    { name: '华为云', url: 'https://repo.huaweicloud.com/repository/pypi/simple' },
  ]

  /**
   * 通过 pip install uv 安装 uv。
   *
   * 依次尝试国内 PyPI 镜像源（清华、阿里云、华为云），
   * 如果全部失败则尝试默认 PyPI 源。
   * 国内镜像源带宽充足，通常下载速度可达 1-10MB/s。
   *
   * @returns uv 二进制路径，或 null 表示安装失败
   */
  private async _installUvViaPip(): Promise<string | null> {
    // 查找系统 Python
    this.notifyStatus('正在查找系统 Python...')
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
    const resolvedPython = resolveCommandPath(pythonCmd)
    if (!resolvedPython) {
      logger.system.warn('[PythonManager] No system Python found for pip install uv fallback')
      this.notifyStatus('未找到系统 Python，无法通过 pip 安装')
      return null
    }

    // 依次尝试国内镜像源
    for (const mirror of PythonManager.PYPI_MIRRORS) {
      try {
        this.notifyStatus(`正在通过 pip 安装 uv（${mirror.name}镜像源，可能需要 1-2 分钟）...`)
        logger.system.info(`[PythonManager] Running: ${resolvedPython} -m pip install uv -i ${mirror.url}`)
        const { code, stdout, stderr } = await execCommandAsync(
          resolvedPython,
          ['-m', 'pip', 'install', 'uv', '-i', mirror.url, '--trusted-host', new URL(mirror.url).hostname],
          { timeout: 180000 } // 3 分钟超时（pip 安装可能较慢）
        )

        if (code !== 0) {
          logger.system.warn(`[PythonManager] pip install uv failed (${mirror.name}):`, stderr)
          this.notifyStatus(`${mirror.name}镜像源安装失败，尝试下一个源...`)
          continue
        }

        logger.system.info(`[PythonManager] pip install uv succeeded (${mirror.name}):`, stdout)
        this.notifyStatus(`pip 安装 uv 成功（${mirror.name}源），正在定位二进制文件...`)

        // pip 安装后，uv/uvx 会被放到 Python 的 Scripts（Windows）或 bin（Unix）目录
        const uvDest = resolveCommandPath('uv')
        if (uvDest) {
          this._status.uvPath = uvDest
          store.set(CONFIG_KEY_UV_PATH, uvDest)
          this._resolveUvxPath(uvDest)
          logger.system.info(`[PythonManager] uv installed via pip at: ${uvDest}`)
          this.notifyStatus('uv 安装完成')
          return uvDest
        }

        // 如果 PATH 中找不到，尝试从 Python Scripts 目录推断
        const pythonDir = path.dirname(resolvedPython)
        const scriptsDir = process.platform === 'win32'
          ? path.join(pythonDir, 'Scripts')
          : path.join(pythonDir, '..', 'bin')
        const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv'
        const uvPath = path.join(scriptsDir, uvName)

        if (fs.existsSync(uvPath)) {
          this._status.uvPath = uvPath
          store.set(CONFIG_KEY_UV_PATH, uvPath)
          this._resolveUvxPath(uvPath)
          logger.system.info(`[PythonManager] uv installed via pip at: ${uvPath}`)
          this.notifyStatus('uv 安装完成')
          return uvPath
        }

        logger.system.error('[PythonManager] pip install uv succeeded but binary not found')
        this.notifyStatus('pip 安装成功但未找到 uv 二进制文件')
        return null
      } catch (err) {
        logger.system.warn(`[PythonManager] pip install uv exception (${mirror.name}):`, err)
        this.notifyStatus(`${mirror.name}镜像源安装异常，尝试下一个源...`)
      }
    }

    // 所有国内镜像源都失败，最后尝试默认 PyPI 源
    try {
      this.notifyStatus('正在通过 pip 安装 uv（默认 PyPI 源）...')
      logger.system.info(`[PythonManager] Running: ${resolvedPython} -m pip install uv (default index)`)
      const { code, stdout, stderr } = await execCommandAsync(
        resolvedPython,
        ['-m', 'pip', 'install', 'uv'],
        { timeout: 180000 }
      )

      if (code !== 0) {
        logger.system.error('[PythonManager] pip install uv failed (default):', stderr)
        this.notifyStatus('pip 安装 uv 失败（所有源均失败）')
        return null
      }

      logger.system.info('[PythonManager] pip install uv succeeded (default):', stdout)
      this.notifyStatus('pip 安装 uv 成功，正在定位二进制文件...')

      const uvDest = resolveCommandPath('uv')
      if (uvDest) {
        this._status.uvPath = uvDest
        store.set(CONFIG_KEY_UV_PATH, uvDest)
        this._resolveUvxPath(uvDest)
        logger.system.info(`[PythonManager] uv installed via pip at: ${uvDest}`)
        this.notifyStatus('uv 安装完成')
        return uvDest
      }

      const pythonDir = path.dirname(resolvedPython)
      const scriptsDir = process.platform === 'win32'
        ? path.join(pythonDir, 'Scripts')
        : path.join(pythonDir, '..', 'bin')
      const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv'
      const uvPath = path.join(scriptsDir, uvName)

      if (fs.existsSync(uvPath)) {
        this._status.uvPath = uvPath
        store.set(CONFIG_KEY_UV_PATH, uvPath)
        this._resolveUvxPath(uvPath)
        logger.system.info(`[PythonManager] uv installed via pip at: ${uvPath}`)
        this.notifyStatus('uv 安装完成')
        return uvPath
      }

      logger.system.error('[PythonManager] pip install uv succeeded but binary not found')
      return null
    } catch (err) {
      logger.system.error('[PythonManager] pip install uv exception (default):', err)
      return null
    }
  }

  /**
   * 在解压目录中查找指定二进制文件（uv 或 uvx）。
   * @param searchDir 解压目录
   * @param binaryName 二进制文件基础名（'uv' 或 'uvx'），自动追加平台后缀
   */
  private _findBinary(searchDir: string, binaryName: 'uv' | 'uvx'): string | null {
    const fileName = process.platform === 'win32' ? `${binaryName}.exe` : binaryName

    const directPath = path.join(searchDir, fileName)
    if (fs.existsSync(directPath)) return directPath

    const entries = fs.readdirSync(searchDir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subPath = path.join(searchDir, entry.name, fileName)
        if (fs.existsSync(subPath)) return subPath

        const subEntries = fs.readdirSync(path.join(searchDir, entry.name), { withFileTypes: true })
        for (const subEntry of subEntries) {
          if (subEntry.isDirectory()) {
            const deepPath = path.join(searchDir, entry.name, subEntry.name, fileName)
            if (fs.existsSync(deepPath)) return deepPath
          }
        }
      }
    }
    return null
  }

  /**
   * 判断 URL 是否为 python-build-standalone 镜像前缀（前缀格式，供 UV_PYTHON_INSTALL_MIRROR 使用）
   *
   * 示例：
   *   https://ghfast.top/https://github.com/astral-sh/python-build-standalone/releases/download  → true
   *   https://cdn.xxx.com/cpython-3.11+20260825-aarch64-apple-darwin-install_only.tar.gz       → false
   */
  private static _isMirrorPrefix(url: string): boolean {
    return url.includes('python-build-standalone/releases/download')
  }

  private async _installPythonViaUv(uvPath: string, required: VersionTuple): Promise<string | null> {
    // 目标版本取「默认 3.11」与「本次要求」的较严者：调用方要求 3.12 时不能仍装 3.11，
    // 否则装完依然不满足，下次调用会再装一遍
    const preferred = parseVersionTuple(PYTHON_VERSION) ?? MIN_VENV_BASE_VERSION
    const target = formatVersion(maxVersion(preferred, required))
    logger.system.info(`[PythonManager] Installing Python ${target} via uv...`)

    const pythonInstallDir = path.join(getDefaultPythonDir(), 'python')
    if (!fs.existsSync(pythonInstallDir)) fs.mkdirSync(pythonInstallDir, { recursive: true })

    // 优先尝试后端托管下载源
    // 策略分两种：
    //   A. 后端返回的是镜像前缀（含 python-build-standalone/releases/download）→ 设 UV_PYTHON_INSTALL_MIRROR，交给 uv 处理
    //   B. 后端返回的是完整文件 URL（如 CDN 直链 tar.gz）→ 客户端自行下载 + 解压，不经过 uv
    this.notifyStatus('正在从后端获取 Python 推荐下载源...')
    const backendUrl = await resolveBackendAssetUrl('python')

    if (backendUrl) {
      if (PythonManager._isMirrorPrefix(backendUrl)) {
        // 策略 A：后端返回镜像前缀，交给 uv 通过 UV_PYTHON_INSTALL_MIRROR 下载
        try {
          this.notifyStatus('正在通过后端镜像源下载 Python...')
          const env: Record<string, string> = {
            ...process.env,
            UV_PYTHON_INSTALL_MIRROR: backendUrl,
            UV_DEFAULT_INDEX: PythonManager.PYPI_MIRRORS[0].url,
          }
          const { code, stdout, stderr } = await execCommandAsync(
            uvPath,
            ['python', 'install', target, '--preview', '--install-dir', pythonInstallDir],
            { timeout: 600000, env },
          )
          if (code === 0) {
            logger.system.info('[PythonManager] Python installed from backend mirror prefix')
            this.notifyStatus('Python 下载完成，正在配置环境...')
            const pythonBin = this._findPythonInDir(pythonInstallDir)
            if (pythonBin) return pythonBin
            logger.system.error('[PythonManager] Python binary not found after backend mirror install')
            this.notifyStatus('Python 安装完成但未找到二进制文件')
            return null
          }
          logger.system.warn('[PythonManager] Backend mirror prefix install failed:', { stdout, stderr })
          this.notifyStatus('后端镜像源下载失败，尝试内置镜像源...')
        } catch (err) {
          logger.system.warn('[PythonManager] Backend mirror prefix install error:', err)
          this.notifyStatus('后端镜像源下载异常，尝试内置镜像源...')
        }
      } else {
        // 策略 B：后端返回完整文件 URL（CDN 直链），客户端直接下载 + 解压
        try {
          this.notifyStatus('正在从后端 CDN 下载 Python（免 uv 中转）...')
          const tmpDir = path.join(getDefaultPythonDir(), 'tmp')
          if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true })
          const archivePath = path.join(tmpDir, `python-backend.tar.gz`)
          await downloadFile(backendUrl, archivePath)
          this.notifyStatus('Python 下载完成，正在解压...')
          await extractArchive(archivePath, pythonInstallDir)
          try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
          logger.system.info('[PythonManager] Python extracted from backend CDN URL')
          this.notifyStatus('Python 下载完成，正在配置环境...')
          const pythonBin = this._findPythonInDir(pythonInstallDir)
          if (pythonBin) return pythonBin
          logger.system.error('[PythonManager] Python binary not found after backend CDN install')
          this.notifyStatus('Python 安装完成但未找到二进制文件')
          return null
        } catch (err) {
          logger.system.warn('[PythonManager] Backend CDN download failed:', err)
          this.notifyStatus('后端 CDN 下载失败，尝试内置镜像源...')
        }
      }
    }

    // 后端无托管源或后端源下载失败 → 回退到内置镜像源（通过 uv）
    let lastError: unknown = null
    for (let i = 0; i < PYTHON_DOWNLOAD_MIRRORS.length; i++) {
      const mirror = PYTHON_DOWNLOAD_MIRRORS[i]
      const mirrorName = i === PYTHON_DOWNLOAD_MIRRORS.length - 1 ? 'GitHub 官方' : `镜像源 ${i + 1}`
      this.notifyStatus(`正在通过 ${mirrorName} 下载 Python ${target}（可能需要 2-5 分钟）...`)

      try {
        const env: Record<string, string> = {
          ...process.env,
          UV_PYTHON_INSTALL_MIRROR: mirror,
          UV_DEFAULT_INDEX: PythonManager.PYPI_MIRRORS[0].url,
        }
        const { stdout, stderr, code } = await execCommandAsync(
          uvPath,
          ['python', 'install', target, '--preview', '--install-dir', pythonInstallDir],
          { timeout: 600000, env },
        )
        if (code !== 0) {
          logger.system.warn(`[PythonManager] uv python install failed (${mirrorName}):`, { stdout, stderr })
          this.notifyStatus(`${mirrorName} 下载失败，尝试下一个源...`)
          lastError = new Error(stderr || stdout)
          continue
        }
        logger.system.info(`[PythonManager] Python installed successfully from ${mirrorName}`)
        this.notifyStatus('Python 下载完成，正在配置环境...')
        const pythonBin = this._findPythonInDir(pythonInstallDir)
        if (pythonBin) {
          logger.system.info(`[PythonManager] Python installed at: ${pythonBin}`)
          return pythonBin
        }
        logger.system.error('[PythonManager] Python binary not found after uv install')
        this.notifyStatus('Python 安装完成但未找到二进制文件')
        return null
      } catch (err) {
        logger.system.warn(`[PythonManager] uv python install error (${mirrorName}):`, err)
        this.notifyStatus(`${mirrorName} 下载异常，尝试下一个源...`)
        lastError = err
      }
    }

    logger.system.error('[PythonManager] uv python install failed (all mirrors exhausted):', lastError)
    this.notifyStatus('Python 下载失败（所有源均不可用），请检查网络或手动安装 Python')
    return null
  }

  private _findPythonInDir(searchDir: string): string | null {
    const pythonName = process.platform === 'win32' ? 'python.exe' : 'python3'
    const pythonAltName = process.platform === 'win32' ? 'python3.exe' : 'python'

    const candidates = [pythonName, pythonAltName]

    const findRecursive = (dir: string, depth: number): string | null => {
      if (depth > 4) return null
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (candidates.includes(entry.name) && !entry.isDirectory()) {
            return path.join(dir, entry.name)
          }
        }
        for (const entry of entries) {
          if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const result = findRecursive(path.join(dir, entry.name), depth + 1)
            if (result) return result
          }
        }
      } catch {
        // ignore
      }
      return null
    }

    return findRecursive(searchDir, 0)
  }

  /**
   * 准备 venv（复用或新建）
   *
   * 与旧版最大的差别是**校验 venv 基底的版本**：venv 目录名与基底解释器版本无关，
   * 所以「`python-env/venv` 存在」并不代表它满足要求——本机上它就建立于系统 3.9。
   * 旧实现只要 `pyvenv.cfg` 存在就直接复用，于是环境一旦以低版本建成就再也不会升级。
   *
   * @param pythonPath 拟用作基底的解释器（已确认满足 required）
   * @param required 本次要求的最低版本
   */
  private async _ensureVenv(pythonPath: string, required: VersionTuple): Promise<void> {
    const venvDir = path.join(getDefaultPythonDir(), 'venv')
    const cfgPath = path.join(venvDir, 'pyvenv.cfg')

    if (fs.existsSync(cfgPath)) {
      const baseVersion = await this._readVenvBaseVersion(venvDir, cfgPath)
      if (baseVersion && isVersionSatisfied(baseVersion, required)) {
        logger.system.info(
          `[PythonManager] venv 复用：基底 ${baseVersion} ≥ ${formatVersion(required)}（${venvDir}）`,
        )
        this._adoptVenv(venvDir, baseVersion)
        await this._installBasePackages(venvDir)
        return
      }

      // 基底过低必须重建：venv 里为旧解释器编译的 wheel（sherpa-onnx、onnxruntime 等
      // 本地语音依赖就在其中）在新解释器下不可用，复用只会得到更难懂的错误。
      logger.system.warn(
        `[PythonManager] venv 基底 ${baseVersion ?? '未知'} 低于要求 ${formatVersion(required)}，重建 venv`,
      )
      await this._recreateVenv(venvDir, pythonPath, required, baseVersion)
      return
    }

    logger.system.info(`[PythonManager] Creating venv at: ${venvDir}`)
    try {
      const { code, stderr } = await execCommandAsync(pythonPath, ['-m', 'venv', venvDir], { timeout: 60000 })
      if (code !== 0) {
        logger.system.error('[PythonManager] venv creation failed:', stderr)
        return
      }

      const baseVersion = (await this._getPythonVersion(pythonPath)) ?? null
      this._adoptVenv(venvDir, baseVersion)
      await this._installBasePackages(venvDir)
    } catch (err) {
      logger.system.error('[PythonManager] venv creation error:', err)
    }
  }

  /**
   * 采用 venv：写入状态与缓存
   *
   * source 固定为 'managed'：venv 位于受管目录下，与「用户自己的系统 Python」
   * 是两回事。至于它建立在哪个版本之上，由 `venvBaseVersion` 单独表达——
   * 把这个信息塞进 source 只会让两个概念互相污染。
   */
  private _adoptVenv(venvDir: string, baseVersion: string | null): void {
    this._status.venvDir = venvDir
    this._status.venvBaseVersion = baseVersion
    store.set(CONFIG_KEY_VENV_DIR, venvDir)
    if (baseVersion) store.set(CONFIG_KEY_VENV_BASE_VERSION, baseVersion)

    const venvPython = this._getVenvPython(venvDir)
    if (venvPython && fs.existsSync(venvPython)) {
      this._status.pythonPath = venvPython
      this._status.source = 'managed'
      store.set(CONFIG_KEY_PYTHON_PATH, venvPython)
    }
  }

  /**
   * 读取 venv 基底解释器版本
   *
   * 优先读 pyvenv.cfg 的 `version` 行（标准 venv 都会写，零进程开销），读不到再实际
   * 执行一次——不能从目录名推断，venv 的目录名与基底版本没有任何固定关系。
   */
  private async _readVenvBaseVersion(venvDir: string, cfgPath: string): Promise<string | null> {
    try {
      const cfg = fs.readFileSync(cfgPath, 'utf-8')
      const m = cfg.match(/^\s*version\s*=\s*(\d+\.\d+(?:\.\d+)?)/m)
      if (m) return m[1]
    } catch {
      /* 读不到就走下面的实际探测 */
    }
    const venvPython = this._getVenvPython(venvDir)
    if (venvPython) return this._getPythonVersion(venvPython)
    return null
  }

  /**
   * 重建 venv（基底版本不满足要求时）
   *
   * 这里有真实的功能回归风险：本地 ASR/TTS 的第三方依赖就装在 venv 里，删掉就没了。
   * 因此重建前先 `pip freeze` 记录清单，重建后 best-effort 恢复；恢复失败的项只记
   * 日志——local-voice/pythonDeps 在下次使用时会按需重装，不会静默留下坏状态。
   */
  private async _recreateVenv(
    venvDir: string,
    basePython: string,
    required: VersionTuple,
    oldBaseVersion: string | null,
  ): Promise<void> {
    const previousPackages = await this._freezeVenvPackages(venvDir)

    this.notifyStatus(
      `正在重建 Python 虚拟环境（${oldBaseVersion ?? '未知'} → ${formatVersion(required)}+）...`,
    )

    try {
      fs.rmSync(venvDir, { recursive: true, force: true })
    } catch (err) {
      logger.system.error('[PythonManager] 删除旧 venv 失败，保留现状:', err)
      this._status.error = '无法重建 Python 虚拟环境（旧环境删除失败），请检查磁盘权限'
      return
    }

    const { code, stderr } = await execCommandAsync(basePython, ['-m', 'venv', venvDir], {
      timeout: 120000,
    })
    if (code !== 0) {
      logger.system.error('[PythonManager] venv 重建失败:', stderr)
      this._status.error = `重建 Python 虚拟环境失败：${(stderr || '').slice(0, 300)}`
      return
    }

    const baseVersion = (await this._getPythonVersion(basePython)) ?? null
    this._adoptVenv(venvDir, baseVersion)
    await this._installBasePackages(venvDir)
    await this._restoreVenvPackages(venvDir, previousPackages)
  }

  /** 读取 venv 已装包清单（pip freeze），用于重建后的恢复 */
  private async _freezeVenvPackages(venvDir: string): Promise<string[]> {
    const pipPath = this._getVenvPip(venvDir)
    if (!pipPath) return []
    try {
      const { stdout, code } = await execCommandAsync(pipPath, ['freeze'], { timeout: 30000 })
      if (code !== 0 || !stdout) return []
      return stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('#'))
    } catch {
      return []
    }
  }

  /** 把旧 venv 的依赖装回新 venv（best-effort） */
  private async _restoreVenvPackages(venvDir: string, packages: string[]): Promise<void> {
    const pipPath = this._getVenvPip(venvDir)
    if (!pipPath || packages.length === 0) return

    // 基础包已由 _installBasePackages 按当前源装好，不必按旧版本号再钉一次
    const restorable = packages.filter(
      (spec) => !BASE_PACKAGES.some((base) => spec.startsWith(`${base}==`)),
    )
    if (restorable.length === 0) return

    logger.system.info(`[PythonManager] 恢复 venv 依赖（${restorable.length} 项）...`)
    const ok = await this._pipInstallWithMirrors(pipPath, restorable, 600000)
    if (ok) {
      this._status.installedPackages = Array.from(new Set([...BASE_PACKAGES, ...restorable]))
      logger.system.info('[PythonManager] venv 依赖恢复完成')
    } else {
      logger.system.warn(
        '[PythonManager] venv 依赖恢复失败，相关功能会在下次使用时按需重装（见 local-voice/pythonDeps）',
      )
    }
  }

  private _getVenvPython(venvDir: string): string | null {
    if (process.platform === 'win32') {
      const winPython = path.join(venvDir, 'Scripts', 'python.exe')
      return fs.existsSync(winPython) ? winPython : null
    }
    // 注意：venv 中 python / python3 通常是符号链接对，但并非所有环境都同时存在。
    // 这里必须真实判断存在性——用 `||` 拼接字符串恒为前者（历史误写）。
    for (const name of ['python3', 'python']) {
      const candidate = path.join(venvDir, 'bin', name)
      if (fs.existsSync(candidate)) return candidate
    }
    return null
  }

  private _getVenvPip(venvDir: string): string | null {
    if (process.platform === 'win32') {
      const pipPath = path.join(venvDir, 'Scripts', 'pip.exe')
      return fs.existsSync(pipPath) ? pipPath : null
    }
    const pip3 = path.join(venvDir, 'bin', 'pip3')
    if (fs.existsSync(pip3)) return pip3
    const pip = path.join(venvDir, 'bin', 'pip')
    return fs.existsSync(pip) ? pip : null
  }

  /**
   * 通用 pip install 方法，自动轮询国内 PyPI 镜像源
   *
   * 依次尝试清华、阿里云、华为云镜像源，任一成功即可。
   * 全部失败后回退到默认 PyPI 源。
   * 解决国内用户 pip install 慢/失败的问题。
   *
   * @param pipPath pip 可执行文件路径
   * @param packages 要安装的包名列表
   * @param timeoutMs 超时时间（毫秒），默认 300s
   * @returns 成功返回 true，失败返回 false
   */
  private async _pipInstallWithMirrors(
    pipPath: string,
    packages: string[],
    timeoutMs: number = 300000,
  ): Promise<boolean> {
    // 依次尝试国内镜像源
    for (const mirror of PythonManager.PYPI_MIRRORS) {
      try {
        logger.system.info(`[PythonManager] pip install ${packages.join(' ')} (${mirror.name})`)
        const { code, stderr } = await execCommandAsync(
          pipPath,
          ['install', '--quiet', ...packages, '-i', mirror.url, '--trusted-host', new URL(mirror.url).hostname],
          { timeout: timeoutMs },
        )
        if (code === 0) {
          logger.system.info(`[PythonManager] pip install succeeded (${mirror.name})`)
          return true
        }
        logger.system.warn(`[PythonManager] pip install failed (${mirror.name}):`, stderr)
      } catch (err) {
        logger.system.warn(`[PythonManager] pip install error (${mirror.name}):`, err)
      }
    }

    // 所有国内镜像源都失败，最后尝试默认 PyPI 源
    try {
      logger.system.info(`[PythonManager] pip install ${packages.join(' ')} (default PyPI)`)
      const { code, stderr } = await execCommandAsync(
        pipPath,
        ['install', '--quiet', ...packages],
        { timeout: timeoutMs },
      )
      if (code === 0) {
        logger.system.info('[PythonManager] pip install succeeded (default PyPI)')
        return true
      }
      logger.system.error('[PythonManager] pip install failed (default):', stderr)
    } catch (err) {
      logger.system.error('[PythonManager] pip install error (default):', err)
    }
    return false
  }

  private async _installBasePackages(venvDir: string): Promise<void> {
    const pipPath = this._getVenvPip(venvDir)
    if (!pipPath) {
      logger.system.error('[PythonManager] pip not found in venv')
      return
    }

    logger.system.info(`[PythonManager] Installing base packages: ${BASE_PACKAGES.join(', ')}`)
    this.notifyStatus(`正在安装基础包（${BASE_PACKAGES.join(', ')}，使用国内镜像源）...`)

    const success = await this._pipInstallWithMirrors(pipPath, BASE_PACKAGES, 300000)
    if (success) {
      this._status.installedPackages = [...BASE_PACKAGES]
      this.notifyStatus('基础包安装完成')
      logger.system.info('[PythonManager] Base packages installed successfully')
    } else {
      this.notifyStatus('基础包安装失败，部分 Python 功能可能不可用')
      logger.system.error('[PythonManager] pip install base packages failed (all mirrors)')
    }
  }

  async installPackage(packageName: string): Promise<{ success: boolean; error?: string }> {
    const venvDir = this._status.venvDir
    if (!venvDir) return { success: false, error: 'No venv available' }

    const pipPath = this._getVenvPip(venvDir)
    if (!pipPath) return { success: false, error: 'pip not found in venv' }

    // 使用带国内镜像源轮询的 pip install
    const success = await this._pipInstallWithMirrors(pipPath, [packageName], 300000)
    if (!success) return { success: false, error: `Failed to install ${packageName} from all mirrors` }

    if (!this._status.installedPackages.includes(packageName)) {
      this._status.installedPackages.push(packageName)
    }
    return { success: true }
  }

  private _extractPythonDependencies(scriptContent: string): string[] {
    const PYTHON_IMPORT_TO_PACKAGE: Record<string, string> = {
      pandas: 'pandas', pd: 'pandas',
      numpy: 'numpy', np: 'numpy',
      openpyxl: 'openpyxl',
      xlrd: 'xlrd', xlwt: 'xlwt',
      matplotlib: 'matplotlib', plt: 'matplotlib',
      seaborn: 'seaborn',
      scipy: 'scipy',
      sklearn: 'scikit-learn',
      requests: 'requests',
      bs4: 'beautifulsoup4',
      PIL: 'pillow',
      plotly: 'plotly',
      sympy: 'sympy',
      statsmodels: 'statsmodels',
      sqlalchemy: 'sqlalchemy',
      psycopg2: 'psycopg2-binary',
    }
    const deps = new Set<string>()
    const importRegex = /^\s*(?:from|import)\s+([a-zA-Z_][a-zA-Z0-9_]*)/gm
    let match: RegExpExecArray | null
    while ((match = importRegex.exec(scriptContent)) !== null) {
      const pkg = PYTHON_IMPORT_TO_PACKAGE[match[1]]
      if (pkg) deps.add(pkg)
    }
    return Array.from(deps)
  }

  private async _ensureDependencies(scriptContent: string): Promise<void> {
    const deps = this._extractPythonDependencies(scriptContent)
    if (deps.length === 0) return

    for (const dep of deps) {
      if (!this._status.installedPackages.includes(dep)) {
        logger.system.info(`[PythonManager] Auto-installing dependency: ${dep}`)
        const result = await this.installPackage(dep)
        if (!result.success) {
          logger.system.warn(`[PythonManager] Failed to install ${dep}: ${result.error}`)
        }
      }
    }
  }

  async executeScript(params: {
    scriptPath: string
    args?: string[]
    cwd?: string
    timeout?: number
  }): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string }> {
    const { scriptPath, args = [], cwd, timeout = 120000 } = params

    if (!fs.existsSync(scriptPath)) {
      return { success: false, stdout: '', stderr: '', exitCode: null, error: `Script file not found: ${scriptPath}` }
    }

    const pythonPath = this._status.pythonPath
    if (pythonPath && fs.existsSync(pythonPath)) {
      try {
        const scriptContent = fs.readFileSync(scriptPath, 'utf-8')
        await this._ensureDependencies(scriptContent)
      } catch (err) {
        logger.system.warn('[PythonManager] Failed to scan dependencies:', err)
      }

      logger.system.info(`[PythonManager] Executing script via venv python: ${scriptPath}`)
      try {
        const result = await execCommandAsync(
          pythonPath,
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
        logger.system.warn('[PythonManager] venv python execution failed, falling back to uv run:', errMsg)
      }
    }

    const uvPath = this._status.uvPath || resolveCommandPath('uv')
    if (!uvPath) {
      return { success: false, stdout: '', stderr: '', exitCode: null, error: 'No Python runtime available. Please ensure Python environment is set up.' }
    }

    logger.system.info(`[PythonManager] Executing script via uv run: ${scriptPath}`)
    try {
      const result = await execCommandAsync(
        uvPath,
        ['run', '--script', scriptPath, ...args],
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
      logger.system.error('[PythonManager] Script execution failed:', errMsg)
      return { success: false, stdout: '', stderr: errMsg, exitCode: null, error: errMsg }
    }
  }

  async executeInlineScript(params: {
    script: string
    dependencies?: string[]
    args?: string[]
    cwd?: string
    timeout?: number
  }): Promise<{ success: boolean; stdout: string; stderr: string; exitCode: number | null; error?: string; tempFile?: string }> {
    const { script, dependencies = [], args = [], cwd, timeout = 120000 } = params

    const baseDir = cwd || getDefaultPythonDir()
    const tempDir = path.join(baseDir, BRAND.dirName, 'python-temp')
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true })

    const tempFile = path.join(tempDir, `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.py`)

    const pythonPath = this._status.pythonPath
    if (pythonPath && fs.existsSync(pythonPath)) {
      try {
        fs.writeFileSync(tempFile, script, 'utf-8')

        await this._ensureDependencies(script)
        for (const dep of dependencies) {
          if (!this._status.installedPackages.includes(dep)) {
            logger.system.info(`[PythonManager] Auto-installing explicit dependency: ${dep}`)
            const result = await this.installPackage(dep)
            if (!result.success) {
              logger.system.warn(`[PythonManager] Failed to install ${dep}: ${result.error}`)
            }
          }
        }

        logger.system.info(`[PythonManager] Executing inline script via venv python: ${tempFile}`)
        try {
          const result = await execCommandAsync(
            pythonPath,
            [tempFile, ...args],
            { cwd: cwd || path.dirname(tempFile), timeout }
          )

          return {
            success: result.code === 0,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.code,
            error: result.code !== 0 ? result.stderr : undefined,
            tempFile,
          }
        } catch (err) {
          const errMsg = toAppError(err).message
          logger.system.warn('[PythonManager] venv python inline execution failed, falling back to uv run:', errMsg)
        }
      } finally {
        try {
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile)
        } catch { /* ignore */ }
      }
    }

    const uvPath = this._status.uvPath || resolveCommandPath('uv')
    if (!uvPath) {
      return { success: false, stdout: '', stderr: '', exitCode: null, error: 'No Python runtime available. Please ensure Python environment is set up.' }
    }

    const fallbackTempFile = path.join(tempDir, `script-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.py`)

    try {
      let scriptContent = script
      if (dependencies.length > 0) {
        const depComment = `# /// script\n# dependencies = [${dependencies.map(d => `"${d}"`).join(', ')}]\n# ///\n`
        scriptContent = depComment + script
      }

      fs.writeFileSync(fallbackTempFile, scriptContent, 'utf-8')

      logger.system.info(`[PythonManager] Executing inline script via uv run: ${fallbackTempFile}`)

      const result = await execCommandAsync(
        uvPath,
        ['run', '--script', fallbackTempFile, ...args],
        { cwd: cwd || path.dirname(fallbackTempFile), timeout }
      )

      return {
        success: result.code === 0,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.code,
        error: result.code !== 0 ? result.stderr : undefined,
        tempFile: fallbackTempFile,
      }
    } catch (err) {
      const errMsg = toAppError(err).message
      logger.system.error('[PythonManager] Inline script execution failed:', errMsg)
      return { success: false, stdout: '', stderr: errMsg, exitCode: null, error: errMsg, tempFile: fallbackTempFile }
    } finally {
      try {
        if (fs.existsSync(fallbackTempFile)) fs.unlinkSync(fallbackTempFile)
      } catch { /* ignore */ }
    }
  }

  async reinstall(): Promise<PythonStatus> {
    logger.system.info('[PythonManager] Reinstalling Python environment...')

    store.delete(CONFIG_KEY_PYTHON_PATH)
    store.delete(CONFIG_KEY_UV_PATH)
    store.delete(CONFIG_KEY_UVX_PATH)
    store.delete(CONFIG_KEY_VENV_DIR)
    store.delete(CONFIG_KEY_VENV_BASE_VERSION)
    store.delete(CONFIG_KEY_STATUS)
    // 重装是用户显式动作，之前记录过的「装不上」结论应当作废，否则会被这道闸门挡住
    this._failedRequirements.clear()

    try {
      if (fs.existsSync(getDefaultPythonDir())) {
        fs.rmSync(getDefaultPythonDir(), { recursive: true, force: true })
      }
    } catch (err) {
      logger.system.warn('[PythonManager] Failed to clean python-env dir:', err)
    }

    this._status = {
      ready: false,
      pythonPath: null,
      uvPath: null,
      uvxPath: null,
      source: 'none',
      version: null,
      venvDir: null,
      venvBaseVersion: null,
      installedPackages: [],
    }

    return this.ensureReady()
  }

  /**
   * 手动指定解释器路径
   *
   * 不校验、不拒绍：这是用户的显式选择。但会把「低于插件要求」的结论写进诊断，
   * 让设置页与插件都能提前看到原因，而不是等脚本抛 SyntaxError 才发现。
   */
  setCustomPythonPath(customPath: string | null): void {
    if (customPath && fs.existsSync(customPath)) {
      store.set(CONFIG_KEY_PYTHON_PATH, customPath)
      this._status.pythonPath = customPath
      // 用户可能选的是受管目录里的解释器，此时单纯标 'system' 就不对了
      this._status.source = this._classifySource(customPath)
      this._status.ready = true
      this._status.error = undefined
      this._failedRequirements.clear()
      this._getPythonVersion(customPath).then((v) => {
        this._status.version = v
        const requiredText = formatVersion(MIN_VENV_BASE_VERSION)
        if (v && !isVersionSatisfied(v, MIN_VENV_BASE_VERSION)) {
          this._status.diagnostics = {
            requiredVersion: requiredText,
            candidates: [
              {
                kind: 'manual',
                path: customPath,
                version: v,
                accepted: false,
                reason: `手动指定，但版本 ${v} 低于 ${requiredText}`,
              },
            ],
            outcome: `已手动指定 ${customPath}（${v}）：不满足插件要求的 ${requiredText}+`,
          }
        }
      })
    } else if (customPath === null) {
      store.delete(CONFIG_KEY_PYTHON_PATH)
      this._status.pythonPath = null
      this._status.ready = false
      this._status.source = 'none'
      this._status.venvBaseVersion = null
    }
  }
}

export const pythonManager = PythonManager.getInstance()
