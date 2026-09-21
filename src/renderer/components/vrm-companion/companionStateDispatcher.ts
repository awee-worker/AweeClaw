/**
 * 伴侣状态表达下发
 *
 * 把状态映射得到的表达经 IPC 送到伴侣窗口，并管理用户对主动行为的开关。
 *
 * 与 companionStateMapping 的分工：
 * - mapping 只做「状态 → 表达」的纯转换，可单独验证
 * - 本模块承担 IPC 与开关持久化，是唯一有副作用的一层
 *
 * 打扰边界：动作与表情属于状态可视化，默认开启；
 * 语音会打断当前声音环境，默认关闭，由用户显式打开。
 */

import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@shared/toolkit/LogEngine'
import { StorageService } from '@shared/toolkit/StorageService'
import {
  buildStateCommands,
  reactionForAgentState,
  type CompanionAgentState,
} from './companionStateMapping'

/** 表达开关的存储键 */
const EXPRESSION_ENABLED_KEY = 'companion-state-expression-enabled'
const VOICE_ENABLED_KEY = 'companion-state-voice-enabled'

/** 状态表达是否开启（动作与表情） */
export function isExpressionEnabled(): boolean {
  try {
    const stored = StorageService.get<boolean>(EXPRESSION_ENABLED_KEY)
    return stored === null || stored === undefined ? true : stored
  } catch {
    return true
  }
}

export function setExpressionEnabled(enabled: boolean): void {
  try {
    StorageService.set(EXPRESSION_ENABLED_KEY, enabled)
  } catch {
    // 持久化失败不影响当前会话
  }
}

/** 状态语音播报是否开启 */
export function isStateVoiceEnabled(): boolean {
  try {
    return StorageService.get<boolean>(VOICE_ENABLED_KEY) === true
  } catch {
    return false
  }
}

export function setStateVoiceEnabled(enabled: boolean): void {
  try {
    StorageService.set(VOICE_ENABLED_KEY, enabled)
  } catch {
    // 持久化失败不影响当前会话
  }
}

/**
 * 下发一次状态表达
 *
 * 失败时静默返回 false：伴侣窗口可能没打开，这属于正常情况，
 * 状态可视化不应该影响主流程。
 */
export async function dispatchCompanionState(
  state: CompanionAgentState,
  language: 'zh' | 'en' = 'zh',
): Promise<boolean> {
  if (!isExpressionEnabled()) return false

  const commands = buildStateCommands(reactionForAgentState(state, language), {
    includeVoice: isStateVoiceEnabled(),
  })
  if (commands.length === 0) return false

  let delivered = false
  for (const command of commands) {
    try {
      const result = await api.vrmCompanion.sendCommand(command)
      delivered = delivered || Boolean(result?.data?.delivered)
    } catch (err) {
      logger.agent.debug('[Companion] 状态表达下发失败：', err)
    }
  }

  return delivered
}
