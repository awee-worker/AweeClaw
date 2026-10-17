/**
 * 悬浮头像窗口「按需创建」回归测试
 *
 * 关注点：初始化阶段不得无条件创建头像 BrowserWindow。
 * - enabled=false 或 showOnStartup=false 时，初始化不应构造任何窗口
 * - 两个开关都为 true 时，只在主窗口 dom-ready 后构造一次
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

/** mock 工厂内的计数器需要提升，避免与 vi.mock 的 hoisting 冲突 */
const state = vi.hoisted(() => ({
  created: 0,
  visible: 0,
  config: {
    enabled: true,
    showOnStartup: true,
    size: 41,
    positionX: null as number | null,
    positionY: null as number | null,
  },
}))

vi.mock('electron', () => {
  class MockBrowserWindow {
    static nextId = 1
    id = MockBrowserWindow.nextId++
    webContents = {
      isDestroyed: () => false,
      isLoading: () => false,
      once: vi.fn(),
      send: vi.fn(),
      on: vi.fn(),
    }
    private visible = false

    constructor() {
      state.created += 1
    }

    setAlwaysOnTop() {}
    setPosition() {}
    getPosition(): [number, number] {
      return [0, 0]
    }
    loadFile() {}
    loadURL() {}
    on() {}
    once() {}
    isDestroyed(): boolean {
      return false
    }
    isVisible(): boolean {
      return this.visible
    }
    showInactive(): void {
      this.visible = true
      state.visible += 1
    }
    show(): void {
      this.visible = true
      state.visible += 1
    }
    hide(): void {
      this.visible = false
    }
    destroy() {}
    focus() {}
    isMinimized(): boolean {
      return false
    }
    restore() {}
  }

  return {
    app: {
      isPackaged: false,
      getPath: () => '/tmp/aweeclaw-test',
      getVersion: () => '0.0.0',
      on: vi.fn(),
      whenReady: () => Promise.resolve(),
      quit: vi.fn(),
    },
    BrowserWindow: MockBrowserWindow,
    screen: {
      getPrimaryDisplay: () => ({
        workAreaSize: { width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
      getDisplayNearestPoint: () => ({
        workAreaSize: { width: 1920, height: 1080 },
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      }),
      getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    },
    ipcMain: {
      on: vi.fn(),
      once: vi.fn(),
      removeListener: vi.fn(),
      handle: vi.fn(),
      removeHandler: vi.fn(),
    },
    Tray: class {
      setToolTip() {}
      setContextMenu() {}
      on() {}
      destroy() {}
    },
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: { createFromPath: () => ({}) },
  }
})

vi.mock('@shared/toolkit/LogEngine', () => ({
  logger: {
    system: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  },
}))

vi.mock('@modules/settings-db/SettingsDb', () => ({
  SettingsDb: {
    getInstance: () => ({
      getAppSetting: () => ({ ...state.config }),
      upsertAppSetting: vi.fn(),
    }),
  },
}))

vi.mock('@main/bootstrap/windowManager', () => ({
  setHideOnCloseEnabled: vi.fn(),
}))

vi.mock('@modules/floating-avatar/TrayManager', () => ({
  TrayManager: {
    getInstance: () => ({
      create: vi.fn(),
      setLanguage: vi.fn(),
      destroy: vi.fn(),
    }),
  },
}))

vi.mock('@modules/floating-avatar/AvatarMenu', () => ({
  AvatarMenu: class {
    setLanguage() {}
    attach() {}
  },
}))

vi.mock('@modules/floating-avatar/ScreenshotAskManager', () => ({
  ScreenshotAskManager: class {
    async start() {}
  },
}))

vi.mock('@modules/meeting-notes/MeetingNotesManager', () => ({
  MeetingNotesManager: {
    getInstance: () => ({ show: vi.fn() }),
  },
}))

vi.mock('@modules/floating-avatar/FloatingAvatarIpc', () => ({
  registerFloatingAvatarIpc: vi.fn(),
}))

import { initFloatingAvatar, FloatingAvatarManager } from '@modules/floating-avatar'

/** 主窗口 mock：暴露 webContents.once，供测试手动触发 dom-ready */
function createMainWindowMock() {
  const handlers = new Map<string, () => void>()
  return {
    handlers,
    window: {
      isDestroyed: () => false,
      webContents: {
        isDestroyed: () => false,
        isLoading: () => false,
        once: (event: string, cb: () => void) => {
          handlers.set(event, cb)
        },
        send: vi.fn(),
      },
      show: vi.fn(),
      focus: vi.fn(),
      isMinimized: () => false,
      restore: vi.fn(),
    },
  }
}

function createDeps(mainWindow: unknown) {
  return {
    getOrCreateMainWindow: () => mainWindow as never,
    mainWindow: mainWindow as never,
    openSettings: vi.fn(),
    quitApp: vi.fn(),
    forwardSaveConversation: vi.fn(),
    forwardVoiceStateChanged: vi.fn(),
    isWakeWordEnabled: () => true,
    toggleWakeWord: async () => true,
    getLanguage: () => 'zh' as const,
    getWorkspacePath: () => '/tmp/workspace',
    forwardRequestModels: vi.fn(),
    forwardSelectModel: vi.fn(),
    forwardSelectAuthorizationMode: vi.fn(),
    forwardSelectWorkMode: vi.fn(),
    forwardSelectAgent: vi.fn(),
  }
}

describe('FloatingAvatar 按需创建', () => {
  beforeEach(() => {
    state.created = 0
    state.visible = 0
    state.config = {
      enabled: true,
      showOnStartup: true,
      size: 41,
      positionX: null,
      positionY: null,
    }
    // 单例跨用例复用，重置窗口引用
    ;(FloatingAvatarManager.getInstance() as unknown as { window: unknown }).window = null
  })

  it('enabled=false 时初始化不创建头像窗口', () => {
    state.config.enabled = false
    const { window } = createMainWindowMock()

    initFloatingAvatar(createDeps(window))

    expect(state.created).toBe(0)
    expect(state.visible).toBe(0)
    expect(FloatingAvatarManager.getInstance().isVisible()).toBe(false)
  })

  it('showOnStartup=false 时初始化不创建头像窗口', () => {
    state.config.showOnStartup = false
    const { window } = createMainWindowMock()

    initFloatingAvatar(createDeps(window))

    expect(state.created).toBe(0)
    expect(state.visible).toBe(0)
  })

  it('两个开关都开启时，仅在主窗口 dom-ready 后创建一次', () => {
    const { window, handlers } = createMainWindowMock()

    initFloatingAvatar(createDeps(window))

    // 初始化阶段只注册回调，不建窗口
    expect(state.created).toBe(0)

    handlers.get('dom-ready')?.()

    expect(state.created).toBe(1)
    expect(state.visible).toBe(1)
    expect(FloatingAvatarManager.getInstance().isVisible()).toBe(true)
  })
})
