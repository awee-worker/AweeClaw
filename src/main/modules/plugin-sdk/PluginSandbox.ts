/**
 * 插件沙箱化框架 — 基于 Electron UtilityProcess 的进程级隔离
 *
 * 设计目标：
 * - 将外部插件代码从主进程 import() 迁移到独立 UtilityProcess
 * - 插件无法直接访问主进程 Node API（fs、child_process 等）
 * - HostServices 通过 MessagePort IPC 代理调用
 * - 插件崩溃不影响主进程稳定性
 *
 * 架构：
 *   主进程                    插件进程（UtilityProcess）
 *   ┌──────────────┐          ┌──────────────────────┐
 *   │ PluginSandbox│ ←port→   │ pluginWorkerEntry.ts │
 *   │  Manager     │          │  ├─ 加载插件 ESM     │
 *   │              │          │  ├─ PluginRuntime    │
 *   │ HostServices │←─IPC──→  │  └─ ctx.host 代理    │
 *   │  (代理调用)   │          │                      │
 *   └──────────────┘          └──────────────────────┘
 *
 * 通信协议（MessagePort）：
 * - main→worker: { type: 'initialize', ctx: SerializedContext }
 * - main→worker: { type: 'call-hook', event: string, args: unknown[] }
 * - worker→main: { type: 'host-call', service: string, method: string, args: unknown[] }
 * - main→worker: { type: 'host-call-result', id: number, result: unknown, error?: string }
 * - worker→main: { type: 'log', level: string, message: string }
 * - worker→main: { type: 'error', message: string, stack?: string }
 *
 * 当前状态：骨架代码，尚未启用。
 * 启用方式：将 PluginRegistry.loadExternalRuntime 改为调用 PluginSandboxManager.loadInSandbox()
 *
 * 待办事项（实施清单）：
 * 1. 创建 pluginWorkerEntry.ts（插件进程入口，加载 ESM、建立 IPC）
 * 2. 实现 HostServices IPC 代理层（序列化/反序列化、Promise 桥接）
 * 3. 实现 PluginContext IPC 代理（getConfig/setConfig/getSecret/setSecret）
 * 4. 处理 ESM/CJS 互操作（UtilityProcess 默认加载 CJS）
 * 5. 实现插件进程崩溃恢复和超时机制
 * 6. 修改 PluginRegistry.loadExternalRuntime 支持沙箱模式
 * 7. 添加配置开关（app-settings 中的 enablePluginSandbox）
 * 8. 完善测试覆盖（沙箱启动、IPC 通信、崩溃恢复、权限校验）
 *
 * @module plugin-sdk/PluginSandbox
 */

import { type UtilityProcess } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import type { PluginManifest } from '@shared/plugin-sdk/types'

// ─── 类型定义 ──────────────────────────────────────────────

/** 沙箱化插件实例 */
interface SandboxedPlugin {
  /** 插件 ID */
  pluginId: string
  /** UtilityProcess 实例 */
  process: UtilityProcess
  /** 通信端口 */
  messagePort: Electron.MessagePortMain
  /** 是否已初始化 */
  initialized: boolean
  /** 最后活跃时间戳 */
  lastActiveAt: number
}

/** IPC 消息类型（主进程→插件进程） */
type MainToWorkerMessage =
  | { type: 'initialize'; pluginId: string; dataDir: string; permissions: string[] }
  | { type: 'call-hook'; event: string; args: unknown[] }
  | { type: 'host-call-result'; id: number; result: unknown; error?: string }
  | { type: 'destroy' }

/** IPC 消息类型（插件进程→主进程） */
type WorkerToMainMessage =
  | { type: 'ready' }
  | { type: 'initialized' }
  | { type: 'host-call'; id: number; service: string; method: string; args: unknown[] }
  | { type: 'log'; level: string; message: string; args?: unknown[] }
  | { type: 'error'; message: string; stack?: string }
  | { type: 'hook-result'; event: string; result: unknown }

// ─── 配置 ──────────────────────────────────────────────────

/** 沙箱是否已启用（当前为 false，待完整实施后改为可配置） */
const SANDBOX_ENABLED = false

/** 插件进程入口脚本路径（相对于 dist/main）
 *
 * 预留常量：当前沙箱功能未启用（SANDBOX_ENABLED=false），待 UtilityProcess 方案实施时使用。
 * `void` 引用消除 TS6133，保留常量供未来 fork 入口使用。 */
const PLUGIN_WORKER_ENTRY = path.join(__dirname, 'pluginWorkerEntry.js')
void PLUGIN_WORKER_ENTRY

/** 插件进程启动超时（毫秒）
 *
 * 预留常量：待 UtilityProcess 方案实施时用于启动超时检测。 */
const SANDBOX_STARTUP_TIMEOUT = 10_000
void SANDBOX_STARTUP_TIMEOUT

/** Host Service 调用超时（毫秒）
 *
 * 插件进程发起的 IPC 调用若超时未返回，主进程将 reject 对应的 PendingHostCall，
 * 避免插件侧永久挂起。 */
const HOST_CALL_TIMEOUT_MS = 30_000

/** 待处理的 Host Service 调用 */
interface PendingHostCall {
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

// ─── PluginSandboxManager ──────────────────────────────────

/**
 * 插件沙箱管理器（单例）
 *
 * 管理所有沙箱化插件的 UtilityProcess 生命周期。
 * 当前为骨架实现，SANDBOX_ENABLED 为 false 时不启用。
 */
export class PluginSandboxManager {
  private static instance: PluginSandboxManager | null = null
  private sandboxes = new Map<string, SandboxedPlugin>()
  /** 预留：待 HostServices 代理实施时使用 */
  private pendingHostCalls = new Map<number, PendingHostCall>()
  /** 预留：待 HostServices 代理实施时使用 */
  private nextCallId = 1

  static getInstance(): PluginSandboxManager {
    if (!PluginSandboxManager.instance) {
      PluginSandboxManager.instance = new PluginSandboxManager()
    }
    return PluginSandboxManager.instance
  }

  /** 沙箱是否已启用 */
  isEnabled(): boolean {
    return SANDBOX_ENABLED
  }

  /**
   * 在沙箱中加载插件。
   *
   * 流程：
   * 1. 创建 UtilityProcess，加载 pluginWorkerEntry.js
   * 2. 建立 MessagePort 通信通道
   * 3. 发送 initialize 消息，传递插件路径和上下文
   * 4. 等待 worker 返回 initialized 确认
   *
   * @param manifest 插件 manifest
   * @returns 是否加载成功
   */
  async loadInSandbox(manifest: PluginManifest): Promise<boolean> {
    if (!SANDBOX_ENABLED) {
      throw new Error('Plugin sandbox is not enabled. Use direct import instead.')
    }

    if (!manifest.main) {
      throw new Error(`Plugin ${manifest.id} has no main entry`)
    }

    logger.system.info(`[PluginSandbox] Loading plugin ${manifest.id} in sandbox`)

    // TODO: 实施 UtilityProcess 创建和 IPC 通信
    // 1. const child = utilityProcess.fork(PLUGIN_WORKER_ENTRY, [], { stdio: 'pipe' })
    // 2. const { port1, port2 } = new MessageChannelMain()
    // 3. child.postMessage({ type: 'initialize', manifest, port: port2 }, [port2])
    // 4. 等待 port1 收到 'initialized' 消息
    throw new Error('PluginSandbox.loadInSandbox() not yet implemented (skeleton code)')
  }

  /**
   * 分发插件进程发来的消息（公开入口）。
   *
   * 待 UtilityProcess 方案实施后，由 `child.on('message')` / `messagePort.on('message')`
   * 回调调用此方法，将 worker 消息路由到对应处理器。
   * 当前为骨架实现：仅路由 host-call 与日志类消息，其余类型记录后忽略。
   */
  dispatchWorkerMessage(pluginId: string, message: WorkerToMainMessage): void {
    switch (message.type) {
      case 'host-call':
        this.handleHostCall(pluginId, message.id, message.service, message.method, message.args)
        break
      case 'log':
        logger.system.info(`[PluginSandbox:${pluginId}] ${message.message}`)
        break
      case 'error':
        logger.system.error(`[PluginSandbox:${pluginId}] ${message.message}`, message.stack)
        break
      default:
        // ready / initialized / hook-result 等待完整实施后处理
        logger.system.debug(`[PluginSandbox:${pluginId}] worker message: ${message.type}`)
        break
    }
  }

  /**
   * 代理 HostServices 调用到主进程。
   * 由插件进程通过 IPC 发起，主进程执行后返回结果。
   *
   * 骨架实现：登记 PendingHostCall 并设置超时定时器，
   * 待 HostServices 代理层实施后补充实际调用与结果回传（host-call-result）。
   */
  private handleHostCall(
    pluginId: string,
    id: number,
    service: string,
    method: string,
    args: unknown[],
  ): void {
    // 分配内部调用 ID 并登记挂起请求（供未来 host-call-result 回填）
    const callId = this.nextCallId++
    const timer = setTimeout(() => {
      const pending = this.pendingHostCalls.get(callId)
      if (pending) {
        pending.reject(new Error(`Host call timeout: ${service}.${method}`))
        this.pendingHostCalls.delete(callId)
      }
    }, HOST_CALL_TIMEOUT_MS)

    this.pendingHostCalls.set(callId, {
      resolve: () => {
        // TODO: 待 HostServices 代理实施后，回传 host-call-result 给 worker
      },
      reject: () => {
        // TODO: 待 HostServices 代理实施后，回传错误给 worker
      },
      timer,
    })

    // TODO: 实施 HostServices 代理
    // 1. 根据 service 名称获取对应的 HostServices 字段
    // 2. 校验插件权限（PluginPermissionGuard.assertPermission）
    // 3. 调用方法并返回结果
    // 4. 处理序列化（Buffer/函数等不可序列化值）
    logger.system.debug(
      `[PluginSandbox] Host call from ${pluginId}: ${service}.${method}(${args.length} args) [reqId=${id}, callId=${callId}]`,
    )
  }

  /**
   * 卸载沙箱化插件。
   * 通知插件进程 destroy，然后关闭进程。
   */
  async unload(pluginId: string): Promise<void> {
    const sandbox = this.sandboxes.get(pluginId)
    if (!sandbox) return

    try {
      sandbox.messagePort.postMessage({ type: 'destroy' } satisfies MainToWorkerMessage)
      // 等待插件 destroy 完成后关闭进程
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch (err) {
      logger.system.warn(`[PluginSandbox] Error during unload of ${pluginId}:`, err)
    }

    try {
      sandbox.process.kill()
    } catch {
      /* ignore */
    }

    sandbox.messagePort.close()
    this.sandboxes.delete(pluginId)
    logger.system.info(`[PluginSandbox] Unloaded plugin ${pluginId}`)
  }

  /** 销毁所有沙箱（应用退出时调用） */
  async destroyAll(): Promise<void> {
    const pluginIds = Array.from(this.sandboxes.keys())
    await Promise.allSettled(pluginIds.map((id) => this.unload(id)))
  }
}

export type { MainToWorkerMessage, WorkerToMainMessage, SandboxedPlugin }
