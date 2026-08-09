/**
 * PromptOverlay — 全局输入弹窗
 *
 * 背景：Electron 渲染进程默认禁用 window.prompt()，调用会抛
 * "prompt() is not supported"。本组件提供等价的 Promise 化输入弹窗，
 * API 风格与 globalDecide 一致，可在任意位置（含非 React 上下文）调用。
 *
 * 用法：
 *   const name = await globalPrompt({ title: '新建文件', defaultValue: 'untitled.txt' })
 *   if (name === null) return  // 用户取消
 *
 * 实现模式：照搬 DecisionOverlay 的全局 setState + Promise resolver 方案。
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { Edit3 } from 'lucide-react'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { OverlayDialog } from '../ui/OverlayDialog'
import { ActionButton } from '../ui/ActionButton'

export interface PromptOptions {
  /** 弹窗标题 */
  title?: string
  /** 提示文案 */
  message?: string
  /** 输入框默认值 */
  defaultValue?: string
  /** 输入框 placeholder */
  placeholder?: string
  /** 确认按钮文字 */
  confirmText?: string
  /** 取消按钮文字 */
  cancelText?: string
}

interface PromptState {
  isOpen: boolean
  options: PromptOptions | null
}

// 全局 resolver + setState（与 globalDecide 同模式）
let globalResolve: ((value: string | null) => void) | null = null
let globalSetState: ((state: PromptState) => void) | null = null

/**
 * 全局输入弹窗 UI 组件（需在应用根节点挂载一次）
 */
export function GlobalPromptOverlay() {
  const [state, setState] = useState<PromptState>({
    isOpen: false,
    options: null,
  })
  const inputRef = useRef<HTMLInputElement>(null)
  const language = useStore(s => s.language) as Language

  useEffect(() => {
    globalSetState = setState
    return () => { globalSetState = null }
  }, [])

  // 打开时聚焦并选中默认值
  useEffect(() => {
    if (state.isOpen) {
      // 延迟一帧确保 DOM 已挂载
      requestAnimationFrame(() => {
        const input = inputRef.current
        if (input) {
          input.focus()
          input.select()
        }
      })
    }
  }, [state.isOpen])

  const handleConfirm = useCallback(() => {
    const value = inputRef.current?.value ?? ''
    globalResolve?.(value)
    globalResolve = null
    setState({ isOpen: false, options: null })
  }, [])

  const handleCancel = useCallback(() => {
    globalResolve?.(null)
    globalResolve = null
    setState({ isOpen: false, options: null })
  }, [])

  // Enter 确认 / Esc 取消（OverlayDialog 已处理 Esc 关闭，这里补 Enter）
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleConfirm()
    }
  }, [handleConfirm])

  if (!state.options) return null

  const { title, message, defaultValue, placeholder, confirmText, cancelText } = state.options

  return (
    <OverlayDialog isOpen={state.isOpen} onClose={handleCancel} title={title} size="sm">
      <div className="flex items-start gap-4">
        <div className="p-2.5 rounded-xl text-blue-400 bg-blue-500/10 flex-shrink-0">
          <Edit3 className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0 pt-1">
          {message && (
            <p className="text-sm text-text-secondary leading-relaxed mb-3">{message}</p>
          )}
          <input
            ref={inputRef}
            type="text"
            defaultValue={defaultValue ?? ''}
            placeholder={placeholder}
            onKeyDown={handleKeyDown}
            className="w-full px-3 py-2 rounded-lg bg-surface border border-border text-sm text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/50 transition-colors"
          />
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-6">
        <ActionButton variant="ghost" size="sm" onClick={handleCancel}>
          {cancelText || t('cancel', language)}
        </ActionButton>
        <ActionButton variant="primary" size="sm" onClick={handleConfirm}>
          {confirmText || t('common.confirm', language) || '确定'}
        </ActionButton>
      </div>
    </OverlayDialog>
  )
}

/**
 * 全局输入弹窗函数（替代 window.prompt）
 *
 * @returns 用户输入的字符串；用户取消时返回 null
 */
export function globalPrompt(options: PromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (!globalSetState) {
      // 未挂载时直接返回 null（取消）
      resolve(null)
      return
    }
    globalResolve = resolve
    globalSetState({ isOpen: true, options })
  })
}

export default GlobalPromptOverlay
