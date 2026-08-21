/**
 * 设备联动事件桥接
 *
 * 监听桌面端内部事件，转换为设备联动事件上报到后端：
 *
 * - powerMonitor:
 *   - suspend / resume / shutdown → event.idle / event.status / event.alert
 *   - lock-screen / unlock-screen → event.idle
 *   - on-battery / on-ac → event.power（电源切换）
 * - system idle 轮询：getSystemIdleTime() 超过阈值 → event.idle，
 *                     恢复活动 → event.active
 * - 文件变更（直连 fileSystemObserver 的全局转发器，不经 renderer）：
 *   1s 内同批合并 → event.file-changed
 * - 紧急停止状态变更 → event.alert
 * - WebSocket 连接状态变化 → event.connectivity
 *
 * 这些事件经 DeviceLinkClient.reportEvent() 推送到后端，
 * 再由后端 DeviceEventBus 分发到移动端 SSE。
 *
 * @module device-link/DeviceLinkEventBridge
 */
import { BrowserWindow, ipcMain, powerMonitor } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { getDeviceLinkClient } from './DeviceLinkClient'
import { setFileChangeForwarder } from '../../guard/fileSystemObserver'

/** 文件变更事件防抖间隔（1s 内合并） */
const FILE_CHANGE_DEBOUNCE_MS = 1000
/** 文件变更单批最大条数（保护后端） */
const FILE_CHANGE_MAX_BATCH = 50

/** 系统空闲轮询间隔 */
const IDLE_POLL_INTERVAL_MS = 30000
/** 触发空闲事件的最小空闲秒数 */
const IDLE_THRESHOLD_SEC = 300 // 5 分钟
/** 空闲恢复阈值（小于该值视为恢复活动） */
const ACTIVE_RECOVERY_SEC = 10

class DeviceLinkEventBridge {
  private fileChangeBuffer: Array<{ event: string; path: string }> = []
  private fileChangeTimer: NodeJS.Timeout | null = null

  /** 系统空闲轮询定时器 */
  private idlePollTimer: NodeJS.Timeout | null = null
  /** 当前是否已进入空闲态（避免重复上报） */
  private isIdleReported = false

  private isAttached = false

  /**
   * 启动事件桥接（app ready 后调用）
   *
   * @param _getMainWindow 主窗口获取函数（保留以兼容未来需要向 renderer 推送事件的场景）
   */
  attach(_getMainWindow: () => BrowserWindow | null): void {
    if (this.isAttached) return
    this.isAttached = true

    // ── 1. 电源事件（系统级，不依赖窗口） ───────────────────────────
    powerMonitor.on('suspend', () => {
      // 系统挂起 → 进入空闲
      this.report('idle', { reason: 'system_suspend', idleSeconds: powerMonitor.getSystemIdleTime() })
      this.isIdleReported = true
    })
    powerMonitor.on('resume', () => {
      // 系统唤醒恢复活动
      this.isIdleReported = false
      this.report('status', { reason: 'system_resume' })
    })
    powerMonitor.on('shutdown', () => {
      this.report('alert', { reason: 'system_shutdown' })
    })

    // ── 2. 屏幕锁定/解锁（部分平台支持，需事件后向 powerMonitor 注册）
    //    注：'lock-screen' / 'unlock-screen' 事件在 macOS / Windows 上提供
    try {
      powerMonitor.on('lock-screen', () => {
        this.report('idle', { reason: 'screen_locked' })
      })
      powerMonitor.on('unlock-screen', () => {
        this.isIdleReported = false
        this.report('status', { reason: 'screen_unlocked' })
      })
    } catch (err) {
      logger.deviceLink.debug(`[EventBridge] lock-screen events unsupported: ${(err as Error).message}`)
    }

    // ── 3. 电源切换（电池/外接电源） ────────────────────────────────
    //    powerMonitor 提供 'on-battery' / 'on-ac' 事件
    try {
      powerMonitor.on('on-battery', () => {
        this.report('power', {
          source: 'battery',
          level: this.getBatteryLevel(),
          charging: false,
        })
      })
      powerMonitor.on('on-ac', () => {
        this.report('power', {
          source: 'ac',
          level: this.getBatteryLevel(),
          charging: true,
        })
      })
    } catch (err) {
      logger.deviceLink.debug(`[EventBridge] on-battery/on-ac events unsupported: ${(err as Error).message}`)
    }

    // ── 4. 系统空闲轮询（getSystemIdleTime） ───────────────────────
    //    powerMonitor 的 suspend/resume 只能感知挂起/唤醒，
    //    无法感知"用户离开但系统未睡眠"的中间状态（如阅读文档长时间无操作）。
    //    每 30s 采样一次：超过阈值上报 idle（首次），恢复活动上报 active。
    this.idlePollTimer = setInterval(() => {
      this.pollSystemIdle()
    }, IDLE_POLL_INTERVAL_MS)

    // ── 5. 文件变更事件（直连 fileSystemObserver 全局转发器） ───────
    //    不再依赖 renderer 通过 IPC 回传，避免渲染进程未就绪时事件丢失
    setFileChangeForwarder((data) => {
      this.queueFileChange(data.event, data.path)
    })

    // ── 6. 兼容：renderer 仍可通过 IPC 主动上报文件变更（保留旧通道） ─
    ipcMain.on('device-link:file-changed', (_event, data: { event: string; path: string }) => {
      this.queueFileChange(data.event, data.path)
    })

    // ── 7. 紧急停止状态（由 desktopControl 或 renderer 转发） ───────
    ipcMain.on('device-link:emergency-stop', (_event, data: { active: boolean; source: string; reason?: string }) => {
      if (data.active) {
        this.report('alert', {
          reason: 'emergency_stop',
          source: data.source,
          detail: data.reason,
        })
      }
    })

    // ── 8. 连接状态上报（由 client 在 ws open/close 时调用 pushConnectivity） ─
    //    见 DeviceLinkClient 在 start/stop/connect 成功/closed 时调用此通道

    logger.deviceLink.info('[EventBridge] Attached')
  }

  /**
   * 文件变更事件去重（1s 内同批合并）
   */
  private queueFileChange(event: string, filePath: string): void {
    this.fileChangeBuffer.push({ event, path: filePath })
    if (this.fileChangeTimer) return
    this.fileChangeTimer = setTimeout(() => {
      const batch = this.fileChangeBuffer.splice(0, this.fileChangeBuffer.length)
      this.fileChangeTimer = null
      if (batch.length === 0) return
      this.report('file-changed', {
        changes: batch.slice(0, FILE_CHANGE_MAX_BATCH), // 最多 50 条/批
        count: batch.length,
        truncated: batch.length > FILE_CHANGE_MAX_BATCH,
      })
    }, FILE_CHANGE_DEBOUNCE_MS)
  }

  /**
   * 系统空闲状态轮询
   */
  private pollSystemIdle(): void {
    let idleSec: number
    try {
      idleSec = powerMonitor.getSystemIdleTime()
    } catch {
      return
    }
    if (idleSec >= IDLE_THRESHOLD_SEC && !this.isIdleReported) {
      this.isIdleReported = true
      this.report('idle', {
        reason: 'user_inactive',
        idleSeconds: idleSec,
        threshold: IDLE_THRESHOLD_SEC,
      })
    } else if (idleSec <= ACTIVE_RECOVERY_SEC && this.isIdleReported) {
      this.isIdleReported = false
      this.report('active', {
        reason: 'user_resumed',
        idleSeconds: idleSec,
      })
    }
  }

  /**
   * 读取电池电量百分比（0-100），无法获取时返回 undefined
   *
   * Electron 的 powerMonitor 类型未直接声明 getBatteryLevel，
   * 但运行时可能存在（macOS / Windows），用 dynamic cast 兜底。
   */
  private getBatteryLevel(): number | undefined {
    try {
      const pm = powerMonitor as unknown as {
        getBatteryLevel?: () => number
      }
      if (typeof pm.getBatteryLevel === 'function') {
        const v = pm.getBatteryLevel()
        if (typeof v === 'number' && v >= 0 && v <= 1) return Math.round(v * 100)
        if (typeof v === 'number' && v > 1) return Math.round(v)
      }
    } catch {
      /* ignore */
    }
    return undefined
  }

  /**
   * 由 DeviceLinkClient 在 WebSocket 连接状态变化时调用
   * 用于将连接性变化主动上报到后端，让移动端及时刷新设备在线状态
   */
  pushConnectivity(state: 'online' | 'offline' | 'connecting' | 'error', detail?: string): void {
    this.report('connectivity', { state, detail, timestamp: Date.now() })
  }

  /**
   * 上报事件（容错：若 client 未初始化则跳过）
   */
  private report(type: string, payload: Record<string, unknown>): void {
    const client = getDeviceLinkClient()
    if (!client) return
    client.reportEvent(type, payload)
  }

  /**
   * 清理（应用退出时调用）
   */
  detach(): void {
    if (this.fileChangeTimer) {
      clearTimeout(this.fileChangeTimer)
      this.fileChangeTimer = null
    }
    if (this.idlePollTimer) {
      clearInterval(this.idlePollTimer)
      this.idlePollTimer = null
    }
    this.fileChangeBuffer = []
    this.isIdleReported = false
    this.isAttached = false
    // 解除文件变更转发器，防止已销毁的 client 被回调
    try {
      setFileChangeForwarder(null)
    } catch (err) {
      logger.deviceLink.debug(`[EventBridge] Failed to clear file change forwarder: ${(err as Error).message}`)
    }
  }
}

export const deviceLinkEventBridge = new DeviceLinkEventBridge()
