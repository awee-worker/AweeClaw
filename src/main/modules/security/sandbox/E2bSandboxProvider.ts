/**
 * E2B 云沙箱后端
 *
 * 适用场景：本机不想/不能跑容器（Windows 无 Docker、公司机器禁装、CI 环境），
 * 但需要一个「断网 + 文件系统隔离 + 资源限额」的执行环境。
 *
 * ── 实现方式与偏离原方案的说明（必读）─────────────────────────
 * P1 文档原写「用 undici 调 e2b API」。落地时核实其官方 REST 面后否决了这条路：
 * E2B 的公开 REST 只覆盖**控制面**（`POST /sandboxes` 创建、`.../connect` 取 envd 地址
 * 与访问令牌），真正的**数据面**（跑命令 / 传文件）走 envd 的 ConnectRPC 端口，
 * 请求体是 protobuf 编码。手写这层需要同时实现 ConnectRPC 帧格式 + protobuf 编解码，
 * 而动辄上百行的编解码在**无法用真实凭据联调**的前提下写出来，
 * 大概率是一份「看着对、跑起来错」的伪实现。
 *
 * 因此改为**懒加载官方 SDK**：`require('e2b')`（缺失时回落 `@e2b/code-interpreter`）。
 * 好处是协议面完全交给官方维护；代价是它是一个可选依赖，未安装时本后端不可用
 * ——这恰好由降级链优雅处理（e2b → docker → local → 拒绝），不会把整个功能卡死。
 *
 * ⚠️ **未在真实 API Key 下联调**。因此这里的错误处理刻意不做「友好翻译」：
 * SDK 抛什么就如实带上什么原文，让形状不匹配（SDK 大版本差异）一眼可见，
 * 而不是被包装成一句「云沙箱调用失败」把真实信号吃掉。
 *
 * ⚠️ **数据出境**：命令内容与工作目录文件会上传到 E2B 云端。UI 必须给出合规提示。
 *
 * @module security/sandbox/E2bSandboxProvider
 */

import { logger } from '@shared/toolkit/LogEngine'
import type {
  SandboxConfig,
  SandboxProbe,
  SandboxProviderKind,
  SandboxRunResult,
} from '@shared/protocols/sandboxProtocol'
import { SANDBOX_CAPABILITIES } from '@shared/protocols/sandboxProtocol'
import type { SandboxProvider, SandboxRunContext, SandboxRunRequest } from './SandboxProvider'
import { describeTruncation } from './SandboxProcess'

/** 候选 SDK 包名（按优先级） */
const SDK_CANDIDATES = ['e2b', '@e2b/code-interpreter'] as const

/** SDK 中我们用到的最小形状（只声明实际用到的字段，避免被 SDK 版本牵着走） */
interface E2bCommandResult {
  stdout?: string
  stderr?: string
  exitCode?: number
  error?: string
}

interface E2bSandboxInstance {
  commands: { run(command: string, opts?: Record<string, unknown>): Promise<E2bCommandResult> }
  kill(options?: Record<string, unknown>): Promise<void>
  sandboxId?: string
}

interface E2bSdkModule {
  Sandbox: {
    create(template: string, opts?: Record<string, unknown>): Promise<E2bSandboxInstance>
  }
}

/** 当前正在使用的 SDK 模块缓存（`undefined` = 尚未探测，`null` = 不可用） */
let sdkModule: { name: string; mod: E2bSdkModule } | null | undefined

/** 加载 E2B SDK：不可用时返回 null 且不抛异常 */
function loadSdk(): { name: string; mod: E2bSdkModule } | null {
  if (sdkModule !== undefined) return sdkModule

  for (const name of SDK_CANDIDATES) {
    try {
      // 用 require 而非 import：SDK 是可选依赖，静态 import 会让整个模块在
      // 未安装时直接加载失败，把「沙箱不可用」扩散成「主进程起不来」。
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require(name) as E2bSdkModule
      if (mod && mod.Sandbox && typeof mod.Sandbox.create === 'function') {
        sdkModule = { name, mod }
        logger.security.info(`[Sandbox] E2B SDK loaded: ${name}`)
        return sdkModule
      }
    } catch {
      // 包不存在 / 形状不符，继续尝试下一个候选
    }
  }

  sdkModule = null
  return null
}

/** 清除 SDK 缓存（测试用） */
export function resetE2bSdkCache(): void {
  sdkModule = undefined
}

export class E2bSandboxProvider implements SandboxProvider {
  readonly kind: SandboxProviderKind = 'e2b'

  /** 在跑的沙箱（退出 / dispose 时兜底 kill） */
  private liveSandboxes = new Set<E2bSandboxInstance>()

  async probe(): Promise<SandboxProbe> {
    // 顺序很重要：先报「环境缺什么」而不是「没配 Key」，因为前者是本机事实、
    // 后者是用户可随手改的配置，先报更根本的能减少一次无效往返。
    const sdk = loadSdk()
    if (!sdk) {
      return {
        kind: this.kind,
        available: false,
        reason: `未安装 E2B SDK，请执行 npm i ${SDK_CANDIDATES[0]} 后重启应用`,
        detail: '',
        capabilities: SANDBOX_CAPABILITIES.e2b,
      }
    }

    return {
      kind: this.kind,
      available: true,
      reason: '',
      detail: `E2B SDK（${sdk.name}）· 云端执行 · ⚠️ 命令与工作目录会上传至 E2B`,
      capabilities: SANDBOX_CAPABILITIES.e2b,
    }
  }

  async run(
    req: SandboxRunRequest,
    config: SandboxConfig,
    ctx: SandboxRunContext,
  ): Promise<SandboxRunResult> {
    const startTime = Date.now()
    const notes: string[] = [
      '⚠️ E2B 云沙箱：命令与工作目录内容会离开本机上传至 E2B 云端',
    ]

    const sdk = loadSdk()
    if (!sdk) {
      return this.failure(startTime, ctx, '未安装 E2B SDK，请执行 npm i e2b 后重启应用', [], true)
    }
    if (!config.e2b.apiKey) {
      return this.failure(startTime, ctx, '未配置 E2B API Key', [], true)
    }

    // 云侧超时与本地超时取较小值：两边都可能是瓶颈，取小的才能保证「超时标记」可信
    const timeoutMs = Math.min(req.timeoutMs, config.e2b.timeoutMs)

    let sandbox: E2bSandboxInstance | null = null
    try {
      sandbox = await sdk.mod.Sandbox.create(config.e2b.template, {
        apiKey: config.e2b.apiKey,
        timeoutMs,
      })
      this.liveSandboxes.add(sandbox)

      // 工作目录：temp 模式给一个干净目录，workspace 模式直接用 /home/user
      const workdir = config.workDirMode === 'temp' ? '/tmp' : '/home/user'

      const result = await sandbox.commands.run(req.command, {
        cwd: workdir,
        timeoutMs,
      })

      const stdout = typeof result?.stdout === 'string' ? result.stdout : ''
      const stderr = typeof result?.stderr === 'string' ? result.stderr : ''
      const exitCode = typeof result?.exitCode === 'number' ? result.exitCode : null

      // SDK 内部超时会以 `error` 字段带出信号，而不是抛异常
      const errorText = typeof result?.error === 'string' ? result.error : ''
      const timedOut = /timeout|timed out|deadline/i.test(errorText)

      if (timedOut) notes.push(`云端命令超过 ${Math.round(timeoutMs / 1000)}s 未结束，已终止`)
      if (errorText) notes.push(`云沙箱返回错误：${errorText}`)

      notes.push(`模板 ${config.e2b.template} · 云端超时上限 ${Math.round(config.e2b.timeoutMs / 1000)}s`)
      notes.push(...describeTruncation(false, false, config.maxOutputBytes))

      return {
        success: !timedOut && !errorText && exitCode === 0,
        stdout,
        stderr,
        exitCode,
        timedOut,
        stdoutTruncated: false,
        stderrTruncated: false,
        durationMs: Date.now() - startTime,
        provider: this.kind,
        degradations: ctx.degradations,
        notes,
      }
    } catch (err) {
      // 不翻译错误：SDK 大版本差异导致的方法缺失必须原文可见
      const message = err instanceof Error ? err.message : String(err)
      logger.security.warn('[Sandbox] E2B run failed:', message)
      // 云沙箱无法区分「建沙箱失败」与「命令执行失败」时，按**后端故障**处理：
      // 降级到 docker/local 至少能让命令跑起来，比直接断在这里对用户更有价值。
      return this.failure(startTime, ctx, message, notes, true)
    } finally {
      if (sandbox) {
        this.liveSandboxes.delete(sandbox)
        try {
          await sandbox.kill()
        } catch (err) {
          logger.security.warn('[Sandbox] E2B sandbox kill failed:', err)
        }
      }
    }
  }

  async dispose(): Promise<void> {
    for (const sandbox of Array.from(this.liveSandboxes)) {
      try {
        await sandbox.kill()
      } catch (err) {
        logger.security.warn('[Sandbox] E2B dispose kill failed:', err)
      }
    }
    this.liveSandboxes.clear()
  }

  /** 统一构造失败结果（不抛异常，交给上层按降级链处理） */
  private failure(
    startTime: number,
    ctx: SandboxRunContext,
    message: string,
    notes: string[] = [],
    infrastructureFailure = false,
  ): SandboxRunResult {
    return {
      success: false,
      stdout: '',
      stderr: message,
      exitCode: null,
      timedOut: false,
      stdoutTruncated: false,
      stderrTruncated: false,
      durationMs: Date.now() - startTime,
      provider: this.kind,
      degradations: ctx.degradations,
      notes: [...notes, message],
      infrastructureFailure,
    }
  }
}
