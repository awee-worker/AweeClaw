/**
 * 导航菜单目录
 *
 * 左侧导航栏由三类菜单合并而成：场景声明的侧边栏项、插件贡献的侧边栏项、
 * 用户添加的自定义网页菜单。渲染（NavigationRail）与「菜单显示」设置（穿梭框）
 * 必须基于同一份清单与同一套过滤规则 —— 否则设置里能看到的入口与实际渲染的
 * 对不上，用户改了却看不到效果。因此与菜单清单相关的解析统一收在这里。
 *
 * @module renderer/components/layout/navMenuCatalog
 */

import { useMemo } from 'react'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import type { SidebarItemDescriptor } from '@shared/protocols/scenario'
import { useStore } from '@store'
import { usePluginExtensions } from '@renderer/plugins/usePluginExtensions'
import type { CustomMenu } from '@renderer/state/slices/layoutSlice'
import { NAV_ACCOUNT_MENU_ITEMS } from '@shared/configuration/navAccountMenuItems'
import { sortMenusByOrder } from './menuVisibilityModel'

/**
 * 场景未声明 sidebarItems 时的兜底菜单。
 *
 * explorer 标记 hidden：它由「新建任务」按钮按需激活（打开工作空间文件面板），
 * 不作为常驻导航项，避免与「新建任务」的语义重复。
 */
export const DEFAULT_SIDEBAR_ITEMS: SidebarItemDescriptor[] = [
  { id: 'explorer', icon: 'Files', label: 'Workspace', labelZh: '工作空间', component: 'ExplorerView', position: 0, hidden: true },
  { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 1 },
]

/** 菜单来源，用于在设置面板里标注入口归属 */
export type NavMenuItemSource = 'scenario' | 'plugin' | 'custom' | 'account'

/** 展示用菜单项：各类菜单收敛成同一种形状 */
export interface NavMenuItem {
  id: string
  icon: string
  label: string
  labelZh: string
  source: NavMenuItemSource
}

/**
 * 用户菜单（账号下拉）里的功能入口
 *
 * 清单与默认隐藏状态同源在 shared/configuration/navAccountMenuItems：
 * 这里只负责把它们拼成展示用的形状，并标记来源。
 */
export const ACCOUNT_MENU_ITEMS: NavMenuItem[] = NAV_ACCOUNT_MENU_ITEMS.map((item) => ({
  ...item,
  source: 'account',
}))


/**
 * 解析场景声明的导航项
 *
 * 排序按 position，并过滤掉两类入口：
 * - 场景自己声明 hidden 的（不作为常驻入口，但仍可由代码激活）
 * - 与当前场景不匹配的 checkpoint（该面板只在开发助手里有意义）
 */
export function resolveScenarioSidebarItems(activeScenarioId: string): SidebarItemDescriptor[] {
  const scenario = scenarioRegistry.get(activeScenarioId)
  const raw = scenario?.ui?.sidebarItems?.length
    ? [...scenario.ui.sidebarItems].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    : DEFAULT_SIDEBAR_ITEMS
  return raw.filter((item) => {
    if (item.id === 'checkpoint' && activeScenarioId !== 'dev-assistant') return false
    if (item.hidden) return false
    return true
  })
}

export interface NavMenuCatalog {
  /** 场景菜单（已排序、已过滤声明为 hidden 的项） */
  scenarioItems: SidebarItemDescriptor[]
  /** 插件菜单（同样过滤掉声明为 hidden 的项） */
  pluginItems: SidebarItemDescriptor[]
  /** 自定义网页菜单 */
  customMenus: CustomMenu[]
  /** 三类菜单合并后的展示清单，顺序与导航栏一致 */
  items: NavMenuItem[]
}

/**
 * 订阅当前可用的导航菜单目录
 *
 * 场景切换、插件增删、自定义菜单变动、拖曳排序都会让清单更新；返回值用 useMemo
 * 收敛，以免每次渲染都把清单当成新的依赖传下去。
 */
export function useNavMenuCatalog(): NavMenuCatalog {
  const activeScenarioId = useStore((s) => s.activeScenarioId)
  const customMenus = useStore((s) => s.customMenus)
  const navMenuOrder = useStore((s) => s.navMenuOrder)
  const { sidebarItems: pluginSidebarItems } = usePluginExtensions()

  return useMemo(() => {
    const scenarioItems = resolveScenarioSidebarItems(activeScenarioId)
    const pluginItems = pluginSidebarItems.filter((item) => !item.hidden)
    const items: NavMenuItem[] = [
      ...scenarioItems.map((item): NavMenuItem => ({
        id: item.id,
        icon: item.icon,
        label: item.label,
        labelZh: item.labelZh,
        source: 'scenario',
      })),
      ...pluginItems.map((item): NavMenuItem => ({
        id: item.id,
        icon: item.icon,
        label: item.label,
        labelZh: item.labelZh,
        source: 'plugin',
      })),
      ...customMenus.map((menu): NavMenuItem => ({
        id: menu.id,
        icon: menu.icon,
        label: menu.name,
        labelZh: menu.name,
        source: 'custom',
      })),
    ]

    // 用户菜单里的功能入口排在最后；场景或插件已经声明了同名入口时不再重复，
    // 否则「菜单显示」里会出现两条 id 相同的条目，改一个另一个跟着变。
    const occupied = new Set(items.map((item) => item.id))
    items.push(...ACCOUNT_MENU_ITEMS.filter((item) => !occupied.has(item.id)))

    return {
      scenarioItems,
      pluginItems,
      customMenus,
      items: sortMenusByOrder(items, navMenuOrder),
    }
  }, [activeScenarioId, pluginSidebarItems, customMenus, navMenuOrder])
}
