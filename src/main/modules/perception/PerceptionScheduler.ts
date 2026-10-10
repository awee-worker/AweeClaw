/**
 * 感知采集调度器 — 补齐"感知预测"功能缺失的数据采集闭环
 *
 * 职责：
 * - 定时（默认 60s）执行一次屏幕感知采集：
 *   截图（DesktopControlManager.captureScreen）
 *   → OCR 提取文本（MacVisionOcrRouter，非 macOS 或不可用时降级为窗口标题摘要）
 *   → 生成本地嵌入向量（LocalEmbedder）
 *   → 写入 screen_scenes 表（PerceptionStore.saveScreenScene）
 * - 检测活跃窗口变化，自动记录一条 app_switch 类型行为（BehaviorPredictor.recordBehavior），
 *   让 user_behaviors 表持续积累样本，供行为预测检索使用
 * - 监听隐私配置热更新（enablePerception / channels.screen / retentionDays 等），自动启停
 * - 每小时执行一次 retentionDays 过期数据清理（对齐 MonitoringService 风格）
 *
 * 门控规则：
 * - enablePerception=false → 整个调度器不启动
 * - channels.screen=false → 跳过截图采集，仅保留行为记录能力（如果有其他来源）
 * - privacyMode=true → 不写入任何数据到磁盘，仅做内存摘要（与 PerceptionStore 现有约束一致）
 *
 * 容错：
 * - 截图/OCR/嵌入任一环节失败不影响其他环节，降级为"窗口标题摘要"
 * - 所有外部依赖（DesktopControlManager / MacVisionOcrRouter / LocalEmbedder）均做
 *   延迟 import + try/catch，避免主进程启动期依赖未就绪时抛错
 *
 * @module perception/PerceptionScheduler
 */

import { logger } from '@shared/toolkit/LogEngine'
import { PerceptionStore } from './PerceptionStore'
import { BehaviorPredictor } from './BehaviorPredictor'
import type { ScreenActivity, ScreenScene, PerceptionPrivacyConfig } from './PerceptionInterface'
import { generatePerceptionId } from './PerceptionInterface'

// ============================================================
// 常量
// ============================================================

/** 默认采集间隔（毫秒）：60 秒 */
const DEFAULT_CAPTURE_INTERVAL_MS = 60_000

/** 过期数据清理定时器间隔（毫秒）：1 小时（对齐 MonitoringService） */
const RETENTION_CLEANUP_INTERVAL_MS = 60 * 60 * 1000

/** OCR 文本摘要最大长度（避免超长文本拖慢嵌入计算） */
const MAX_TEXT_SUMMARY_LENGTH = 500

// ============================================================
// 调度器
// ============================================================

/**
 * 感知采集调度器（单例）
 *
 * 使用方式：
 * ```ts
 * const scheduler = PerceptionScheduler.getInstance()
 * scheduler.start()
 * // 配置变化时：
 * scheduler.onConfigUpdated()
 * // 应用退出时：
 * scheduler.stop()
 * ```
 */
export class PerceptionScheduler {
  private static instance: PerceptionScheduler | null = null

  /** 采集定时器 */
  private captureTimer: NodeJS.Timeout | null = null

  /** 保留期清理定时器 */
  private retentionTimer: NodeJS.Timeout | null = null

  /** 是否正在执行一次采集（防止重入） */
  private capturing = false

  /** 上一次采集到的窗口标题（用于检测窗口切换） */
  private lastWindowTitle: string | null = null

  /** 最近一次采集的屏幕场景 ID（供行为记录关联 sceneId 使用） */
  private lastCapturedSceneId: string | null = null

  private running = false

  private constructor() {
    // 无副作用，依赖全部在方法里懒获取
  }

  /** 获取单例 */
  static getInstance(): PerceptionScheduler {
    if (!PerceptionScheduler.instance) {
      PerceptionScheduler.instance = new PerceptionScheduler()
    }
    return PerceptionScheduler.instance
  }

  // ============================================================
  // 生命周期
  // ============================================================

  /**
   * 启动调度器
   *
   * 内部会立即检查一次隐私配置，满足条件才真正启动定时器。
   * 若条件不满足（感知总开关未开等），不会启动定时器，但保留
   * 保留期清理定时器（与数据保留策略相关，不受感知开关影响）。
   */
  start(): void {
    if (this.running) return
    this.running = true

    // 保留期清理定时器：无条件启动（只要 store 初始化成功就会清理，避免数据无限膨胀）
    this.retainTimer()

    // 采样定时器：仅在配置满足条件时启动
    this.syncCaptureTimer()

    logger.perception?.info('[PerceptionScheduler] 调度器已启动')
  }

  /** 停止调度器 */
  stop(): void {
    this.running = false
    this.stopTimers()
    logger.perception?.info('[PerceptionScheduler] 调度器已停止')
  }

  /**
   * 配置热更新入口
   *
   * 供 `PerceptionStore.updatePrivacyConfig()` 或 IPC 层在配置变化时调用，
   * 根据最新配置决定是否启停采集定时器。
   */
  onConfigUpdated(): void {
    if (!this.running) return
    this.syncCaptureTimer()
  }

  /** 销毁（应用退出时调用） */
  dispose(): void {
    this.stop()
    PerceptionScheduler.instance = null
  }

  // ============================================================
  // 配置检查
  // ============================================================

  /** 当前配置是否允许执行截图采集 */
  private shouldCapture(): boolean {
    const config: PerceptionPrivacyConfig = PerceptionStore.getInstance().getPrivacyConfig()
    return Boolean(
      config.enablePerception
        && config.channels.screen
        && !config.privacyMode,
    )
  }

  /** 当前配置是否允许记录行为（不要求截图通道开启，行为本身来源更广泛） */
  private shouldRecordBehavior(): boolean {
    const config: PerceptionPrivacyConfig = PerceptionStore.getInstance().getPrivacyConfig()
    return Boolean(config.enablePerception && !config.privacyMode)
  }

  /** 根据当前配置同步采集定时器的启停状态 */
  private syncCaptureTimer(): void {
    if (this.shouldCapture()) {
      this.startCaptureTimer()
    } else {
      this.stopCaptureTimer()
    }
  }

  // ============================================================
  // 定时器管理
  // ============================================================

  private startCaptureTimer(): void {
    if (this.captureTimer) return
    this.captureTimer = setInterval(() => {
      this.captureOnce().catch((e) => {
        logger.perception?.error('[PerceptionScheduler] 采集失败:', e)
      })
    }, DEFAULT_CAPTURE_INTERVAL_MS)
    logger.perception?.info(
      `[PerceptionScheduler] 采集定时器已启动（间隔 ${DEFAULT_CAPTURE_INTERVAL_MS / 1000}s）`,
    )
  }

  private stopCaptureTimer(): void {
    if (this.captureTimer) {
      clearInterval(this.captureTimer)
      this.captureTimer = null
      logger.perception?.info('[PerceptionScheduler] 采集定时器已停止')
    }
  }

  private retainTimer(): void {
    if (this.retentionTimer) return
    this.retentionTimer = setInterval(() => {
      this.cleanupRetention().catch((e) => {
        logger.perception?.warn('[PerceptionScheduler] 保留期清理失败:', e)
      })
    }, RETENTION_CLEANUP_INTERVAL_MS)
  }

  private stopTimers(): void {
    this.stopCaptureTimer()
    if (this.retentionTimer) {
      clearInterval(this.retentionTimer)
      this.retentionTimer = null
    }
  }

  // ============================================================
  // 核心采集逻辑
  // ============================================================

  /**
   * 执行一次完整的感知采集周期
   *
   * 流程：
   * 1. 截图
   * 2. 获取活跃窗口信息（用于活动类型推断 + 窗口切换行为记录）
   * 3. OCR 提取文本摘要（失败降级为窗口标题）
   * 4. 生成嵌入向量
   * 5. 写入 screen_scenes
   * 6. 若检测到窗口切换，记录一条 app_switch 行为
   */
  async captureOnce(): Promise<void> {
    if (this.capturing) return
    this.capturing = true

    try {
      // 1. 截图
      const screenshot = await this.captureScreenshot()

      // 2. 获取活跃窗口信息
      const { app, windowTitle, activity } = await this.getActiveWindowInfo()

      // 3. OCR 提取文本摘要（失败时降级为窗口标题）
      const textSummary = await this.buildTextSummary(screenshot, windowTitle)

      // 4. 生成嵌入向量
      const embedder = await this.getEmbedder()
      const embedding = embedder ? await embedder.embed(textSummary) : []

      // 5. 组装场景并写入
      const sceneId = generatePerceptionId('scene')
      const scene: ScreenScene = {
        id: sceneId,
        timestamp: Date.now(),
        app,
        windowTitle,
        activity,
        textSummary: textSummary.slice(0, MAX_TEXT_SUMMARY_LENGTH),
        embedding,
      }

      const saved = await PerceptionStore.getInstance().saveScreenScene(scene)
      if (saved) {
        this.lastCapturedSceneId = sceneId
        logger.perception?.debug(
          `[PerceptionScheduler] 场景已保存: ${sceneId} app=${app} activity=${activity}`,
        )
      }

      // 6. 检测窗口切换 → 记录行为
      if (windowTitle && this.lastWindowTitle && windowTitle !== this.lastWindowTitle) {
        if (this.shouldRecordBehavior()) {
          await this.recordAppSwitch(app, windowTitle, activity)
        }
      }
      this.lastWindowTitle = windowTitle
    } catch (e) {
      logger.perception?.warn('[PerceptionScheduler] 采集周期异常:', e instanceof Error ? e.message : String(e))
    } finally {
      this.capturing = false
    }
  }

  /** 截图（失败返回 null，不抛错） */
  private async captureScreenshot(): Promise<{ dataUrl: string } | null> {
    try {
      const { getDesktopControlManager } = await import('../desktop-control/DesktopControlManager')
      const result = await getDesktopControlManager().captureScreen(0)
      if (!result.success) return null
      return { dataUrl: result.dataUrl }
    } catch (e) {
      logger.perception?.debug('[PerceptionScheduler] 截图不可用:', e instanceof Error ? e.message : String(e))
      return null
    }
  }

  /**
   * 获取活跃窗口信息（app / windowTitle / activity）
   *
   * 使用 BrowserWindow.getFocusedWindow() 获取当前聚焦窗口；
   * 若无聚焦窗口（全部最小化或系统级切换中），降级使用主窗口信息。
   */
  private async getActiveWindowInfo(): Promise<{ app: string; windowTitle: string; activity: ScreenActivity }> {
    try {
      const { BrowserWindow } = await import('electron')
      const focused =
        BrowserWindow.getFocusedWindow() ??
        BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ??
        null

      if (!focused) {
        return { app: 'Unknown', windowTitle: '', activity: 'idle' as ScreenActivity }
      }

      const title = focused.getTitle() || 'Untitled'
      const app = focused.webContents.getURL().includes('aweeclaw')
        ? 'AweeClaw'
        : 'Unknown'
      const activity = this.inferActivityFromWindow(focused, title)

      return { app, windowTitle: title, activity }
    } catch (e) {
      logger.perception?.debug('[PerceptionScheduler] 获取活跃窗口失败:', e instanceof Error ? e.message : String(e))
      return { app: 'Unknown', windowTitle: '', activity: 'unknown' as ScreenActivity }
    }
  }

  /** 根据窗口标题和 URL 推断活动类型 */
  private inferActivityFromWindow(win: { getTitle(): string; webContents: { getURL(): string } }, title: string): ScreenActivity {
    const url = win.webContents.getURL()
    const lower = `${title} ${url}`.toLowerCase()

    if (lower.includes('terminal') || lower.includes('iterm') || lower.includes('zsh') || lower.includes('bash')) {
      return 'coding'
    }
    if (lower.includes('code') || lower.includes('vscode') || lower.includes('idea') || lower.includes('xcode')) {
      return 'coding'
    }
    if (lower.includes('safari') || lower.includes('chrome') || lower.includes('edge') || lower.includes('firefox')) {
      return 'browsing'
    }
    if (lower.includes('slack') || lower.includes('wechat') || lower.includes('telegram') || lower.includes('discord')) {
      return 'chatting'
    }
    if (lower.includes('doc') || lower.includes('page') || lower.includes('notes') || lower.includes('readme')) {
      return 'writing'
    }
    return 'unknown'
  }

  /**
   * 构建文本摘要
   *
   * 优先使用 OCR 结果；OCR 不可用或结果为空时降级为窗口标题。
   */
  private async buildTextSummary(
    screenshot: { dataUrl: string } | null,
    fallbackWindowTitle: string,
  ): Promise<string> {
    if (screenshot && screenshot.dataUrl) {
      const ocrText = await this.runOcr(screenshot.dataUrl)
      if (ocrText) return ocrText
    }
    // 降级：使用窗口标题
    return fallbackWindowTitle || 'Unknown scene'
  }

  /** 调用 macOS Vision OCR（失败返回空字符串，不抛错） */
  private async runOcr(dataUrl: string): Promise<string> {
    try {
      const { macVisionOcrRouter } = await import('../desktop-control/MacVisionOcrRouter')
      const available = await macVisionOcrRouter.isAvailable()
      if (!available) return ''

      // dataUrl 格式：data:image/jpeg;base64,xxx
      const base64 = dataUrl.split(',').pop() ?? ''
      const items = await macVisionOcrRouter.recognize(base64)
      if (items.length === 0) return ''

      // 取置信度最高的前 20 条，拼接为摘要
      const top = items
        .filter((i) => i.confidence > 0.3)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 20)
        .map((i) => i.text.trim())
        .filter(Boolean)

      return top.join(' ')
    } catch (e) {
      logger.perception?.debug('[PerceptionScheduler] OCR 不可用，降级为窗口标题:', e instanceof Error ? e.message : String(e))
      return ''
    }
  }

  /** 获取 LocalEmbedder 实例（不可用时返回 null） */
  private async getEmbedder(): Promise<{ embed: (text: string) => Promise<number[]> } | null> {
    try {
      const { LocalEmbedder } = await import('./LocalEmbedder')
      const embedder = LocalEmbedder.getInstance()
      await embedder.load()
      return embedder
    } catch (e) {
      logger.perception?.debug('[PerceptionScheduler] 嵌入模型不可用:', e instanceof Error ? e.message : String(e))
      return null
    }
  }

  /** 记录一次应用/窗口切换行为 */
  private async recordAppSwitch(app: string, windowTitle: string, activity: ScreenActivity): Promise<void> {
    if (!this.shouldRecordBehavior()) return

    const sceneText = `${app} | ${windowTitle}`
    try {
      await BehaviorPredictor.getInstance().recordBehavior({
        sceneId: this.lastCapturedSceneId ?? undefined,
        sceneText,
        app,
        activity,
        action: { type: 'app_switch', target: windowTitle },
        outcome: 'success',
      })
      logger.perception?.debug(`[PerceptionScheduler] 记录窗口切换: ${app} → ${windowTitle}`)
    } catch (e) {
      logger.perception?.debug('[PerceptionScheduler] 记录行为失败:', e instanceof Error ? e.message : String(e))
    }
  }

  // ============================================================
  // 保留期清理
  // ============================================================

  /** 执行一次过期数据清理 */
  private async cleanupRetention(): Promise<void> {
    try {
      const store = PerceptionStore.getInstance()
      if (!store.isReady()) return
      await store.cleanupExpiredData()
    } catch (e) {
      logger.perception?.debug('[PerceptionScheduler] 保留期清理跳过:', e instanceof Error ? e.message : String(e))
    }
  }
}
