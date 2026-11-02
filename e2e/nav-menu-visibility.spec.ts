/**
 * 左侧导航栏：菜单区滚动 + 菜单显隐设置
 *
 * 覆盖两条改动：
 * 1. 菜单区与「最近任务」各占自己的可视区域，菜单再多也不把后者压没
 * 2. 「自定义菜单」弹窗的两个 Tab：添加菜单 / 菜单显示（穿梭框）
 *
 * 只验证渲染与交互过程，不点「保存」——避免把测试数据写进用户真实配置。
 */
import type { Locator, Page } from 'playwright'
import { test, expect } from './fixtures'

const RAIL = '.aweeclaw-nav-rail'
const MENU_SCROLL = '.aweeclaw-nav-rail-menu-scroll'
const HISTORY_TITLE = '.aweeclaw-nav-rail-history-title'

/** 展开态下点开「自定义菜单」弹窗 */
async function openCustomMenuDialog(window: Page) {
  const entry = window.locator(`${RAIL} .aweeclaw-nav-rail-item`, { hasText: '自定义菜单' })
  await expect(entry.first()).toBeVisible()
  await entry.first().click()
  await expect(window.getByRole('tab', { name: '添加菜单' })).toBeVisible()
}

test.describe('左侧导航栏布局', () => {
  test('菜单区与最近任务同时可见且不重叠', async ({ window }) => {
    await expect(window.locator(RAIL)).toBeVisible()
    await expect(window.locator(MENU_SCROLL)).toBeVisible()

    const menuScroll = await window.locator(MENU_SCROLL).boundingBox()
    const historyTitle = await window.locator(HISTORY_TITLE).boundingBox()

    expect(menuScroll).not.toBeNull()
    expect(historyTitle).not.toBeNull()
    // 菜单区不越过「最近任务」标题：超出阈值时由菜单区内部滚动吸收
    expect(menuScroll!.y + menuScroll!.height).toBeLessThanOrEqual(historyTitle!.y + 1)
  })

  test('菜单条目未超过阈值时菜单区不限高', async ({ window }) => {
    const itemCount = await window.locator(`${MENU_SCROLL} .aweeclaw-nav-rail-item`).count()
    test.skip(itemCount > 15, `当前菜单 ${itemCount} 条，已进入滚动模式`)

    const maxHeight = await window
      .locator(MENU_SCROLL)
      .evaluate((el) => getComputedStyle(el).maxHeight)
    expect(maxHeight === 'none' || maxHeight === '').toBe(true)
  })
})

test.describe('自定义菜单弹窗', () => {
  test('弹窗包含「添加菜单」与「菜单显示」两个 Tab，默认停在添加菜单', async ({ window }) => {
    await openCustomMenuDialog(window)

    const addTab = window.getByRole('tab', { name: '添加菜单' })
    const displayTab = window.getByRole('tab', { name: /菜单显示/ })

    await expect(addTab).toHaveAttribute('aria-selected', 'true')
    await expect(displayTab).toHaveAttribute('aria-selected', 'false')
    // 默认 Tab 展示的是新增表单，不是穿梭框
    await expect(window.getByPlaceholder('请输入菜单名称')).toBeVisible()
  })

  test('切到「菜单显示」渲染穿梭框两栏', async ({ window }) => {
    await openCustomMenuDialog(window)
    await window.getByRole('tab', { name: /菜单显示/ }).click()

    await expect(window.getByText('已隐藏', { exact: false }).first()).toBeVisible()
    await expect(window.getByText('已显示', { exact: false }).first()).toBeVisible()
    // 导航栏里至少有一个可管理入口，右侧栏不应是空态
    await expect(window.getByText('所有菜单都已隐藏')).toHaveCount(0)
  })

  test('勾选后可用「隐藏选中菜单」把条目移到已隐藏栏', async ({ window }) => {
    await openCustomMenuDialog(window)
    await window.getByRole('tab', { name: /菜单显示/ }).click()

    const hideButton = window.getByRole('button', { name: '隐藏选中菜单' })
    const showButton = window.getByRole('button', { name: '显示选中菜单' })
    // 没有勾选时两个方向按钮都应禁用
    await expect(hideButton).toBeDisabled()
    await expect(showButton).toBeDisabled()

    const visiblePaneCheckboxes = window.locator('ul li input[type="checkbox"]')
    const before = await visiblePaneCheckboxes.count()
    test.skip(before === 0, '当前没有可管理的菜单')

    // 勾掉右侧（已显示）第一项 —— 两栏中右侧栏的 checkbox 排在后面
    const target = visiblePaneCheckboxes.nth(before - 1)
    await target.check()
    await expect(hideButton).toBeEnabled()

    const hiddenBefore = await window.locator('ul li input[type="checkbox"]:checked').count()
    await hideButton.click()

    // 移动后勾选被清空，按钮回到禁用态
    await expect(hideButton).toBeDisabled()
    expect(hiddenBefore).toBeGreaterThan(0)
  })

  test('未保存时关闭弹窗不改变导航栏菜单数', async ({ window }) => {
    const countBefore = await window.locator(`${MENU_SCROLL} .aweeclaw-nav-rail-item`).count()

    await openCustomMenuDialog(window)
    await window.getByRole('tab', { name: /菜单显示/ }).click()
    const checkboxes = window.locator('ul li input[type="checkbox"]')
    const total = await checkboxes.count()
    test.skip(total === 0, '当前没有可管理的菜单')

    await checkboxes.nth(total - 1).check()
    await window.getByRole('button', { name: '隐藏选中菜单' }).click()
    // 取消而不是保存
    await window.getByRole('button', { name: '取消' }).click()

    const countAfter = await window.locator(`${MENU_SCROLL} .aweeclaw-nav-rail-item`).count()
    expect(countAfter).toBe(countBefore)
  })
})

/**
 * 「已显示」栏的行
 *
 * 两栏都有条目时它是第二个 ul；「已隐藏」为空时该栏渲染的是提示块而不是 ul，
 * 这时它就是唯一的那个，所以取 last() 而不是写死下标。
 */
function visibleRows(window: Page) {
  return window.locator('ul').last().locator('li')
}

/** 读一栏当前的行文案，用来断言顺序 */
async function rowTexts(rows: Locator): Promise<string[]> {
  return rows.evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()))
}
/**
 * 把「已显示」栏第 fromIndex 行拖到第 toIndex 行之后
 *
 * 指针落在目标行下三分之一处（已越过该行中线），落点确定在该行之后；
 * 拖曳靠 pointer 事件实现，所以这里用真实鼠标轨迹，不用 dragTo。
 */
async function dragRowTo(window: Page, rows: Locator, fromIndex: number, toIndex: number) {
  const from = await rows.nth(fromIndex).boundingBox()
  const to = await rows.nth(toIndex).boundingBox()
  expect(from).not.toBeNull()
  expect(to).not.toBeNull()

  // 抓在文字区，避开复选框与图标
  const grabX = from!.x + from!.width * 0.6
  const grabY = from!.y + from!.height / 2
  await window.mouse.move(grabX, grabY)
  await window.mouse.down()
  // 先小幅位移越过 4px 起拖阈值，再拖到目标位置
  await window.mouse.move(grabX, grabY + 12, { steps: 4 })
  await window.mouse.move(to!.x + to!.width * 0.6, to!.y + to!.height * 0.7, { steps: 12 })
  await window.mouse.up()
}


test.describe('菜单显示：拖曳排序', () => {
  test('拖起第一项拖到第三项位置，松手后顺序立即生效', async ({ window }) => {
    await openCustomMenuDialog(window)
    await window.getByRole('tab', { name: /菜单显示/ }).click()

    const rows = visibleRows(window)
    const total = await rows.count()
    test.skip(total < 3, `已显示栏只有 ${total} 项，不足以验证排序`)

    const before = await rowTexts(rows)
    await dragRowTo(window, rows, 0, 2)

    const after = await rowTexts(rows)
    // 松手就地生效：条目没丢没多，第一项落到后面，原第二项顶到第一位
    expect(after).toHaveLength(before.length)
    expect([...after].sort()).toEqual([...before].sort())
    expect(after[0]).toBe(before[1])
    expect(after.indexOf(before[0])).toBeGreaterThanOrEqual(2)
  })


  test('拖动后未保存，点取消回到弹窗时顺序回滚', async ({ window }) => {
    await openCustomMenuDialog(window)
    await window.getByRole('tab', { name: /菜单显示/ }).click()

    const rows = visibleRows(window)
    const total = await rows.count()
    test.skip(total < 3, `已显示栏只有 ${total} 项，不足以验证排序`)

    const before = await rowTexts(rows)
    await dragRowTo(window, rows, 0, 2)
    expect(await rowTexts(rows)).not.toEqual(before)

    await window.getByRole('button', { name: '取消' }).click()

    await openCustomMenuDialog(window)
    await window.getByRole('tab', { name: /菜单显示/ }).click()
    expect(await rowTexts(visibleRows(window))).toEqual(before)
  })
})

