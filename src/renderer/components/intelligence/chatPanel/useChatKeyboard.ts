/**
 * 聊天键盘处理 Hook
 * 统一管理输入框键盘事件，包括发送、Mention 导航、IME 处理
 */
import { useCallback } from 'react'
import { keybindingService } from '@services/keybindingAdapter'

interface UseChatKeyboardParams {
  showFileMention: boolean
  setShowFileMention: (show: boolean) => void
  setMentionQuery: (query: string) => void
  onSubmit: () => void
}

export function useChatKeyboard({
  showFileMention,
  setShowFileMention,
  setMentionQuery,
  onSubmit,
}: UseChatKeyboardParams) {
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 忽略 IME 组合状态中的按键
      if (e.nativeEvent.isComposing) return

      if (showFileMention) {
        if (keybindingService.matches(e, 'list.cancel')) {
          e.preventDefault()
          setShowFileMention(false)
          setMentionQuery('')
        }
        if (['Enter', 'ArrowUp', 'ArrowDown', 'Tab'].includes(e.key)) {
          e.preventDefault()
          return
        }
      }

      if (keybindingService.matches(e, 'chat.send')) {
        e.preventDefault()
        onSubmit()
      }
    },
    [showFileMention, setShowFileMention, setMentionQuery, onSubmit],
  )

  return { handleKeyDown }
}
