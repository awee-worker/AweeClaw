import { describe, it, expect } from 'vitest'
import {
  computeSubMenuPlacement,
  SUBMENU_GAP,
  SUBMENU_VIEWPORT_MARGIN,
} from '@/renderer/components/layout/quickSettingsPlacement'

const viewport = { width: 1280, height: 800 }

/** 一级项贴着屏幕底部：用户菜单就是在这个位置向上堆叠的 */
const bottomAnchor = { top: 700, bottom: 732, left: 16, right: 216 }

/** 一级项靠上：下方空间充足 */
const topAnchor = { top: 40, bottom: 72, left: 16, right: 216 }

describe('computeSubMenuPlacement', () => {
  it('顶边与一级项顶部对齐，向下展开', () => {
    const placement = computeSubMenuPlacement(topAnchor, viewport, 'right', 240)

    expect(placement.top).toBe(topAnchor.top)
    expect(SUBMENU_GAP).toBe(5)
  })

  it('一级项靠近底部、面板放不下时整体上移，底边不越过视口', () => {
    const panelHeight = 400
    const placement = computeSubMenuPlacement(
      bottomAnchor,
      viewport,
      'right',
      240,
      panelHeight,
    )

    const limitBottom = viewport.height - SUBMENU_VIEWPORT_MARGIN
    // 上移后底边正好贴住安全边距

    expect(placement.top + panelHeight).toBe(limitBottom)
    expect(placement.top).toBeLessThan(bottomAnchor.top)
    // 仍是向下展开的形态，没有钉死在顶部
    expect(placement.top).toBeGreaterThan(SUBMENU_VIEWPORT_MARGIN)
  })

  it('面板放得下时不做任何上移', () => {
    // 顶部一级项下方有 700 多像素，200 高的面板完全放得下
    const panelHeight = 200
    const placement = computeSubMenuPlacement(
      topAnchor,
      viewport,
      'right',
      240,
      panelHeight,
    )

    expect(placement.top).toBe(topAnchor.top)

    expect(placement.maxHeight).toBe(
      viewport.height - SUBMENU_VIEWPORT_MARGIN - placement.top,
    )
  })

  it('向右展开时贴在一级项右侧，留出 5px 缝隙', () => {
    const placement = computeSubMenuPlacement(topAnchor, viewport, 'right', 240)
    expect(placement.left).toBe(topAnchor.right + SUBMENU_GAP)
  })

  it('向左展开时贴在一级项左侧，窗口过窄则夹在视口内', () => {
    const leftAnchor = { top: 40, bottom: 72, left: 1080, right: 1104 }
    expect(
      computeSubMenuPlacement(leftAnchor, viewport, 'left', 240).left,
    ).toBe(leftAnchor.left - SUBMENU_GAP - 240)

    const narrow = computeSubMenuPlacement(
      leftAnchor,
      { width: 600, height: 800 },
      'left',
      240,
    )
    expect(narrow.left).toBe(600 - 240 - SUBMENU_VIEWPORT_MARGIN)
    expect(narrow.left + 240).toBeLessThanOrEqual(600 - SUBMENU_VIEWPORT_MARGIN)
  })

  it('视口比面板还矮时，面板贴顶部安全边距并在内部滚动', () => {
    const shortViewport = { width: 1280, height: 300 }
    const anchor = { top: 120, bottom: 152, left: 16, right: 216 }
    const placement = computeSubMenuPlacement(anchor, shortViewport, 'right', 240, 600)

    expect(placement.top).toBe(SUBMENU_VIEWPORT_MARGIN)
    expect(placement.maxHeight).toBe(300 - SUBMENU_VIEWPORT_MARGIN * 2)
    expect(placement.maxHeight).toBeGreaterThan(0)
  })
})
