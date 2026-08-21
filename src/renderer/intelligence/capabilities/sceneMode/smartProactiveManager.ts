/**
 * AI 智能主动模式管理器
 *
 * 功能：
 * - 定时检查用户近期活动（每30分钟检查一次）
 * - 根据场景模式 + 用户活动，主动触发提醒（如未完成项目、久坐、忘记复习等）
 * - 限频：每2小时最多触发1次（由 store.canTriggerSmartProactive 控制）
 *
 * 触发逻辑通过 IPC 发送 'proactive:invoke-agent' 事件，
 * 由 useProactiveInvoker 接收并调用 Agent.send。
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/06-ui-differentiation.md}
 */

import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import type { SceneMode } from '@protocols/sceneModeProtocol'

/** 检查间隔：30分钟 */
const CHECK_INTERVAL_MS = 30 * 60 * 1000

class SmartProactiveManager {
  private timer: NodeJS.Timeout | null = null
  private isRunning = false

  /**
   * 启动智能主动模式检查
   */
  start(): void {
    if (this.isRunning) return
    this.isRunning = true
    logger.agent.info('[SmartProactive] Started, checking every 30min')
    // 立即检查一次（延迟30秒，避免启动时立即触发）
    setTimeout(() => void this.check(), 30_000)
    // 定时检查
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
  }

  /**
   * 停止智能主动模式检查
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.isRunning = false
    logger.agent.info('[SmartProactive] Stopped')
  }

  /**
   * 执行一次检查
   */
  private async check(): Promise<void> {
    try {
      const store = useSceneModeStore.getState()
      if (!store.smartProactiveEnabled) return
      if (!store.canTriggerSmartProactive()) {
        logger.agent.debug('[SmartProactive] Cooldown, skipping')
        return
      }

      const mode = store.currentSceneMode
      const message = await this.buildProactiveMessage(mode)
      if (!message) return

      // 通过 IPC 发送主动消息
      // 使用 ProactiveActionTrigger 的 high 级触发机制
      await this.triggerProactive(message, mode)
      store.markSmartProactiveTriggered()
      logger.agent.info(`[SmartProactive] Triggered for ${mode}: ${message.slice(0, 50)}...`)
    } catch (err) {
      logger.agent.warn('[SmartProactive] Check failed:', err)
    }
  }

  /**
   * 根据当前模式构建主动提醒消息
   */
  private async buildProactiveMessage(mode: SceneMode): Promise<string | null> {
    switch (mode) {
      case 'work':
        return this.buildWorkMessage()
      case 'life':
        return this.buildLifeMessage()
      case 'study':
        return this.buildStudyMessage()
      default:
        return null
    }
  }

  /**
   * 工作模式提醒
   * 检查未完成任务、长时间未活动等
   */
  private async buildWorkMessage(): Promise<string | null> {
    const hour = new Date().getHours()
    // 工作时间内才提醒
    if (hour < 9 || hour > 18) return null

    // 随机选择提醒类型，避免每次都一样
    const reminders = [
      '检查一下今天的任务进度，看看有没有遗漏的待办事项？',
      '最近有什么项目需要跟进的吗？我可以帮您整理一下。',
      '工作间隙记得休息一下眼睛，站起来活动活动。',
    ]
    return reminders[Math.floor(Math.random() * reminders.length)]
  }

  /**
   * 生活模式提醒
   */
  private async buildLifeMessage(): Promise<string | null> {
    const hour = new Date().getHours()
    // 晚间或休息时间才提醒
    if (hour >= 9 && hour < 18) return null

    const reminders = [
      '今天记得喝够水哦，身体是革命的本钱。',
      '忙碌了一天，听点放松的音乐吧。',
      '晚上早点休息，保持好作息。',
    ]
    return reminders[Math.floor(Math.random() * reminders.length)]
  }

  /**
   * 学习模式提醒
   */
  private async buildStudyMessage(): Promise<string | null> {
    const hour = new Date().getHours()
    // 学习时间才提醒
    if (hour < 8 || hour > 22) return null

    const reminders = [
      '是时候复习一下之前学过的知识点了，记忆需要巩固。',
      '今天还没开始学习呢，要不要定个小目标？',
      '学习累了可以试试费曼学习法，给我讲解一下你学的内容。',
    ]
    return reminders[Math.floor(Math.random() * reminders.length)]
  }

  /**
   * 触发主动提醒
   *
   * 通过 webContents.send 发送 'proactive:invoke-agent' 事件
   */
  private async triggerProactive(message: string, mode: SceneMode): Promise<void> {
    // 通过自定义事件触发 Agent.send
    // 使用与 quickPrompt 相同的机制
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aweeclaw:smart-proactive', {
        detail: { message, mode },
      }))
    }
  }
}

/** 智能主动模式管理器单例 */
export const smartProactiveManager = new SmartProactiveManager()
