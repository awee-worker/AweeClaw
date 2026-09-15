/**
 * 防休眠 preload API
 *
 * 暴露到 `window.electronAPI.powerGuard`，服务于两个消费者：
 * 1. 设置页：强度档位、自动触发规则、手动「保持唤醒」开关、当前生效状态
 * 2. Agent 主循环（`intelligence/engine/IntelligenceCore`）：
 *    任务起止时 `acquire('agent-task')` / `release('agent-task')`
 *
 * 契约类型来自 `@shared/protocols/powerGuardProtocol` —— 主进程与渲染层共用同一份定义，
 * 这里不重复声明，避免「加了一个配置项但某一侧漏掉」。
 *
 * @module preload/api/powerGuard
 */

import { ipcRenderer } from 'electron'
import { invoke, on } from '../ipcHelpers'
import type {
  PowerGuardConfig,
  PowerGuardConfigPayload,
  PowerGuardIpcResponse,
  PowerGuardStatus,
} from '@shared/protocols/powerGuardProtocol'

/** 创建防休眠 API 集合 */
export function createPowerGuardApi() {
  return {
    // --------------------------------------------
    // 配置
    // --------------------------------------------
    /** 读取配置（附状态与配置提示） */
    getConfig: invoke<PowerGuardIpcResponse<PowerGuardConfigPayload>>('power-guard:get-config'),

    /** 增量更新配置（主进程立即重算生效状态） */
    updateConfig: (patch: Partial<PowerGuardConfig>) =>
      ipcRenderer.invoke('power-guard:update-config', patch) as Promise<
        PowerGuardIpcResponse<PowerGuardConfigPayload>
      >,

    /** 恢复默认配置（会关掉手动保持唤醒） */
    resetConfig: invoke<PowerGuardIpcResponse<PowerGuardConfigPayload>>('power-guard:reset-config'),

    // --------------------------------------------
    // 状态
    // --------------------------------------------
    /** 运行状态（是否生效 / 平台机制 / 持有者列表 / 最近错误） */
    getStatus: invoke<PowerGuardIpcResponse<PowerGuardStatus>>('power-guard:get-status'),

    // --------------------------------------------
    // 持有者（引用计数）
    // --------------------------------------------
    /**
     * 取得一份防休眠持有（引用计数 +1）。
     *
     * 调用方必须在 `finally` 里配对的 `release` 一次 —— 引用计数是「谁持有谁释放」，
     * 不配对会让断言长期不释放（系统无法休眠）。
     */
    acquire: (reason: string) =>
      ipcRenderer.invoke('power-guard:acquire', reason) as Promise<
        PowerGuardIpcResponse<PowerGuardStatus>
      >,

    /** 释放一份防休眠持有（引用计数 -1；未持有时静默忽略） */
    release: (reason: string) =>
      ipcRenderer.invoke('power-guard:release', reason) as Promise<
        PowerGuardIpcResponse<PowerGuardStatus>
      >,

    /** 清空全部持有者（排障 / 退出前兜底） */
    releaseAll: invoke<PowerGuardIpcResponse<PowerGuardStatus>>('power-guard:release-all'),

    // --------------------------------------------
    // 事件订阅
    // --------------------------------------------
    /** 订阅状态变化（生效 / 释放 / 失败），返回取消订阅函数 */
    onStatus: (callback: (status: PowerGuardStatus) => void) =>
      on<PowerGuardStatus>('power-guard:status')(callback),
  }
}
