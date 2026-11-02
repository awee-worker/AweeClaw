/**
 * 快速设置二级菜单的定位计算
 *
 * 单独成文件是为了能脱离 React 与 Electron 环境直接验证边界情况：
 * 面板贴着一级项摆在侧边，一级项又跟着用户菜单走，位置必须在每次展开时
 * 按视口重新算，写死 top/bottom 会在菜单靠边时把面板顶出屏幕。
 */

/** 二级菜单展开方向：rail 落位向右，顶部账号区落位向左 */
export type QuickSettingsDirection = 'right' | 'left'

/** 一级项与二级面板之间的缝隙，用于视觉分隔 */
export const SUBMENU_GAP = 5

/** 面板与视口边缘的最小安全距离 */
export const SUBMENU_VIEWPORT_MARGIN = 8

/** 一级项在视口中的位置，只取定位需要的四条边 */
export interface SubMenuAnchorRect {
  top: number
  bottom: number
  left: number
  right: number
}

/** 面板的定位结果：始终用 top 定位，溢出时整体上移 */
export interface SubMenuPlacement {
  left: number
  top: number
  maxHeight: number
}

/**
 * 计算二级面板的位置
 *
 * - 水平：贴着方向侧摆放，并夹在视口内，宽度固定不会横向溢出。
 * - 垂直：默认从一级项下方展开；只有当「向下展开会越过视口底边」时，
 *   才把面板整体上移一段让底边贴住安全边距，而不是翻到上方去。
 * - 高度：maxHeight 兜住剩余空间，极端情况（视口比内容还矮）在内部滚动。
 *
 * panelHeight 是面板的实际内容高度。首次渲染还不知道，传 0 就按向下展开
 * 算可用高度；量到真实高度后再算一次，面板便上移到刚好不溢出的位置。
 */
export function computeSubMenuPlacement(
  anchor: SubMenuAnchorRect,
  viewport: { width: number; height: number },
  direction: QuickSettingsDirection,
  width: number,
  panelHeight = 0,
): SubMenuPlacement {
  const rawLeft =
    direction === 'left'
      ? anchor.left - SUBMENU_GAP - width
      : anchor.right + SUBMENU_GAP
  const left = Math.max(
    SUBMENU_VIEWPORT_MARGIN,
    Math.min(rawLeft, viewport.width - width - SUBMENU_VIEWPORT_MARGIN),
  )

  const limitBottom = viewport.height - SUBMENU_VIEWPORT_MARGIN
  // 顶边与一级项对齐，向下展开
  const preferredTop = anchor.top

  // 向下放不下就整体上移，但顶部不越过安全边距
  const top =
    panelHeight > 0 && preferredTop + panelHeight > limitBottom
      ? Math.max(SUBMENU_VIEWPORT_MARGIN, limitBottom - panelHeight)
      : preferredTop

  return {
    left,
    top,
    maxHeight: Math.max(0, limitBottom - top),
  }
}
