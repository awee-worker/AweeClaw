/**
 * 代码解释器沙箱能力契约（主进程 ↔ preload ↔ 渲染层共用）
 *
 * 语义来源：源项目 `py/code_interpreter.py`（e2b 云沙箱 + 本地沙箱）。
 * 本文件只描述「配置存什么」与「IPC 传什么」，不含任何平台实现
 * （平台分支在 `main/modules/security/sandbox/`）。
 *
 * 本文件被主进程与渲染进程共用，因此**不得**引入 electron / node 专属类型。
 *
 * @module shared/protocols/sandboxProtocol
 */

/** 状态推送通道（主进程 emit / preload 订阅） */
export const SANDBOX_STATUS_CHANNEL = 'sandbox:status'

/**
 * 沙箱策略。
 *
 * - `off`    **默认**。`run_command` 走改造前的宿主终端路径，行为完全不变
 * - `local`  受限子进程：临时工作目录 + 环境变量白名单 + 超时 + 输出上限 + 进程组回收
 * - `docker` 容器隔离：无网络 + 内存/CPU/PID 限额 + 只读根文件系统（**推荐**）
 * - `e2b`    云沙箱：需 API Key，数据出境
 *
 * `off` 之所以是默认值，是为了满足 P1 通用要求「不破坏既有链路」：
 * 沙箱会改变命令的执行环境（cwd/env/文件可见性），贸然默认开启会让既有工作流静默失败。
 */
export type SandboxPolicy = 'off' | 'local' | 'docker' | 'e2b'

/** 具体执行后端（`off` 不是后端，故不在此枚举内） */
export type SandboxProviderKind = 'local' | 'docker' | 'e2b'

/**
 * 工作目录语义。
 *
 * - `workspace` 在请求的 cwd 内执行（能读写项目文件，docker 下以挂载方式暴露）
 * - `temp`      每次执行新建空临时目录（纯计算场景，不暴露项目文件）
 */
export type SandboxWorkDirMode = 'workspace' | 'temp'

/** Docker 后端参数 */
export interface SandboxDockerOptions {
  /** 运行时镜像（shell 环境与语言运行时由镜像决定） */
  image: string
  /** 内存上限（MB） */
  memoryMb: number
  /** CPU 核数上限 */
  cpus: number
  /** 进程数上限（防 fork 炸弹） */
  pidsLimit: number
  /**
   * 是否允许容器内网络。
   *
   * 默认 false → `--network=none`。这是 docker 后端相对 local 后端**唯一**的
   * 不可替代价值（Node 无法在裸进程层面断网），UI 必须如实说明。
   */
  network: boolean
  /** 镜像不存在时是否自动 `docker pull`（关闭则报错让用户手动拉取） */
  pullOnDemand: boolean
}

/** E2B 云沙箱参数 */
export interface SandboxE2bOptions {
  /** API Key（落盘前由 safeStorage 加密，读取时解密返回） */
  apiKey: string
  /** 模板 ID（决定镜像内预装的语言运行时） */
  template: string
  /** 云侧超时（毫秒），与单次执行超时取较小值 */
  timeoutMs: number
}

/** 模块配置（落盘结构） */
export interface SandboxConfig {
  /** 策略，默认 `off` */
  policy: SandboxPolicy
  /** 单次执行超时（毫秒） */
  timeoutMs: number
  /** stdout / stderr **各自**的输出上限（字节），超出截断并标记 */
  maxOutputBytes: number
  /** 工作目录语义 */
  workDirMode: SandboxWorkDirMode
  /**
   * 后端不可用时是否降级而非拒绝执行。
   *
   * 降级链：`docker → local → 拒绝`；`e2b → docker → local → 拒绝`。
   * 关闭时任何不可用都直接拒绝（严格模式，适合对隔离有硬要求的场景）。
   */
  allowFallback: boolean
  docker: SandboxDockerOptions
  e2b: SandboxE2bOptions
}

/** 后端隔离能力声明（UI 如实展示，不承诺做不到的事） */
export interface SandboxCapabilities {
  /** 能否阻断容器/进程的出网 */
  networkIsolation: boolean
  /** 能否限制文件系统可见范围 */
  filesystemIsolation: boolean
  /** 能否限制内存 / CPU / 进程数 */
  resourceLimits: boolean
  /** 是否在远端（数据出境） */
  cloud: boolean
}

/** 后端可用性探测结果 */
export interface SandboxProbe {
  kind: SandboxProviderKind
  available: boolean
  /** 不可用原因（available=false 时非空，可直接展示给用户） */
  reason: string
  /** 可用时的版本 / 环境摘要（available=true 时） */
  detail: string
  capabilities: SandboxCapabilities
}

/** 一次降级记录（从哪个后端降到哪个，以及为什么） */
export interface SandboxDegradation {
  from: SandboxProviderKind
  /** null 表示降级到「拒绝执行」 */
  to: SandboxProviderKind | null
  reason: string
}

/** 一次沙箱执行的完整结果 */
export interface SandboxRunResult {
  success: boolean
  stdout: string
  stderr: string
  exitCode: number | null
  timedOut: boolean
  /** stdout 是否被截断（截断必须标记，否则模型会以为输出完整） */
  stdoutTruncated: boolean
  stderrTruncated: boolean
  durationMs: number
  /** 实际执行后端；`off` 表示未经过沙箱 */
  provider: SandboxProviderKind | 'off'
  /** 本次执行的降级链（空数组 = 未降级） */
  degradations: SandboxDegradation[]
  /** 后端注入的说明性提示（隔离能力声明、截断提示等），直接拼进工具返回文本 */
  notes: string[]
  /**
   * 后端**自身**不可用（CLI 起不来 / SDK 缺失 / 鉴权失败），而非命令执行失败。
   *
   * 这是降级链继续往下走的唯一判据 —— 若把「命令返回非 0」也当成后端故障，
   * 一条正常报错的命令会被在三个后端里各跑一遍，既慢又会产生副作用。
   */
  infrastructureFailure?: boolean
  /**
   * 整条降级链都不可用（或严格模式禁止降级），命令**没有执行**。
   *
   * 与普通失败的区别：普通失败至少跑过了，调用方可以据此决定
   * 「如实告知用户」还是「提示用户检查沙箱环境」。
   */
  refused?: boolean
}

/** 模块运行状态（IPC 返回 / 事件推送） */
export interface SandboxStatus {
  policy: SandboxPolicy
  /** 当前策略下实际会使用的后端（策略为 off 或全部不可用时为 null） */
  activeProvider: SandboxProviderKind | null
  /** 各后端探测结果（含未启用的，便于设置页一次展示全部） */
  probes: SandboxProbe[]
  /** 最近一次执行的降级链 */
  lastDegradations: SandboxDegradation[]
  /** 正在执行的沙箱任务数 */
  runningCount: number
  /** 历史执行次数（排障用） */
  totalRuns: number
  /** 历史拒绝次数（策略不可用或严格模式，排障用） */
  refusedRuns: number
  /** 最近一次失败原因（无则空串） */
  lastError: string
}

/** get-config / update-config / reset-config 的返回体 */
export interface SandboxConfigPayload {
  config: SandboxConfig
  status: SandboxStatus
  /** 配置提示（不阻断保存，仅用于 UI 引导） */
  issues: string[]
}

/** 渲染层发起一次沙箱执行的入参 */
export interface SandboxExecuteRequest {
  command: string
  cwd: string
  /** 覆盖配置中的超时（毫秒） */
  timeoutMs?: number
  /** 发起方标识（排障用） */
  agentId?: string
}

/** 通用 IPC 响应包装（与 ipcGuard 的 IpcGuardResponse 对齐） */
export interface SandboxIpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 各后端的隔离能力矩阵（唯一事实来源，UI 与运行期提示共用） */
export const SANDBOX_CAPABILITIES: Record<SandboxProviderKind, SandboxCapabilities> = {
  local: {
    networkIsolation: false,
    filesystemIsolation: false,
    resourceLimits: true,
    cloud: false,
  },
  docker: {
    networkIsolation: true,
    filesystemIsolation: true,
    resourceLimits: true,
    cloud: false,
  },
  e2b: {
    networkIsolation: true,
    filesystemIsolation: true,
    resourceLimits: true,
    cloud: true,
  },
}

/** 策略 → 初始降级链（用户选择的后端排在最前） */
export function resolveProviderChain(policy: SandboxPolicy): SandboxProviderKind[] {
  switch (policy) {
    case 'docker':
      return ['docker', 'local']
    case 'e2b':
      return ['e2b', 'docker', 'local']
    case 'local':
      return ['local']
    case 'off':
    default:
      return []
  }
}
