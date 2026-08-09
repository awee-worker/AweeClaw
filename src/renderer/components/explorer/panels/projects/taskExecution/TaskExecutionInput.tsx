/**
 * TaskExecutionInput — 任务执行输入区
 *
 * 轻量输入框，支持：
 * - 多行文本输入（textarea 自适应高度）
 * - Enter 发送 / Shift+Enter 换行
 * - 流式时切换为"停止"按钮（abort）
 * - 空内容禁用发送
 *
 * 与 ChatPanel composer 的区别：
 * - 不集成 @mention / slash 命令 / 文件附件 / 模式切换
 * - 保持极简，专注任务对话的连续追问
 */
import { useCallback, useEffect, useRef } from 'react'
import { Send, Square } from 'lucide-react'

interface TaskExecutionInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onAbort: () => void
  isStreaming: boolean
  isZh: boolean
}

/** 输入框最大高度（超出后滚动） */
const MAX_HEIGHT = 120
/** 输入框最小高度 */
const MIN_HEIGHT = 36

export function TaskExecutionInput({
  value, onChange, onSubmit, onAbort, isStreaming, isZh,
}: TaskExecutionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  /** 自适应高度：根据内容调整 textarea 高度，限制最大值 */
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = `${MIN_HEIGHT}px`
    const newHeight = Math.min(el.scrollHeight, MAX_HEIGHT)
    el.style.height = `${newHeight}px`
  }, [])

  useEffect(() => {
    adjustHeight()
  }, [value, adjustHeight])

  /** 键盘事件：Enter 发送，Shift+Enter 换行 */
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (!isStreaming && value.trim()) {
        onSubmit()
      }
    }
  }, [isStreaming, value, onSubmit])

  const canSend = !isStreaming && value.trim().length > 0

  return (
    <div className="flex-shrink-0 px-3 py-2.5 border-t border-border/30 bg-surface/20">
      <div className="flex items-end gap-2 bg-background/60 rounded-lg border border-border/40 focus-within:border-accent/40 transition-colors px-2.5 py-1.5">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isZh ? '输入消息继续对话...' : 'Type a message to continue...'}
          rows={1}
          className="flex-1 bg-transparent text-[13px] text-text-primary outline-none resize-none placeholder:text-text-muted/60 leading-relaxed overflow-y-auto"
          style={{ minHeight: `${MIN_HEIGHT}px`, maxHeight: `${MAX_HEIGHT}px` }}
          disabled={isStreaming}
        />
        {isStreaming ? (
          <button
            onClick={onAbort}
            className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md bg-red-500/15 text-red-500 hover:bg-red-500/25 transition-colors"
            title={isZh ? '停止' : 'Stop'}
          >
            <Square className="w-3.5 h-3.5 fill-current" />
          </button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={!canSend}
            className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-md bg-accent text-white hover:bg-accent/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title={isZh ? '发送' : 'Send'}
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
