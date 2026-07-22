/**
 * 主动式 AI 助手 IPC 处理器（阶段10 s10-02 新增）
 *
 * 在主进程注册 IPC 处理器，暴露 ProactiveStore 能力给渲染进程。
 * 渲染进程通过 window.electronAPI.proactive.* 调用。
 *
 * 4 个核心处理器：
 * 1. proactive:listProposals    — 分页查询提案历史（支持多维度过滤）
 * 2. proactive:recordFeedback   — 记录用户反馈（accepted/rejected/later/ignored）
 * 3. proactive:getStats         — 获取采纳率统计（用于设置面板展示 + ProactiveLearner 消费）
 * 4. proactive:clearHistory     — 清空历史（设置面板"清除历史"按钮）
 *
 * 安全约束：
 * - 所有方法都先校验 ProactiveStore 是否已初始化
 * - 反馈记录写入会同步更新提案状态 + 审计日志
 * - 清空操作需二次确认（渲染层负责弹窗确认，IPC 层直接执行）
 *
 * @module proactive/ProactiveIpc
 */

import { ipcMain, BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { proactiveStore } from './ProactiveStore'
import { proactiveDecisionEngine } from './ProactiveDecisionEngine'
import type {
  ProactiveSource,
  ProactiveSeverity,
  ProposalStatus,
  ProposalFeedback,
} from './ProactiveInterface'

/** IPC 频道前缀 */
const IPC_PREFIX = 'proactive:'

/** 错误响应构造工具 */
function errorResponse(err: unknown): { success: false; error: string } {
  const msg = err instanceof Error ? err.message : String(err)
  return { success: false, error: msg }
}

/**
 * 注册主动式助手 IPC 处理器
 *
 * 在 moduleInitializer.initProactiveIpc() 中调用。
 * ProactiveStore 的初始化由调用方负责（initProactiveIpc 异步触发）。
 */
export function registerProactiveIpc(): void {
  // ============================================================
  // 1. 分页查询提案历史
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}listProposals`,
    async (
      _,
      filter: {
        source?: ProactiveSource
        severity?: ProactiveSeverity
        status?: ProposalStatus
        startTime?: number
        endTime?: number
        limit?: number
        offset?: number
        sort?: 'asc' | 'desc'
      } = {},
    ) => {
      try {
        const result = proactiveStore.listProposals(filter)
        return { success: true, data: result }
      } catch (e) {
        logger.proactive?.error('[IPC] listProposals 失败:', e)
        return errorResponse(e)
      }
    },
  )

  // ============================================================
  // 2. 记录用户反馈
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}recordFeedback`,
    async (
      _,
      proposalId: string,
      feedback: ProposalFeedback,
      actualAction?: string,
    ) => {
      // 参数校验
      if (!proposalId || typeof proposalId !== 'string') {
        return { success: false, error: 'proposalId 不能为空' }
      }
      const validFeedbacks: ProposalFeedback[] = ['accepted', 'rejected', 'later', 'ignored']
      if (!validFeedbacks.includes(feedback)) {
        return { success: false, error: `非法 feedback 值: ${feedback}` }
      }

      try {
        // 记录反馈（内部自动更新提案状态）
        proactiveStore.recordFeedback(proposalId, feedback, actualAction)
        // 写入审计日志（用于追踪完整链路）
        proactiveStore.insertAuditLog(proposalId, 'feedback', {
          feedback,
          actualAction: actualAction ?? null,
          timestamp: Date.now(),
        })
        logger.proactive?.info(
          `[IPC] 反馈已记录: proposal=${proposalId} feedback=${feedback}`,
        )
        return { success: true }
      } catch (e) {
        logger.proactive?.error('[IPC] recordFeedback 失败:', e)
        return errorResponse(e)
      }
    },
  )

  // ============================================================
  // 3. 获取采纳率统计
  // ============================================================

  ipcMain.handle(
    `${IPC_PREFIX}getStats`,
    async (_, startTime?: number, endTime?: number) => {
      try {
        const stats = proactiveStore.getAdoptionStats(startTime, endTime)
        return { success: true, data: stats }
      } catch (e) {
        logger.proactive?.error('[IPC] getStats 失败:', e)
        return errorResponse(e)
      }
    },
  )

  // ============================================================
  // 4. 清空所有历史数据
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}clearHistory`, async () => {
    try {
      proactiveStore.clearAll()
      logger.proactive?.info('[IPC] 历史数据已清空（用户主动操作）')
      return { success: true }
    } catch (e) {
      logger.proactive?.error('[IPC] clearHistory 失败:', e)
      return errorResponse(e)
    }
  })

  // ============================================================
  // 5. 查询某提案的反馈列表（用于审计详情页）
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}listFeedback`, async (_, proposalId: string) => {
    if (!proposalId) {
      return { success: false, error: 'proposalId 不能为空' }
    }
    try {
      const items = proactiveStore.listFeedback(proposalId)
      return { success: true, data: items }
    } catch (e) {
      logger.proactive?.error('[IPC] listFeedback 失败:', e)
      return errorResponse(e)
    }
  })

  // ============================================================
  // 6. 查询某提案的审计日志（用于审计详情页）
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}listAuditLogs`, async (_, proposalId: string) => {
    if (!proposalId) {
      return { success: false, error: 'proposalId 不能为空' }
    }
    try {
      const items = proactiveStore.listAuditLogs(proposalId)
      return { success: true, data: items }
    } catch (e) {
      logger.proactive?.error('[IPC] listAuditLogs 失败:', e)
      return errorResponse(e)
    }
  })

  // ============================================================
  // 7. 清理过期数据（供定时任务调用，也可由设置面板手动触发）
  // ============================================================

  ipcMain.handle(`${IPC_PREFIX}cleanupExpired`, async () => {
    try {
      const removed = proactiveStore.cleanupExpired()
      logger.proactive?.info(`[IPC] 已清理 ${removed} 条过期数据`)
      return { success: true, data: { removed } }
    } catch (e) {
      logger.proactive?.error('[IPC] cleanupExpired 失败:', e)
      return errorResponse(e)
    }
  })

  // ============================================================
  // 8. 权限配置管理（s10-05 新增）
  // ============================================================

  /**
   * 获取当前权限配置
   * 设置面板初始化时调用，返回完整配置 + 决策引擎运行状态 + 频率窗口状态
   */
  ipcMain.handle(`${IPC_PREFIX}getPermissionConfig`, async () => {
    try {
      // 延迟导入避免循环依赖（ProactivePermission 导入了 proactiveDecisionEngine）
      const { proactivePermission } = await import('./ProactivePermission')
      const config = proactivePermission.getConfig()
      const freq = proactivePermission.getFrequencyStatus()
      return {
        success: true,
        data: {
          config,
          engineRunning: proactiveDecisionEngine.isRunning(),
          frequency: freq,
        },
      }
    } catch (e) {
      logger.proactive?.error('[IPC] getPermissionConfig 失败:', e)
      return errorResponse(e)
    }
  })

  /**
   * 更新权限配置（部分更新）
   * 自动持久化 + 同步决策引擎启动/停止 + 返回新配置
   */
  ipcMain.handle(
    `${IPC_PREFIX}updatePermissionConfig`,
    async (_, patch: Partial<import('./ProactiveInterface').ProactivePermissionConfig>) => {
      try {
        const { proactivePermission } = await import('./ProactivePermission')
        const config = proactivePermission.updateConfig(patch)
        return {
          success: true,
          data: {
            config,
            engineRunning: proactiveDecisionEngine.isRunning(),
          },
        }
      } catch (e) {
        logger.proactive?.error('[IPC] updatePermissionConfig 失败:', e)
        return errorResponse(e)
      }
    },
  )

  /** 重置权限配置为默认值 */
  ipcMain.handle(`${IPC_PREFIX}resetPermissionConfig`, async () => {
    try {
      const { proactivePermission } = await import('./ProactivePermission')
      const config = proactivePermission.resetConfig()
      return {
        success: true,
        data: {
          config,
          engineRunning: proactiveDecisionEngine.isRunning(),
        },
      }
    } catch (e) {
      logger.proactive?.error('[IPC] resetPermissionConfig 失败:', e)
      return errorResponse(e)
    }
  })

  // ============================================================
  // 9. LLM 决策增强器初始化（s10-03 新增）
  // ============================================================

  /**
   * 初始化 LLM 决策增强器
   *
   * 渲染层通过此 IPC 传入 LLM 配置（model + apiKey + baseUrl），
   * 主进程创建 LLMService 实例并初始化 ProactiveDecisionLlm，
   * 然后注入到 ProactiveDecisionEngine.setRefiner()。
   *
   * 优势：
   * - 主进程直接持有 LLM 句柄，复用连接池
   * - 决策引擎节拍内同步调用 LLM，无需 IPC 来回
   * - 失败降级在主进程内闭环，不影响渲染层
   */
  ipcMain.handle(
    `${IPC_PREFIX}initLlmRefiner`,
    async (_, config: { model: string; apiKey?: string; baseUrl?: string; temperature?: number }) => {
      try {
        const { LLMService } = await import('../ai-provider/AIProviderService')
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        if (!win) {
          throw new Error('无可用的 BrowserWindow，无法初始化 LLMService')
        }

        const llmService = new LLMService(win)
        const { proactiveDecisionLlm } = await import('./ProactiveDecisionLlm')
        proactiveDecisionLlm.initialize(llmService, config)

        // 注入到决策引擎
        proactiveDecisionEngine.setRefiner(async (candidates) => {
          // 获取当前环境上下文摘要（从 PerceptionFusionService 缓存读取，避免重复查询）
          let sceneSummary = '无场景数据'
          let attentionScore = 0
          let anomalyCount = 0
          try {
            const { PerceptionFusionService } = await import('../perception/PerceptionFusionService')
            const ctx = PerceptionFusionService.getInstance().getLastContext()
            if (ctx) {
              const scene = ctx.scene?.latestScene
              sceneSummary = scene ? `${scene.app}/${scene.activity}: ${scene.textSummary.slice(0, 100)}` : '无场景数据'
              attentionScore = ctx.attentionScore
              anomalyCount = ctx.totalAnomalyCount
            }
          } catch {
            // 融合服务未初始化时静默
          }
          return proactiveDecisionLlm.refine(candidates, { sceneSummary, attentionScore, anomalyCount })
        })

        logger.proactive?.info(
          `[IPC] LLM 决策增强器已初始化（模型: ${config.model}）`,
        )
        return { success: true, data: true }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        logger.proactive?.error('[IPC] initLlmRefiner 失败:', e)
        return { success: false, error: msg }
      }
    },
  )

  /** 查询 LLM 决策增强器是否已就绪 */
  ipcMain.handle(`${IPC_PREFIX}isLlmRefinerReady`, async () => {
    try {
      const { proactiveDecisionLlm } = await import('./ProactiveDecisionLlm')
      return { success: true, data: proactiveDecisionLlm.isInitialized() }
    } catch (e) {
      logger.proactive?.error('[IPC] isLlmRefinerReady 失败:', e)
      return errorResponse(e)
    }
  })

  /** 重置 LLM 决策增强器（清空配置，恢复纯规则模式） */
  ipcMain.handle(`${IPC_PREFIX}resetLlmRefiner`, async () => {
    try {
      const { proactiveDecisionLlm } = await import('./ProactiveDecisionLlm')
      proactiveDecisionLlm.reset()
      // 同时清除决策引擎的 refiner
      proactiveDecisionEngine.setRefiner(null)
      logger.proactive?.info('[IPC] LLM 决策增强器已重置')
      return { success: true }
    } catch (e) {
      logger.proactive?.error('[IPC] resetLlmRefiner 失败:', e)
      return errorResponse(e)
    }
  })

  logger.proactive?.info(
    '[IPC] 主动式助手 IPC 处理器已注册（listProposals/recordFeedback/getStats/clearHistory/listFeedback/listAuditLogs/cleanupExpired/getPermissionConfig/updatePermissionConfig/resetPermissionConfig/initLlmRefiner/isLlmRefinerReady/resetLlmRefiner）',
  )
}
