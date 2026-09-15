/**
 * 沙箱策略存储（主进程）
 *
 * 存储布局：
 *   <userData>/sandbox/sandbox_config.json   配置（e2b apiKey 加密落盘）
 *
 * 与 PowerGuardStore / VtsStore / A2aStore 共用同一套 `mergeConfig` 深合并语义：
 * 「旧配置缺字段不丢默认值、用户手改出非法类型也不污染内存」。
 *
 * @module security/sandbox/SandboxStore
 */

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { decryptString, encryptString } from '../../../guard/safeStorageUtil'
import type {
  SandboxConfig,
  SandboxPolicy,
  SandboxWorkDirMode,
} from '@shared/protocols/sandboxProtocol'

// ============================================
// 常量
// ============================================

const SANDBOX_DIR_NAME = 'sandbox'
const CONFIG_FILE_NAME = 'sandbox_config.json'

/** 超时下限：1 秒。再小就无法完成任何有意义的启动开销（node/python 冷启动） */
export const TIMEOUT_FLOOR_MS = 1_000
/** 超时上限：10 分钟。与 run_command 的「安装/构建」档位对齐 */
export const TIMEOUT_CEILING_MS = 10 * 60 * 1000

/** 输出上限下限：4KB。再小会丢掉正常命令的报错信息 */
export const MAX_OUTPUT_FLOOR_BYTES = 4 * 1024
/** 输出上限上限：16MB。再大就没意义了（模型只能看前几 KB） */
export const MAX_OUTPUT_CEILING_BYTES = 16 * 1024 * 1024

/**
 * 默认配置。
 *
 * `policy: 'off'` —— 沙箱会改变命令的执行环境（cwd / env / 文件可见性），
 * 默认开启会让既有工作流静默失败（例如依赖用户 `~/.npmrc`、PATH 里的本地工具链）。
 * 必须由用户显式选择后端，符合 P1 通用要求「off 状态下行为与改造前一致」。
 */
export const DEFAULT_SANDBOX_CONFIG: SandboxConfig = {
  policy: 'off',
  timeoutMs: 120_000,
  maxOutputBytes: 1024 * 1024,
  workDirMode: 'workspace',
  allowFallback: true,
  docker: {
    image: 'python:3.11-slim',
    memoryMb: 512,
    cpus: 1,
    pidsLimit: 128,
    network: false,
    pullOnDemand: true,
  },
  e2b: {
    apiKey: '',
    template: 'base',
    timeoutMs: 120_000,
  },
}

const VALID_POLICIES: SandboxPolicy[] = ['off', 'local', 'docker', 'e2b']
const VALID_WORKDIR_MODES: SandboxWorkDirMode[] = ['workspace', 'temp']

// ============================================
// 路径工具
// ============================================

/** 模块数据目录（<userData>/sandbox） */
export function getSandboxDataDir(): string {
  return path.join(app.getPath('userData'), SANDBOX_DIR_NAME)
}

/** 配置文件绝对路径 */
export function getSandboxConfigPath(): string {
  return path.join(getSandboxDataDir(), CONFIG_FILE_NAME)
}

/** 确保目录存在 */
function ensureDir(dir: string): void {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  } catch (err) {
    logger.system.warn('[Sandbox] ensureDir failed:', dir, err)
  }
}

// ============================================
// 深合并与归一化
// ============================================

/** 深合并：只覆盖 fallback 中已声明的键，且类型必须一致 */
function mergeConfig<T>(fallback: T, patch: unknown): T {
  if (patch === null || patch === undefined || typeof patch !== 'object') return fallback
  if (Array.isArray(fallback)) return fallback

  const source = patch as Record<string, unknown>
  const base = fallback as unknown as Record<string, unknown>
  const out: Record<string, unknown> = { ...base }

  for (const key of Object.keys(base)) {
    const next = source[key]
    if (next === undefined) continue
    const current = base[key]
    if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
      out[key] = mergeConfig(current, next)
    } else if (typeof next === typeof current) {
      out[key] = next
    }
  }

  return out as T
}

/** 夹取到 [floor, ceiling]，非有限数回落默认值 */
function clampNumber(value: number, floor: number, ceiling: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.max(floor, Math.min(ceiling, Math.floor(value)))
}

/**
 * 归一化：非法枚举回落默认、数值夹取到合法区间。
 *
 * 手改配置文件把 `policy` 写成拼写错误的值时，必须回落到 **`off`**（而不是保留非法值），
 * 否则 `resolveProviderChain` 会返回空链、运行期表现为「命令全部被拒」，
 * 比直接退回宿主执行更难排查。
 */
function normalize(config: SandboxConfig): SandboxConfig {
  const out: SandboxConfig = {
    ...config,
    docker: { ...config.docker },
    e2b: { ...config.e2b },
  }

  if (!VALID_POLICIES.includes(out.policy)) out.policy = DEFAULT_SANDBOX_CONFIG.policy
  if (!VALID_WORKDIR_MODES.includes(out.workDirMode)) {
    out.workDirMode = DEFAULT_SANDBOX_CONFIG.workDirMode
  }

  out.timeoutMs = clampNumber(out.timeoutMs, TIMEOUT_FLOOR_MS, TIMEOUT_CEILING_MS, DEFAULT_SANDBOX_CONFIG.timeoutMs)
  out.maxOutputBytes = clampNumber(
    out.maxOutputBytes,
    MAX_OUTPUT_FLOOR_BYTES,
    MAX_OUTPUT_CEILING_BYTES,
    DEFAULT_SANDBOX_CONFIG.maxOutputBytes,
  )

  if (!out.docker.image || typeof out.docker.image !== 'string') {
    out.docker.image = DEFAULT_SANDBOX_CONFIG.docker.image
  }
  out.docker.memoryMb = clampNumber(out.docker.memoryMb, 64, 32_768, DEFAULT_SANDBOX_CONFIG.docker.memoryMb)
  out.docker.cpus = clampNumber(out.docker.cpus, 1, 32, DEFAULT_SANDBOX_CONFIG.docker.cpus)
  out.docker.pidsLimit = clampNumber(out.docker.pidsLimit, 16, 4096, DEFAULT_SANDBOX_CONFIG.docker.pidsLimit)

  if (!out.e2b.template || typeof out.e2b.template !== 'string') {
    out.e2b.template = DEFAULT_SANDBOX_CONFIG.e2b.template
  }
  out.e2b.timeoutMs = clampNumber(
    out.e2b.timeoutMs,
    TIMEOUT_FLOOR_MS,
    TIMEOUT_CEILING_MS,
    DEFAULT_SANDBOX_CONFIG.e2b.timeoutMs,
  )

  return out
}

// ============================================
// 凭证加解密
// ============================================

/** 落盘前加密 apiKey */
function encryptSecrets(config: SandboxConfig): SandboxConfig {
  return {
    ...config,
    e2b: {
      ...config.e2b,
      apiKey: config.e2b.apiKey ? encryptString(config.e2b.apiKey) : '',
    },
  }
}

/** 读盘后解密 apiKey（decryptString 对无前缀的旧明文原样返回） */
function decryptSecrets(config: SandboxConfig): SandboxConfig {
  return {
    ...config,
    e2b: {
      ...config.e2b,
      apiKey: config.e2b.apiKey ? decryptString(config.e2b.apiKey) : '',
    },
  }
}

// ============================================
// 配置读写
// ============================================

/** 内存缓存（避免每次读磁盘） */
let cached: SandboxConfig | null = null

/** 读取配置 */
export function getConfig(): SandboxConfig {
  if (cached) return cached

  const filePath = getSandboxConfigPath()
  try {
    if (!fs.existsSync(filePath)) {
      cached = { ...DEFAULT_SANDBOX_CONFIG }
      return cached
    }
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as Record<string, unknown>
    cached = normalize(decryptSecrets(mergeConfig(DEFAULT_SANDBOX_CONFIG, parsed)))
  } catch (err) {
    logger.system.warn('[Sandbox] read config failed, fallback to default:', err)
    cached = { ...DEFAULT_SANDBOX_CONFIG }
  }
  return cached
}

/** 写入配置 */
export function saveConfig(next: SandboxConfig): void {
  cached = next
  try {
    ensureDir(getSandboxDataDir())
    fs.writeFileSync(getSandboxConfigPath(), JSON.stringify(encryptSecrets(next), null, 2), 'utf-8')
  } catch (err) {
    logger.system.error('[Sandbox] save config failed:', err)
  }
}

/** 局部更新配置（深合并到当前值，落盘并返回新值） */
export function updateConfig(patch: unknown): SandboxConfig {
  const next = normalize(mergeConfig(getConfig(), patch))
  saveConfig(next)
  return next
}

/** 重置为默认配置 */
export function resetConfig(): SandboxConfig {
  const next = { ...DEFAULT_SANDBOX_CONFIG }
  saveConfig(next)
  return next
}

/** 清除内存缓存（测试用） */
export function clearConfigCache(): void {
  cached = null
}

/**
 * 配置提示（不阻断保存，仅 UI 引导）。
 *
 * 这里只报「配置自相矛盾」的情况，不报「环境不可用」——后者由探测结果负责，
 * 两者混在一起会让用户分不清「我配错了」还是「机器上没装 docker」。
 */
export function validateConfig(config: SandboxConfig): string[] {
  const issues: string[] = []
  if (config.policy === 'e2b' && !config.e2b.apiKey) {
    issues.push('已选择 E2B 云沙箱但未配置 API Key，将降级到本地后端')
  }
  if (config.policy === 'docker' && config.docker.network) {
    issues.push('Docker 后端已放开容器网络，将失去「断网」这一核心隔离能力')
  }
  if (!config.allowFallback && config.policy !== 'off') {
    issues.push('已关闭降级：后端不可用时命令会被直接拒绝，而不是退回本地执行')
  }
  if (config.policy === 'local') {
    issues.push('local 后端仅提供超时与输出限制，无法阻断网络访问，也不会隐藏项目文件')
  }
  return issues
}
