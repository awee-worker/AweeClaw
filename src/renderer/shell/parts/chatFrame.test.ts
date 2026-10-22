import { describe, it, expect } from 'vitest'
import type { PartPresentation } from '@shared/protocols/scenario-regions'
import { CHAT_CONTENT_KEY, resolveChatFrame } from './chatFrame'

const PRESENTATIONS: PartPresentation[] = ['inline', 'drawer', 'modal']

function frameFor(presentation: PartPresentation, visible: boolean, flexible = false) {
  return resolveChatFrame({
    presentation,
    visible,
    width: 360,
    flexible,
    minWidth: 320,
  })
}

describe('resolveChatFrame - 结构不变量', () => {
  it('任何呈现形态与显隐组合下内容子树标识都一致', () => {
    const keys = new Set<string>()
    for (const presentation of PRESENTATIONS) {
      for (const visible of [true, false]) {
        keys.add(frameFor(presentation, visible).contentKey)
      }
    }

    // 只有一个取值：切换形态只换外框，内容结构不变，ChatPanel 不会被重建
    expect([...keys]).toEqual([CHAT_CONTENT_KEY])
  })

  it('呈现形态只改变外框样式，不改变内容标识', () => {
    const inline = frameFor('inline', true)
    const drawer = frameFor('drawer', true)
    const modal = frameFor('modal', true)

    expect(drawer.contentKey).toBe(inline.contentKey)
    expect(modal.contentKey).toBe(inline.contentKey)
    expect(drawer.style).not.toEqual(inline.style)
    expect(modal.style).not.toEqual(drawer.style)
  })
})

describe('resolveChatFrame - inline', () => {
  it('展开时按宽度固定，收起时用 display:none 而不是卸载', () => {
    const shown = frameFor('inline', true)
    const hidden = frameFor('inline', false)

    expect(shown.style.width).toBe(360)
    expect(hidden.style.display).toBe('none')
    // 收起态不再渲染拖拽手柄
    expect(shown.resizable).toBe(true)
    expect(hidden.resizable).toBe(false)
  })

  it('撑满模式不设宽度，返回 min-w-0 的类名', () => {
    const frame = frameFor('inline', true, true)

    expect(frame.style.width).toBeUndefined()
    expect(frame.style.flex).toBe('1 1 0%')
    expect(frame.className).toContain('min-w-0')
    expect(frame.resizable).toBe(false)
  })

  it('inline 不需要遮罩', () => {
    expect(frameFor('inline', true).needsBackdrop).toBe(false)
  })
})

describe('resolveChatFrame - drawer / modal', () => {
  it('抽屉收起时滑出视口且不可交互', () => {
    const hidden = frameFor('drawer', false)

    expect(hidden.style.position).toBe('fixed')
    expect(hidden.style.transform).toBe('translateX(100%)')
    expect(hidden.style.visibility).toBe('hidden')
    expect(hidden.style.pointerEvents).toBe('none')
    expect(hidden.needsBackdrop).toBe(false)
  })

  it('抽屉展开时回到原位并挂遮罩，且不渲染拖拽手柄', () => {
    const shown = frameFor('drawer', true)

    expect(shown.style.transform).toBe('translateX(0)')
    expect(shown.style.visibility).toBe('visible')
    expect(shown.needsBackdrop).toBe(true)
    expect(shown.resizable).toBe(false)
  })

  it('弹窗收起时透明隐藏，展开时居中显示', () => {
    const shown = frameFor('modal', true)
    const hidden = frameFor('modal', false)

    expect(shown.style.transform).toBe('translate(-50%, -50%)')
    expect(shown.style.opacity).toBe(1)
    expect(hidden.style.opacity).toBe(0)
    expect(hidden.style.visibility).toBe('hidden')
    expect(hidden.needsBackdrop).toBe(false)
  })
})
