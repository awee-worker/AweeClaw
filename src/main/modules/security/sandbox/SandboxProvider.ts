/**
 * 沙箱后端接口
 *
 * 所有后端（local / docker / e2b）都实现同一接口，由 `SandboxRouter` 负责
 * 探测、选取与降级编排。后端**不做**策略判断、不读配置、不认识降级链 ——
 * 它只回答两个问题：「我现在能用吗」（`probe`）与「把这条命令跑起来并给我结果」（`run`）。
 *
 * @module security/sandbox/SandboxProvider
 */

import type {
  SandboxConfig,
  SandboxDegradation,
  SandboxProbe,
  SandboxProviderKind,
  SandboxRunResult,
} from '@shared/protocols/sandboxProtocol'

/** 一次执行的入参（已由 Router 归一化：超时已夹取、cwd 已解析为绝对路径） */
export interface SandboxRunRequest {
  /** 待执行的 shell 命令行（整体作为单参数传给 shell，不做字符串拼接） */
  command: string
  /** 已解析的绝对工作目录 */
  cwd: string
  /** 已夹取到合法区间的超时 */
  timeoutMs: number
}

/** Router 注入的执行上下文（后端只读，不修改） */
export interface SandboxRunContext {
  /** 本次执行已经发生的降级（包含后端自身贡献的那一次） */
  degradations: SandboxDegradation[]
  /** 发起方标识（排障） */
  agentId?: string
}

export interface SandboxProvider {
  readonly kind: SandboxProviderKind

  /**
   * 探测后端是否可用。
   *
   * 实现**不得**缓存结果 —— 缓存放在 Router（统一 TTL），否则各后端各写一套
   * 缓存策略，「docker 刚装好但要等 5 分钟才生效」这类问题会到处冒。
   */
  probe(): Promise<SandboxProbe>

  /** 执行一条命令。失败（含超时）通过返回值表达，不抛异常 */
  run(req: SandboxRunRequest, config: SandboxConfig, ctx: SandboxRunContext): Promise<SandboxRunResult>

  /** 释放长驻资源（连接 / 容器 / 临时目录），幂等 */
  dispose(): Promise<void>
}
