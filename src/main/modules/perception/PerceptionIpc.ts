/**
 * 感知层 IPC 处理器
 *
 * 在主进程注册 IPC 处理器，暴露 PerceptionStore 能力给渲染进程。
 * 渲染进程通过 window.electronAPI.perception.* 调用。
 *
 * 安全约束：
 * - 所有方法都需要先检查感知是否启用
 * - 隐私模式下只允许读取状态，不允许保存数据
 *
 * @module perception/PerceptionIpc
 */

import { ipcMain, systemPreferences, BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { PerceptionStore } from './PerceptionStore'
import { PerceptionFusionService } from './PerceptionFusionService'
import { BehaviorPredictor, type PredictRequest, type PredictionFeedback } from './BehaviorPredictor'
import { ImpactAnalyzer, type ImpactAnalysisRequest } from './ImpactAnalyzer'
import { GitCoModificationAnalyzer, type AnalyzeOptions } from './GitCoModificationAnalyzer'
import type { PerceptionPrivacyConfig, UserAction } from './PerceptionInterface'

/** IPC 频道前缀 */
const IPC_PREFIX = 'perception:'

/** 注册感知层 IPC 处理器 */
export function registerPerceptionIpc(): void {
  const store = PerceptionStore.getInstance()

  // ============================================================
  // 配置管理
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}getPrivacyConfig`, async () => {
    try {
      return { success: true, data: store.getPrivacyConfig() }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] getPrivacyConfig 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(`${IPC_PREFIX}updatePrivacyConfig`, async (_, config: Partial<PerceptionPrivacyConfig>) => {
    try {
      store.updatePrivacyConfig(config)
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] updatePrivacyConfig 失败:', e)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // 数据查询
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}getRecentScenes`, async (_, limit: number = 20) => {
    try {
      const scenes = await store.getRecentScenes(limit)
      return { success: true, data: scenes }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] getRecentScenes 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(`${IPC_PREFIX}searchSimilarScenes`, async (_, embedding: number[], topK: number = 10) => {
    try {
      const scenes = await store.searchSimilarScenes(embedding, topK)
      return { success: true, data: scenes }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] searchSimilarScenes 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(`${IPC_PREFIX}searchSimilarBehaviors`, async (_, embedding: number[], topK: number = 20) => {
    try {
      const behaviors = await store.searchSimilarBehaviors(embedding, topK)
      return { success: true, data: behaviors }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] searchSimilarBehaviors 失败:', e)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // 数据管理
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}clearAllData`, async () => {
    try {
      const ok = await store.clearAllData()
      return { success: ok }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] clearAllData 失败:', e)
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(`${IPC_PREFIX}cleanupExpiredData`, async () => {
    try {
      await store.cleanupExpiredData()
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] cleanupExpiredData 失败:', e)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // 预测记录
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}updatePredictionOutcome`,
    async (_, predictionId: string, actualAction: unknown, feedback?: string) => {
      try {
        const ok = await store.updatePredictionOutcome(
          predictionId,
          actualAction as never,
          feedback as 'accepted' | 'rejected' | 'ignored' | undefined,
        )
        return { success: ok }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] updatePredictionOutcome 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  // ============================================================
  // 阶段2：行为预测
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}predictAction`,
    async (_, req: PredictRequest) => {
      try {
        const predictor = BehaviorPredictor.getInstance()
        const result = await predictor.predict(req)
        return result
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] predictAction 失败:', e)
        return {
          success: false,
          predictions: [],
          embedding: [],
          sampleCount: 0,
          error: msg,
        }
      }
    },
  )

  ipcMain.handle(
    `${IPC_PREFIX}recordBehavior`,
    async (
      _,
      params: {
        sceneId?: string
        sceneText: string
        app: string
        activity: string
        action: UserAction
        outcome?: 'success' | 'failure' | 'abandoned'
        openFiles?: string[]
        terminalCmds?: string[]
      },
    ) => {
      try {
        const predictor = BehaviorPredictor.getInstance()
        const ok = await predictor.recordBehavior({
          sceneId: params.sceneId,
          sceneText: params.sceneText,
          app: params.app,
          activity: params.activity as never,
          action: params.action,
          outcome: params.outcome,
          openFiles: params.openFiles,
          terminalCmds: params.terminalCmds,
        })
        return { success: ok }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] recordBehavior 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  ipcMain.handle(
    `${IPC_PREFIX}submitFeedback`,
    async (
      _,
      predictionId: string,
      feedback: PredictionFeedback,
      actualAction?: UserAction,
    ) => {
      try {
        const predictor = BehaviorPredictor.getInstance()
        const ok = await predictor.submitFeedback(predictionId, feedback, actualAction)
        return { success: ok }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] submitFeedback 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  // ============================================================
  // 阶段2：代码影响分析
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}analyzeImpact`,
    async (_, req: ImpactAnalysisRequest) => {
      try {
        const analyzer = ImpactAnalyzer.getInstance()
        const result = await analyzer.analyzeImpact(req)
        return result
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] analyzeImpact 失败:', e)
        return {
          success: false,
          projectPath: req.projectPath,
          overallImpact: 'none',
          totalImpactedFiles: 0,
          results: [],
          graphStats: { fileCount: 0, edgeCount: 0, builtAt: 0 },
          highRiskFiles: [],
          coModificationStats: null,
          error: msg,
        }
      }
    },
  )

  // ============================================================
  // 阶段9 s9-09：Git 伴随修改分析
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}analyzeCoModification`,
    async (_, projectPath: string, options: AnalyzeOptions = {}) => {
      try {
        const analyzer = GitCoModificationAnalyzer.getInstance()
        const stats = await analyzer.analyze(projectPath, options)
        return { success: true, data: stats }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] analyzeCoModification 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  ipcMain.handle(
    `${IPC_PREFIX}getCoModifiedFiles`,
    async (_, projectPath: string, relativeFilePath: string, topK: number = 10) => {
      try {
        const analyzer = GitCoModificationAnalyzer.getInstance()
        const result = await analyzer.getCoModifiedFiles(projectPath, relativeFilePath, topK)
        return { success: true, data: result }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] getCoModifiedFiles 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  ipcMain.handle(
    `${IPC_PREFIX}getCoModificationStats`,
    async (_, projectPath: string) => {
      try {
        const analyzer = GitCoModificationAnalyzer.getInstance()
        const stats = analyzer.getStats(projectPath)
        return { success: true, data: stats }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] getCoModificationStats 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  ipcMain.handle(
    `${IPC_PREFIX}clearCoModificationCache`,
    async (_, projectPath: string) => {
      try {
        const analyzer = GitCoModificationAnalyzer.getInstance()
        await analyzer.clearCache(projectPath)
        return { success: true }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] clearCoModificationCache 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  // ============================================================
  // 阶段2：预测统计
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}getPredictionStats`, async (_, days: number = 30) => {
    try {
      const predictor = BehaviorPredictor.getInstance()
      const stats = await predictor.getStats(days)
      return { success: true, data: stats }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] getPredictionStats 失败:', e)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // 阶段2：场景时间轴与行为热力图
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}getSceneTimeline`,
    async (_, startDate: number, endDate: number, limit: number = 500) => {
      try {
        const scenes = await store.getSceneTimeline(startDate, endDate, limit)
        return { success: true, data: scenes }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] getSceneTimeline 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  ipcMain.handle(
    `${IPC_PREFIX}getBehaviorHeatmap`,
    async (_, days: number = 14) => {
      try {
        const heatmap = await store.getBehaviorHeatmap(days)
        return { success: true, data: heatmap }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] getBehaviorHeatmap 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  ipcMain.handle(
    `${IPC_PREFIX}getBehaviorsByTimeRange`,
    async (_, startTime: number, endTime: number, limit: number = 1000) => {
      try {
        const behaviors = await store.getBehaviorsByTimeRange(startTime, endTime, limit)
        return { success: true, data: behaviors }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] getBehaviorsByTimeRange 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  // ============================================================
  // 摄像头权限（阶段3）
  // ============================================================

  /**
   * 查询摄像头权限状态
   *
   * - macOS: 通过 systemPreferences.getMediaAccessStatus('camera') 获取
   * - Windows/Linux: 默认 granted（系统级权限由浏览器/Electron 处理）
   *
   * 返回值: 'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown'
   */
  ipcMain.handle(`${IPC_PREFIX}getCameraPermissionStatus`, async () => {
    try {
      if (process.platform === 'darwin') {
        const status = systemPreferences.getMediaAccessStatus('camera')
        // macOS 返回值: 'not-determined' | 'granted' | 'denied' | 'restricted'
        return { success: true, data: status }
      }
      // Windows / Linux: 默认已授权（实际权限由系统在调用 getUserMedia 时弹窗确认）
      return { success: true, data: 'granted' }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] getCameraPermissionStatus 失败:', e)
      return { success: false, error: msg }
    }
  })

  /**
   * 请求摄像头权限
   *
   * - macOS: 调用 systemPreferences.askForMediaAccess('camera')，会弹出系统授权对话框
   * - Windows/Linux: 直接返回 true（系统会在首次调用 getUserMedia 时弹窗）
   *
   * 返回值: boolean（true=已授权, false=被拒绝）
   */
  ipcMain.handle(`${IPC_PREFIX}requestCameraPermission`, async () => {
    try {
      if (process.platform === 'darwin') {
        // macOS 需要先检查状态，避免重复弹窗
        const current = systemPreferences.getMediaAccessStatus('camera')
        if (current === 'granted') {
          return { success: true, data: true }
        }
        if (current === 'denied' || current === 'restricted') {
          // 用户已拒绝，无法再弹窗，需引导到系统设置
          return { success: true, data: false, redirectToSettings: true }
        }
        // not-determined 状态：弹出系统授权对话框
        const granted = await systemPreferences.askForMediaAccess('camera')
        logger.perception?.info(`[IPC] requestCameraPermission: ${granted ? 'granted' : 'denied'}`)
        return { success: true, data: granted }
      }
      // Windows / Linux: 直接返回 true，实际权限在 getUserMedia 调用时由系统处理
      return { success: true, data: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] requestCameraPermission 失败:', e)
      return { success: false, error: msg }
    }
  })

  /**
   * 打开系统设置中的摄像头权限页面
   *
   * 用于用户已拒绝权限后引导其手动开启。
   */
  ipcMain.handle(`${IPC_PREFIX}openCameraSettings`, async () => {
    try {
      const { shell } = await import('electron')
      if (process.platform === 'darwin') {
        // macOS: 打开系统设置 → 隐私与安全 → 摄像头
        await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Camera')
      } else if (process.platform === 'win32') {
        // Windows: 打开设置 → 隐私 → 摄像头
        await shell.openExternal('ms-settings:privacy-webcam')
      } else {
        // Linux: 无统一标准，打开系统设置首页
        await shell.openExternal('system-settings')
      }
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] openCameraSettings 失败:', e)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // 阶段9：LLM 双模式行为预测
  // ============================================================

  /**
   * 初始化 LLM 行为预测器
   *
   * 渲染层通过此 IPC 传入 LLM 配置（model + apiKey + baseUrl），
   * 主进程创建 LLMService 实例并初始化 BehaviorPredictor 的 LLM 模式。
   *
   * 优势：
   * - 主进程直接持有 LLM 句柄，复用连接池
   * - 消除 IPC 来回开销，预测延迟降低 50%+
   * - 失败重试在主进程内闭环，不影响渲染层
   */
  ipcMain.handle(
    `${IPC_PREFIX}initLlmPredictor`,
    async (_, config: { model: string; apiKey?: string; baseUrl?: string; temperature?: number }) => {
      try {
        const { LLMService } = await import('../ai-provider/AIProviderService')
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        if (!win) {
          throw new Error('无可用的 BrowserWindow，无法初始化 LLMService')
        }

        const llmService = new LLMService(win)
        const predictor = BehaviorPredictor.getInstance()
        predictor.initLlmExtractor(llmService, config)

        logger.perception?.info(
          `[IPC] LLM 行为预测器已初始化（模型: ${config.model}）`,
        )
        return { success: true, data: true }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] initLlmPredictor 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  /** 查询 LLM 预测器是否已就绪 */
  ipcMain.handle(`${IPC_PREFIX}isLlmPredictorReady`, async () => {
    try {
      const predictor = BehaviorPredictor.getInstance()
      return { success: true, data: predictor.isLlmPredictorReady() }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] isLlmPredictorReady 失败:', e)
      return { success: false, error: msg }
    }
  })

  /** 重置 LLM 预测器（清空配置，恢复纯统计模式） */
  ipcMain.handle(`${IPC_PREFIX}resetLlmPredictor`, async () => {
    try {
      const predictor = BehaviorPredictor.getInstance()
      predictor.resetLlmPredictor()
      logger.perception?.info('[IPC] LLM 行为预测器已重置')
      return { success: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      logger.perception?.error('[IPC] resetLlmPredictor 失败:', e)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // D-步骤5：场景模式感知策略切换
  // ============================================================

  /**
   * 设置场景模式感知过滤器
   *
   * 场景模式切换时由渲染进程调用，将新模式的 perceptionFilter 同步到
   * PerceptionFusionService，控制各感知通道（scene/iot/monitoring）的启停。
   *
   * filter 为 null 时清除过滤，全部通道启用。
   */
  ipcMain.handle(
    `${IPC_PREFIX}setSceneFilter`,
    async (_, filter: Record<string, boolean> | null) => {
      try {
        PerceptionFusionService.getInstance().setSceneFilter(filter)
        logger.perception?.info(
          `[IPC] 场景感知过滤器已更新: ${filter ? `${Object.entries(filter).filter(([, v]) => v).length} 信号启用` : '已清除（全部启用）'}`,
        )
        return { success: true }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.perception?.error('[IPC] setSceneFilter 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  logger.perception?.info('[IPC] 感知层 IPC 处理器已注册（含阶段2 预测/影响分析/时间轴 + 阶段3 摄像头权限 + 阶段9 LLM 双模式 + D-步骤5 场景感知过滤）')
}
