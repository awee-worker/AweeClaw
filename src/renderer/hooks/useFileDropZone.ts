/**
 * useFileDropZone — 文件拖拽上传通用 Hook
 *
 * 职责：
 * - 管理拖拽悬浮状态（isDragging）
 * - 防止 dragLeave 在子元素间误触发（边界检测法，参考 useAttachmentManager）
 * - 支持扩展名白名单过滤（与主进程校验保持一致）
 * - 支持禁用态（上传中不可拖入，光标显示 none）
 * - 设置正确的 dropEffect（copy/none）反馈光标
 *
 * 设计要点：
 * - 回调/配置通过 ref 透传，handlers 引用恒定稳定，避免拖拽过程中
 *   因依赖变化导致 handler 重建、状态丢失
 * - 边界检测法比 dragCounter 更可靠（无惧嵌套层级）
 *
 * 用法：
 * ```tsx
 * const { isDragging, dragHandlers } = useFileDropZone({
 *   onDrop: (files) => handleUpload(files),
 *   accept: ['pdf', 'doc', 'docx'],
 *   disabled: uploading,
 *   onRejected: (files) => toast('不支持的文件类型'),
 * })
 * return <div {...dragHandlers}>...</div>
 * ```
 */

import { useState, useCallback, useRef } from 'react'

// ============================================
// 类型定义
// ============================================

interface UseFileDropZoneOptions {
  /** 文件释放回调（仅包含通过扩展名校验的文件） */
  onDrop: (files: File[]) => void
  /** 允许的扩展名白名单（小写，不含点）。为空/未传表示不过滤 */
  accept?: string[]
  /** 禁用拖拽（如上传进行中） */
  disabled?: boolean
  /** 不支持的文件回调（可选，用于提示用户） */
  onRejected?: (rejected: File[]) => void
}

interface DragHandlers {
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
}

interface UseFileDropZoneResult {
  /** 是否处于拖拽悬浮态（可用于显示遮罩/高亮） */
  isDragging: boolean
  /** 拖拽事件处理器，展开到 drop zone 元素 */
  dragHandlers: DragHandlers
}

// ============================================
// Hook 实现
// ============================================

export function useFileDropZone({
  onDrop,
  accept,
  disabled = false,
  onRejected,
}: UseFileDropZoneOptions): UseFileDropZoneResult {
  const [isDragging, setIsDragging] = useState(false)

  // 用 ref 持有最新回调与配置，使 handlers 引用稳定（deps 为空）
  const onDropRef = useRef(onDrop)
  onDropRef.current = onDrop
  const onRejectedRef = useRef(onRejected)
  onRejectedRef.current = onRejected
  const acceptRef = useRef(accept)
  acceptRef.current = accept
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled

  /** 校验单个文件扩展名是否在白名单内 */
  const isAccepted = useCallback((file: File): boolean => {
    const list = acceptRef.current
    if (!list || list.length === 0) return true
    const ext = file.name.split('.').pop()?.toLowerCase() || ''
    return list.includes(ext)
  }, [])

  /** 拖拽悬浮：阻止默认行为 + 设 copy 光标 + 标记悬浮态 */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (disabledRef.current) {
      e.dataTransfer.dropEffect = 'none'
      return
    }
    e.dataTransfer.dropEffect = 'copy'
    setIsDragging(true)
  }, [])

  /** 拖拽离开：仅当鼠标真正离开元素边界才清除悬浮态 */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    if (
      e.clientX < rect.left ||
      e.clientX > rect.right ||
      e.clientY < rect.top ||
      e.clientY > rect.bottom
    ) {
      setIsDragging(false)
    }
  }, [])

  /** 拖放释放：提取文件 + 扩展名过滤 + 回调 */
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (disabledRef.current) return

    const allFiles = Array.from(e.dataTransfer.files || [])
    if (allFiles.length === 0) return

    const accepted: File[] = []
    const rejected: File[] = []
    for (const file of allFiles) {
      if (isAccepted(file)) {
        accepted.push(file)
      } else {
        rejected.push(file)
      }
    }

    if (accepted.length > 0) {
      onDropRef.current(accepted)
    }
    if (rejected.length > 0 && onRejectedRef.current) {
      onRejectedRef.current(rejected)
    }
  }, [isAccepted])

  return {
    isDragging,
    dragHandlers: {
      onDragOver: handleDragOver,
      onDragLeave: handleDragLeave,
      onDrop: handleDrop,
    },
  }
}
