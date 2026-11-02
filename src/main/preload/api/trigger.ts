/**
 * Trigger API — 事件触发器 / 任务账本 IPC 桥接
 *
 * 渲染进程通过 window.electronAPI.trigger.* 调用。
 *
 * 接口分组：
 * - 触发器：listRules / upsertRule / removeRule / setRuleEnabled / listSources / getStats
 * - 本地自动化开关：getTriggerSettings / updateTriggerSettings / resetTriggerSettings
 * - 任务账本：listTasks / getTask / createTask / approveTask / startTask / succeedTask /
 *            failTask / cancelTask / retryTask / updateTaskProgress / taskCounts
 * - 事件订阅：onTriggerHit / onTaskUpdated / onLedgerTaskExecute
 */

import { ipcRenderer, type IpcRendererEvent } from 'electron'

/** 统一的 IPC 响应格式 */
export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

export function createTriggerApi() {
  return {
    // ── 触发器规则 ──
    listTriggerRules: () => ipcRenderer.invoke('trigger:listRules') as Promise<IpcResponse>,
    upsertTriggerRule: (rule: unknown) =>
      ipcRenderer.invoke('trigger:upsertRule', rule) as Promise<IpcResponse>,
    removeTriggerRule: (ruleId: string) =>
      ipcRenderer.invoke('trigger:removeRule', ruleId) as Promise<IpcResponse>,
    setTriggerRuleEnabled: (ruleId: string, enabled: boolean) =>
      ipcRenderer.invoke('trigger:setRuleEnabled', ruleId, enabled) as Promise<IpcResponse>,
    listTriggerSources: () => ipcRenderer.invoke('trigger:listSources') as Promise<IpcResponse>,
    getTriggerStats: () => ipcRenderer.invoke('trigger:getStats') as Promise<IpcResponse>,

    // ── 本地自动化开关 ──
    getTriggerSettings: () => ipcRenderer.invoke('trigger:getSettings') as Promise<IpcResponse>,
    updateTriggerSettings: (patch: unknown) =>
      ipcRenderer.invoke('trigger:updateSettings', patch) as Promise<IpcResponse>,
    resetTriggerSettings: () => ipcRenderer.invoke('trigger:resetSettings') as Promise<IpcResponse>,

    // ── 任务账本 ──
    listLedgerTasks: (query?: unknown) =>
      ipcRenderer.invoke('ledger:list', query) as Promise<IpcResponse>,
    getLedgerTask: (taskId: string) =>
      ipcRenderer.invoke('ledger:get', taskId) as Promise<IpcResponse>,
    createLedgerTask: (input: unknown) =>
      ipcRenderer.invoke('ledger:create', input) as Promise<IpcResponse>,
    approveLedgerTask: (taskId: string) =>
      ipcRenderer.invoke('ledger:approve', taskId) as Promise<IpcResponse>,
    startLedgerTask: (taskId: string) =>
      ipcRenderer.invoke('ledger:start', taskId) as Promise<IpcResponse>,
    succeedLedgerTask: (taskId: string, result: unknown) =>
      ipcRenderer.invoke('ledger:succeed', taskId, result) as Promise<IpcResponse>,
    failLedgerTask: (taskId: string, error: string) =>
      ipcRenderer.invoke('ledger:fail', taskId, error) as Promise<IpcResponse>,
    cancelLedgerTask: (taskId: string) =>
      ipcRenderer.invoke('ledger:cancel', taskId) as Promise<IpcResponse>,
    retryLedgerTask: (taskId: string) =>
      ipcRenderer.invoke('ledger:retry', taskId) as Promise<IpcResponse>,
    updateLedgerTaskProgress: (taskId: string, progress: number, message?: string) =>
      ipcRenderer.invoke('ledger:progress', taskId, progress, message) as Promise<IpcResponse>,
    getLedgerTaskCounts: () => ipcRenderer.invoke('ledger:counts') as Promise<IpcResponse>,

    // ── 事件订阅（返回取消订阅函数）──
    onTriggerHit: (callback: (hit: unknown) => void) => {
      const listener = (_e: IpcRendererEvent, hit: unknown) => callback(hit)
      ipcRenderer.on('trigger:hit', listener)
      return () => ipcRenderer.removeListener('trigger:hit', listener)
    },
    onLedgerTaskUpdated: (callback: (task: unknown) => void) => {
      const listener = (_e: IpcRendererEvent, task: unknown) => callback(task)
      ipcRenderer.on('ledger:task-updated', listener)
      return () => ipcRenderer.removeListener('ledger:task-updated', listener)
    },
    /**
     * 订阅"任务下发执行"指令（autoExecuteTask 开启时由主进程广播）
     *
     * 只覆盖自动执行路径；用户在任务中心手动点「开始执行」时直接调用执行器，
     * 不经过这个频道。
     */
    onLedgerTaskExecute: (callback: (task: unknown) => void) => {
      const listener = (_e: IpcRendererEvent, task: unknown) => callback(task)
      ipcRenderer.on('ledger:task-execute', listener)
      return () => ipcRenderer.removeListener('ledger:task-execute', listener)
    },
  }
}
