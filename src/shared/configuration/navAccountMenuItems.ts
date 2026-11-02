/**
 * 用户菜单里可提升为导航入口的功能项
 *
 * 这些入口原本只存在于账号下拉菜单中，现在同时出现在「自定义菜单 → 菜单显示」
 * 的可管理清单里。清单与默认隐藏状态必须同源：分开写两份 id，改一处忘一处就会
 * 出现「清单里有这一项、默认隐藏里却没有」的漏项，入口一上线就自己冒出来。
 *
 * id 独立于各项实际打开的目标。任务中心打开的是 ledger 面板，但这里的 id 不是
 * `ledger` —— 导航栏会收回「正处于隐藏状态的面板」，若沿用面板 id，默认隐藏的
 * 任务中心就会被判定为不该停留在屏幕上，从账号菜单打开后立刻被关掉。
 */

/** 单个可管理入口的展示信息（不含菜单来源，由调用方补齐） */
export interface NavAccountMenuItem {
  id: string
  /** lucide 图标名，取值见 IconMap */
  icon: string
  label: string
  labelZh: string
}

export const NAV_ACCOUNT_MENU_ITEMS: NavAccountMenuItem[] = [
  { id: 'roleLibrary', icon: 'GraduationCap', label: 'Expert Library', labelZh: '专家库' },
  { id: 'taskCenter', icon: 'Activity', label: 'Task Center', labelZh: '任务中心' },
]

/** 这些入口默认不出现在导航栏，是否放出由用户在「菜单显示」里决定 */
export const DEFAULT_HIDDEN_NAV_ITEMS: string[] = NAV_ACCOUNT_MENU_ITEMS.map((item) => item.id)
