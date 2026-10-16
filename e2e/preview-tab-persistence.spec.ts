/**
 * 内置浏览器预览 Tab 常驻挂载：真实应用回归
 *
 * 背景：预览 Tab 若在切走时被卸载，其 <webview> 会随组件销毁，主进程随即解绑
 * 该会话的健康采集与自动化记录（PreviewHealthMonitor.detach）。表现为标签页在
 * UI 上还开着，但 AI 的 browser_* 工具定位不到它（报 "No preview tab found"），
 * 且切回来整页重载。
 *
 * 本用例在真实 Electron 应用里复跑「打开预览 → 切到别的 Tab」这一步，断言预览
 * Tab 的 <webview> 仍然挂在 DOM 上（只是隐藏），即未被卸载。
 *
 * 通过 window.__AWEECLAW_STORE__（生产环境亦暴露）直接驱动 store，避免依赖
 * AI/网络，让断言只针对「挂载生命周期」这一件事。
 */

import { test, expect } from '@playwright/test'
import { _electron as electron, type ElectronApplication, type Page } from 'playwright'
import path from 'path'
import fs from 'fs'
import os from 'os'

/** 预览会话与文件 Tab 的固定标识，跨断言复用 */
const PREVIEW_SESSION_ID = 'e2e-preview-session'
const PREVIEW_URL = 'http://127.0.0.1:59999/'
const FILE_PATH = '/e2e-sample.txt'

let app: ElectronApplication
let window: Page

// 首次启动要过引导向导，启动阶段留足时间
test.setTimeout(120000)

test.beforeAll(async () => {
  // 隔离 profile：单实例锁以 userData 目录为键，换个目录即可与已运行实例并存
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aweeclaw-e2e-'))
  app = await electron.launch({
    args: [path.join(__dirname, '..'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, NODE_ENV: 'test' },
  })
  window = await app.firstWindow()

  // 渲染层错误会让断言莫名其妙地失败，这里把控制台与页面异常留证
  window.on('pageerror', (err) => console.log('[e2e][pageerror]', err.message))
  window.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[e2e][console.error]', msg.text())
  })

  await window.waitForLoadState('domcontentloaded')

  await trySkipOnboarding()
  // 引导完成后页面可能重载：重新解析出真正挂载了 store 的窗口
  window = await pageWithStore()
})

test.afterAll(async () => {
  await app?.close()
})

/** 等待 store 挂到 window（应用初始化完成的前置信号） */
async function waitForStore(): Promise<void> {
  await window.waitForFunction(
    () => Boolean((window as unknown as { __AWEECLAW_STORE__?: unknown }).__AWEECLAW_STORE__),
    undefined,
    { timeout: 60000 },
  )
}

/**
 * 尝试跳过首次启动的引导向导
 *
 * 全新 profile 会进入引导向导，此时工作区（编辑器）尚未挂载；跳过它才能到达
 * 可驱动预览 Tab 的主界面。已初始化过时没有该按钮，直接返回。
 */
async function trySkipOnboarding(): Promise<void> {
  for (const page of app.windows()) {
    const skip = page.getByRole('button', { name: '跳过引导' })
    try {
      await skip.waitFor({ state: 'visible', timeout: 10000 })
      await skip.click()
      return
    } catch {
      // 该窗口没有引导页，尝试下一个
    }
  }
}

/**
 * 解析出已挂载 store 的窗口
 *
 * 引导完成、设置保存后应用可能重载页面；复用旧句柄会一直等不到 store。
 * 这里按窗口轮询 __AWEECLAW_STORE__，拿到真正可驱动的页面。
 */
async function pageWithStore(timeoutMs = 90000): Promise<Page> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    for (const page of app.windows()) {
      try {
        const hasStore = await page.evaluate(
          () => Boolean((window as unknown as { __AWEECLAW_STORE__?: unknown }).__AWEECLAW_STORE__),
        )
        if (hasStore) return page
      } catch {
        // 页面可能正在导航，跳过
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('等待 __AWEECLAW_STORE__ 超时：没有窗口挂载 store')
}

/** 打开一个预览 Tab 并切到一个普通文件 Tab */
async function openPreviewThenSwitchAway(): Promise<void> {
  await window.evaluate(
    ({ sessionId, url, filePath }) => {
      const store = (window as unknown as {
        __AWEECLAW_STORE__: { getState: () => Record<string, (...args: unknown[]) => unknown> }
      }).__AWEECLAW_STORE__
      const state = store.getState()
      // showWelcomePage 为 true 时主界面根本不渲染编辑器，先关掉它
      ;(state.setShowWelcomePage as (show: boolean) => void)(false)
      // 打开预览并激活
      state.openPreview(
        { sessionId, url, title: 'E2E Preview', source: 'manual' },
        { activate: true },
      )
      // 再开一个普通文件 Tab，供切换目标
      state.openFile(filePath, 'e2e sample content', undefined)
    },
    { sessionId: PREVIEW_SESSION_ID, url: PREVIEW_URL, filePath: FILE_PATH },
  )
}

test.describe('预览 Tab 常驻挂载', () => {
  test('切到别的 Tab 后预览 webview 仍在 DOM 中（未被卸载）', async () => {
    await waitForStore()

    await openPreviewThenSwitchAway()

    // 预览激活时：webview 应已挂载
    await expect(window.locator('webview')).toHaveCount(1, { timeout: 15000 })

    // 切到普通文件 Tab
    await window.evaluate((filePath) => {
      const store = (window as unknown as {
        __AWEECLAW_STORE__: { getState: () => Record<string, (...args: unknown[]) => unknown> }
      }).__AWEECLAW_STORE__
      ;(store.getState().setActiveFile as (path: string) => void)(filePath)
    }, FILE_PATH)

    // 关键断言：切走后 webview 仍然存在（隐藏而非卸载）。
    // 若回归为「切走即卸载」，这里的数量会变成 0。
    await expect(window.locator('webview')).toHaveCount(1, { timeout: 10000 })
  })
})
