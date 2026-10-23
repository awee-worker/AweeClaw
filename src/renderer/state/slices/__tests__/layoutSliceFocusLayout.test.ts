/**
 * 专注布局收放测试
 *
 * 打开编辑器 / 内置浏览器时收起菜单栏与侧边栏，关闭后必须回到打开前的状态；
 * 用户中途手动动过面板则不再覆盖其选择。
 */

import { describe, it, expect } from 'vitest'
import { create } from 'zustand'
import { createLayoutSlice, type LayoutSlice } from '../layoutSlice'

function createTestStore() {
  return create<LayoutSlice>()((set, get, api) => ({
    ...createLayoutSlice(set, get, api),
  }))
}

describe('layoutSlice 专注布局', () => {
  it('进入专注布局时收起菜单栏与侧边栏，并记录原状态', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('git')

    store.getState().enterFocusLayout()

    expect(store.getState().navRailExpanded).toBe(false)
    expect(store.getState().activeSidePanel).toBeNull()
    expect(store.getState().chromeSnapshotBeforeFocus).toEqual({
      navRailExpanded: true,
      activeSidePanel: 'git',
    })
  })

  it('重复进入不覆盖首次快照', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('explorer')
    store.getState().enterFocusLayout()

    // 模拟在编辑器里再打开内置浏览器：此时面板已收起，再次进入不应改写快照
    store.getState().enterFocusLayout()

    expect(store.getState().chromeSnapshotBeforeFocus).toEqual({
      navRailExpanded: true,
      activeSidePanel: 'explorer',
    })
  })

  it('退出专注布局时恢复菜单栏与侧边栏', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('explorer')
    store.getState().setNavRailExpanded(false)
    store.getState().enterFocusLayout()

    store.getState().exitFocusLayout()

    expect(store.getState().activeSidePanel).toBe('explorer')
    expect(store.getState().navRailExpanded).toBe(false)
    expect(store.getState().chromeSnapshotBeforeFocus).toBeNull()
  })

  it('用户手动切换面板后丢弃快照，退出时不再覆盖', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('explorer')
    store.getState().enterFocusLayout()

    store.getState().setActiveSidePanel('search')
    store.getState().exitFocusLayout()

    expect(store.getState().activeSidePanel).toBe('search')
  })

  it('没有快照时退出是空操作', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('explorer')

    store.getState().exitFocusLayout()

    expect(store.getState().activeSidePanel).toBe('explorer')
  })

  it('文件编辑器只收起菜单栏，工作空间侧边栏保留', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('explorer')

    store.getState().enterFocusLayout({ collapseSidePanel: false })

    expect(store.getState().navRailExpanded).toBe(false)
    expect(store.getState().activeSidePanel).toBe('explorer')
    expect(store.getState().chromeSnapshotBeforeFocus).toEqual({
      navRailExpanded: true,
      activeSidePanel: 'explorer',
    })
  })

  it('编辑器内再打开浏览器：补收侧边栏，快照仍是最初的面板状态', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('explorer')
    store.getState().enterFocusLayout({ collapseSidePanel: false })

    store.getState().enterFocusLayout({ collapseSidePanel: true })

    expect(store.getState().activeSidePanel).toBeNull()
    expect(store.getState().chromeSnapshotBeforeFocus?.activeSidePanel).toBe('explorer')
  })

  it('浏览器关闭回到编辑器：侧边栏按快照放回，菜单栏仍收起', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('explorer')
    store.getState().enterFocusLayout({ collapseSidePanel: true })

    store.getState().enterFocusLayout({ collapseSidePanel: false })

    expect(store.getState().navRailExpanded).toBe(false)
    expect(store.getState().activeSidePanel).toBe('explorer')
    expect(store.getState().chromeSnapshotBeforeFocus).not.toBeNull()
  })

  it('程序化收起菜单栏 / 侧边栏不丢弃快照，关闭后仍能恢复', () => {
    const store = createTestStore()
    store.getState().setActiveSidePanel('explorer')
    store.getState().enterFocusLayout({ collapseSidePanel: false })

    // 打开文件时 AweeApp / 文件预览会再收一次菜单栏，打开预览会清空侧边栏
    store.getState().setNavRailExpanded(false)
    store.getState().setActiveSidePanel(null)

    expect(store.getState().chromeSnapshotBeforeFocus).not.toBeNull()

    store.getState().exitFocusLayout()

    expect(store.getState().navRailExpanded).toBe(true)
    expect(store.getState().activeSidePanel).toBe('explorer')
  })
})
