/**
 * 抽屉宽度与红绿灯让位
 *
 * 这里锁的是「铺满剩余空间」这条规则：屏幕宽度减去左侧菜单宽度，菜单展开与
 * 收起是两档不同取值。写测试是因为这两个数字一旦和导航栏实际宽度对不上，
 * 现象只是抽屉边缘压到菜单、漏出一截，或被 macOS 红绿灯盖住，肉眼很难在每次
 * 改动后复查。
 */

import { describe, expect, it } from 'vitest'
import {
  PANEL_DRAWER_WIDTHS,
  isBuiltinDrawerPanel,
  resolvePanelDrawerWidth,
} from '../pluginDrawerStore'
import {
  MAC_TRAFFIC_LIGHTS_WIDTH,
  NAV_RAIL_WIDTH_COLLAPSED,
  NAV_RAIL_WIDTH_EXPANDED,
  resolveNavRailWidth,
  resolveTrafficLightsClearance,
} from '@components/layout/navRailMetrics'

describe('resolveNavRailWidth', () => {
  it('展开取展开宽度，收起取收起宽度', () => {
    expect(resolveNavRailWidth(true, false)).toBe(NAV_RAIL_WIDTH_EXPANDED)
    expect(resolveNavRailWidth(false, false)).toBe(NAV_RAIL_WIDTH_COLLAPSED)
  })

  it('导航栏不渲染时不占宽度', () => {
    expect(resolveNavRailWidth(true, true)).toBe(0)
    expect(resolveNavRailWidth(false, true)).toBe(0)
  })
})

describe('resolvePanelDrawerWidth', () => {
  it('full 档按视口减去菜单宽度', () => {
    expect(resolvePanelDrawerWidth('full', NAV_RAIL_WIDTH_EXPANDED)).toBe('calc(100vw - 200px)')
    expect(resolvePanelDrawerWidth('full', NAV_RAIL_WIDTH_COLLAPSED)).toBe('calc(100vw - 48px)')
  })

  it('导航栏不渲染时 full 档等于整个视口', () => {
    expect(resolvePanelDrawerWidth('full', 0)).toBe('calc(100vw - 0px)')
  })

  it('其余档位保持固定像素，且不低于 320px', () => {
    expect(resolvePanelDrawerWidth('md')).toBe('420px')
    expect(resolvePanelDrawerWidth('lg')).toBe('920px')
    expect(resolvePanelDrawerWidth('xl')).toBe('1180px')
    expect(resolvePanelDrawerWidth(640)).toBe('640px')
    expect(resolvePanelDrawerWidth(100)).toBe('320px')
  })
})

describe('内置面板宽度声明', () => {
  const fullWidthPanels = [
    'todo-hub',
    'projects',
    'automation',
    'knowledge',
    'mail-center',
    'plugin-market',
    'ai-browser',
  ]

  it.each(fullWidthPanels)('%s 铺满剩余宽度', panelId => {
    expect(PANEL_DRAWER_WIDTHS[panelId]).toBe('full')
  })

  it('没有内置面板停留在固定宽度档', () => {
    Object.values(PANEL_DRAWER_WIDTHS).forEach(width => expect(width).toBe('full'))
  })

  it('宽度表同时充当抽屉面板登记表', () => {
    fullWidthPanels.forEach(panelId => expect(isBuiltinDrawerPanel(panelId)).toBe(true))
    expect(isBuiltinDrawerPanel('not-a-panel')).toBe(false)
  })
})

describe('resolveTrafficLightsClearance', () => {
  it('菜单展开时容器已在红绿灯右侧，保持常规留白', () => {
    expect(resolveTrafficLightsClearance(NAV_RAIL_WIDTH_EXPANDED, true, 12)).toBe(12)
  })

  it('菜单收起时补足到红绿灯右边缘之外', () => {
    const inset = resolveTrafficLightsClearance(NAV_RAIL_WIDTH_COLLAPSED, true, 12)
    expect(inset).toBe(MAC_TRAFFIC_LIGHTS_WIDTH - NAV_RAIL_WIDTH_COLLAPSED)
    // 容器左边缘 + 留白 必须越过整组红绿灯
    expect(NAV_RAIL_WIDTH_COLLAPSED + inset).toBeGreaterThanOrEqual(MAC_TRAFFIC_LIGHTS_WIDTH)
  })

  it('菜单不渲染时整组红绿灯宽度都要让出', () => {
    expect(resolveTrafficLightsClearance(0, true, 12)).toBe(MAC_TRAFFIC_LIGHTS_WIDTH)
  })

  it('非 macOS 平台不受红绿灯影响', () => {
    expect(resolveTrafficLightsClearance(0, false, 12)).toBe(12)
    expect(resolveTrafficLightsClearance(NAV_RAIL_WIDTH_COLLAPSED, false, 12)).toBe(12)
  })

  it('常规留白本身更大时不被收窄', () => {
    expect(resolveTrafficLightsClearance(0, true, 96)).toBe(96)
  })
})
