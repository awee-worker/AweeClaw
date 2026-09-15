/**
 * 代码沙箱 preload API
 *
 * 暴露到 `window.electronAPI.sandbox`，服务于两个消费者：
 * 1. 设置页（`SandboxSettings`）：策略选择、各后端探测结果与能力矩阵、降级链
 * 2. 渲染层 `run_command` 执行器：策略非 `off` 时把命令交给主进程沙箱执行
 *
 * 契约类型来自 `@shared/protocols/sandboxProtocol` —— 主进程与渲染层共用同一份定义，
 * 这里不重复声明，避免「加了一个配置项但某一侧漏掉」。
 *
 * @module preload/api/sandbox
 */

import { ipcRenderer } from 'electron'
import { invoke, on } from '../ipcHelpers'
import type {
  SandboxConfig,
  SandboxConfigPayload,
  SandboxExecuteRequest,
  SandboxIpcResponse,
  SandboxRunResult,
  SandboxStatus,
} from '@shared/protocols/sandboxProtocol'

/** 创建沙箱 API 集合 */
export function createSandboxApi() {
  return {
    // --------------------------------------------
    // 配置
    // --------------------------------------------
    /** 读取配置（附状态与配置提示） */
    getConfig: invoke<SandboxIpcResponse<SandboxConfigPayload>>('sandbox:get-config'),

    /** 增量更新配置（主进程会强制重探后端并返回最新状态） */
    updateConfig: (patch: Partial<SandboxConfig>) =>
      ipcRenderer.invoke('sandbox:update-config', patch) as Promise<
        SandboxIpcResponse<SandboxConfigPayload>
      >,

    /** 恢复默认配置（策略回到 off，run_command 立即回到宿主路径） */
    resetConfig: invoke<SandboxIpcResponse<SandboxConfigPayload>>('sandbox:reset-config'),

    // --------------------------------------------
    // 状态与探测
    // --------------------------------------------
    /** 运行状态（各后端探测结果 / 降级链 / 计数） */
    getStatus: invoke<SandboxIpcResponse<SandboxStatus>>('sandbox:get-status'),

    /** 强制重新探测（跳过 30s TTL 缓存，设置页「重新检测」按钮用） */
    probe: invoke<SandboxIpcResponse<SandboxStatus>>('sandbox:probe'),

    // --------------------------------------------
    // 执行
    // --------------------------------------------
    /**
     * 在沙箱中执行一条命令。
     *
     * `handled: false` 表示策略为 `off` —— **调用方必须回退到宿主执行路径**，
     * 这是「off 状态下行为与改造前一致」的实现方式（主进程不替调用方做这层判断）。
     */
    execute: (request: SandboxExecuteRequest) =>
      ipcRenderer.invoke('sandbox:execute', request) as Promise<
        SandboxIpcResponse<{ handled: boolean; result?: SandboxRunResult }>
      >,

    // --------------------------------------------
    // 事件订阅
    // --------------------------------------------
    /** 订阅状态变化，返回取消订阅函数 */
    onStatus: (callback: (status: SandboxStatus) => void) =>
      on<SandboxStatus>('sandbox:status')(callback),
  }
}
