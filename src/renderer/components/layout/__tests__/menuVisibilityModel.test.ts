import { describe, it, expect } from 'vitest'
import {
  splitMenusByHidden,
  showMenus,
  hideMenus,
  shouldScrollMenu,
  sortMenusByOrder,
  moveMenuBefore,
  moveMenuTo,
} from '../menuVisibilityModel'
import type { NavMenuItem } from '../navMenuCatalog'

function menu(id: string, source: NavMenuItem['source'] = 'scenario'): NavMenuItem {
  return { id, icon: 'Files', label: id, labelZh: id, source }
}

const ITEMS: NavMenuItem[] = [menu('a'), menu('p1', 'plugin'), menu('c1', 'custom')]

describe('splitMenusByHidden', () => {
  it('按隐藏集合拆成两栏，且保持原清单顺序', () => {
    const { hiddenItems, visibleItems } = splitMenusByHidden(ITEMS, ['c1', 'a'])

    // 顺序取原清单而非 hiddenIds 的先后，否则两栏会随点击顺序乱跳
    expect(hiddenItems.map((i) => i.id)).toEqual(['a', 'c1'])
    expect(visibleItems.map((i) => i.id)).toEqual(['p1'])
  })

  it('空隐藏集合时全部落在已显示栏', () => {
    const { hiddenItems, visibleItems } = splitMenusByHidden(ITEMS, [])

    expect(hiddenItems).toEqual([])
    expect(visibleItems).toEqual(ITEMS)
  })

  it('隐藏集合里已不存在的 id 不影响拆分', () => {
    const { hiddenItems, visibleItems } = splitMenusByHidden(ITEMS, ['removed-plugin'])

    expect(hiddenItems).toEqual([])
    expect(visibleItems).toHaveLength(3)
  })

  it('用户菜单来源的入口默认落在已隐藏栏', () => {
    const withAccount: NavMenuItem[] = [
      ...ITEMS,
      menu('roleLibrary', 'account'),
      menu('taskCenter', 'account'),
    ]
    const { hiddenItems, visibleItems } = splitMenusByHidden(withAccount, ['roleLibrary', 'taskCenter'])

    expect(hiddenItems.map((i) => i.id)).toEqual(['roleLibrary', 'taskCenter'])
    expect(visibleItems.map((i) => i.id)).toEqual(['a', 'p1', 'c1'])
  })

  it('把用户菜单入口移出隐藏集合后出现在已显示栏', () => {
    const withAccount: NavMenuItem[] = [...ITEMS, menu('taskCenter', 'account')]
    const { hiddenItems, visibleItems } = splitMenusByHidden(withAccount, showMenus(['taskCenter'], ['taskCenter']))

    expect(hiddenItems).toEqual([])
    expect(visibleItems.map((i) => i.id)).toEqual(['a', 'p1', 'c1', 'taskCenter'])
  })
})

describe('showMenus', () => {
  it('把选中项从隐藏集合移除，其余保持不变', () => {
    expect(showMenus(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
  })

  it('移除不存在的 id 不产生副作用', () => {
    expect(showMenus(['a'], ['zzz'])).toEqual(['a'])
  })

  it('空选中列表直接返回原引用', () => {
    const hidden = ['a']
    expect(showMenus(hidden, [])).toBe(hidden)
  })
})

describe('hideMenus', () => {
  it('并入隐藏集合并去重', () => {
    expect(hideMenus(['a'], ['b', 'a'])).toEqual(['a', 'b'])
  })

  it('空选中列表直接返回原引用', () => {
    const hidden = ['a']
    expect(hideMenus(hidden, [])).toBe(hidden)
  })
})

describe('shouldScrollMenu', () => {
  it('恰好等于阈值时不滚动', () => {
    expect(shouldScrollMenu(15, 15)).toBe(false)
  })

  it('超过阈值时滚动', () => {
    expect(shouldScrollMenu(16, 15)).toBe(true)
  })
})

describe('sortMenusByOrder', () => {
  it('按顺序表重排，跨来源调序同样生效', () => {
    const sorted = sortMenusByOrder(ITEMS, ['c1', 'a', 'p1'])

    expect(sorted.map((i) => i.id)).toEqual(['c1', 'a', 'p1'])
  })

  it('顺序表为空时保持原顺序且返回原引用', () => {
    expect(sortMenusByOrder(ITEMS, [])).toBe(ITEMS)
  })

  it('顺序表里未列出的项稳定地排在后面', () => {
    // 新装的插件、刚加的菜单不会因为没进顺序表而跑到最前面
    const sorted = sortMenusByOrder(ITEMS, ['c1'])

    expect(sorted.map((i) => i.id)).toEqual(['c1', 'a', 'p1'])
  })

  it('顺序表里的已删除 id 被忽略，不打乱现有条目', () => {
    const sorted = sortMenusByOrder(ITEMS, ['removed', 'p1', 'gone', 'a'])

    expect(sorted.map((i) => i.id)).toEqual(['p1', 'a', 'c1'])
  })

  it('不修改入参数组', () => {
    const original = [...ITEMS]
    sortMenusByOrder(ITEMS, ['c1', 'p1', 'a'])

    expect(ITEMS).toEqual(original)
  })
})

describe('moveMenuBefore', () => {
  /** 完整顺序：a / p1 已显示，c1 已隐藏 */
  const ORDER = ['a', 'p1', 'c1']
  const VISIBLE = ['a', 'p1']

  it('向下拖动：把前一项移到目标位置', () => {
    expect(moveMenuBefore(ORDER, VISIBLE, 'a', 'p1')).toEqual(['p1', 'a', 'c1'])
  })

  it('向上拖动：把后一项移到目标位置', () => {
    expect(moveMenuBefore(['a', 'p1', 'c1'], ['a', 'p1'], 'p1', 'a')).toEqual(['p1', 'a', 'c1'])
  })

  it('已隐藏项始终排在已显示项之后', () => {
    const next = moveMenuBefore(ORDER, VISIBLE, 'p1', 'a')

    expect(next.slice(0, 2)).toEqual(['p1', 'a'])
    expect(next).toContain('c1')
  })

  it('拖到自己身上时返回原顺序', () => {
    expect(moveMenuBefore(ORDER, VISIBLE, 'a', 'a')).toBe(ORDER)
  })

  it('拖动不存在的条目时返回原顺序', () => {
    expect(moveMenuBefore(ORDER, VISIBLE, 'ghost', 'a')).toBe(ORDER)
  })

  it('顺序表里残留的已删除 id 保留在末尾，不丢失也不前移', () => {
    const next = moveMenuBefore(['a', 'p1', 'removed'], ['a', 'p1'], 'p1', 'a')

    expect(next).toEqual(['p1', 'a', 'removed'])
  })
})

describe('moveMenuTo', () => {
  /** 完整顺序：a / p1 / c1 已显示，h1 已隐藏 */
  const ORDER = ['a', 'p1', 'c1', 'h1']
  const VISIBLE = ['a', 'p1', 'c1']

  it('向后拖动：拖起项落到目标下标', () => {
    // a 拖到第 3 位，中间两项前移
    expect(moveMenuTo(ORDER, VISIBLE, 0, 2)).toEqual(['p1', 'c1', 'a', 'h1'])
  })

  it('向前拖动：拖起项落到目标下标', () => {
    expect(moveMenuTo(ORDER, VISIBLE, 2, 0)).toEqual(['c1', 'a', 'p1', 'h1'])
  })

  it('相邻换位', () => {
    expect(moveMenuTo(ORDER, VISIBLE, 0, 1)).toEqual(['p1', 'a', 'c1', 'h1'])
  })

  it('原地不动时返回原引用，避免无意义的草稿更新', () => {
    expect(moveMenuTo(ORDER, VISIBLE, 1, 1)).toBe(ORDER)
  })

  it('下标越界时返回原引用', () => {
    expect(moveMenuTo(ORDER, VISIBLE, -1, 1)).toBe(ORDER)
    expect(moveMenuTo(ORDER, VISIBLE, 3, 1)).toBe(ORDER)
    expect(moveMenuTo(ORDER, VISIBLE, 0, -1)).toBe(ORDER)
    expect(moveMenuTo(ORDER, VISIBLE, 0, 3)).toBe(ORDER)
  })

  it('已隐藏项始终留在已显示项之后', () => {
    const next = moveMenuTo(ORDER, VISIBLE, 0, 2)

    expect(next.slice(0, 3)).toEqual(['p1', 'c1', 'a'])
    expect(next[3]).toBe('h1')
  })

  it('顺序表里残留的已删除 id 保留在末尾，不丢失也不前移', () => {
    expect(moveMenuTo(['a', 'p1', 'removed'], ['a', 'p1'], 1, 0)).toEqual(['p1', 'a', 'removed'])
  })

  it('不修改入参数组', () => {
    const order = [...ORDER]
    const visible = [...VISIBLE]

    moveMenuTo(order, visible, 0, 2)

    expect(order).toEqual(ORDER)
    expect(visible).toEqual(VISIBLE)
  })
})

/**
 * 穿梭框「已显示」栏的渲染顺序 = sortMenusByOrder(items, 草稿顺序) 之后按显隐拆分。
 * 这里把这条链路原样拼出来：拖动只写草稿、还没保存时，栏内顺序也必须立刻变化，
 * 否则用户松手后看到条目没动，会以为拖拽失效。
 */
function visiblePaneOrder(
  items: NavMenuItem[],
  draftOrder: string[],
  hiddenIds: string[],
): string[] {
  const ordered = sortMenusByOrder(items, draftOrder)
  return splitMenusByHidden(ordered, hiddenIds).visibleItems.map((item) => item.id)
}

describe('拖曳后「已显示」栏的渲染顺序', () => {
  const CATALOG: NavMenuItem[] = [
    menu('a'),
    menu('p1', 'plugin'),
    menu('c1', 'custom'),
    menu('h1', 'plugin'),
  ]

  it('草稿顺序未变时沿用清单原顺序', () => {
    expect(visiblePaneOrder(CATALOG, ['a', 'p1', 'c1', 'h1'], ['h1'])).toEqual(['a', 'p1', 'c1'])
  })

  it('拖动只落草稿、尚未保存，栏内顺序就跟着变', () => {
    const draft = moveMenuTo(['a', 'p1', 'c1', 'h1'], ['a', 'p1', 'c1'], 0, 2)

    expect(draft).toEqual(['p1', 'c1', 'a', 'h1'])
    expect(visiblePaneOrder(CATALOG, draft, ['h1'])).toEqual(['p1', 'c1', 'a'])
  })

  it('已隐藏栏的相对顺序不受已显示栏拖动影响', () => {
    const draft = moveMenuTo(['a', 'p1', 'c1', 'h1'], ['a', 'p1', 'c1'], 0, 2)
    const ordered = sortMenusByOrder(CATALOG, draft)

    expect(splitMenusByHidden(ordered, ['h1']).hiddenItems.map((i) => i.id)).toEqual(['h1'])
  })

  it('顺序表为空时退回清单原顺序，不把条目排丢', () => {
    expect(visiblePaneOrder(CATALOG, [], [])).toEqual(['a', 'p1', 'c1', 'h1'])
  })
})

