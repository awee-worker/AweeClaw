/**
 * 场景菜单定义（动态）
 *
 * 从 scenarioMenuState 读取已安装场景列表，构建子菜单。
 * - 场景数 ≤ 12：平铺为 radio 互斥列表
 * - 场景数 > 12：按 category 分组为子菜单，避免单层过长
 *
 * 当前激活场景显示勾选状态。
 */

import type { BrowserWindow, MenuItemConstructorOptions } from 'electron'
import type { Language } from '../../appBootstrap'
import { t, type MenuKey } from '../menuI18n'
import { createCommandSender, sendSwitchScenario } from '../menuActions'
import { scenarioMenuState } from '../menuScenarioSync'

/** 场景分组阈值：超过此值按 category 分组 */
const SCENARIO_GROUP_THRESHOLD = 12

/** 场景分类 → i18n key 映射 */
const CATEGORY_KEY_MAP: Record<string, MenuKey> = {
  development: 'catDevelopment',
  data: 'catData',
  creative: 'catCreative',
  productivity: 'catProductivity',
  education: 'catEducation',
  automation: 'catAutomation',
  research: 'catResearch',
  communication: 'catCommunication',
  entertainment: 'catEntertainment',
  business: 'catBusiness',
  health: 'catHealth',
}

export interface ScenarioMenuContext {
  getWin: () => BrowserWindow | null
  lang: Language
}

/**
 * 构建场景菜单
 */
export function buildScenarioMenu(ctx: ScenarioMenuContext): MenuItemConstructorOptions {
  const { getWin, lang } = ctx
  const scenarios = scenarioMenuState.getScenarios()
  const activeId = scenarioMenuState.getActiveId()

  const scenarioItems = buildScenarioItems(scenarios, activeId, getWin, lang)

  return {
    label: t(lang, 'scenario'),
    submenu: [
      ...scenarioItems,
      { type: 'separator' },
      {
        label: t(lang, 'scenarioManage'),
        click: createCommandSender(getWin, 'scenario.openManager'),
      },
    ],
  }
}

/**
 * 根据场景数量决定平铺或分组
 */
function buildScenarioItems(
  scenarios: ReturnType<typeof scenarioMenuState.getScenarios>,
  activeId: string | null,
  getWin: () => BrowserWindow | null,
  lang: Language,
): MenuItemConstructorOptions[] {
  if (scenarios.length === 0) {
    return [{ label: t(lang, 'noScenarios'), enabled: false }]
  }

  // 场景较少：平铺为 radio 列表
  if (scenarios.length <= SCENARIO_GROUP_THRESHOLD) {
    return scenarios.map<MenuItemConstructorOptions>((s) => ({
      label: s.name,
      sublabel: s.description,
      type: 'radio',
      checked: s.id === activeId,
      click: sendSwitchScenario(getWin, s.id),
    }))
  }

  // 场景较多：按 category 分组为子菜单
  const grouped = groupByCategory(scenarios)
  const items: MenuItemConstructorOptions[] = []

  for (const [category, groupScenarios] of grouped) {
    const categoryLabel = t(lang, CATEGORY_KEY_MAP[category] ?? 'catOther')
    items.push({
      label: categoryLabel,
      submenu: groupScenarios.map<MenuItemConstructorOptions>((s) => ({
        label: s.name,
        sublabel: s.description,
        type: 'radio',
        checked: s.id === activeId,
        click: sendSwitchScenario(getWin, s.id),
      })),
    })
  }

  return items
}

/**
 * 按 category 分组，保持插入顺序
 */
function groupByCategory(
  scenarios: ReturnType<typeof scenarioMenuState.getScenarios>,
): Map<string, typeof scenarios> {
  const map = new Map<string, typeof scenarios>()
  for (const s of scenarios) {
    const cat = s.category ?? 'other'
    if (!map.has(cat)) map.set(cat, [])
    map.get(cat)!.push(s)
  }
  return map
}
