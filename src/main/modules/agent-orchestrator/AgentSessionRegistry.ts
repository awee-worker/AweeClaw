/**
 * 会话注册表 — 保存主进程持有的编排状态与观察者
 *
 * 与流订阅表的分工：
 * - 流订阅表回答「这一路 token 该发给谁」
 * - 本表回答「这场会话进行到哪一步、谁在关注它的状态变化」
 *
 * 两者都按 ID 组织，但生命周期不同：一路流跑完即消失，一场会话会保留到
 * 被显式清除，供窗口重开后回看。
 */

import { webContents } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import type {
  AgentSessionEvent,
  AgentSessionState,
  AgentSessionSummary,
} from './types'

class AgentSessionRegistry {
  private readonly sessions = new Map<string, AgentSessionState>()
  private readonly observers = new Map<string, Set<number>>()

  register(state: AgentSessionState): void {
    this.sessions.set(state.sessionId, state)
  }

  get(sessionId: string): AgentSessionState | undefined {
    return this.sessions.get(sessionId)
  }

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  list(): AgentSessionSummary[] {
    const list: AgentSessionSummary[] = []
    for (const state of this.sessions.values()) {
      list.push({
        sessionId: state.sessionId,
        status: state.status,
        label: state.label,
        turnCount: state.turns.length,
        startedAt: state.startedAt,
        updatedAt: state.updatedAt,
        error: state.error,
      })
    }
    return list.sort((a, b) => b.startedAt - a.startedAt)
  }

  /** 会话终态后清理，释放消息链占用的内存 */
  remove(sessionId: string): void {
    this.sessions.delete(sessionId)
    this.observers.delete(sessionId)
  }

  /** 会话是否仍在进行（用于拒绝重复启动） */
  isActive(sessionId: string): boolean {
    const state = this.sessions.get(sessionId)
    if (!state) return false
    return state.status === 'running' || state.status === 'waiting-tool'
  }

  addObserver(sessionId: string, webContentsId: number): void {
    let set = this.observers.get(sessionId)
    if (!set) {
      set = new Set()
      this.observers.set(sessionId, set)
    }
    set.add(webContentsId)
  }

  removeObserver(sessionId: string, webContentsId: number): void {
    this.observers.get(sessionId)?.delete(webContentsId)
  }

  observersOf(sessionId: string): number[] {
    return [...(this.observers.get(sessionId) ?? [])]
  }

  /** 某窗口观察的全部会话（窗口关闭时清理） */
  sessionsObservedBy(webContentsId: number): string[] {
    const matched: string[] = []
    for (const [sessionId, set] of this.observers) {
      if (set.has(webContentsId)) matched.push(sessionId)
    }
    return matched
  }

  dropWindow(webContentsId: number): void {
    for (const set of this.observers.values()) {
      set.delete(webContentsId)
    }
  }

  /**
   * 广播会话事件
   *
   * 投递时顺手剔除已销毁的窗口，避免观察者集合随窗口开关膨胀。
   */
  emit(sessionId: string, event: AgentSessionEvent): void {
    const targets = this.observers.get(sessionId)
    if (!targets || targets.size === 0) return

    const channel = `agent:event:${sessionId}`
    for (const id of [...targets]) {
      const wc = webContents.fromId(id)
      if (!wc || wc.isDestroyed()) {
        targets.delete(id)
        continue
      }
      try {
        wc.send(channel, event)
      } catch (error) {
        logger.agent.error('[AgentSessionRegistry] 事件投递失败:', error)
      }
    }
  }

  clear(): void {
    this.sessions.clear()
    this.observers.clear()
  }
}

export const agentSessionRegistry = new AgentSessionRegistry()
export { AgentSessionRegistry }
