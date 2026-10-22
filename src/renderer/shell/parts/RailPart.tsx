/**
 * 导航栏部件（rail）
 *
 * 与 rail-user、chat-history 的关系：本部件只负责「导航入口那一列」，
 * 左下角用户区与会话列表已单独拆出。整列一起用时写 rail 即可，需要把
 * 用户区或会话列表挪到别处时，把 rail-user / chat-history 摆到目标位置。
 *
 * `collapsed` 只在挂载时写入一次展开态：之后由折叠按钮与快捷键共同维护，
 * 部件不再反向覆盖，否则用户点开导航栏会被初值立刻收起。
 */

import { useEffect, useRef } from 'react'
import { useStore } from '@store'
import NavigationRail from '@components/layout/NavigationRail'
import type { HostPartComponentProps } from '../HostPartRegistry'

export interface RailPartProps extends HostPartComponentProps {
  /** 挂载时写入的展开态初值；不传则沿用用户上次的选择 */
  collapsed?: boolean
}

export function RailPart({ collapsed }: RailPartProps) {
  const setNavRailExpanded = useStore((s) => s.setNavRailExpanded)
  const appliedRef = useRef(false)

  useEffect(() => {
    if (appliedRef.current) return
    appliedRef.current = true
    if (collapsed === undefined) return
    setNavRailExpanded(!collapsed)
  }, [collapsed, setNavRailExpanded])

  return <NavigationRail />
}

export default RailPart
