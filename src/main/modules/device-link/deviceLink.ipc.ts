/**
 * 设备联动 IPC 处理器
 *
 * 桌面客户端 renderer 进程与主进程的通信接口：
 * - device-link:set-credentials  renderer 推送登录凭据，触发 WS 连接
 * - device-link:clear-credentials  renderer 登出时清除凭据，断开连接
 * - device-link:set-preferences    renderer 更新允许策略（开关）
 * - device-link:get-status         renderer 查询连接状态（用于设置界面）
 * - device-link:get-device-id      renderer 查询设备 ID
 *
 * 注意：所有 IPC 都通过 ipcMain.handle 注册，由 renderer 主动调用。
 * 主进程不主动轮询凭据，依赖 renderer 推送。
 *
 * @module device-link/deviceLink.ipc
 */
import { ipcMain } from 'electron'
import * as os from 'os'
import { logger } from '@shared/toolkit/LogEngine'
import { credentialsHolder, type DeviceLinkCredentials } from './DeviceLinkCredentials'
import {
  initDeviceLinkClient,
  shutdownDeviceLinkClient,
  getDeviceLinkClient,
} from './DeviceLinkClient'
import { deviceLinkEventBridge } from './DeviceLinkEventBridge'
import type Store from 'electron-store'

/**
 * 若 renderer 未提供 deviceName，则用 hostname + OS 拼接一个。
 * 让 renderer 不必关心主机名获取（其无法直接访问 os.hostname）。
 *
 * 注意：hostname 中可能包含品牌名 "AweeClaw"（用户将电脑名设为品牌名），
 * 会导致设备名显示为 "AweeClawde (macOS)" 之类的不友好格式。
 * 如果 hostname 以品牌名开头，直接使用平台名作为设备名，避免前缀残留。
 */
function resolveDeviceName(name?: string): string {
  if (name && name.trim()) return name.trim()
  let hostname = os.hostname() || 'unknown-host'
  const platform = process.platform === 'darwin' ? 'macOS'
    : process.platform === 'win32' ? 'Windows'
    : process.platform === 'linux' ? 'Linux'
    : process.platform

  // 如果 hostname 以品牌名 "AweeClaw" 开头（不区分大小写），
  // 去掉品牌名前缀及后续的分隔符，只保留实际主机名部分
  // 如 "AweeClaw-MacBook" → "MacBook"，"AweeClaw_Desktop" → "Desktop"
  if (/^aweeclaw/i.test(hostname)) {
    hostname = hostname.replace(/^aweeclaw/i, '').replace(/^[-_\s]+/, '')
    // 去掉后如果剩余部分太短（如 "de"），直接用平台名
    if (hostname.length < 3) {
      hostname = platform
    }
  }

  return `${hostname} (${platform})`
}

export interface DeviceLinkStatus {
  started: boolean
  deviceId: string
  connected: boolean
  reconnectAttempts: number
  credentialsValid: boolean
}

let isInitialized = false

/**
 * 初始化设备联动模块（必须在 app ready + stores 初始化后调用）
 *
 * @param configStore 应用配置 store
 * @param getMainWindow 主窗口获取函数
 * @param resolveWorkspaceRoot 工作区根路径解析器
 */
export function initDeviceLinkModule(opts: {
  configStore: Store<Record<string, unknown>>
  getMainWindow: () => Electron.BrowserWindow | null
  resolveWorkspaceRoot: () => string | null
}): void {
  if (isInitialized) {
    logger.deviceLink.warn('[IPC] Module already initialized, skipping')
    return
  }
  isInitialized = true

  // 1. 创建客户端
  const client = initDeviceLinkClient({
    configStore: opts.configStore,
    getMainWindow: opts.getMainWindow,
    resolveWorkspaceRoot: opts.resolveWorkspaceRoot,
  })

  // 2. 启动事件桥接
  deviceLinkEventBridge.attach(opts.getMainWindow)

  // 3. 注册 IPC handlers
  registerIpcHandlers(client)

  logger.deviceLink.info('[IPC] Module initialized')
}

function registerIpcHandlers(client: ReturnType<typeof initDeviceLinkClient>): void {
  // ── 凭据管理 ──────────────────────────────────────────────
  ipcMain.handle('device-link:set-credentials', async (_event, payload: DeviceLinkCredentials) => {
    if (!payload?.accessToken || !payload?.serverUrl) {
      throw new Error('invalid_credentials: accessToken and serverUrl required')
    }
    const normalized: DeviceLinkCredentials = {
      ...payload,
      deviceName: resolveDeviceName(payload.deviceName),
    }
    credentialsHolder.set(normalized)
    client.onCredentialsUpdated(normalized)
    return { ok: true }
  })

  ipcMain.handle('device-link:clear-credentials', async () => {
    credentialsHolder.clear()
    client.onCredentialsCleared()
    return { ok: true }
  })

  // ── 偏好设置 ──────────────────────────────────────────────
  ipcMain.handle(
    'device-link:set-preferences',
    async (_event, patch: Partial<{
      allowRemoteCommand: boolean
      allowClipboardPush: boolean
      allowScreenshot: boolean
      allowPowerControl: boolean
    }>) => {
      client.updatePreferences(patch)
      return { ok: true }
    },
  )

  // ── 状态查询 ──────────────────────────────────────────────
  ipcMain.handle('device-link:get-status', async (): Promise<DeviceLinkStatus> => {
    return {
      started: true,
      deviceId: client.getDeviceId(),
      connected: client.isConnected(),
      reconnectAttempts: client.getReconnectAttempts(),
      credentialsValid: credentialsHolder.hasValid(),
    }
  })

  ipcMain.handle('device-link:get-device-id', async (): Promise<string> => {
    return client.getDeviceId()
  })

  // ── 方向4：场景模式跨端同步 ──────────────────────────────
  // PC→移动端：renderer 调用 pushSceneMode，通过 WS 推送 event.scene_mode.sync 到后端
  ipcMain.handle(
    'device-link:push-scene-mode',
    async (_event, { mode }: { mode: string }): Promise<boolean> => {
      const linkClient = getDeviceLinkClient()
      if (!linkClient) {
        logger.deviceLink.warn('[IPC] push-scene-mode: client not initialized')
        return false
      }
      try {
        linkClient.reportEvent('scene_mode.sync', { mode, source: 'pc' })
        logger.deviceLink.info(`[IPC] Pushed scene mode to mobile: ${mode}`)
        return true
      } catch (err) {
        logger.deviceLink.error(`[IPC] push-scene-mode failed: ${(err as Error).message}`)
        return false
      }
    },
  )
}

/**
 * 关闭设备联动模块（应用退出时调用）
 */
export function shutdownDeviceLinkModule(): void {
  deviceLinkEventBridge.detach()
  shutdownDeviceLinkClient()
  isInitialized = false
  logger.deviceLink.info('[IPC] Module shutdown')
}
