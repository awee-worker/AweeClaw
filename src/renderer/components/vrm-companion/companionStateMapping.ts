/**
 * 伴侣状态表达
 *
 * 把 Agent 的执行状态映射为桌面伴侣的动作与表情，让用户不打开对话框
 * 也能看出「正在干活 / 卡住了 / 在等确认」。
 *
 * 调用位置说明：本模块由主窗口（Agent 所在进程）调用，指令经 IPC 送到
 * 伴侣窗口。两个窗口是不同的 JS 上下文，不能靠内存事件传递状态。
 *
 * 打扰边界：动作与表情属于状态可视化，默认开启；
 * 语音会打断当前声音环境，默认关闭，由用户显式打开。
 */

import type { VrmCompanionCommand } from '@renderer/types/electronBridge'

/** Agent 状态 */
export type CompanionAgentState =
  | 'idle'
  | 'working'
  | 'awaiting_approval'
  | 'completed'
  | 'blocked'

/** 一次状态表达 */
export interface CompanionReaction {
  /** 动作名或语义别名 */
  action?: string
  /** 表情名 */
  expression?: string
  /** 播报文本（仅在开启语音时下发） */
  speak?: string
}

/** 状态 → 表达映射（中英文案随语言切换） */
export function reactionForAgentState(
  state: CompanionAgentState,
  language: 'zh' | 'en' = 'zh',
): CompanionReaction {
  const isZh = language === 'zh'

  switch (state) {
    case 'working':
      return { action: 'think', expression: 'neutral' }

    case 'awaiting_approval':
      return {
        action: 'wave',
        expression: 'surprised',
        speak: isZh ? '有一条操作在等你确认。' : 'An action is waiting for your confirmation.',
      }

    case 'completed':
      return {
        action: 'peace',
        expression: 'happy',
        speak: isZh ? '这一步完成了。' : 'Step completed.',
      }

    case 'blocked':
      return {
        action: 'think',
        expression: 'sad',
        speak: isZh ? '遇到问题，需要你看一下。' : 'Hit an issue that needs your attention.',
      }

    case 'idle':
    default:
      return { expression: 'neutral' }
  }
}

/** 把表达拆成一条条可下发的指令，按「先表情、后动作、再说话」排序 */
export function buildStateCommands(
  reaction: CompanionReaction,
  options: { includeVoice: boolean } = { includeVoice: false },
): VrmCompanionCommand[] {
  const commands: VrmCompanionCommand[] = []

  if (reaction.expression) {
    commands.push({ type: 'expression', name: reaction.expression })
  }
  if (reaction.action) {
    commands.push({ type: 'play_action', name: reaction.action })
  }
  if (options.includeVoice && reaction.speak) {
    commands.push({ type: 'speak', text: reaction.speak })
  }

  return commands
}


