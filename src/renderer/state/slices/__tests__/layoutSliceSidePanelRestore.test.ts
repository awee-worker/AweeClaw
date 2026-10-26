/**
 * 顶部工作空间开关的恢复目标测试
 *
 * 开关按下时若面板已收起，会按「上次面板」恢复。用户自己关掉再打开理应回到同一块；
 * 但切走视图（打开历史会话、切换会话、新建任务…）是被动离开，开关再按下必须回到
 * 工作空间面板，不能把刚离开的插件市场重新顶出来。
 */

import { describe, it, expect } from 'vitest'
import { create } from 'zustand'
import { createLayoutSlice, WORKSPACE_PANEL_ID, type LayoutSlice } from '../layoutSlice'

function createTestStore() {
  return create<LayoutSlice>()((set, get, api) => ({
    ...createLayoutSlice(set, get, api),
  }))
}

describe('layoutSlice 侧边栏恢复目标', () => {
  it('用户自己收起再打开，回到收起前的那块面板', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('plugin-market')

    store.getState().toggleSidebar()
    expect(store.getState().activeSidePanel).toBeNull()

    store.getState().toggleSidebar()
    expect(store.getState().activeSidePanel).toBe('plugin-market')
  })

  it('切走视图后收起，开关打开的是工作空间面板', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('plugin-market')

    // 打开历史会话 / 切换会话 / 新建任务都会走这条路径
    store.getState().closeSidePanelForView()
    expect(store.getState().activeSidePanel).toBeNull()

    store.getState().toggleSidebar()
    expect(store.getState().activeSidePanel).toBe(WORKSPACE_PANEL_ID)
  })

  it('切走视图时清掉专注布局快照，关闭编辑器后不回放面板', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('plugin-market')
    store.getState().enterFocusLayout({ collapseSidePanel: false })

    store.getState().closeSidePanelForView()

    expect(store.getState().chromeSnapshotBeforeFocus).toBeNull()
  })

  it('工作空间面板 id 与默认面板一致，避免开关恢复出空面板', () => {
    const store = createTestStore()
    expect(store.getState().lastActiveSidePanel).toBe(WORKSPACE_PANEL_ID)
    expect(store.getState().activeSidePanel).toBe(WORKSPACE_PANEL_ID)
  })
})
