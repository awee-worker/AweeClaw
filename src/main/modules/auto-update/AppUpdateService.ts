/**
 * 应用自动更新服务 — 基于 electron-updater 的版本更新
 *
 * 发布策略：
 * - Windows：NSIS 安装包
 * - macOS：DMG / ZIP
 * - Linux：AppImage
 *
 * 说明：
 * 部分本地打包布局仍无法可靠地自动更新，此时回退到
 * GitHub Release 检查并暴露手动下载链接。
 */

import { app, BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { logger } from '@shared/toolkit/LogEngine'
import { ErrorCode, toAppError } from '@shared/toolkit/errorCatalog'
import { BRAND } from '@shared/brand'
import * as fs from 'fs'
import * as path from 'path'
import { getUserConfigDir } from '../../modules/configPath'

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

/** 后端 /api/v1/app-version/check 返回结构 */
interface BackendUpdateCheckResult {
  hasUpdate: boolean
  version?: string
  channel?: string
  downloadUrl?: string
  releaseNotes?: string
  releaseNotesHtml?: string
  releaseDate?: string
  isCritical: boolean
  forceUpdate: boolean
  minRequiredVersion?: string
  signature?: string
  hash?: string
  fileSize?: number
}

class UpdateService {
  private status: UpdateStatus = {
    status: 'idle',
    requiresManualDownload: false,
    isPortable: false,
  }

  private mainWindow: BrowserWindow | null = null
  private updateCheckInterval: NodeJS.Timeout | null = null

  initialize(mainWindow: BrowserWindow): void {
    this.mainWindow = mainWindow

    const requiresManualDownload = this.detectManualDownloadMode()
    this.status.requiresManualDownload = requiresManualDownload
    // Backward-compatible alias for existing consumers.
    this.status.isPortable = requiresManualDownload

    logger.system.info(
      `[Updater] Initialized, requiresManualDownload: ${requiresManualDownload}, platform: ${process.platform}`
    )

    if (requiresManualDownload) {
      this.setupManualDownloadUpdater()
      return
    }

    this.setupAutoUpdater()
  }

  /**
   * Detect package layouts that should not use electron-updater directly.
   */
  private detectManualDownloadMode(): boolean {
    const exePath = app.getPath('exe')
    const exeDir = path.dirname(exePath)

    if (process.platform === 'win32') {
      // Windows releases are installer-based now. If the usual uninstall entry
      // is missing, treat it as a non-standard layout and avoid auto-install.
      const uninstallPath = path.join(exeDir, 'Uninstall AweeClaw.exe')
      return !fs.existsSync(uninstallPath)
    }

    if (process.platform === 'darwin') {
      // Drag-and-drop app bundles outside /Applications are often ad-hoc copies.
      return !exePath.startsWith('/Applications/')
    }

    if (process.platform === 'linux') {
      // AppImage is the supported Linux update path.
      return !process.env.APPIMAGE
    }

    return true
  }

  private setupAutoUpdater(): void {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowDowngrade = false

    const channel = this.getUpdateChannel()
    autoUpdater.channel = channel
    autoUpdater.setFeedURL({
      provider: 'github',
      owner: 'awee-worker',
      repo: BRAND.name.toLowerCase(),
    })

    logger.system.info(`[Updater] Using update channel: ${channel}`)

    autoUpdater.on('checking-for-update', () => {
      this.updateStatus({ status: 'checking' })
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.updateStatus({
        status: 'available',
        version: info.version,
        releaseNotes: this.formatReleaseNotes(info.releaseNotes),
        releaseDate: info.releaseDate,
      })
    })

    autoUpdater.on('update-not-available', () => {
      this.updateStatus({ status: 'not-available' })
    })

    autoUpdater.on('download-progress', (progress: ProgressInfo) => {
      this.updateStatus({
        status: 'downloading',
        progress: Math.round(progress.percent),
      })
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      logger.system.info(`[Updater] Update downloaded: ${info.version}, files:`, info.files)
      this.updateStatus({
        status: 'downloaded',
        version: info.version,
      })
    })

    autoUpdater.on('error', (err: Error) => {
      logger.system.error('[Updater] Error:', err)
      this.updateStatus({
        status: 'error',
        error: toAppError(err).message,
      })
    })

    setTimeout(() => {
      void this.checkForUpdates()
    }, 30 * 1000)

    this.updateCheckInterval = setInterval(() => {
      void this.checkForUpdates()
    }, 4 * 60 * 60 * 1000)
  }

  private setupManualDownloadUpdater(): void {
    setTimeout(() => {
      void this.checkForUpdatesViaGitHub()
    }, 30 * 1000)

    this.updateCheckInterval = setInterval(() => {
      void this.checkForUpdatesViaGitHub()
    }, 4 * 60 * 60 * 1000)
  }

  async checkForUpdates(): Promise<UpdateStatus> {
    // 优先走后端版本管理；失败或无更新时回退到 electron-updater / GitHub
    const backendResult = await this.checkForUpdatesViaBackend().catch(err => {
      logger.system.warn('[Updater] Backend version check failed, will fall back:', err)
      return null
    })

    if (backendResult) {
      return backendResult
    }

    if (this.status.requiresManualDownload) {
      return this.checkForUpdatesViaGitHub()
    }

    try {
      this.updateStatus({ status: 'checking' })
      logger.system.info('[Updater] Starting update check...')

      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('更新检查超时，请检查网络连接'))
        }, 30 * 1000)
      })

      const checkPromise = autoUpdater
        .checkForUpdates()
        .then(async result => {
          logger.system.info(
            '[Updater] checkForUpdates() resolved, result:',
            result
              ? JSON.stringify({
                  updateInfo: result.updateInfo ? { version: result.updateInfo.version } : null,
                  cancellationToken: result.cancellationToken ? 'present' : null,
                })
              : 'null'
          )

          if (result?.updateInfo) {
            if (this.status.status === 'checking') {
              this.updateStatus({
                status: 'available',
                version: result.updateInfo.version,
                releaseNotes: this.formatReleaseNotes(result.updateInfo.releaseNotes),
                releaseDate: result.updateInfo.releaseDate as string | undefined,
              })
            }
            return
          }

          if (!result) {
            logger.system.warn('[Updater] checkForUpdates() returned null, falling back to GitHub API check')
            await this.sleep(2000)
            if (this.status.status === 'checking') {
              return this.checkForUpdatesViaGitHub(false)
            }
            return
          }

          await this.waitForUpdaterEventOrFallback()
        })
        .catch(async err => {
          logger.system.error('[Updater] checkForUpdates() rejected:', err)
          if (this.status.status === 'checking') {
            return this.checkForUpdatesViaGitHub(false).catch(() => {
              throw err
            })
          }
          throw err
        })

      await Promise.race([checkPromise, timeoutPromise])
    } catch (err) {
      const error = toAppError(err)
      if (error.code === ErrorCode.NETWORK || error.code === ErrorCode.TIMEOUT) {
        logger.system.warn(`[Updater] Check failed due to network: ${error.code} (${error.message})`)
      } else {
        logger.system.error(`[Updater] Check failed: ${error.code}`, error)
      }

      if (this.status.status === 'checking') {
        this.updateStatus({
          status: 'error',
          error: error.message || '更新检查失败',
        })
      }
    }

    return this.status
  }

  /**
   * 后端版本管理检查（优先通道）
   *
   * 调用后端 GET /api/v1/app-version/check 接口，返回是否需要更新及最新版本元数据。
   * - hasUpdate=true 时直接进入 available 状态，使用后端提供的下载地址与更新日志。
   * - 手动下载模式：使用后端返回的 downloadUrl。
   * - 自动下载模式：仍由 electron-updater 负责下载安装，但展示后端的 releaseNotes/critical。
   * - 接口不可用或返回无更新时返回 null，由调用方回退到原逻辑。
   */
  async checkForUpdatesViaBackend(setCheckingStatus = true): Promise<UpdateStatus | null> {
    const serverUrl = this.readServerUrl()
    if (!serverUrl) {
      // 未配置后端地址，跳过后端检查
      return null
    }

    const currentVersion = app.getVersion()
    const platform = this.mapPlatform()
    const arch = this.mapArch()

    if (!platform || !arch) {
      logger.system.warn(`[Updater] Unsupported platform/arch for backend check: ${process.platform}/${process.arch}`)
      return null
    }

    if (setCheckingStatus) {
      this.updateStatus({ status: 'checking' })
    }

    const url = `${serverUrl.replace(/\/+$/, '')}/api/v1/app-version/check?currentVersion=${encodeURIComponent(currentVersion)}&platform=${platform}&arch=${arch}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 15 * 1000)

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        logger.system.warn(`[Updater] Backend version check HTTP ${response.status}`)
        return null
      }

      const payload = (await response.json()) as {
        success?: boolean
        data?: BackendUpdateCheckResult
      }

      const result = payload?.data ?? (payload as unknown as BackendUpdateCheckResult)
      if (!result || typeof result.hasUpdate !== 'boolean') {
        return null
      }

      if (!result.hasUpdate) {
        this.updateStatus({ status: 'not-available', source: 'backend' })
        return this.status
      }

      // 后端确认有更新
      const isCritical = result.isCritical === true
      const forceUpdate = result.forceUpdate === true

      // 自动下载模式：仍由 electron-updater 下载（保证签名校验），但展示后端元数据
      // 手动下载模式：直接使用后端 downloadUrl
      if (this.status.requiresManualDownload) {
        this.updateStatus({
          status: 'available',
          version: result.version,
          releaseNotes: result.releaseNotes ?? undefined,
          releaseDate: result.releaseDate,
          downloadUrl: result.downloadUrl,
          isCritical,
          forceUpdate,
          minRequiredVersion: result.minRequiredVersion,
          source: 'backend',
        })
      } else {
        // 让 electron-updater 仍然负责下载/安装，但用后端元数据展示
        // 若后端返回的 version 与 electron-updater 一致则复用；否则仅展示后端信息
        this.updateStatus({
          status: 'available',
          version: result.version,
          releaseNotes: result.releaseNotes ?? undefined,
          releaseDate: result.releaseDate,
          downloadUrl: result.downloadUrl,
          isCritical,
          forceUpdate,
          minRequiredVersion: result.minRequiredVersion,
          source: 'backend',
        })
      }

      logger.system.info(
        `[Updater] Backend reports update available: v${result.version}, critical=${isCritical}, force=${forceUpdate}`,
      )
      return this.status
    } catch (err) {
      clearTimeout(timeoutId)
      const error = toAppError(err)
      logger.system.warn(`[Updater] Backend version check error: ${error.code} (${error.message})`)
      // 后端检查失败不抛出，交由调用方回退
      return null
    }
  }

  async checkForUpdatesViaGitHub(setCheckingStatus = true): Promise<UpdateStatus> {
    // 优先走后端版本管理（手动下载模式下同样适用，可拿到 critical/forceUpdate 元数据）
    const backendResult = await this.checkForUpdatesViaBackend(setCheckingStatus).catch(err => {
      logger.system.warn('[Updater] Backend version check failed (manual-download path):', err)
      return null
    })

    if (backendResult) {
      return backendResult
    }

    try {
      if (setCheckingStatus) {
        this.updateStatus({ status: 'checking' })
      }

      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30 * 1000)

      try {
        const response = await fetch('https://api.github.com/repos/awee-worker/aweeclaw/releases/latest', {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'AweeClaw-Updater',
          },
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (!response.ok) {
          if (response.status === 403) {
            const remaining = response.headers.get('X-RateLimit-Remaining')
            const resetTime = response.headers.get('X-RateLimit-Reset')
            logger.system.warn(`[Updater] Rate limited. Remaining: ${remaining}, Reset: ${resetTime}`)
            throw new Error('GitHub API 请求频率超限，请稍后再试')
          }

          if (response.status === 404) {
            this.updateStatus({ status: 'not-available' })
            return this.status
          }

          throw new Error(`GitHub API error: ${response.status}`)
        }

        const release = (await response.json()) as {
          tag_name: string
          body: string
          published_at: string
          assets: Array<{ name: string; browser_download_url: string }>
        }

        const latestVersion = release.tag_name.replace(/^v/, '')
        const currentVersion = app.getVersion()

        if (this.isNewerVersion(latestVersion, currentVersion)) {
          this.updateStatus({
            status: 'available',
            version: latestVersion,
            releaseNotes: release.body,
            releaseDate: release.published_at,
            downloadUrl: this.findDownloadUrl(release.assets),
          })
        } else {
          this.updateStatus({ status: 'not-available' })
        }
      } catch (err) {
        clearTimeout(timeoutId)
        if (toAppError(err).name === 'AbortError') {
          throw new Error('更新检查超时，请检查网络连接')
        }
        throw err
      }
    } catch (err) {
      const error = toAppError(err)
      if (error.code === ErrorCode.NETWORK || error.code === ErrorCode.TIMEOUT) {
        logger.system.warn(`[Updater] GitHub release check failed due to network: ${error.code} (${error.message})`)
      } else {
        logger.system.error(`[Updater] GitHub release check failed: ${error.code}`, error)
      }

      this.updateStatus({
        status: 'error',
        error: error.message || '更新检查失败',
      })
    }

    return this.status
  }

  async downloadUpdate(): Promise<void> {
    if (this.status.requiresManualDownload) {
      throw new Error('当前安装方式不支持自动下载，请前往发布页手动下载。')
    }

    if (this.status.status !== 'available') {
      throw new Error('No update available')
    }

    await autoUpdater.downloadUpdate()
  }

  quitAndInstall(): void {
    if (this.status.requiresManualDownload) {
      throw new Error('当前安装方式不支持自动安装。')
    }

    if (this.status.status !== 'downloaded') {
      throw new Error('Update not downloaded')
    }

    autoUpdater.autoInstallOnAppQuit = true
    logger.system.info('[Updater] Initiating quit and install...')

    setTimeout(() => {
      logger.system.info('[Updater] Calling autoUpdater.quitAndInstall(true, true)')
      autoUpdater.quitAndInstall(true, true)
    }, 100)
  }

  getStatus(): UpdateStatus {
    return { ...this.status }
  }

  destroy(): void {
    if (this.updateCheckInterval) {
      clearInterval(this.updateCheckInterval)
      this.updateCheckInterval = null
    }
  }

  private updateStatus(partial: Partial<UpdateStatus>): void {
    // 切换更新来源时，重置后端专属字段，避免上一来源的元数据残留
    if (partial.source && partial.source !== this.status.source) {
      if (partial.isCritical === undefined) partial.isCritical = false
      if (partial.forceUpdate === undefined) partial.forceUpdate = false
      if (partial.minRequiredVersion === undefined) partial.minRequiredVersion = undefined
    }

    this.status = {
      ...this.status,
      ...partial,
      isPortable: partial.requiresManualDownload ?? this.status.requiresManualDownload,
    }

    if (partial.requiresManualDownload !== undefined) {
      this.status.isPortable = partial.requiresManualDownload
    }

    this.notifyRenderer()
  }

  private notifyRenderer(): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('updater:status', this.status)
    }
  }

  /**
   * 读取后端服务地址（aweeclaw-config.json 中的 serverUrl）
   */
  private readServerUrl(): string | null {
    try {
      const configPath = path.join(getUserConfigDir(), '.aweeclaw', 'aweeclaw-config.json')
      if (!fs.existsSync(configPath)) return null
      const raw = fs.readFileSync(configPath, 'utf-8')
      const config = JSON.parse(raw)
      return config?.serverUrl || null
    } catch (err) {
      logger.system.warn('[Updater] Failed to read serverUrl from app config:', err)
      return null
    }
  }

  /**
   * 将 process.platform 映射为后端枚举值
   */
  private mapPlatform(): 'WIN32' | 'DARWIN' | 'LINUX' | null {
    switch (process.platform) {
      case 'win32': return 'WIN32'
      case 'darwin': return 'DARWIN'
      case 'linux': return 'LINUX'
      default: return null
    }
  }

  /**
   * 将 process.arch 映射为后端枚举值
   */
  private mapArch(): 'X64' | 'ARM64' | null {
    switch (process.arch) {
      case 'x64': return 'X64'
      case 'arm64': return 'ARM64'
      default: return null
    }
  }

  private formatReleaseNotes(notes: string | Array<{ version: string; note: string | null }> | null | undefined): string {
    if (!notes) return ''
    if (typeof notes === 'string') return notes
    return notes
      .map(note => note.note || '')
      .filter(Boolean)
      .join('\n\n')
  }

  private isNewerVersion(latest: string, current: string): boolean {
    const latestParts = latest.split('.').map(Number)
    const currentParts = current.split('.').map(Number)

    for (let i = 0; i < Math.max(latestParts.length, currentParts.length); i += 1) {
      const left = latestParts[i] || 0
      const right = currentParts[i] || 0
      if (left > right) return true
      if (left < right) return false
    }

    return false
  }

  private findDownloadUrl(assets: Array<{ name: string; browser_download_url: string }>): string {
    const key = `${process.platform}-${process.arch}`
    const patterns: Record<string, RegExp[]> = {
      'win32-x64': [/AweeClaw-Setup-.*-x64\.exe$/i],
      'win32-arm64': [/AweeClaw-Setup-.*-arm64\.exe$/i],
      'darwin-x64': [/AweeClaw-.*-x64-mac\.dmg$/i, /AweeClaw-.*-x64-mac\.zip$/i],
      'darwin-arm64': [/AweeClaw-.*-arm64-mac\.dmg$/i, /AweeClaw-.*-arm64-mac\.zip$/i],
      'linux-x64': [/AweeClaw-.*-x86_64-linux\.AppImage$/i, /AweeClaw-.*-x64-linux\.AppImage$/i],
      'linux-arm64': [/AweeClaw-.*-arm64-linux\.AppImage$/i],
    }

    const regexes = patterns[key] || []
    for (const asset of assets) {
      if (regexes.some(regex => regex.test(asset.name))) {
        return asset.browser_download_url
      }
    }

    return BRAND.links.releases
  }

  private getUpdateChannel(): string {
    if (process.platform === 'win32') {
      return process.arch === 'arm64' ? 'latest-arm64' : 'latest'
    }

    if (process.platform === 'darwin') {
      return process.arch === 'arm64' ? 'latest-arm64-mac' : 'latest-mac'
    }

    if (process.platform === 'linux') {
      return process.arch === 'arm64' ? 'latest-linux-arm64' : 'latest-linux'
    }

    return 'latest'
  }

  private async waitForUpdaterEventOrFallback(): Promise<void> {
    const startTime = Date.now()

    await new Promise<void>(resolve => {
      const interval = setInterval(() => {
        if (this.status.status !== 'checking') {
          clearInterval(interval)
          logger.system.info(`[Updater] Status changed to: ${this.status.status}`)
          resolve()
          return
        }

        if (Date.now() - startTime > 5000) {
          clearInterval(interval)
          if (this.status.status === 'checking') {
            logger.system.warn('[Updater] No event triggered after checkForUpdates() resolved, falling back to GitHub API')
            this.checkForUpdatesViaGitHub(false)
              .then(() => resolve())
              .catch(() => {
                this.updateStatus({ status: 'not-available' })
                resolve()
              })
          } else {
            resolve()
          }
        }
      }, 200)
    })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}

export const updateService = new UpdateService()
