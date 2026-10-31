/**
 * 左侧导航栏宽度与 macOS 红绿灯占位
 *
 * 这两组数字都是「窗口左边被占掉多少」的问题，写在同一个文件里：
 * - 右侧抽屉要按「屏幕宽度 - 左侧菜单宽度」铺满剩余空间，而菜单有展开、收起
 *   两档宽度，导航栏自身和抽屉都要用，集中维护才不会两处各写一份后慢慢对不上
 *   （导航栏 CSS 的 width 与抽屉的 calc 必须严格一致）。
 * - 红绿灯由系统绘制在窗口左上角，任何贴在左侧的内容都要为它让位。菜单收起或
 *   不渲染时，紧邻其后的标题栏、抽屉标题栏都会落进这块区域。
 */
export const NAV_RAIL_WIDTH_EXPANDED = 200

export const NAV_RAIL_WIDTH_COLLAPSED = 48

/**
 * macOS 红绿灯整组占用的宽度
 *
 * 三个圆形按钮自窗口左边缘 15px 起排布（直径 12px、间距 8px），整组右边缘落在
 * 67px 附近。留到 88px 既完全避开遮挡，又不至于让内容离窗口边缘太远。
 */
export const MAC_TRAFFIC_LIGHTS_WIDTH = 88

/** 按导航栏当前开合状态取宽度；导航栏整个不渲染时传 0 */
export function resolveNavRailWidth(expanded: boolean, hidden: boolean): number {
  if (hidden) return 0
  return expanded ? NAV_RAIL_WIDTH_EXPANDED : NAV_RAIL_WIDTH_COLLAPSED
}

/**
 * 起点落在 navRailWidth 的容器，其内容需要多少左内边距才能避开红绿灯
 *
 * 菜单展开时容器左边缘已在红绿灯右侧，返回 normalInset 即可；菜单收起（48px）
 * 或不渲染（0）时容器左边缘落在红绿灯区域内，需要补到 MAC_TRAFFIC_LIGHTS_WIDTH
 * 之外。非 macOS 平台没有红绿灯，始终返回 normalInset。
 */
export function resolveTrafficLightsClearance(
  navRailWidth: number,
  isMac: boolean,
  normalInset: number,
): number {
  if (!isMac) return normalInset
  return Math.max(normalInset, MAC_TRAFFIC_LIGHTS_WIDTH - Math.max(0, navRailWidth))
}

