/**
 * 侧边栏部件（sidebar）
 *
 * 内容来自 SidebarSection（懒加载 ExplorerSidebar + 宽度拖拽 + 崩溃兜底）。
 * 是否显示取决于当前是否有激活的面板：没有激活面板时侧边栏本身没有内容可
 * 展示，渲染一个空框只会浪费横向空间。
 *
 * 与外壳默认布局的差别：默认布局里 `hidden` 由 AweeApp 汇总了七八个页面级
 * 条件（设置页、全屏页、宽模式面板……）。那些页面在场景接管整壳之后不再走
 * 这条渲染路径，因此部件层只需要判断面板是否激活。
 */

import { useStore } from '@store'
import SidebarSection from '@components/layout/SidebarSection'
import type { HostPartComponentProps } from '../HostPartRegistry'

export interface SidebarPartProps extends HostPartComponentProps {
  /** 期望展示的面板 id；不传时按当前激活面板显示 */
  defaultPanel?: string
}

export function SidebarPart({ defaultPanel }: SidebarPartProps) {
  const activeSidePanel = useStore((s) => s.activeSidePanel)
  const hidden = defaultPanel ? activeSidePanel !== defaultPanel : !activeSidePanel

  return <SidebarSection hidden={hidden} />
}

export default SidebarPart
