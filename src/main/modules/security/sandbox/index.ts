/**
 * 代码解释器沙箱模块入口（主进程）
 *
 * 语义来源：源项目 `py/code_interpreter.py`（e2b 云沙箱 + 本地沙箱）。
 *
 * 模块组成：
 *   SandboxStore       策略配置（<userData>/sandbox，e2b apiKey 加密落盘）
 *   SandboxProvider    后端接口
 *   LocalSandboxProvider / DockerSandboxProvider / E2bSandboxProvider
 *   SandboxRouter      策略选取 + 探测缓存 + 降级链编排
 *   SandboxIpc         IPC 通道
 *
 * 与既有 `security/SandboxExecutor.ts` 的关系：
 *   后者是**旧的命令校验 + 直执行**实现（黑名单 / 危险模式 / 环境变量代理技巧），
 *   目前只被 `SecureToolExecutor` 与 `DoctorService` 引用，**未接入 run_command 主链路**。
 *   本模块是**新的执行隔离层**，走独立通道（`sandbox:*`），
 *   两者不叠加、不互相调用 —— 旧实现负责「命令内容是否危险」，本模块负责「在哪执行」，
 *   将来若把旧实现接进主链路，二者职责依然正交。
 *
 * @module security/sandbox
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getSandboxRouter } from './SandboxRouter'
import { registerSandboxIpc } from './SandboxIpc'

export { getSandboxRouter, resetSandboxRouter, PROBE_TTL_MS } from './SandboxRouter'
export type { SandboxRouteOutcome, SandboxExecuteOptions } from './SandboxRouter'
export {
  getConfig as getSandboxConfig,
  updateConfig as updateSandboxConfig,
  resetConfig as resetSandboxConfig,
  validateConfig as validateSandboxConfig,
  getSandboxDataDir,
  clearConfigCache as clearSandboxConfigCache,
  DEFAULT_SANDBOX_CONFIG,
} from './SandboxStore'
export { LocalSandboxProvider } from './LocalSandboxProvider'
export { DockerSandboxProvider } from './DockerSandboxProvider'
export { E2bSandboxProvider, resetE2bSdkCache } from './E2bSandboxProvider'
export type { SandboxProvider, SandboxRunRequest, SandboxRunContext } from './SandboxProvider'

/**
 * 初始化沙箱模块。
 *
 * 刻意**不做启动探测**：docker 探测要 spawn 一个进程（最坏 5s），
 * 而多数用户策略是 `off`（默认），为不生效的能力付启动时间是纯浪费。
 * 探测改为惰性 —— 首次执行或设置页打开时才做，结果进 Router 的 TTL 缓存。
 */
export async function initSandboxModule(): Promise<void> {
  registerSandboxIpc()
  logger.system.info('[Sandbox] module initialized')
}

/**
 * 卸载沙箱模块。
 *
 * `dispose()` 会标记已卸载、清探测缓存，并让各后端释放长驻资源：
 *   · docker：`docker rm -f` 兜底清理可能残留的容器（超时竞态下 CLI 已死但容器还在）
 *   · e2b：kill 仍在运行的云沙箱（否则会一直计费到超时）
 * 漏掉任何一步都会留下「看不见但一直在跑（且在花钱）」的孤儿工作负载。
 */
export async function cleanupSandboxModule(): Promise<void> {
  await getSandboxRouter().dispose()
  logger.system.info('[Sandbox] module cleaned up')
}
