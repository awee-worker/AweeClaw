/**
 * 沙箱 IPC 处理器（主进程）
 *
 * 通道清单：
 * - sandbox:get-config | update-config | reset-config   配置读写
 * - sandbox:get-status                                  运行状态（含各后端探测结果）
 * - sandbox:probe                                       强制重新探测（跳过 TTL 缓存）
 * - sandbox:execute                                     渲染层发起一次沙箱执行
 *
 * 事件推送：`sandbox:status`（配置变更 / 每次执行后），供设置页实时刷新计数与降级链。
 *
 * ── 为什么 `execute` 要暴露给渲染层 ──
 *
 * `run_command` 的实际执行方在渲染进程（它持有终端会话与流式输出通道）。
 * 沙箱需要系统层能力（spawn / docker / 网络），只能在主进程做。
 * 与其把命令执行整体搬到主进程（会丢掉现有的流式预览能力），
 * 不如让渲染层在「已决定走沙箱」时把命令交给主进程执行一次。
 *
 * @module security/sandbox/SandboxIpc
 */

import { safeIpcHandle } from '../../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { getSandboxRouter } from './SandboxRouter'
import { getConfig, resetConfig, updateConfig, validateConfig } from './SandboxStore'
import type { SandboxConfigPayload, SandboxExecuteRequest } from '@shared/protocols/sandboxProtocol'

/** 是否已注册（幂等） */
let registered = false

/** 统一的错误响应 */
function fail(err: unknown): { success: false; error: string } {
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

/** 组装配置载荷（配置 + 状态 + 提示） */
async function configPayload(): Promise<SandboxConfigPayload> {
  const config = getConfig()
  return {
    config,
    status: await getSandboxRouter().getStatus(),
    issues: validateConfig(config),
  }
}

/** 注册沙箱 IPC（幂等） */
export function registerSandboxIpc(): void {
  if (registered) return
  registered = true

  const router = getSandboxRouter()

  // --------------------------------------------
  // 配置
  // --------------------------------------------
  safeIpcHandle('sandbox:get-config', async () => {
    try {
      return { success: true, data: await configPayload() }
    } catch (err) {
      return fail(err)
    }
  })

  safeIpcHandle('sandbox:update-config', async (_event, patch: unknown) => {
    try {
      updateConfig(patch)
      // 配置可能改了策略 / e2b Key / docker 网络开关，探测结果随之失效 → 强制重探
      await router.getStatus(true)
      return { success: true, data: await configPayload() }
    } catch (err) {
      logger.security.error('[Sandbox] update-config failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('sandbox:reset-config', async () => {
    try {
      resetConfig()
      await router.getStatus(true)
      return { success: true, data: await configPayload() }
    } catch (err) {
      return fail(err)
    }
  })

  // --------------------------------------------
  // 状态与探测
  // --------------------------------------------
  safeIpcHandle('sandbox:get-status', async () => {
    try {
      return { success: true, data: await router.getStatus() }
    } catch (err) {
      return fail(err)
    }
  })

  safeIpcHandle('sandbox:probe', async () => {
    try {
      const status = await router.getStatus(true)
      return { success: true, data: status }
    } catch (err) {
      return fail(err)
    }
  })

  // --------------------------------------------
  // 执行
  // --------------------------------------------
  safeIpcHandle('sandbox:execute', async (_event, request: SandboxExecuteRequest) => {
    try {
      if (!request || typeof request.command !== 'string' || request.command.length === 0) {
        return { success: false, error: 'sandbox:execute 缺少 command' }
      }
      const cwd = typeof request.cwd === 'string' && request.cwd.length > 0 ? request.cwd : process.cwd()
      const outcome = await router.execute(request.command, cwd, {
        timeoutMs: request.timeoutMs,
        agentId: request.agentId,
      })
      return { success: true, data: outcome }
    } catch (err) {
      logger.security.error('[Sandbox] execute failed:', err)
      return fail(err)
    }
  })
}
