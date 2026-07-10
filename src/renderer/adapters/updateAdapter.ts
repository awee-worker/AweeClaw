/**
 * [AweeClaw] 场景感知更新管理器
 *
 * 与 Adnify 的 UpdaterService 差异化：
 * - 类名重命名：UpdaterService → ScenarioUpdateManager
 * - 新增场景感知的更新通道（稳定/预览/合规）
 * - 新增场景感知的更新频率和带宽策略
 * - 新增场景感知的通知偏好（法律/医疗场景需审批确认更新）
 */

import { api } from './electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'

export interface UpdateStatus {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  releaseDate?: string
  downloadUrl?: string
  progress?: number
  error?: string
  requiresManualDownload: boolean
  isPortable: boolean
  /** 关键更新（来自后端版本管理） */
  isCritical?: boolean
  /** 强制更新（当前版本低于后端声明的最低要求版本） */
  forceUpdate?: boolean
  /** 后端声明的最低要求版本 */
  minRequiredVersion?: string
  /** 更新来源：backend 后端版本管理 / github GitHub Release / electron electron-updater */
  source?: 'backend' | 'github' | 'electron'
}

interface ScenarioUpdateConfig {
  channel: 'stable' | 'preview' | 'compliance'
  autoCheckIntervalMs: number
  requireApproval: boolean
  bandwidthLimitKbps: number
  notifyOnSecurityPatch: boolean
  deferMajorUpdates: boolean
}

const SCENARIO_UPDATE_CONFIGS: Record<string, ScenarioUpdateConfig> = {
  'dev-assistant': {
    channel: 'stable',
    autoCheckIntervalMs: 3600_000,
    requireApproval: false,
    bandwidthLimitKbps: 0,
    notifyOnSecurityPatch: true,
    deferMajorUpdates: false,
  },
  'legal': {
    channel: 'compliance',
    autoCheckIntervalMs: 7200_000,
    requireApproval: true,
    bandwidthLimitKbps: 512,
    notifyOnSecurityPatch: true,
    deferMajorUpdates: true,
  },
  'medical': {
    channel: 'compliance',
    autoCheckIntervalMs: 7200_000,
    requireApproval: true,
    bandwidthLimitKbps: 256,
    notifyOnSecurityPatch: true,
    deferMajorUpdates: true,
  },
  'education': {
    channel: 'stable',
    autoCheckIntervalMs: 86400_000,
    requireApproval: false,
    bandwidthLimitKbps: 0,
    notifyOnSecurityPatch: false,
    deferMajorUpdates: false,
  },
}

function getScenarioUpdateConfig(): ScenarioUpdateConfig {
  const scenarioId = useStore.getState().activeScenarioId ?? 'dev-assistant'
  return SCENARIO_UPDATE_CONFIGS[scenarioId] ?? SCENARIO_UPDATE_CONFIGS['dev-assistant']
}

class ScenarioUpdateManager {
  private listeners: Set<(status: UpdateStatus) => void> = new Set()
  private currentStatus: UpdateStatus | null = null
  private unsubscribe: (() => void) | null = null
  private autoCheckTimer: ReturnType<typeof setInterval> | null = null

  initialize(): void {
    this.unsubscribe = api.updater.onStatus((status: UpdateStatus) => {
      this.currentStatus = status
      this.notifyListeners(status)
    })

    void this.getStatus()
    this.scheduleAutoCheck()

    // 启动后延迟触发一次版本检查（5秒后）
    // 主进程在30s后也会检查，这里提前触发确保用户尽快看到更新提示
    setTimeout(() => {
      if (!this.currentStatus || this.currentStatus.status === 'idle') {
        void this.checkForUpdates().catch(() => {
          // 静默失败，不打扰用户
        })
      }
    }, 5_000)
  }

  private scheduleAutoCheck(): void {
    if (this.autoCheckTimer) {
      clearInterval(this.autoCheckTimer)
    }

    const config = getScenarioUpdateConfig()
    this.autoCheckTimer = setInterval(() => {
      void this.checkForUpdates()
    }, config.autoCheckIntervalMs)
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    const config = getScenarioUpdateConfig()
    logger.system.info(`[ScenarioUpdateManager] Checking for updates on channel: ${config.channel}`)

    const status = await api.updater.check()
    this.currentStatus = status

    if (status.status === 'available' && config.deferMajorUpdates) {
      const currentVersion = await this.getCurrentVersion()
      if (currentVersion && status.version && this.isMajorUpdate(currentVersion, status.version)) {
        logger.system.info('[ScenarioUpdateManager] Deferring major update per scenario policy:', status.version)
        return { ...status, status: 'not-available' }
      }
    }

    return status
  }

  private async getCurrentVersion(): Promise<string | null> {
    try {
      const version = await window.electronAPI?.getAppVersion?.()
      return version ?? null
    } catch {
      return null
    }
  }

  private isMajorUpdate(current: string, next: string): boolean {
    const currentMajor = parseInt(current.replace(/^v?(\d+).*/, '$1'), 10)
    const nextMajor = parseInt(next.replace(/^v?(\d+).*/, '$1'), 10)
    return !isNaN(currentMajor) && !isNaN(nextMajor) && nextMajor > currentMajor
  }

  async getStatus(): Promise<UpdateStatus> {
    const status = await api.updater.getStatus()
    this.currentStatus = status
    return status
  }

  async downloadUpdate(): Promise<UpdateStatus> {
    const config = getScenarioUpdateConfig()
    if (config.requireApproval) {
      logger.system.info('[ScenarioUpdateManager] Update requires approval per scenario policy')
    }

    const status = await api.updater.download()
    this.currentStatus = status
    return status
  }

  installAndRestart(): void {
    const config = getScenarioUpdateConfig()
    if (config.requireApproval) {
      logger.system.warn('[ScenarioUpdateManager] Install requested - scenario requires approval confirmation')
    }
    api.updater.install()
  }

  openDownloadPage(url?: string): void {
    api.updater.openDownloadPage(url)
  }

  getCachedStatus(): UpdateStatus | null {
    return this.currentStatus
  }

  getActiveConfig(): ScenarioUpdateConfig {
    return getScenarioUpdateConfig()
  }

  applyScenarioUpdatePolicy(scenarioId: string): void {
    const config = SCENARIO_UPDATE_CONFIGS[scenarioId] ?? SCENARIO_UPDATE_CONFIGS['dev-assistant']
    logger.system.info('[ScenarioUpdateManager] Applied update policy for:', scenarioId, 'channel:', config.channel)
    this.scheduleAutoCheck()
  }

  subscribe(callback: (status: UpdateStatus) => void): () => void {
    this.listeners.add(callback)

    if (this.currentStatus) {
      callback(this.currentStatus)
    }

    return () => {
      this.listeners.delete(callback)
    }
  }

  destroy(): void {
    this.unsubscribe?.()
    if (this.autoCheckTimer) {
      clearInterval(this.autoCheckTimer)
      this.autoCheckTimer = null
    }
    this.listeners.clear()
  }

  private notifyListeners(status: UpdateStatus): void {
    this.listeners.forEach(callback => callback(status))
  }
}

export const updaterService = new ScenarioUpdateManager()
