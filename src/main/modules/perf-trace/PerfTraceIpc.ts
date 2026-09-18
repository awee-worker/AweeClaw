/**
 * 性能追踪 IPC 处理器（主进程）
 *
 * 通道清单：
 * - perf-trace:start    开始追踪（可选指定落盘目录与采样间隔）
 * - perf-trace:stop     停止追踪并收尾落盘
 * - perf-trace:status   查询运行状态
 * - perf-trace:report   渲染进程上报记录（单向）
 *
 * ── 为什么上报走单向 send ──
 *
 * 锚点上报挂在被测链路的同步路径上（流式分片处理、工具批次、命令执行）。
 * 若用 invoke 等主进程回执，每次上报都要跨进程往返一次，测量本身就会成为
 * 延迟来源，把被测对象的耗时结构改掉。单向 send 不产生等待，主进程侧
 * 收到即写入，队列积压由窗口限流兜底。
 *
 * @module perf-trace/PerfTraceIpc
 */

import { ipcMain, BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { getWindowWorkspace } from '../../bootstrap/windowManager'
import { logger } from '@shared/toolkit/LogEngine'
import {
  PERF_TRACE_CHANNELS,
  type PerfTraceReporterIdentity,
  type PerfTraceReportPayload,
  type PerfTraceStartOptions,
} from '@shared/protocols/perfTraceProtocol'
import { PerfTraceService } from './PerfTraceService'

/** 是否已注册（挡一层，避免重复挂载 ipcMain.on） */
let registered = false

/**
 * 未指定落盘目录时的默认位置：当前窗口工作区下的 tmp-diag。
 *
 * 放在工作区里而不是应用数据目录，是为了让产出的 JSONL 与正在排查的
 * 代码在同一棵树内，事后可直接按相对路径读取。拿不到工作区时返回
 * undefined，由服务退回应用数据目录。
 */
function defaultDirFor(event: IpcMainInvokeEvent): string | undefined {
  try {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return undefined

    const roots = getWindowWorkspace(win.id)
    if (!roots || roots.length === 0) return undefined

    const root = roots[0]
    if (!root) return undefined

    return `${root.replace(/[\\/]+$/, '')}/tmp-diag`
  } catch {
    return undefined
  }
}

/**
 * 取上报方的进程身份。
 *
 * 渲染层主世界拿不到稳定的进程标识，而这里两样都是现成的：`sender.id` 是
 * webContents id，`getOSProcessId()` 与 tick 里进程清单的 pid 同一口径，
 * 有了它渲染记录才能和进程占用按 pid 对齐。窗口销毁过程中 pid 可能取不到，
 * 此时仍返回 wid —— 少一个字段不影响定位，只是不再能与进程清单直连。
 */
function identityOf(sender: WebContents): PerfTraceReporterIdentity {
  const identity: PerfTraceReporterIdentity = { wid: sender.id }
  try {
    identity.pid = sender.getOSProcessId()
  } catch {
    // 渲染进程已在销毁过程中，wid 已足够标识窗口
  }
  return identity
}

/**
 * 向所有渲染窗口广播跟随启停。
 *
 * 渲染侧的上报开关默认关闭，只靠各窗口入口自己记得调用 start 是靠不住的：
 * 桌面伴侣、悬浮头像、预览窗口都不会走主窗口的入口，实际结果就是这些窗口
 * 全程没有数据，出问题时无从下手。主进程既然掌握全局启停，就一并把跟随信号
 * 发出去。
 */
function broadcastFollow(running: boolean, intervalMs?: number): void {
  const channel = running ? PERF_TRACE_CHANNELS.autoStart : PERF_TRACE_CHANNELS.autoStop
  // 跟随窗口要按同一节奏采集，否则同一份文件里两侧记录密度不一致
  const payload = running ? { intervalMs } : undefined

  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    try {
      win.webContents.send(channel, payload)
    } catch {
      // 遍历与发送之间窗口被销毁属于正常竞态，跳过即可
    }
  }
}

/** 注册性能追踪 IPC（幂等） */
export function registerPerfTraceIpc(): void {
  if (registered) return
  registered = true

  const service = PerfTraceService.getInstance()

  safeIpcHandle(
    PERF_TRACE_CHANNELS.start,
    async (event, options: unknown) => {
      try {
        const opts = (options ?? {}) as PerfTraceStartOptions
        const explicitDir = typeof opts.dir === 'string' && opts.dir.trim() ? opts.dir.trim() : undefined
        const status = await service.start({
          dir: explicitDir ?? defaultDirFor(event),
          intervalMs: opts.intervalMs,
        })
        broadcastFollow(status.running, status.intervalMs)
        return { success: true, data: status }
      } catch (err) {
        logger.system.error('[PerfTrace] start 失败:', err)
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    { domain: 'system' },
  )

  safeIpcHandle(
    PERF_TRACE_CHANNELS.stop,
    async () => {
      try {
        const status = await service.stop()
        broadcastFollow(false)
        return { success: true, data: status }
      } catch (err) {
        logger.system.error('[PerfTrace] stop 失败:', err)
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    { domain: 'system' },
  )

  safeIpcHandle(
    PERF_TRACE_CHANNELS.status,
    async () => {
      return { success: true, data: service.getStatus() }
    },
    { domain: 'system' },
  )

  // 渲染进程上报：单向通道，主进程不做回执
  ipcMain.on(PERF_TRACE_CHANNELS.report, (event, payload: PerfTraceReportPayload) => {
    service.ingest(payload, identityOf(event.sender))
  })

  logger.system.info('[PerfTraceIpc] IPC 处理器已注册')
}
