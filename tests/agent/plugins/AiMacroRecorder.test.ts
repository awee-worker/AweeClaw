/**
 * AI Macro Recorder 插件 - 单元测试
 *
 * 重点测试宏回放步骤分发逻辑（MacroPlayer.executeStep），
 * 确保每种 action 类型正确映射到 DesktopControlManager 的对应方法，
 * 并正确处理失败情况和参数校验。
 */
import { describe, it, expect } from 'vitest'
import { z } from 'zod'

// ============================================================
// Mock Host 桥（必须在 import 插件前同步设置，因为插件顶层会调用 getHost()）
// ============================================================
;(globalThis as any).__AWEECLAW_HOST__ = {
  z,
  McpServer: class McpServer {
    constructor() {}
    tool() {}
    connect() { return Promise.resolve() }
  },
  InMemoryTransport: {
    createLinkedPair: () => [
      { send() {}, close() {} },
      { send() {}, close() {} },
    ],
  },
  logger: {
    mcp: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    },
  },
  inputListener: {
    startScreenshotStream: () => 'stream-test',
    stopScreenshotStream: () => true,
  },
  cronScheduler: {
    register: () => 'task-test',
    getTask: () => ({ nextRunAt: Date.now() + 3600000 }),
    listTasksByPlugin: () => [],
    unregister: () => true,
    triggerNow: async () => ({ success: true, taskId: 'task-test', runCount: 0 }),
  },
}

const { MacroPlayer } = await import(/* @vite-ignore */ '../../../../aweeclaw-plugins/plugins/ai-macro-recorder/index.js')

// ============================================================
// Mock DesktopControlManager
// ============================================================

/** 创建 mock DesktopControlManager，记录所有调用参数（rest 参数数组） */
function createMockDesktop(overrides?: Record<string, () => any>) {
  const calls: Record<string, any[][]> = {}
  const defaultResult = { success: true }

  const track = (name: string) => (...args: any[]) => {
    calls[name] = calls[name] || []
    calls[name].push(args)
    return overrides?.[name]?.() ?? defaultResult
  }

  return {
    calls,
    mouseClick: track('mouseClick'),
    typeText: track('typeText'),
    pressKey: track('pressKey'),
    keyCombo: track('keyCombo'),
    mouseScroll: track('mouseScroll'),
    mouseDrag: track('mouseDrag'),
    openUrl: track('openUrl'),
    launchApp: track('launchApp'),
  }
}

// ============================================================
// 测试用例
// ============================================================

describe('ai-macro-recorder: MacroPlayer.executeStep', () => {
  const player = new MacroPlayer()

  it('click_at 调用 mouseClick 且参数正确', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, { action: 'click_at', x: 100, y: 200 })
    expect(desktop.calls.mouseClick).toHaveLength(1)
    expect(desktop.calls.mouseClick[0][0]).toEqual({
      x: 100,
      y: 200,
      button: 'left',
      clickType: 'single',
    })
  })

  it('double_click_at 调用 mouseClick with clickType=double', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, { action: 'double_click_at', x: 50, y: 60 })
    expect(desktop.calls.mouseClick[0][0]).toEqual({
      x: 50,
      y: 60,
      button: 'left',
      clickType: 'double',
    })
  })

  it('right_click_at 调用 mouseClick with button=right', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, { action: 'right_click_at', x: 10, y: 20 })
    expect(desktop.calls.mouseClick[0][0]).toEqual({
      x: 10,
      y: 20,
      button: 'right',
      clickType: 'single',
    })
  })

  it('click_at 支持自定义 button 和 clickType', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, {
      action: 'click_at',
      x: 1,
      y: 2,
      button: 'middle',
      clickType: 'triple',
    })
    expect(desktop.calls.mouseClick[0][0]).toEqual({
      x: 1,
      y: 2,
      button: 'middle',
      clickType: 'triple',
    })
  })

  it('type_text 调用 typeText', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, { action: 'type_text', text: 'hello' })
    expect(desktop.calls.typeText).toHaveLength(1)
    expect(desktop.calls.typeText[0][0]).toBe('hello')
  })

  it('type_text 缺少 text 参数抛错', async () => {
    const desktop = createMockDesktop()
    await expect(player.executeStep(desktop, { action: 'type_text' })).rejects.toThrow(
      'type_text 缺少 text 参数',
    )
  })

  it('press_key 调用 pressKey', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, { action: 'press_key', key: 'Enter' })
    expect(desktop.calls.pressKey[0][0]).toBe('Enter')
  })

  it('press_key 缺少 key 参数抛错', async () => {
    const desktop = createMockDesktop()
    await expect(player.executeStep(desktop, { action: 'press_key' })).rejects.toThrow(
      'press_key 缺少 key 参数',
    )
  })

  it('key_combo 调用 keyCombo', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, { action: 'key_combo', keys: ['Control', 'c'] })
    expect(desktop.calls.keyCombo[0][0]).toEqual(['Control', 'c'])
  })

  it('key_combo 缺少 keys 参数抛错', async () => {
    const desktop = createMockDesktop()
    await expect(player.executeStep(desktop, { action: 'key_combo' })).rejects.toThrow(
      'key_combo 缺少 keys 参数',
    )
  })

  it('scroll 调用 mouseScroll', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, { action: 'scroll', x: 100, y: 200, amount: -5 })
    expect(desktop.calls.mouseScroll[0][0]).toEqual({ x: 100, y: 200, amount: -5 })
  })

  it('scroll 默认值为 0', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, { action: 'scroll' })
    expect(desktop.calls.mouseScroll[0][0]).toEqual({ x: 0, y: 0, amount: 0 })
  })

  it('mouse_drag 调用 mouseDrag', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, {
      action: 'mouse_drag',
      fromX: 0,
      fromY: 0,
      toX: 100,
      toY: 100,
      durationMs: 500,
    })
    expect(desktop.calls.mouseDrag[0][0]).toEqual({
      fromX: 0,
      fromY: 0,
      toX: 100,
      toY: 100,
      button: 'left',
      duration: 500,
    })
  })

  it('open_url 调用 openUrl', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, { action: 'open_url', url: 'https://example.com' })
    expect(desktop.calls.openUrl[0][0]).toBe('https://example.com')
  })

  it('open_url 缺少 url 参数抛错', async () => {
    const desktop = createMockDesktop()
    await expect(player.executeStep(desktop, { action: 'open_url' })).rejects.toThrow(
      'open_url 缺少 url 参数',
    )
  })

  it('launch_app 调用 launchApp', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, { action: 'launch_app', appName: 'Safari', args: ['-u'] })
    expect(desktop.calls.launchApp[0][0]).toBe('Safari')
    expect(desktop.calls.launchApp[0][1]).toEqual(['-u'])
  })

  it('launch_app 缺少 appName 抛错', async () => {
    const desktop = createMockDesktop()
    await expect(player.executeStep(desktop, { action: 'launch_app' })).rejects.toThrow(
      'launch_app 缺少 appName 参数',
    )
  })

  it('wait 步骤不报错', async () => {
    const desktop = createMockDesktop()
    await player.executeStep(desktop, { action: 'wait', durationMs: 10 })
    // wait 不调用任何 desktop 方法
    expect(Object.keys(desktop.calls)).toHaveLength(0)
  })

  it('未知 action 抛错', async () => {
    const desktop = createMockDesktop()
    await expect(
      player.executeStep(desktop, { action: 'unknown_action' }),
    ).rejects.toThrow('未知的宏步骤类型: unknown_action')
  })

  it('操作失败时抛错（含 error 信息）', async () => {
    const desktop = createMockDesktop({
      mouseClick: () => ({ success: false, error: '坐标超出屏幕范围' }),
    })
    await expect(
      player.executeStep(desktop, { action: 'click_at', x: 9999, y: 9999 }),
    ).rejects.toThrow('坐标超出屏幕范围')
  })

  it('操作失败且无 error 字段时抛默认错误', async () => {
    const desktop = createMockDesktop({
      mouseClick: () => ({ success: false }),
    })
    await expect(
      player.executeStep(desktop, { action: 'click_at', x: 1, y: 1 }),
    ).rejects.toThrow('click_at (1,1) failed')
  })
})

describe('ai-macro-recorder: MacroPlayer.play', () => {
  it('宏不存在时抛错', async () => {
    const player = new MacroPlayer()
    await expect(player.play('nonexistent-macro', 1)).rejects.toThrow('宏不存在')
  })

  // 注：完整 play 测试需要 mock MacroStore（模块单例），
  // 这里通过 executeStep 单元测试已覆盖核心分发逻辑
})
