/**
 * 外部智能体服务 — 主进程统一编排
 *
 * 职责：
 * - 配置持久化（electron-store，与项目其他模块一致）
 * - preflight 可用性检测（委托 Adapter）
 * - 运行编排：spawn 子进程 → readline 解析 → 事件推流 → 超时看门狗 → 结果收集
 * - 会话管理：start / wait / abort / status（支持 LLM 工具侧非阻塞委托）
 *
 * 安全边界：
 * - workdir 必须在工作区根目录内（由 IPC 层注入 resolver 校验）
 * - 子进程环境变量仅注入增强 PATH 与用户配置的 API Key
 * - 危险命令黑名单沿用 securityManager 体系（Agent 内部命令由 Agent 自身权限模式控制）
 */

import { spawn, type ChildProcess } from 'child_process'
import * as readline from 'readline'
import * as crypto from 'crypto'
import { safeStorage } from 'electron'
import Store from 'electron-store'
import { logger } from '@shared/toolkit/LogEngine'
import {
  DEFAULT_EXTERNAL_AGENT_CONFIG,
  EXTERNAL_AGENT_DEFS,
  type AgentPermissionMode,
  type AgentPreflightResult,
  type AgentStreamEvent,
  type ExternalAgentConfig,
  type ExternalAgentId,
  type ExternalAgentRunRequest,
  type ExternalAgentRunResult,
  type RecentAgentRun,
} from '@shared/externalAgents'
import { createAdapters } from './adapters'
import type { AgentRunState, ExternalAgentAdapter } from './types'

// ============================================
// 配置存储
// ============================================

const configStore = new Store({ name: 'external-agent-config' })
/** 最近运行记录（「继续上次任务」持久化） */
const recentStore = new Store({ name: 'external-agent-recent' })
const RECENT_MAX = 10

/** 加密前缀（仅该前缀的值视为已加密；真实 API Key 通常以 sk- 等开头，不会冲突） */
const ENC_PREFIX = 'enc:v1:'

/** 加密一个 API Key（不可用时原样返回，保持向后兼容） */
function encryptApiKey(value: string): string {
  if (!value) return value
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return ENC_PREFIX + safeStorage.encryptString(value).toString('base64')
    }
  } catch {
    /* 加密失败降级为明文（旧行为） */
  }
  return value
}

/** 解密一个 API Key（无前缀 = 旧版明文，原样返回；解密失败也原样返回） */
function decryptApiKey(value: string): string {
  if (!value.startsWith(ENC_PREFIX)) return value
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), 'base64'))
  } catch {
    logger.agent?.warn('[ExternalAgent] api key decrypt failed, falling back to raw value')
    return value
  }
}

/** 读取配置（与默认值合并，兼容旧版本缺字段；apiKeys 自动解密） */
function loadConfig(): ExternalAgentConfig {
  const raw = configStore.get('config', {}) as Partial<ExternalAgentConfig>
  const storedKeys = raw.apiKeys || {}
  const apiKeys: Partial<Record<ExternalAgentId, string>> = {}
  for (const [agent, v] of Object.entries(storedKeys)) {
    if (typeof v === 'string' && v) apiKeys[agent as ExternalAgentId] = decryptApiKey(v)
  }
  return {
    ...DEFAULT_EXTERNAL_AGENT_CONFIG,
    ...raw,
    enabled: { ...DEFAULT_EXTERNAL_AGENT_CONFIG.enabled, ...(raw.enabled || {}) },
    apiKeys,
  }
}

function saveConfig(patch: Partial<ExternalAgentConfig>): ExternalAgentConfig {
  const current = loadConfig()
  // 合并后写盘：apiKeys 加密存储，内存返回值保持明文
  const mergedKeys: Partial<Record<ExternalAgentId, string>> = { ...current.apiKeys }
  if (patch.apiKeys) {
    for (const [agent, v] of Object.entries(patch.apiKeys)) {
      if (v) mergedKeys[agent as ExternalAgentId] = v
      else delete mergedKeys[agent as ExternalAgentId] // 空值 = 用户清空
    }
  }
  const next: ExternalAgentConfig = {
    ...current,
    ...patch,
    enabled: { ...current.enabled, ...(patch.enabled || {}) },
    apiKeys: mergedKeys,
  }
  configStore.set('config', {
    ...next,
    apiKeys: Object.fromEntries(
      Object.entries(mergedKeys).map(([k, v]) => [k, encryptApiKey(v)]),
    ),
  })
  return next
}

// ============================================
// 会话管理
// ============================================

interface ActiveSession {
  requestId: string
  agent: ExternalAgentId
  proc: ChildProcess | null
  state: AgentRunState
  status: 'running' | 'done' | 'error' | 'aborted'
  result: ExternalAgentRunResult | null
  /** 等待方（wait RPC） */
  waitResolvers: Array<(result: ExternalAgentRunResult) => void>
  /** 推流目标（webContents.send 频道载荷） */
  push?: (event: AgentStreamEvent) => void
  watchdog?: NodeJS.Timeout
  stderrTail: string
  /** 运行元信息（持久化最近记录用） */
  task: string
  workdir: string
  startedAt: number
}

/**
 * 外部智能体服务（单例）
 *
 * 多窗口隔离说明：会话以 requestId 为键全局共享（外部 Agent 进程独立于窗口），
 * 推流事件只发给发起窗口（push 在 start 时绑定 event.sender）。
 */
class ExternalAgentService {
  /** 各 Agent 适配器 */
  private readonly adapters: Record<ExternalAgentId, ExternalAgentAdapter>
  /** 进行中/最近结束会话（requestId → session） */
  private readonly sessions = new Map<string, ActiveSession>()

  constructor() {
    this.adapters = createAdapters()
  }

  // ---------- 最近运行记录（继续上次任务） ----------

  /** 列出最近运行记录（新→旧） */
  listRecentRuns(): RecentAgentRun[] {
    try {
      const runs = recentStore.get('runs', []) as RecentAgentRun[]
      return Array.isArray(runs) ? runs : []
    } catch {
      return []
    }
  }

  /** 清空最近运行记录 */
  clearRecentRuns(): void {
    recentStore.delete('runs')
  }

  getConfig(): ExternalAgentConfig {
    return loadConfig()
  }

  updateConfig(patch: Partial<ExternalAgentConfig>): ExternalAgentConfig {
    logger.agent?.info('[ExternalAgent] config updated', patch)
    return saveConfig(patch)
  }

  // ---------- 可用性检测 ----------

  async preflight(agent: ExternalAgentId): Promise<AgentPreflightResult> {
    const adapter = this.adapters[agent]
    if (!adapter) {
      return { agent, available: false, reason: 'Unknown agent', headlessSupported: false }
    }
    try {
      const result = await adapter.preflight(loadConfig())
      return { ...result, headlessSupported: EXTERNAL_AGENT_DEFS[agent].headless }
    } catch (err) {
      logger.agent?.error(`[ExternalAgent] preflight failed for ${agent}:`, err)
      return { agent, available: false, reason: String(err), headlessSupported: EXTERNAL_AGENT_DEFS[agent].headless }
    }
  }

  // ---------- 运行 ----------

  /**
   * 启动一次外部 Agent 运行（非阻塞，立即返回 requestId）
   *
   * @param request 运行请求
   * @param workdirAllowed 工作目录白名单校验（由 IPC 层注入工作区根）
   * @param push 流式事件推送器（可选，绑定到发起窗口）
   */
  async start(
    request: ExternalAgentRunRequest,
    workdirAllowed: (workdir: string) => boolean,
    push?: (event: AgentStreamEvent) => void,
  ): Promise<{ requestId: string; error?: string }> {
    const agent = request.agent
    const adapter = this.adapters[agent]
    if (!adapter) return { requestId: '', error: `Unknown external agent: ${agent}` }

    const config = loadConfig()
    if (!config.enabled[agent]) {
      return { requestId: '', error: `外部智能体 ${agent} 未启用，请在设置 → 外部智能体中开启` }
    }

    // 安全边界：workdir 必须在工作区内
    if (!workdirAllowed(request.workdir)) {
      return { requestId: '', error: `工作目录不在允许的工作区内: ${request.workdir}` }
    }

    const permissionMode: AgentPermissionMode =
      request.permissionMode || config.defaultPermissionMode || 'acceptEdits'

    const command = adapter.buildCommand(
      request.task,
      { workdir: request.workdir, permissionMode, resumeSession: request.resumeSession },
      config,
    )
    if (!command) {
      return { requestId: '', error: `${agent} 当前环境不可用（CLI 缺失或暂不支持 headless）` }
    }

    const requestId = request.requestId || crypto.randomUUID()
    const session: ActiveSession = {
      requestId,
      agent,
      proc: null,
      state: { capturedOutput: [], toolCalls: [], lastStage: 'spawning' },
      status: 'running',
      result: null,
      waitResolvers: [],
      push,
      stderrTail: '',
      task: request.task,
      workdir: request.workdir,
      startedAt: Date.now(),
    }
    this.sessions.set(requestId, session)

    // 看门狗（默认 30 分钟）
    const timeoutMs = request.maxDurationMs || config.defaultTimeoutMs || 30 * 60 * 1000
    session.watchdog = setTimeout(() => {
      if (session.status === 'running') {
        this.finishSession(requestId, 'aborted', {
          success: false,
          agent,
          status: 'aborted',
          output: session.state.capturedOutput.join('\n').trim(),
          session: session.state.sessionId,
          error: `Timeout after ${Math.round(timeoutMs / 1000)}s`,
        })
      }
    }, timeoutMs)

    try {
      this.spawnSession(session, adapter, command.command, command.args, command.env, request.workdir)
    } catch (err) {
      this.finishSession(requestId, 'error', {
        success: false,
        agent,
        status: 'error',
        output: '',
        error: `Failed to spawn: ${String(err)}`,
      })
      return { requestId, error: String(err) }
    }

    logger.agent?.info(`[ExternalAgent] started ${agent} (${requestId})`, { workdir: request.workdir })
    return { requestId }
  }

  /** spawn 子进程并接好 stdout/stderr/exit 管线 */
  private spawnSession(
    session: ActiveSession,
    adapter: ExternalAgentAdapter,
    command: string,
    args: string[],
    env: Record<string, string>,
    cwd: string,
  ): void {
    const proc = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    session.proc = proc

    const rl = readline.createInterface({ input: proc.stdout! })
    rl.on('line', (line) => {
      if (session.status !== 'running') return
      const events = adapter.parseLine(line, session.state)
      for (const evt of events) this.emit(session, evt)
    })

    proc.stderr?.on('data', (d: Buffer) => {
      session.stderrTail = (session.stderrTail + d.toString()).slice(-2000)
    })

    proc.on('error', (err) => {
      this.finishSession(session.requestId, 'error', {
        success: false,
        agent: session.agent,
        status: 'error',
        output: session.state.capturedOutput.join('\n').trim(),
        error: `Spawn error: ${err.message}`,
      })
    })

    proc.on('close', (code) => {
      if (session.status !== 'running') return
      const result = adapter.finalize(session.state, code ?? 0, session.stderrTail)
      this.finishSession(session.requestId, result.status === 'done' ? 'done' : 'error', result)
    })

    // 推流：spawning 事件
    this.emit(session, { type: 'status', stage: 'spawning' })
  }

  /** 推流一个事件 */
  private emit(session: ActiveSession, event: AgentStreamEvent): void {
    session.push?.(event)
  }

  /** 结束会话：固化结果、清理资源、唤醒所有等待方、持久化最近记录 */
  private finishSession(requestId: string, status: 'done' | 'error' | 'aborted', result: ExternalAgentRunResult): void {
    const session = this.sessions.get(requestId)
    if (!session) return
    session.status = status
    session.result = result
    if (session.watchdog) clearTimeout(session.watchdog)
    this.emit(session, { type: 'done', result })
    for (const resolve of session.waitResolvers) resolve(result)
    session.waitResolvers = []
    // 持久化最近运行记录（供「继续上次任务」UI）
    try {
      const recent = this.listRecentRuns()
      recent.unshift({
        requestId: session.requestId,
        agent: session.agent,
        task: session.task,
        workdir: session.workdir,
        session: result.session,
        status: session.status,
        success: result.success,
        finishedAt: Date.now(),
        durationMs: Date.now() - session.startedAt,
      })
      recentStore.set('runs', recent.slice(0, RECENT_MAX))
    } catch {
      logger.agent?.warn('[ExternalAgent] persist recent run failed')
    }
    // 保留会话记录 5 分钟供 status 查询，之后回收
    setTimeout(() => {
      this.sessions.delete(requestId)
    }, 5 * 60 * 1000).unref()
    logger.agent?.info(`[ExternalAgent] ${session.agent} finished: ${status}`, { requestId })
  }

  /** 等待运行结束（阻塞至 done/error/aborted 或指定超时） */
  wait(requestId: string, timeoutMs?: number): Promise<ExternalAgentRunResult> {
    const session = this.sessions.get(requestId)
    if (!session) {
      return Promise.resolve({
        success: false,
        agent: 'claude-code',
        status: 'error',
        output: '',
        error: `Unknown session: ${requestId}`,
      })
    }
    if (session.result) return Promise.resolve(session.result)

    const timeout = timeoutMs || 30 * 60 * 1000
    return new Promise<ExternalAgentRunResult>((resolve) => {
      const timer = setTimeout(() => {
        resolve({
          success: false,
          agent: session.agent,
          status: 'aborted',
          output: session.state.capturedOutput.join('\n').trim(),
          error: 'Wait timed out',
        })
      }, timeout)
      timer.unref()
      session.waitResolvers.push((result) => {
        clearTimeout(timer)
        resolve(result)
      })
    })
  }

  /** 中止运行 */
  abort(requestId: string): boolean {
    const session = this.sessions.get(requestId)
    if (!session || session.status !== 'running') return false
    session.proc?.kill('SIGTERM')
    // 2s 后强杀兜底
    setTimeout(() => {
      if (session.status === 'running') session.proc?.kill('SIGKILL')
    }, 2000).unref()
    this.finishSession(requestId, 'aborted', {
      success: false,
      agent: session.agent,
      status: 'aborted',
      output: session.state.capturedOutput.join('\n').trim(),
      session: session.state.sessionId,
      error: 'Aborted by user',
    })
    return true
  }

  /** 查询会话状态 */
  status(requestId: string): { status: 'running' | 'done' | 'error' | 'aborted' | 'unknown'; result: ExternalAgentRunResult | null } {
    const session = this.sessions.get(requestId)
    if (!session) return { status: 'unknown', result: null }
    return { status: session.status, result: session.result }
  }

  /** 清理所有进行中会话（应用退出时调用） */
  cleanupAll(): void {
    for (const [requestId, session] of this.sessions) {
      if (session.status === 'running') {
        this.abort(requestId)
      }
    }
    this.sessions.clear()
  }
}

export const externalAgentService = new ExternalAgentService()
