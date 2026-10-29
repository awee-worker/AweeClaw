/**
 * 二进制探测服务
 *
 * 只回答一个问题：某个命令在这台机器上有没有、在哪、什么版本。
 *
 * 不走终端。判断一个命令装没装，本质是一次文件系统检查；把这件事交给用户
 * shell 去做，会连带加载 .zshrc / .bash_profile，慢且不稳定 —— 用户在终端里
 * ffmpeg 用得好好的，应用内却反复超时，根因就在这里。这里直接按目录遍历，
 * 版本再用 execFile 直连二进制取，两者都不依赖 shell 配置、不需要会话、
 * 也没有「命令与关闭窗口抢同一台终端」的竞争。
 */

import { execFile } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'

/** 探测结果 */
export interface BinaryProbeResult {
  /** 是否找到可执行文件 */
  found: boolean
  /** 调用方传入的原始查询（命令名或绝对路径） */
  command: string
  /** 命中路径；未命中为 null */
  path: string | null
  /** 版本串（版本命令输出首行）；取不到为 null，不影响 found */
  version: string | null
  /** 版本命令失败原因，仅用于排查 */
  versionError?: string
  /** 命中来源 */
  source: 'absolute' | 'common' | 'path' | 'shell' | 'none'
  /** 实际搜索过的目录数 */
  searchedDirs: number
  /** 总耗时（毫秒） */
  elapsedMs: number
}

/** 探测选项 */
export interface BinaryProbeOptions {
  /** 是否附带版本号；默认 true */
  withVersion?: boolean
  /** 取版本时传给二进制的参数；默认 ['-version']（ffmpeg 系） */
  versionArgs?: string[]
  /** 取版本的超时（毫秒），默认 4000 */
  versionTimeoutMs?: number
  /** 是否跳过结果缓存 */
  force?: boolean
}

/** 命中结果缓存：命令名 → 结论 */
interface CachedProbe {
  at: number
  result: BinaryProbeResult
}

/** 命中缓存保留时长 */
const CACHE_TTL_MS = 60 * 1000

/** 版本命令默认超时 */
const DEFAULT_VERSION_TIMEOUT_MS = 4000

/** 用户 shell PATH 解析超时 */
const SHELL_PATH_TIMEOUT_MS = 5000

const probeCache = new Map<string, CachedProbe>()

/**
 * 允许探测的命令名
 *
 * 这个接口只读、只查 PATH，但仍然不接受任意字符串：调用方传进来的是命令名，
 * 一旦带上路径分隔符或 shell 元字符，就越过了「按名查 PATH」的语义。
 * 绝对路径单独走一条分支，且只做存在性判断，不拼接任何命令。
 */
const SAFE_COMMAND_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/

/** Windows 下可执行文件的后缀 */
const WIN_EXEC_SUFFIXES = ['.exe', '.cmd', '.bat', '.com']

/**
 * 常见二进制目录
 *
 * 排在这里而不是只信 process.env.PATH，是因为 GUI 进程从 launchd / Finder
 * 继承的 PATH 通常只有 /usr/bin:/bin:/usr/sbin:/sbin —— 恰恰不含 Homebrew
 * 与 MacPorts 的安装位置，而 ffmpeg 几乎都装在那里。
 */
function commonBinaryDirs(): string[] {
  const home = os.homedir()

  if (process.platform === 'win32') {
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files'
    const localAppData = process.env['LOCALAPPDATA'] || path.join(home, 'AppData', 'Local')
    return [
      path.join(programFiles, 'ffmpeg', 'bin'),
      path.join(localAppData, 'Microsoft', 'WindowsApps'),
      path.join(home, 'scoop', 'shims'),
      path.join(programFiles, 'Git', 'cmd'),
      'C:\\ffmpeg\\bin',
    ]
  }

  if (process.platform === 'darwin') {
    return [
      '/opt/homebrew/bin', // Apple Silicon Homebrew
      '/opt/homebrew/sbin',
      '/usr/local/bin', // Intel Homebrew / 官方安装包
      '/usr/local/sbin',
      '/opt/local/bin', // MacPorts
      '/opt/local/sbin',
      '/usr/bin',
      '/bin',
      '/usr/sbin',
      '/sbin',
      path.join(home, '.local', 'bin'),
      path.join(home, 'bin'),
    ]
  }

  return [
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/local/sbin',
    '/usr/sbin',
    '/sbin',
    '/snap/bin',
    '/var/lib/flatpak/exports/bin',
    path.join(home, '.local', 'bin'),
    path.join(home, 'bin'),
  ]
}

/** 用户登录 shell 解析出的完整 PATH（进程内缓存一次） */
let cachedShellPath: string | null = null
let shellPathPromise: Promise<string | null> | null = null

/**
 * 读取用户登录 shell 的完整 PATH
 *
 * 只在「常见目录 + 进程 PATH」都没命中时才走这一步：它要拉起一个交互式 shell，
 * 通常要一两秒。先把免费的部分做完，能命中就不用付这个代价。
 *
 * 限制在 5 秒内返回，且只读 PATH 不执行其他内容 —— 即使用户 shell 配置有阻塞
 * 启动的脚本，探测也不会被拖死。
 */
function resolveUserShellPath(): Promise<string | null> {
  if (cachedShellPath !== null) return Promise.resolve(cachedShellPath)
  if (shellPathPromise) return shellPathPromise

  shellPathPromise = new Promise<string | null>((resolve) => {
    if (process.platform === 'win32') {
      cachedShellPath = ''
      shellPathPromise = null
      resolve(null)
      return
    }

    const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash')
    let settled = false
    let stdout = ''

    const finish = (value: string | null) => {
      if (settled) return
      settled = true
      cachedShellPath = value ?? ''
      shellPathPromise = null
      resolve(value)
    }

    let child: ReturnType<typeof execFile>
    try {
      child = execFile(
        shell,
        ['-l', '-i', '-c', 'echo $PATH'],
        { timeout: SHELL_PATH_TIMEOUT_MS, env: { ...process.env }, windowsHide: true },
        (err, out) => {
          const text = (out || stdout || '').trim()
          if (!err && text) finish(text)
          else finish(null)
        },
      )
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
    } catch (err) {
      logger.system.warn(
        `[BinaryProbe] 解析用户 shell PATH 失败: ${err instanceof Error ? err.message : String(err)}`,
      )
      finish(null)
    }
  })

  return shellPathPromise
}

/** 该路径是否是可执行文件 */
function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false
    // Windows 不区分可执行位，能被 stat 到即视为可执行（后缀已在上层筛过）
    if (process.platform === 'win32') return true
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** 按命令名在给定目录里找文件，返回命中路径 */
function searchDirs(command: string, dirs: string[]): { found: string | null; searched: number } {
  const names =
    process.platform === 'win32'
      ? WIN_EXEC_SUFFIXES.map((suffix) => `${command}${suffix}`)
      : [command]

  let searched = 0
  for (const dir of dirs) {
    if (!dir) continue
    searched += 1
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (isExecutableFile(candidate)) return { found: candidate, searched }
    }
  }
  return { found: null, searched }
}

/** 取版本：直接执行二进制，不经 shell，不共享任何终端会话 */
function readVersion(
  binaryPath: string,
  args: string[],
  timeoutMs: number,
): Promise<{ version: string | null; error?: string }> {
  return new Promise((resolve) => {
    execFile(
      binaryPath,
      args,
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ version: null, error: err.message })
          return
        }
        // 版本串常在 stdout，个别工具的版本信息写在 stderr
        const text = `${stdout || ''}\n${stderr || ''}`.trim()
        const firstLine = text.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
        resolve({ version: firstLine || null })
      },
    )
  })
}

/**
 * 探测一个命令
 *
 * @param input 命令名（如 ffmpeg）或绝对路径
 */
export async function probeBinary(
  input: string,
  options: BinaryProbeOptions = {},
): Promise<BinaryProbeResult> {
  const startedAt = Date.now()
  const command = String(input || '').trim()
  const withVersion = options.withVersion !== false
  const versionArgs = options.versionArgs ?? ['-version']
  const versionTimeoutMs = options.versionTimeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS

  const base: BinaryProbeResult = {
    found: false,
    command,
    path: null,
    version: null,
    source: 'none',
    searchedDirs: 0,
    elapsedMs: 0,
  }

  if (!command) return { ...base, elapsedMs: Date.now() - startedAt }

  const cacheKey = `${command}|${withVersion ? 1 : 0}`
  if (!options.force) {
    const cached = probeCache.get(cacheKey)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return { ...cached.result, elapsedMs: Date.now() - startedAt }
    }
  }

  let hit: string | null = null
  let source: BinaryProbeResult['source'] = 'none'
  let searchedDirs = 0

  if (path.isAbsolute(command)) {
    // 绝对路径只做存在性判断，不再拼路径
    searchedDirs = 1
    if (isExecutableFile(command)) {
      hit = command
      source = 'absolute'
    }
  } else if (SAFE_COMMAND_PATTERN.test(command)) {
    const fromCommon = searchDirs(command, commonBinaryDirs())
    searchedDirs += fromCommon.searched
    if (fromCommon.found) {
      hit = fromCommon.found
      source = 'common'
    }

    if (!hit) {
      const fromEnv = searchDirs(
        command,
        (process.env.PATH || '').split(path.delimiter).filter(Boolean),
      )
      searchedDirs += fromEnv.searched
      if (fromEnv.found) {
        hit = fromEnv.found
        source = 'path'
      }
    }

    if (!hit) {
      const shellPath = await resolveUserShellPath()
      if (shellPath) {
        const fromShell = searchDirs(command, shellPath.split(path.delimiter).filter(Boolean))
        searchedDirs += fromShell.searched
        if (fromShell.found) {
          hit = fromShell.found
          source = 'shell'
        }
      }
    }
  } else {
    logger.system.warn(`[BinaryProbe] 拒绝探测非法命令名: ${command}`)
    return { ...base, elapsedMs: Date.now() - startedAt }
  }

  const result: BinaryProbeResult = {
    found: Boolean(hit),
    command,
    path: hit,
    version: null,
    source: hit ? source : 'none',
    searchedDirs,
    elapsedMs: 0,
  }

  if (hit && withVersion) {
    const { version, error } = await readVersion(hit, versionArgs, versionTimeoutMs)
    result.version = version
    if (error) result.versionError = error
  }

  result.elapsedMs = Date.now() - startedAt
  probeCache.set(cacheKey, { at: Date.now(), result })

  logger.system.info(
    `[BinaryProbe] ${command} → ${result.found ? `${result.path}（${result.source}）` : '未找到'}` +
      ` · ${result.elapsedMs}ms · 搜索 ${searchedDirs} 个目录`,
  )

  return result
}

/** 清除探测缓存（用户装完依赖后由调用方触发，保证「重新检测」拿到新结论） */
export function clearProbeCache(command?: string): void {
  if (!command) {
    probeCache.clear()
    return
  }
  for (const key of probeCache.keys()) {
    if (key.startsWith(`${command}|`)) probeCache.delete(key)
  }
}
