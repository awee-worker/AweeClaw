/**
 * 迷你聊天工具审批协调器
 *
 * 功能：与普通聊天窗口的 ToolApprovalCoordinator（toolOrchestrator.ts）保持一致的审批流程，
 * 但完全独立于 Zustand store，适用于悬浮头像窗口（独立渲染进程）。
 *
 * 工作流程：
 * 1. executeMiniChatToolCall 检查 requiresApproval → 需要审批时调用 waitForApproval()
 * 2. 本服务通知订阅者（useAvatarMiniChat）有新的待审批工具
 * 3. MiniChatPanel 渲染审批卡片，用户点击批准/拒绝
 * 4. 调用 approve()/reject() 解除 Promise 等待
 * 5. 工具继续执行或返回"用户拒绝了此操作"
 *
 * 线程安全：所有方法均可在异步上下文中安全调用。
 */

import { logger } from '@toolkit/LogEngine'
import { isDangerousCommand } from '@shared/configuration/dangerousCommands'
import { getToolApprovalType, isWriteTool } from '@configuration/toolDefinitions'
import type { ApprovalGateToolInfo } from '@intelligence/engine/toolOrchestrator'

// ============================================
// 类型定义
// ============================================

/** 授权方式（与主窗口 store 中的 authorizationMode 一致） */
export type AuthorizationMode = 'every-step' | 'dangerous-only' | 'never'

/** 待审批工具调用信息（传递给 UI 展示） */
export interface PendingApprovalToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
  requestId: string
}

/** 待审批状态变更回调 */
type PendingApprovalListener = (pending: PendingApprovalToolCall[]) => void

// ============================================
// 审批协调器
// ============================================

class MiniChatApprovalCoordinator {
  /** 等待审批的 Promise 解析器映射：key = `${requestId}_${toolCallId}` */
  private pendingResolves = new Map<string, (approved: boolean) => void>()
  /** 当前等待审批的工具调用列表（用于 UI 展示） */
  private pendingList: PendingApprovalToolCall[] = []
  /** 状态变更订阅者 */
  private listeners = new Set<PendingApprovalListener>()

  /**
   * 检查工具是否需要审批（store 独立版本）
   *
   * 与 toolOrchestrator.ts 的 requiresApprovalGate 逻辑一致，
   * 但 authorizationMode 由参数传入，不依赖 Zustand store。
   *
   * @param toolCall 工具调用信息
   * @param authorizationMode 授权方式（来自 voiceContext）
   * @param chatMode 聊天模式（'agent' / 'chat'）
   * @returns 是否需要审批
   */
  checkApprovalNeeded(
    toolCall: ApprovalGateToolInfo,
    authorizationMode: AuthorizationMode | undefined,
    chatMode?: string,
  ): boolean {
    // chat 模式（纯对话无工具副作用）始终不审批
    if (chatMode === 'chat') return false

    const toolName = toolCall.name
    const approvalType = getToolApprovalType(toolName)

    // authorizationMode 有值时，成为工具审批的唯一开关
    if (authorizationMode !== undefined) {
      if (authorizationMode === 'never') {
        // 无需确认：所有操作免 UI 审批
        return false
      }
      if (authorizationMode === 'dangerous-only') {
        // 危险确认：危险操作 + 危险命令需审批
        if (approvalType === 'dangerous') return true
        if (toolName === 'run_command') {
          const command = toolCall.arguments?.command as string | undefined
          if (command && isDangerousCommand(command)) return true
        }
        return false
      }
      if (authorizationMode === 'every-step') {
        // 每步确认：所有有副作用操作都审批；纯读不审批
        return approvalType !== 'none' || isWriteTool(toolName)
      }
      // 未知模式兜底：需审批（更安全）
      return true
    }

    // authorizationMode 未设置时：默认需要审批（安全优先）
    // 与主窗口 store 的回退逻辑不同，这里不依赖 autoApprove/freeModeEnabled
    // 因为迷你聊天窗口无法访问主窗口的 store 状态
    return approvalType === 'terminal' || approvalType === 'dangerous'
  }

  /**
   * 等待用户审批
   *
   * @param toolCallId 工具调用 ID
   * @param requestId 请求 ID
   * @param toolCallInfo 工具调用信息（用于 UI 展示）
   * @returns 用户是否批准
   */
  async waitForApproval(
    toolCallId: string,
    requestId: string,
    toolCallInfo: Omit<PendingApprovalToolCall, 'requestId'>,
  ): Promise<boolean> {
    const key = `${requestId}_${toolCallId}`
    const pendingEntry: PendingApprovalToolCall = {
      ...toolCallInfo,
      requestId,
    }

    logger.agent.info(
      `[MiniApproval] Waiting for approval: ${key} (tool: ${toolCallInfo.name}), ` +
        `currentQueueSize=${this.pendingList.length}`,
    )

    return new Promise<boolean>((resolve) => {
      this.pendingResolves.set(key, resolve)
      this.pendingList = [...this.pendingList, pendingEntry]
      this.notifyListeners()
    })
  }

  /**
   * 批准指定工具调用
   * @param toolCallId 工具调用 ID
   * @param requestId 请求 ID
   */
  approve(toolCallId: string, requestId: string): void {
    const key = `${requestId}_${toolCallId}`
    const resolve = this.pendingResolves.get(key)

    if (resolve) {
      logger.agent.info(`[MiniApproval] Approved: ${key}`)
      resolve(true)
      this.pendingResolves.delete(key)
      this.removeFromPendingList(toolCallId, requestId)
    } else {
      // 精确匹配失败，尝试前缀匹配
      const matchedKey = this.findMatchingKey(toolCallId, requestId)
      if (matchedKey) {
        logger.agent.info(`[MiniApproval] Approved (prefix matched): ${matchedKey}`)
        this.pendingResolves.get(matchedKey)?.(true)
        this.pendingResolves.delete(matchedKey)
        const entry = this.pendingList.find(
          (e) => e.id === toolCallId || this.keyMatches(e, toolCallId, requestId),
        )
        if (entry) this.removeFromPendingList(entry.id, entry.requestId)
      } else {
        logger.agent.warn(`[MiniApproval] approve(${key}): no matching pending request`)
      }
    }
  }

  /**
   * 拒绝指定工具调用
   * @param toolCallId 工具调用 ID
   * @param requestId 请求 ID
   */
  reject(toolCallId: string, requestId: string): void {
    const key = `${requestId}_${toolCallId}`
    const resolve = this.pendingResolves.get(key)

    if (resolve) {
      logger.agent.info(`[MiniApproval] Rejected: ${key}`)
      resolve(false)
      this.pendingResolves.delete(key)
      this.removeFromPendingList(toolCallId, requestId)
    } else {
      const matchedKey = this.findMatchingKey(toolCallId, requestId)
      if (matchedKey) {
        logger.agent.info(`[MiniApproval] Rejected (prefix matched): ${matchedKey}`)
        this.pendingResolves.get(matchedKey)?.(false)
        this.pendingResolves.delete(matchedKey)
        const entry = this.pendingList.find(
          (e) => e.id === toolCallId || this.keyMatches(e, toolCallId, requestId),
        )
        if (entry) this.removeFromPendingList(entry.id, entry.requestId)
      } else {
        logger.agent.warn(`[MiniApproval] reject(${key}): no matching pending request`)
      }
    }
  }

  /** 批准所有待审批工具 */
  approveAll(): void {
    logger.agent.info(`[MiniApproval] Approve all: ${this.pendingList.length} tools`)
    for (const entry of this.pendingList) {
      const key = `${entry.requestId}_${entry.id}`
      this.pendingResolves.get(key)?.(true)
      this.pendingResolves.delete(key)
    }
    this.pendingList = []
    this.notifyListeners()
  }

  /** 拒绝所有待审批工具 */
  rejectAll(): void {
    logger.agent.info(`[MiniApproval] Reject all: ${this.pendingList.length} tools`)
    for (const entry of this.pendingList) {
      const key = `${entry.requestId}_${entry.id}`
      this.pendingResolves.get(key)?.(false)
      this.pendingResolves.delete(key)
    }
    this.pendingList = []
    this.notifyListeners()
  }

  /** 获取当前待审批列表（快照） */
  getPending(): PendingApprovalToolCall[] {
    return [...this.pendingList]
  }

  /** 待审批数量 */
  get pendingCount(): number {
    return this.pendingList.length
  }

  /** 订阅待审批状态变更 */
  subscribe(listener: PendingApprovalListener): () => void {
    this.listeners.add(listener)
    // 立即推送当前状态
    listener(this.getPending())
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 清空所有待审批（用于组件卸载或对话重置） */
  clear(): void {
    if (this.pendingList.length > 0) {
      logger.agent.info(
        `[MiniApproval] Clearing ${this.pendingList.length} pending approvals`,
      )
    }
    for (const entry of this.pendingList) {
      const key = `${entry.requestId}_${entry.id}`
      // 清空时默认拒绝，避免 Promise 永远挂起
      this.pendingResolves.get(key)?.(false)
      this.pendingResolves.delete(key)
    }
    this.pendingList = []
    this.notifyListeners()
  }

  // ===== 内部方法 =====

  private removeFromPendingList(toolCallId: string, requestId: string): void {
    this.pendingList = this.pendingList.filter(
      (e) => !(e.id === toolCallId && e.requestId === requestId),
    )
    this.notifyListeners()
  }

  private notifyListeners(): void {
    const snapshot = this.getPending()
    for (const listener of this.listeners) {
      try {
        listener(snapshot)
      } catch (err) {
        logger.agent.error('[MiniApproval] Listener error:', err)
      }
    }
  }

  private findMatchingKey(toolCallId: string, requestId: string): string | null {
    for (const key of this.pendingResolves.keys()) {
      if (key.startsWith(requestId) || key.includes(toolCallId)) {
        return key
      }
    }
    return null
  }

  private keyMatches(
    entry: PendingApprovalToolCall,
    toolCallId: string,
    requestId: string,
  ): boolean {
    return (
      entry.id === toolCallId ||
      entry.requestId === requestId ||
      `${entry.requestId}_${entry.id}`.includes(toolCallId)
    )
  }
}

/** 迷你聊天审批协调器单例（悬浮头像窗口内使用） */
export const miniChatApprovalService = new MiniChatApprovalCoordinator()
