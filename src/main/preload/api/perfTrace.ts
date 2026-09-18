/**
 * PerfTrace API — 性能追踪 IPC 桥接
 *
 * 将主进程的 PerfTraceService 能力暴露给渲染进程，
 * 渲染进程通过 window.electronAPI.perfTrace.* 调用。
 *
 * 接口分两类：
 * - 控制类（start / stop / status）走 invoke，需要回执确认状态
 * - 上报类（report）走单向 send，见下方说明
 */

import { ipcRenderer } from 'electron'
import {
  PERF_TRACE_CHANNELS,
  type PerfTraceIpcResponse,
  type PerfTraceReportPayload,
  type PerfTraceStartOptions,
  type PerfTraceStatus,
} from '@shared/protocols/perfTraceProtocol'

/** 性能追踪 API 接口 */
export interface PerfTraceApi {
  /** 开始追踪，省略 options 时写入工作区下的 tmp-diag */
  start: (options?: PerfTraceStartOptions) => Promise<PerfTraceIpcResponse<PerfTraceStatus>>
  /** 停止追踪 */
  stop: () => Promise<PerfTraceIpcResponse<PerfTraceStatus>>
  /** 查询运行状态 */
  status: () => Promise<PerfTraceIpcResponse<PerfTraceStatus>>
  /**
   * 上报一条记录。
   *
   * 刻意返回 void 而不是 Promise：调用点位于同步热路径（流式分片、工具批次、
   * 命令执行），若返回值可 await，就迟早会有人 await 它，把一个本该零等待的
   * 动作变成跨进程往返。
   */
  report: (payload: PerfTraceReportPayload) => void
  /**
   * 订阅主进程的跟随启停信号。
   *
   * 主进程开始采样时会向所有渲染窗口广播，渲染层据此打开本地上报开关，
   * 不必指望每个窗口入口都各自记得调用 start。两个信号与 report 一样走单向
   * 通道：它们只用来切换本地上报开关，没有需要回传的结果。
   */
  onAutoStart: (handler: (payload?: { intervalMs?: number }) => void) => void
  onAutoStop: (handler: () => void) => void
}

/** 创建性能追踪 API */
export function createPerfTraceApi(): PerfTraceApi {
  return {
    start: (options) => ipcRenderer.invoke(PERF_TRACE_CHANNELS.start, options),

    stop: () => ipcRenderer.invoke(PERF_TRACE_CHANNELS.stop),

    status: () => ipcRenderer.invoke(PERF_TRACE_CHANNELS.status),

    report: (payload) => {
      // 追踪未开启时主进程会直接丢弃，这里不做前置判断：
      // 前置判断需要多一次 IPC 往返，比让主进程丢一条更贵。
      ipcRenderer.send(PERF_TRACE_CHANNELS.report, payload)
    },

    onAutoStart: (handler) => {
      ipcRenderer.on(PERF_TRACE_CHANNELS.autoStart, (_event, payload?: { intervalMs?: number }) =>
        handler(payload),
      )
    },

    onAutoStop: (handler) => {
      ipcRenderer.on(PERF_TRACE_CHANNELS.autoStop, () => handler())
    },
  }
}
