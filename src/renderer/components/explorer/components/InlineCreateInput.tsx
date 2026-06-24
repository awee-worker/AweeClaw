/**
 * 内联创建输入框组件
 *
 * 设计理念：
 * - 输入验证：实时校验文件名合法性，禁止非法字符
 * - 防抖提交：避免失焦时重复提交
 * - 键盘增强：Enter 提交、Esc 取消、Tab 切换类型
 * - 可访问性：ARIA 标签、焦点管理
 * - 错误提示：行内显示校验错误
 * - IME 兼容：忽略输入法组合状态按键
 */

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { FolderPlus, FilePlus, AlertCircle } from 'lucide-react'
import { TextField } from '../../ui'

/** 文件名非法字符（跨平台） */
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/

/** Windows 保留名称 */
const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i

/** 最大文件名长度 */
const MAX_FILENAME_LENGTH = 255

interface InlineCreateInputProps {
  /** 创建类型：文件或文件夹 */
  type: 'file' | 'folder'
  /** 缩进深度（用于树形对齐） */
  depth: number
  /** 提交回调，返回 false 表示创建失败（用于显示错误） */
  onSubmit: (name: string) => boolean | Promise<boolean>
  /** 取消回调 */
  onCancel: () => void
  /** 是否显示错误提示（默认 true） */
  showError?: boolean
}

/** 校验结果 */
interface ValidationResult {
  valid: boolean
  error?: string
}

/**
 * 校验文件名合法性
 *
 * @param name 文件名
 * @param type 创建类型
 * @returns 校验结果
 */
function validateFilename(name: string, type: 'file' | 'folder'): ValidationResult {
  const trimmed = name.trim()

  if (!trimmed) {
    return { valid: false, error: '名称不能为空' }
  }

  if (trimmed.length > MAX_FILENAME_LENGTH) {
    return { valid: false, error: `名称不能超过 ${MAX_FILENAME_LENGTH} 个字符` }
  }

  if (INVALID_FILENAME_CHARS.test(trimmed)) {
    return { valid: false, error: '名称包含非法字符（< > : " / \\ | ? *）' }
  }

  if (WINDOWS_RESERVED_NAMES.test(trimmed)) {
    return { valid: false, error: '名称使用了系统保留字' }
  }

  // 文件夹不能包含扩展名点开头
  if (type === 'folder' && trimmed.startsWith('.')) {
    return { valid: false, error: '文件夹名称不能以点开头' }
  }

  // 文件需要包含扩展名（可选检查）
  if (type === 'file' && !trimmed.includes('.')) {
    // 仅警告，不阻止
    return { valid: true }
  }

  return { valid: true }
}

export function InlineCreateInput({
  type,
  depth,
  onSubmit,
  onCancel,
  showError = true,
}: InlineCreateInputProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const submittedRef = useRef(false)

  // 自动聚焦
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // 校验结果（实时）
  const validation = useMemo(() => validateFilename(value, type), [value, type])

  // 错误状态（仅在输入后显示）
  useEffect(() => {
    if (value && !validation.valid) {
      setError(validation.error ?? null)
    } else {
      setError(null)
    }
  }, [value, validation])

  const handleSubmit = useCallback(async () => {
    // 防止重复提交
    if (submittedRef.current || submitting) return

    const trimmed = value.trim()
    if (!trimmed) {
      onCancel()
      return
    }

    // 校验失败阻止提交
    if (!validation.valid) {
      setError(validation.error ?? '名称不合法')
      return
    }

    submittedRef.current = true
    setSubmitting(true)

    try {
      const success = await onSubmit(trimmed)
      if (success === false) {
        submittedRef.current = false
        setSubmitting(false)
        setError('创建失败，请重试')
      }
    } catch {
      submittedRef.current = false
      setSubmitting(false)
      setError('创建失败，请重试')
    }
  }, [value, validation, onSubmit, onCancel, submitting])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // 忽略 IME 组合状态中的按键
      if (e.nativeEvent.isComposing) return

      if (e.key === 'Enter') {
        e.preventDefault()
        void handleSubmit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      }
    },
    [handleSubmit, onCancel],
  )

  // 图标根据类型选择
  const Icon = type === 'folder' ? FolderPlus : FilePlus
  const placeholder = type === 'file' ? 'filename.ext' : 'folder name'

  return (
    <div
      className="flex flex-col gap-0.5 py-1 pr-2"
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
      role="form"
      aria-label={`创建${type === 'folder' ? '文件夹' : '文件'}`}
    >
      <div className="flex items-center gap-1.5">
        <span className="w-3.5 flex-shrink-0" aria-hidden />
        <Icon
          className="w-3.5 h-3.5 text-accent flex-shrink-0"
          aria-hidden
        />
        <TextField
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={handleSubmit}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="flex-1 h-6 text-[13px]"
          disabled={submitting}
          autoFocus
          aria-invalid={!!error}
          aria-describedby={error ? 'inline-create-error' : undefined}
        />
      </div>
      {showError && error && (
        <div
          id="inline-create-error"
          className="flex items-center gap-1 ml-9 text-xs text-danger"
          role="alert"
        >
          <AlertCircle className="w-3 h-3 flex-shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
