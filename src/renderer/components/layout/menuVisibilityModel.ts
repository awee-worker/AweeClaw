/**
 * 菜单显隐的纯逻辑
 *
 * 与渲染分离：这里只处理 id 集合的增删与拆分，便于独立验证。
 * 穿梭框组件（MenuVisibilityTransfer）只负责把这些结果画出来。
 *
 * @module renderer/components/layout/menuVisibilityModel
 */

import type { NavMenuItem } from './navMenuCatalog'

export interface MenuSplit {
  /** 已隐藏的菜单，顺序与传入清单一致 */
  hiddenItems: NavMenuItem[]
  /** 已显示的菜单，顺序与传入清单一致 */
  visibleItems: NavMenuItem[]
}

/**
 * 按隐藏集合把菜单拆成「已隐藏 / 已显示」两栏
 *
 * 按原清单顺序过滤，而不是按 hiddenIds 的顺序 —— 后者反映的是用户操作的先后，
 * 一旦用来排序，两栏的顺序会随点击顺序乱跳。
 */
export function splitMenusByHidden(items: NavMenuItem[], hiddenIds: string[]): MenuSplit {
  const hiddenSet = new Set(hiddenIds)
  const hiddenItems: NavMenuItem[] = []
  const visibleItems: NavMenuItem[] = []
  for (const item of items) {
    if (hiddenSet.has(item.id)) hiddenItems.push(item)
    else visibleItems.push(item)
  }
  return { hiddenItems, visibleItems }
}

/** 显示菜单：把它们从隐藏集合中移除，已显示的 id 不受影响 */
export function showMenus(hiddenIds: string[], ids: string[]): string[] {
  if (ids.length === 0) return hiddenIds
  const removing = new Set(ids)
  return hiddenIds.filter((id) => !removing.has(id))
}

/** 隐藏菜单：并入隐藏集合并去重 */
export function hideMenus(hiddenIds: string[], ids: string[]): string[] {
  if (ids.length === 0) return hiddenIds
  return Array.from(new Set([...hiddenIds, ...ids]))
}

/** 菜单条目超过阈值时是否需要限高滚动 */
export function shouldScrollMenu(menuCount: number, threshold: number): boolean {
  return menuCount > threshold
}

/**
 * 按用户自定义顺序重排菜单
 *
 * 顺序表只描述「谁排在谁前面」：出现在表里的项按表内次序排，未出现的项
 * （新装的插件、刚加的入口、已删除残留的 id）保持原有相对顺序排在后面。
 * 依赖 Array 的稳定排序，因此未列出项之间的相对次序不会被搅乱。
 */
export function sortMenusByOrder<T extends { id: string }>(list: T[], order: string[]): T[] {
  if (order.length === 0) return list
  const rank = new Map(order.map((id, index) => [id, index]))
  return [...list].sort((a, b) => {
    const rankA = rank.get(a.id)
    const rankB = rank.get(b.id)
    if (rankA === undefined && rankB === undefined) return 0
    if (rankA === undefined) return 1
    if (rankB === undefined) return -1
    return rankA - rankB
  })
}

/**
 * 拖曳重排「已显示」栏后生成的完整顺序
 *
 * 新顺序 = 重排后的已显示项在前，其余 id（已隐藏 / 已不存在）按原相对顺序追加。
 * 隐藏项留在末尾而不是穿插其中：它们在界面上看不见，混进中间会让落点与视觉
 * 预期对不上；重新显示出来时落到列表末尾，位置明确。
 *
 * 下标语义：`fromIndex` / `toIndex` 都相对「已显示」栏，`toIndex` 是拖起项
 * 松手后的最终位置。界面上的落点预览按同一套下标计算，两边不会错位。
 *
 * @param order 当前完整顺序（含已隐藏项）
 * @param visibleIds 已显示项的当前顺序
 * @param fromIndex 被拖动项在已显示栏中的下标
 * @param toIndex 松手后的目标下标
 */
export function moveMenuTo(
  order: string[],
  visibleIds: string[],
  fromIndex: number,
  toIndex: number,
): string[] {
  if (fromIndex === toIndex) return order
  if (fromIndex < 0 || fromIndex >= visibleIds.length) return order
  if (toIndex < 0 || toIndex >= visibleIds.length) return order
  const next = [...visibleIds]
  const [moved] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, moved)
  const placed = new Set(next)
  return [...next, ...order.filter((id) => !placed.has(id))]
}

/**
 * 按「拖到谁的位置」重排（moveMenuTo 的 id 版本）
 *
 * 保留给按 id 描述落点的调用方；下标换算后走同一套重排逻辑。
 */
export function moveMenuBefore(
  order: string[],
  visibleIds: string[],
  fromId: string,
  toId: string,
): string[] {
  const from = visibleIds.indexOf(fromId)
  const to = visibleIds.indexOf(toId)
  if (from < 0 || to < 0 || from === to) return order
  return moveMenuTo(order, visibleIds, from, to)
}

