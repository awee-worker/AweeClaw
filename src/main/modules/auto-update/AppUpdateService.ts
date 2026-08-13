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

import { app, BrowserWindow, shell } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { logger } from '@shared/toolkit/LogEngine'
import { ErrorCode, toAppError } from '@shared/toolkit/errorCatalog'
import { BRAND } from '@shared/brand'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import * as http from 'http'
import { getUserConfigDir } from '../../modules/configPath'
import { markAutoUpdateQuit } from '../../appBootstrap'

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
  /** 安装方式：auto-restart 自动重启安装 / manual-open 手动打开安装包 */
  installerType?: 'auto-restart' | 'manual-open'
}

/** 后端 /api/v1/app-version/check 返回结构 */
interface BackendUpdateCheckResult {
  hasUpdate: boolean
  version?: string
  channel?: string
  downloadUrl?: string
  /** electron-updater generic provider 的 feed URL（指向 latest.yml 所在目录） */
  updateFeedUrl?: string
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
  /** 自定义下载的安装包路径（后端来源更新，非 electron-updater 下载） */
  private downloadedInstallerPath: string | null = null
  /** 当前正在进行的下载请求（用于取消） */
  private currentDownloadRequest: http.ClientRequest | null = null
  /** 后端返回的 electron-updater feed URL（指向 latest.yml 所在目录） */
  private backendUpdateFeedUrl: string | null = null
  /** 抑制 electron-updater 事件更新状态（热更新下载流程中使用） */
  private suppressStatusEvents = false
  /** 幂等保护：initialize() 重复调用时跳过，避免重复注册事件监听与定时器 */
  private isInitialized = false

  initialize(mainWindow: BrowserWindow): void {
    if (this.isInitialized) {
      logger.system.warn('[Updater] initialize() called multiple times, skipping')
      return
    }
    this.isInitialized = true

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

    this.setupAutoUpdaterEvents()

    setTimeout(() => {
      void this.checkForUpdates()
    }, 30 * 1000)

    this.updateCheckInterval = setInterval(() => {
      void this.checkForUpdates()
    }, 4 * 60 * 60 * 1000)
  }

  /**
   * 设置 electron-updater 事件监听器
   *
   * suppressStatusEvents 为 true 时，抑制 checking/available/not-available/error 事件，
   * 仅允许 download-progress 和 update-downloaded 事件更新状态。
   * 用于热更新下载流程中避免 checkForUpdates() 覆盖后端返回的 available 状态。
   */
  private setupAutoUpdaterEvents(): void {
    autoUpdater.on('checking-for-update', () => {
      if (!this.suppressStatusEvents) {
        this.updateStatus({ status: 'checking' })
      }
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      if (!this.suppressStatusEvents) {
        this.updateStatus({
          status: 'available',
          version: info.version,
          releaseNotes: this.formatReleaseNotes(info.releaseNotes),
          releaseDate: info.releaseDate,
        })
        // 自动下载：检查到更新后静默下载，下载完成后在 UI 上展示"重启以更新"按钮
        this.autoDownloadUpdate().catch(err => {
          logger.system.warn('[Updater] Auto-download failed:', err)
        })
      }
    })

    autoUpdater.on('update-not-available', () => {
      if (!this.suppressStatusEvents) {
        this.updateStatus({ status: 'not-available' })
      }
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
        // electron-updater 下载的走自动重启安装流程
        installerType: 'auto-restart',
      })
    })

    autoUpdater.on('error', (err: Error) => {
      logger.system.error('[Updater] Error:', err)
      if (!this.suppressStatusEvents) {
        this.updateStatus({
          status: 'error',
          error: toAppError(err).message,
        })
      }
    })
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
              // 自动下载：electron-updater 检测到更新后静默下载
              this.autoDownloadUpdate().catch(err => {
                logger.system.warn('[Updater] Auto-download failed (electron source):', err)
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

      // 保存后端返回的 feed URL（用于 electron-updater 热更新）
      this.backendUpdateFeedUrl = result.updateFeedUrl || null

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

      logger.system.info(
        `[Updater] Backend reports update available: v${result.version}, critical=${isCritical}, force=${forceUpdate}, feedUrl=${this.backendUpdateFeedUrl || 'none'}`,
      )

      // 自动下载：后端确认有更新后静默下载
      this.autoDownloadUpdate().catch(err => {
        logger.system.warn('[Updater] Auto-download failed (backend source):', err)
      })

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
          // 自动下载：GitHub 检测到新版本后静默下载
          this.autoDownloadUpdate().catch(err => {
            logger.system.warn('[Updater] Auto-download failed (github source):', err)
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
    if (this.status.status !== 'available') {
      throw new Error('No update available')
    }

    // macOS 未签名应用兜底：Squirrel.Mac 要求应用必须签名才能用 quitAndInstall 重启，
    // 否则会出现「下载完成但点击立即重启无反应」或「应用退出后不重启」。
    // 因此 macOS 下优先走 dmg 完整包下载 + shell.openPath 启动安装流程，绕过签名依赖。
    // 仅在后端显式返回 updateFeedUrl 且应用已签名时才走差量热更新（当前未签名，全部走 dmg）。
    const isMacosUnsigned = process.platform === 'darwin'

    // 后端来源的热更新：后端返回了 updateFeedUrl（指向 latest.yml 所在目录），
    // 使用 electron-updater 差量下载，体验与 VSCode 一样（静默安装、重启生效）
    // macOS 未签名应用跳过此路径，改走下面的 dmg 下载
    if (
      this.status.source === 'backend' &&
      this.backendUpdateFeedUrl &&
      !this.status.requiresManualDownload &&
      !isMacosUnsigned
    ) {
      await this.downloadViaElectronUpdater(this.backendUpdateFeedUrl)
      return
    }

    // 后端来源的 dmg 下载（macOS 首选路径，或其他平台无 feedUrl 时）
    if (this.status.source === 'backend' && this.status.downloadUrl) {
      await this.downloadUpdateFromUrl(this.status.downloadUrl)
      return
    }

    // macOS 下 electron-updater 自动下载的 zip 包也走不通（未签名无法 quitAndInstall）
    // 改为抛出友好提示，引导用户手动下载
    if (isMacosUnsigned && !this.status.downloadUrl) {
      throw new Error('macOS 未签名应用暂不支持自动热更新，请前往发布页手动下载 dmg 安装包。')
    }

    if (this.status.requiresManualDownload) {
      throw new Error('当前安装方式不支持自动下载，请前往发布页手动下载。')
    }

    await autoUpdater.downloadUpdate()
  }

  /**
   * 自动下载更新（静默，不打扰用户）
   *
   * 触发时机：
   * - electron-updater 检测到 update-available 事件时
   * - 后端版本检查确认有更新时
   *
   * 失败处理：
   * - 静默失败，仅记录日志，不弹错误提示
   * - 用户仍可在设置页手动触发下载
   */
  private async autoDownloadUpdate(): Promise<void> {
    const currentStatus = this.status.status
    if (currentStatus !== 'available') return

    try {
      logger.system.info(`[Updater] Auto-downloading update v${this.status.version}...`)
      await this.downloadUpdate()
    } catch (err) {
      logger.system.warn('[Updater] Auto-download failed:', err)
      // 静默失败：状态回退到 available，用户可在设置页手动重试
      const afterStatus = this.status.status
      if (afterStatus === 'downloading' || afterStatus === 'error') {
        this.updateStatus({ status: 'available', error: undefined, progress: undefined })
      }
    }
  }

  /**
   * 通过 electron-updater 热更新（差量下载 + 静默安装）
   *
   * 动态设置 generic provider 指向后端返回的 feed URL（latest.yml 所在目录），
   * electron-updater 自动处理：
   * 1. 下载 latest.yml 获取版本元数据
   * 2. 使用 blockmap 差量下载（只下载变化的文件块）
   * 3. 下载完成后触发 update-downloaded 事件
   * 4. quitAndInstall() 静默安装，重启生效
   *
   * 前提条件：OSS 目录下需上传以下文件：
   * - latest.yml（版本元数据，electron-builder 打包自动生成）
   * - AweeClaw-Setup-x.x.x-x64.exe（安装包）
   * - AweeClaw-Setup-x.x.x-x64.exe.blockmap（块映射，用于差量下载）
   */
  private async downloadViaElectronUpdater(feedUrl: string): Promise<void> {
    logger.system.info(`[Updater] Using electron-updater with feed URL: ${feedUrl}`)

    // 动态设置 feed URL 为后端返回的 OSS 目录
    autoUpdater.setFeedURL({
      provider: 'generic',
      url: feedUrl,
    })

    // 抑制 checkForUpdates 的事件，避免覆盖后端返回的 available 状态
    this.suppressStatusEvents = true

    try {
      this.updateStatus({ status: 'downloading', progress: 0 })

      // electron-updater 需要先 checkForUpdates 获取 latest.yml，然后才能 downloadUpdate
      const result = await autoUpdater.checkForUpdates()

      if (!result?.updateInfo) {
        // electron-updater 未找到更新（latest.yml 中版本号不匹配等），回退到自定义下载器
        logger.system.warn('[Updater] electron-updater found no update in feed, falling back to custom downloader')
        this.suppressStatusEvents = false
        if (this.status.downloadUrl) {
          await this.downloadUpdateFromUrl(this.status.downloadUrl)
        } else {
          throw new Error('未找到可用更新')
        }
        return
      }

      logger.system.info(`[Updater] electron-updater found update: v${result.updateInfo.version}, starting delta download...`)

      // 差量下载（electron-updater 使用 blockmap 只下载变化的文件块）
      await autoUpdater.downloadUpdate()

      // 下载完成后 suppressStatusEvents 恢复，update-downloaded 事件已设置 status = downloaded
    } catch (err) {
      logger.system.error('[Updater] electron-updater hot update failed:', err)
      this.suppressStatusEvents = false

      // 热更新失败，回退到自定义下载器
      if (this.status.downloadUrl) {
        logger.system.info('[Updater] Falling back to custom downloader')
        await this.downloadUpdateFromUrl(this.status.downloadUrl)
      } else {
        throw err
      }
    } finally {
      this.suppressStatusEvents = false
    }
  }

  /**
   * 从自定义 URL 下载安装包（后端来源的更新）
   *
   * 下载到系统临时目录，下载进度通过 updateStatus 实时通知渲染进程。
   * 下载完成后状态变为 downloaded，用户可点击"重启安装"启动安装程序。
   */
  private async downloadUpdateFromUrl(url: string): Promise<void> {
    // 清理上一次的下载文件
    if (this.downloadedInstallerPath) {
      try {
        fs.unlinkSync(this.downloadedInstallerPath)
      } catch {
        // 忽略清理失败
      }
      this.downloadedInstallerPath = null
    }

    const tempDir = app.getPath('temp')
    const fileName = this.extractFileName(url) || `AweeClaw-Setup-${this.status.version || 'unknown'}.${this.getInstallerExtension()}`
    const filePath = path.join(tempDir, `aweeclaw-update-${Date.now()}-${fileName}`)

    this.updateStatus({ status: 'downloading', progress: 0 })

    logger.system.info(`[Updater] Downloading update from: ${url} -> ${filePath}`)

    try {
      await this.downloadFile(url, filePath)
      this.downloadedInstallerPath = filePath
      // 自定义下载的安装包（dmg/exe）需要用户手动打开安装，不走自动重启流程
      this.updateStatus({ status: 'downloaded', progress: 100, installerType: 'manual-open' })
      logger.system.info(`[Updater] Update downloaded successfully: ${filePath}`)
    } catch (err) {
      // 清理不完整的下载文件
      try { fs.unlinkSync(filePath) } catch { /* ignore */ }
      const error = toAppError(err)
      logger.system.error(`[Updater] Download failed: ${error.code}`, error)
      this.updateStatus({
        status: 'error',
        error: error.message || '下载更新失败',
      })
      throw error
    }
  }

  /**
   * 下载文件（支持 HTTPS/HTTP，自动处理重定向）
   *
   * 重定向处理：遇到 301/302/307/308 时销毁当前响应流后递归跟随，
   * 避免响应流未关闭导致的句柄泄漏。
   */
  private downloadFile(url: string, filePath: string, maxRedirects = 5): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https:') ? https : http

      const request = protocol.get(url, (response) => {
        // 处理重定向：必须先销毁响应流再递归，否则底层 socket 句柄泄漏
        if (
          response.statusCode !== undefined &&
          [301, 302, 307, 308].includes(response.statusCode) &&
          response.headers.location
        ) {
          // 销毁当前响应流，释放底层资源
          response.destroy()

          if (maxRedirects <= 0) {
            reject(new Error('重定向次数过多'))
            return
          }
          const redirectUrl = new URL(response.headers.location, url).href
          logger.system.info(`[Updater] Redirecting to: ${redirectUrl}`)
          this.downloadFile(redirectUrl, filePath, maxRedirects - 1).then(resolve, reject)
          return
        }

        if (response.statusCode !== 200) {
          // 非 200 响应也需销毁流，避免句柄挂起
          response.destroy()
          reject(new Error(`下载失败: HTTP ${response.statusCode}`))
          return
        }

        const totalBytes = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedBytes = 0
        let lastProgressUpdate = 0

        const fileStream = fs.createWriteStream(filePath)

        response.on('data', (chunk: Buffer) => {
          downloadedBytes += chunk.length
          if (totalBytes > 0) {
            const progress = Math.round((downloadedBytes / totalBytes) * 100)
            // 限制进度更新频率，每 5% 更新一次，避免过度渲染
            if (progress - lastProgressUpdate >= 5 || progress === 100) {
              lastProgressUpdate = progress
              this.updateStatus({ status: 'downloading', progress })
            }
          }
        })

        response.pipe(fileStream)

        fileStream.on('finish', () => {
          fileStream.close(() => resolve())
        })

        fileStream.on('error', (err) => {
          response.destroy()
          fs.unlink(filePath, () => {})
          reject(err)
        })
      })

      request.on('error', (err) => {
        reject(err)
      })

      // 设置超时（5 分钟）
      request.setTimeout(5 * 60 * 1000, () => {
        request.destroy()
        reject(new Error('下载超时，请检查网络连接'))
      })

      this.currentDownloadRequest = request
    })
  }

  /** 从 URL 中提取文件名 */
  private extractFileName(url: string): string {
    try {
      const urlObj = new URL(url)
      const pathname = urlObj.pathname
      const fileName = pathname.split('/').pop()
      return fileName || ''
    } catch {
      return ''
    }
  }

  /** 根据平台获取安装包扩展名 */
  private getInstallerExtension(): string {
    switch (process.platform) {
      case 'win32': return 'exe'
      case 'darwin': return 'dmg'
      case 'linux': return 'AppImage'
      default: return 'bin'
    }
  }

  async quitAndInstall(): Promise<void> {
    if (this.status.status !== 'downloaded') {
      throw new Error('Update not downloaded')
    }

    // 自定义下载的安装包（后端来源）：直接启动安装程序并退出应用
    if (this.downloadedInstallerPath) {
      const installerPath = this.downloadedInstallerPath
      logger.system.info(`[Updater] Launching installer: ${installerPath}`)

      try {
        if (process.platform === 'linux') {
          // Linux AppImage 需要可执行权限
          fs.chmodSync(installerPath, 0o755)
        }

        // 打开安装包（Windows: NSIS .exe, macOS: .dmg, Linux: .AppImage）
        // shell.openPath 返回 Promise<string>，空字符串表示成功
        const errorMsg = await shell.openPath(installerPath)
        if (errorMsg) {
          logger.system.error(`[Updater] Failed to open installer: ${errorMsg}`)
          throw new Error(`无法启动安装程序: ${errorMsg}`)
        }

        logger.system.info('[Updater] Installer launched, quitting app...')
        // 延迟退出，确保安装程序已启动
        setTimeout(() => {
          // 标记自动更新退出，before-quit 走快速清理路径杀死子进程，释放文件锁
          markAutoUpdateQuit()
          app.quit()
        }, 500)
      } catch (err) {
        logger.system.error('[Updater] Failed to launch installer:', err)
        throw err
      }
      return
    }

    if (this.status.requiresManualDownload) {
      throw new Error('当前安装方式不支持自动安装。')
    }

    autoUpdater.autoInstallOnAppQuit = true
    logger.system.info('[Updater] Initiating quit and install...')

    setTimeout(() => {
      // 标记自动更新退出，before-quit 走快速清理路径杀死子进程，释放文件锁
      // 否则 NSIS 安装器卸载旧版本时文件仍被子进程锁定，导致卸载失败
      markAutoUpdateQuit()
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
    // 取消正在进行的下载
    if (this.currentDownloadRequest) {
      this.currentDownloadRequest.destroy()
      this.currentDownloadRequest = null
    }
    // 清理下载的临时文件
    if (this.downloadedInstallerPath) {
      try { fs.unlinkSync(this.downloadedInstallerPath) } catch { /* ignore */ }
      this.downloadedInstallerPath = null
    }
    // 重置幂等标志，允许 destroy 后重新 initialize（测试/重启场景）
    this.isInitialized = false
    // 移除 electron-updater 所有事件监听，防止内存泄漏
    autoUpdater.removeAllListeners()
    this.mainWindow = null
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
