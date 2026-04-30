/**
 * 情绪建议 → 可操作 Action 系统
 *
 * 把情绪检测产生的建议绑定到真实操作上：
 *  - ai_fix:      调 AI 修复当前文件错误
 *  - ask_ai:      打开 Chat 面板并预填问题
 *  - take_break:  显示休息提醒 overlay
 *  - focus_mode:  隐藏侧栏/终端/调试面板，进入专注
 *  - switch_theme: 切换到适合当前情绪的主题
 */

import { useStore } from '@/renderer/store'
import { useAgentStore } from '@/renderer/agent/store/AgentStore'
import { useDiagnosticsStore } from '@/renderer/services/diagnosticsStore'
import { EventBus } from '../core/EventBus'
import type { EmotionDetection } from '../types/emotion'

// ===== Action 类型 =====
export type EmotionActionType =
  | 'ai_fix'
  | 'ask_ai'
  | 'take_break'
  | 'focus_mode'
  | 'switch_theme'

export interface EmotionActionDef {
  type: EmotionActionType
  label: string
  emoji: string
  execute: () => void
}

// ===== Action 执行器 =====

const actions: Record<EmotionActionType, () => EmotionActionDef> = {

  ai_fix: () => ({
    type: 'ai_fix',
    label: 'AI 修复',
    emoji: '🔧',
    execute: () => {
      const activeFile = useStore.getState().activeFilePath
      const diagState = useDiagnosticsStore.getState()

      if (!activeFile) return

      // 收集当前文件的错误信息
      const fileDiags = diagState.diagnostics.get(activeFile) || []
      const errors = fileDiags
        .filter((d: { severity?: number }) => d.severity === 1)
        .slice(0, 5)
        .map((d: { message?: string; range?: { start?: { line?: number } } }) =>
          `Line ${(d.range?.start?.line ?? 0) + 1}: ${d.message || 'Error'}`
        )

      const prompt = errors.length > 0
        ? `请帮我修复当前文件 \`${activeFile.split('/').pop()}\` 中的错误：\n\n${errors.join('\n')}`
        : `请帮我检查当前文件 \`${activeFile.split('/').pop()}\` 是否有问题`

      // 打开 Chat 面板并预填 prompt
      useAgentStore.getState().setInputPrompt(prompt)
      useStore.getState().setChatVisible(true)
    },
  }),

  ask_ai: () => ({
    type: 'ask_ai',
    label: '问 AI',
    emoji: '💬',
    execute: () => {
      useAgentStore.getState().setInputPrompt('')
      useStore.getState().setChatVisible(true)
    },
  }),

  take_break: () => ({
    type: 'take_break',
    label: '休息一下',
    emoji: '☕',
    execute: () => {
      EventBus.emit({
        type: 'break:suggested',
        message: '站起来活动一下，看看远处，让大脑放松 🧘',
      })
    },
  }),

  focus_mode: () => ({
    type: 'focus_mode',
    label: '专注模式',
    emoji: '🎯',
    execute: () => {
      const store = useStore.getState()
      // 隐藏侧栏、终端
      store.setActiveSidePanel(null)
      if (store.setTerminalVisible) store.setTerminalVisible(false)
      if (store.setDebugVisible) store.setDebugVisible(false)
    },
  }),

  switch_theme: () => ({
    type: 'switch_theme',
    label: '切换主题',
    emoji: '🎨',
    execute: () => {
      const store = useStore.getState()
      if (store.setTheme) {
        // 根据当前主题轮换
        const themes = ['aweeclaw-dark', 'midnight', 'dawn', 'cyberpunk'] as const
        const current = store.currentTheme || 'aweeclaw-dark'
        const idx = themes.indexOf(current as typeof themes[number])
        const next = themes[(idx + 1) % themes.length]
        store.setTheme(next)
      }
    },
  }),
}

/**
 * 根据当前情绪状态和检测结果，推荐最合适的操作
 */
export function getRecommendedActions(
  detection: EmotionDetection,
): EmotionActionDef[] {
  const result: EmotionActionDef[] = []
  const state = detection.state

  // 有真实 LSP 错误 → 推荐 AI 修复
  if (detection.context?.hasErrors) {
    result.push(actions.ai_fix())
  }

  // 沮丧/压力 → 推荐问 AI + 休息
  if (state === 'frustrated' || state === 'stressed') {
    if (!detection.context?.hasErrors) result.push(actions.ask_ai())
    result.push(actions.take_break())
  }

  // 疲劳 → 推荐休息 + 切主题提神
  if (state === 'tired') {
    result.push(actions.take_break())
    result.push(actions.switch_theme())
  }

  // 无聊 → 推荐切主题 + 问 AI 找点事做
  if (state === 'bored') {
    result.push(actions.switch_theme())
    result.push(actions.ask_ai())
  }

  // 专注/心流 → 推荐专注模式
  if (state === 'focused' || state === 'flow') {
    result.push(actions.focus_mode())
  }

  // 最多返回 2 个
  return result.slice(0, 2)
}

