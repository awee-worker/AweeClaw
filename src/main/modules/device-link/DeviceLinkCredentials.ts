/**
 * 设备联动凭据管理
 *
 * 由于 token 在 renderer 进程管理（见 renderer/adapters/backendApi.ts），
 * 主进程的 DeviceLinkClient 需要通过 IPC 接收 renderer 推送的凭据。
 *
 * 流程：
 * 1. App 启动后，renderer 检测到已登录，调用 IPC `device-link:set-credentials`
 *    推送 { serverUrl, accessToken, deviceName, workspacePath, workspaceName }
 * 2. DeviceLinkClient 收到后启动 WebSocket 连接
 * 3. renderer 监听 `cloud:tokenRefreshed`，每次刷新都同步推送给主进程
 * 4. renderer 收到 `cloud:authFailed` 时调用 `device-link:clear-credentials`，
 *    主进程断开 WS 连接
 *
 * 主进程内部不主动刷新 token，避免与 renderer 的刷新逻辑重复。
 */
import { logger } from '@shared/toolkit/LogEngine'

export interface DeviceLinkCredentials {
  /** 后端服务地址，如 https://api.aweeclaw.com */
  serverUrl: string
  /** JWT accessToken */
  accessToken: string
  /** 设备展示名（如 "MacBook Pro (Alice)"）。若不提供，主进程自动用 hostname + OS 填充 */
  deviceName?: string
  /** 工作区根路径（可选，用于后端展示） */
  workspacePath?: string
  /** 工作区名称（可选） */
  workspaceName?: string
}

class CredentialsHolder {
  private current: DeviceLinkCredentials | null = null

  set(creds: DeviceLinkCredentials): void {
    this.current = creds
    logger.deviceLink.info('[Credentials] Updated', {
      serverUrl: creds.serverUrl,
      hasToken: !!creds.accessToken,
      deviceName: creds.deviceName || '(auto)',
    })
  }

  get(): DeviceLinkCredentials | null {
    return this.current
  }

  /** 仅更新 accessToken（token 刷新时用） */
  updateAccessToken(newToken: string): boolean {
    if (!this.current || !newToken) return false
    this.current.accessToken = newToken
    return true
  }

  clear(): void {
    this.current = null
    logger.deviceLink.info('[Credentials] Cleared')
  }

  hasValid(): boolean {
    return !!this.current?.accessToken && !!this.current?.serverUrl
  }
}

export const credentialsHolder = new CredentialsHolder()
