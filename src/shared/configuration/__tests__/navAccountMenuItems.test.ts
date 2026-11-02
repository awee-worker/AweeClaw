import { describe, it, expect } from 'vitest'
import { NAV_ACCOUNT_MENU_ITEMS, DEFAULT_HIDDEN_NAV_ITEMS } from '../navAccountMenuItems'

describe('NAV_ACCOUNT_MENU_ITEMS', () => {
  it('包含专家库与任务中心两个入口', () => {
    expect(NAV_ACCOUNT_MENU_ITEMS.map((item) => item.id)).toEqual(['roleLibrary', 'taskCenter'])
  })

  it('id 唯一，中英文名称与图标都不为空', () => {
    const ids = NAV_ACCOUNT_MENU_ITEMS.map((item) => item.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const item of NAV_ACCOUNT_MENU_ITEMS) {
      expect(item.label.trim()).not.toBe('')
      expect(item.labelZh.trim()).not.toBe('')
      expect(item.icon.trim()).not.toBe('')
    }
  })

  it('任务中心的 id 不复用面板 id ledger', () => {
    // 导航栏会收回「正处于隐藏状态的面板」，沿用面板 id 会让默认隐藏的任务中心
    // 从账号菜单打开后立刻被关掉
    expect(NAV_ACCOUNT_MENU_ITEMS.find((item) => item.labelZh === '任务中心')?.id).not.toBe('ledger')
  })
})

describe('DEFAULT_HIDDEN_NAV_ITEMS', () => {
  it('默认隐藏项与可管理清单完全一致', () => {
    // 同源派生：清单增删后默认隐藏自动跟上，避免「清单有、默认隐藏没有」的漏项
    expect(DEFAULT_HIDDEN_NAV_ITEMS).toEqual(NAV_ACCOUNT_MENU_ITEMS.map((item) => item.id))
  })

  it('每个默认隐藏 id 都能在清单里找到', () => {
    const catalogIds = new Set(NAV_ACCOUNT_MENU_ITEMS.map((item) => item.id))
    for (const id of DEFAULT_HIDDEN_NAV_ITEMS) {
      expect(catalogIds.has(id)).toBe(true)
    }
  })
})
