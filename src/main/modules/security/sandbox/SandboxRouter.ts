/**
 * 沙箱路由与降级编排
 *
 * 职责边界（单一）：
 *   1. 按策略算出候选后端链，逐个探测（带 TTL 缓存），选出第一个可用的
 *   2. 执行；若后端**自身**故障则沿链继续降级，把每次降级如实记录下来
 *   3. 全链不可用时按 `allowFallback` 决定「降级」还是「直接拒绝」
 *
 * 关键语义（别改）：
 *   · **降级必须留痕**。每次降级都进 `degradations`，最终拼进工具返回文本 ——
 *     用户开了 docker 却实际跑在 local 上（失去网络隔离）而不自知，是最危险的情况。
 *   · **命令失败不触发降级**。只有 `infrastructureFailure` 才继续往下走；
 *     否则一条正常报错的命令会在三个后端里各跑一遍，既慢又可能产生副作用。
 *   · **探测结果带 TTL 缓存**。docker 探测要 spawn 一个进程，不能每条命令都做；
 *     但也不能永久缓存（用户中途启动 Docker Desktop 后应能自愈）。
 *
 * @module security/sandbox/SandboxRouter
 */

import { logger } from '@shared/toolkit/LogEngine'
import type {
  SandboxConfig,
  SandboxDegradation,
  SandboxProbe,
  SandboxProviderKind,
  SandboxRunResult,
  SandboxStatus,
} from '@shared/protocols/sandboxProtocol'
import { resolveProviderChain } from '@shared/protocols/sandboxProtocol'
import type { SandboxProvider } from './SandboxProvider'
import { LocalSandboxProvider } from './LocalSandboxProvider'
import { DockerSandboxProvider } from './DockerSandboxProvider'
import { E2bSandboxProvider } from './E2bSandboxProvider'
import { getConfig } from './SandboxStore'

/** 探测结果 TTL：30s。兼顾「不重复 spawn 进程」与「装好 docker 后能自愈」 */
export const PROBE_TTL_MS = 30_000

/** 路由结果：`handled === false` 表示策略为 off，调用方应走宿主原路径 */
export type SandboxRouteOutcome =
  | { handled: false }
  | { handled: true; result: SandboxRunResult }

export interface SandboxExecuteOptions {
  /** 覆盖配置的本次超时 */
  timeoutMs?: number
  agentId?: string
}

export class SandboxRouter {
  private readonly providers: Record<SandboxProviderKind, SandboxProvider>
  private readonly probeCache = new Map<SandboxProviderKind, { at: number; probe: SandboxProbe }>()

  private runningCount = 0
  private totalRuns = 0
  private refusedRuns = 0
  private lastDegradations: SandboxDegradation[] = []
  private lastError = ''
  private disposed = false

  constructor() {
    this.providers = {
      local: new LocalSandboxProvider(),
      docker: new DockerSandboxProvider(),
      e2b: new E2bSandboxProvider(),
    }
  }

  /**
   * 执行一条命令。
   *
   * @returns `{ handled: false }` → 策略为 off，**调用方必须回退到宿主执行路径**，
   *          保证「off 状态下行为与改造前完全一致」
   */
  async execute(
    command: string,
    cwd: string,
    options: SandboxExecuteOptions = {},
  ): Promise<SandboxRouteOutcome> {
    const config = getConfig()
    if (config.policy === 'off') return { handled: false }

    if (this.disposed) {
      return { handled: true, result: this.refusal('沙箱模块已卸载，无法执行') }
    }

    const chain = resolveProviderChain(config.policy)
    const degradations: SandboxDegradation[] = []
    const timeoutMs = this.resolveTimeout(config, options.timeoutMs)

    this.runningCount += 1
    try {
      for (let i = 0; i < chain.length; i += 1) {
        const kind = chain[i]
        if (!(kind in this.providers)) continue

        const probe = await this.probeOne(kind)
        if (!probe.available) {
          const next = chain[i + 1] ?? null
          const reason = probe.reason || '后端不可用'

          // 链走到底，或用户关闭了降级 → 不再往下走，直接拒绝执行
          if (next === null || !config.allowFallback) {
            this.lastDegradations = degradations
            this.refusedRuns += 1
            const detail = config.allowFallback
              ? `所有候选后端均不可用，最后一个失败原因：${reason}`
              : `后端 ${kind} 不可用且已关闭降级：${reason}`
            this.lastError = detail
            return { handled: true, result: this.refusal(detail, degradations) }
          }

          degradations.push({ from: kind, to: next, reason })
          logger.security.warn(`[Sandbox] degrade ${kind} → ${next}: ${reason}`)
          continue
        }

        this.totalRuns += 1
        const result = await this.providers[kind].run({ command, cwd, timeoutMs }, config, {
          degradations,
          agentId: options.agentId,
        })

        // 后端自身故障（CLI 起不来 / SDK 缺失）→ 继续沿链降级
        if (result.infrastructureFailure && config.allowFallback) {
          const next = chain[i + 1] ?? null
          if (next !== null) {
            degradations.push({
              from: kind,
              to: next,
              reason: this.firstLine(result.stderr) || '后端执行环境故障',
            })
            logger.security.warn(`[Sandbox] runtime degrade ${kind} → ${next}`)
            continue
          }
        }

        this.lastDegradations = result.degradations
        this.lastError = result.success ? '' : this.firstLine(result.stderr) || '命令执行失败'
        return { handled: true, result }
      }

      // 链为空（理论上不可达：policy≠off 时链至少一个元素）
      this.refusedRuns += 1
      this.lastError = '没有可用的沙箱后端'
      return { handled: true, result: this.refusal(this.lastError, degradations) }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.security.error('[Sandbox] router execute threw:', err)
      this.lastError = message
      return { handled: true, result: this.refusal(`沙箱路由异常：${message}`, degradations) }
    } finally {
      this.runningCount -= 1
    }
  }

  /** 探测全部后端（`force` 跳过缓存，用于设置页的「重新检测」） */
  async probeAll(force = false): Promise<SandboxProbe[]> {
    const kinds: SandboxProviderKind[] = ['local', 'docker', 'e2b']
    const results: SandboxProbe[] = []
    for (const kind of kinds) {
      results.push(await this.probeOne(kind, force))
    }
    return results
  }

  /** 当前状态（IPC 返回 / 事件推送） */
  async getStatus(force = false): Promise<SandboxStatus> {
    const config = getConfig()
    const probes = await this.probeAll(force)
    const chain = resolveProviderChain(config.policy)

    let activeProvider: SandboxProviderKind | null = null
    for (const kind of chain) {
      const probe = probes.find((p) => p.kind === kind)
      if (probe?.available) {
        activeProvider = kind
        break
      }
    }

    return {
      policy: config.policy,
      activeProvider,
      probes,
      lastDegradations: this.lastDegradations,
      runningCount: this.runningCount,
      totalRuns: this.totalRuns,
      refusedRuns: this.refusedRuns,
      lastError: this.lastError,
    }
  }

  /** 释放资源（模块卸载 / 应用退出） */
  async dispose(): Promise<void> {
    this.disposed = true
    this.probeCache.clear()
    for (const provider of Object.values(this.providers)) {
      try {
        await provider.dispose()
      } catch (err) {
        logger.security.warn('[Sandbox] provider dispose failed:', err)
      }
    }
  }

  // ============================================
  // 私有
  // ============================================

  /** 探测单个后端（带 TTL 缓存） */
  private async probeOne(kind: SandboxProviderKind, force = false): Promise<SandboxProbe> {
    const cached = this.probeCache.get(kind)
    if (!force && cached && Date.now() - cached.at < PROBE_TTL_MS) {
      return cached.probe
    }

    let probe: SandboxProbe
    try {
      probe = await this.providers[kind].probe()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.security.warn(`[Sandbox] probe ${kind} threw:`, message)
      probe = {
        kind,
        available: false,
        reason: `探测失败：${message}`,
        detail: '',
        capabilities: {
          networkIsolation: false,
          filesystemIsolation: false,
          resourceLimits: false,
          cloud: kind === 'e2b',
        },
      }
    }

    this.probeCache.set(kind, { at: Date.now(), probe })
    return probe
  }

  /** 本次超时：显式值优先，但一律不超过配置上限 */
  private resolveTimeout(config: SandboxConfig, override?: number): number {
    if (typeof override === 'number' && Number.isFinite(override) && override > 0) {
      return Math.min(override, config.timeoutMs)
    }
    return config.timeoutMs
  }

  /** 构造「拒绝执行」结果（provider=off 表示无沙箱承载，命令未执行） */
  private refusal(reason: string, degradations: SandboxDegradation[] = []): SandboxRunResult {
    return {
      success: false,
      stdout: '',
      stderr: reason,
      exitCode: null,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: 0,
      provider: 'off',
      degradations,
      notes: [reason],
      refused: true,
    }
  }

  /** 取首行（错误信息通常第一行才是根因，后面是堆栈 / 建议） */
  private firstLine(text: string): string {
    if (!text) return ''
    const line = text.split('\n').find((l) => l.trim().length > 0)
    return (line || '').trim()
  }
}

let instance: SandboxRouter | null = null

/** 全局唯一的沙箱路由实例 */
export function getSandboxRouter(): SandboxRouter {
  if (!instance) instance = new SandboxRouter()
  return instance
}

/** 测试用：丢弃单例 */
export function resetSandboxRouter(): void {
  instance = null
}

