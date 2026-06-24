/**
 * 工具卡片展开/折叠状态 Hook
 *
 * 在工具卡片激活时自动展开，并提供手动切换。
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Hook 配置 */
export interface UseToolCardExpansionOptions {
  defaultExpanded?: boolean
  isActive: boolean
}

/** Hook 返回值 */
export interface ToolCardExpansionState {
  isExpanded: boolean
  animateContent: boolean
  handleToggleExpanded: () => void
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>
}

/**
 * 管理工具卡片展开状态
 *
 * 当卡片从未激活变为激活且默认展开时，自动展开但不触发动画；
 * 手动切换时启用动画。
 */
export function useToolCardExpansion({
  defaultExpanded = false,
  isActive,
}: UseToolCardExpansionOptions): ToolCardExpansionState {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const [animateContent, setAnimateContent] = useState(false)
  const wasActiveRef = useRef(isActive)

  useEffect(() => {
    // 首次激活且默认展开：直接展开，不播放动画
    if (defaultExpanded && isActive && !wasActiveRef.current) {
      setAnimateContent(false)
      setIsExpanded(true)
    }
    wasActiveRef.current = isActive
  }, [defaultExpanded, isActive])

  const handleToggleExpanded = useCallback(() => {
    setAnimateContent(true)
    setIsExpanded((prev) => !prev)
  }, [])

  return {
    isExpanded,
    animateContent,
    handleToggleExpanded,
    setIsExpanded,
  }
}
