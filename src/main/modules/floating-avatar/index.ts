/**
 * 悬浮头像模块入口（barrel + 编排）
 *
 * 聚合导出 FloatingAvatarManager / TrayManager / AvatarMenu / VoiceContextCache /
 * FloatingAvatarIpc，并提供 initFloatingAvatar(firstWin) 编排函数。
 *
 * initFloatingAvatar 职责：
 * 1. 加载持久化配置
 * 2. 创建头像窗口（不显示，按 showOnStartup 决定）
 * 3. 绑定右键菜单
 * 4. 创建系统托盘
 * 5. 注册 IPC handler（注入 openMainWindow/quitApp/转发回调）
 *
 * 由 moduleInitializer.ts 在「后台异步初始化」段调用（不阻塞启动）。
 */

import { BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { FloatingAvatarManager } from './FloatingAvatarManager'
import { TrayManager } from './TrayManager'
import { AvatarMenu, type AvatarMenuCallbacks } from './AvatarMenu'
import { ScreenshotAskManager } from './ScreenshotAskManager'
import { MeetingNotesManager } from '../meeting-notes/MeetingNotesManager'
import {
  registerFloatingAvatarIpc,
  type FloatingAvatarIpcCallbacks,
  type SaveConversationPayload,
  type VoiceStateChangedPayload,
  type SelectModelPayload,
} from './FloatingAvatarIpc'

export { FloatingAvatarManager } from './FloatingAvatarManager'
export { TrayManager } from './TrayManager'
export { AvatarMenu } from './AvatarMenu'
export type { AvatarMenuCallbacks } from './AvatarMenu'
export { VoiceContextCache } from './VoiceContextCache'
export type { VoiceContext } from './VoiceContextCache'
export {
  registerFloatingAvatarIpc,
  type FloatingAvatarIpcCallbacks,
  type SaveConversationPayload,
  type VoiceStateChangedPayload,
} from './FloatingAvatarIpc'

/** 外部依赖注入（避免直接 import windowManager/appBootstrap 造成循环依赖） */
export interface FloatingAvatarDeps {
  /** 创建/获取主窗口（头像菜单/托盘「打开主窗口」时调用） */
  getOrCreateMainWindow: () => BrowserWindow | null
  /** 主窗口实例（用于监听 dom-ready，延迟显示头像避免启动闪烁） */
  mainWindow: BrowserWindow
  /** 打开设置页面（语音设置），通过主窗口 IPC 通知 */
  openSettings: () => void
  /** 触发完整退出流程 */
  quitApp: () => void
  /** 转发对话历史到主窗口（主窗口写入 IntelligenceStore） */
  forwardSaveConversation: (payload: SaveConversationPayload) => void
  /** 转发语音状态到主窗口（用于主窗口 UI 联动） */
  forwardVoiceStateChanged: (payload: VoiceStateChangedPayload) => void
  /** 读取语音唤醒开关当前状态 */
  isWakeWordEnabled: () => boolean
  /** 切换语音唤醒开关，返回切换后的状态 */
  toggleWakeWord: () => Promise<boolean>
  /** 界面语言 */
  getLanguage: () => 'zh' | 'en'
  /** 获取当前工作区路径（用于截图等本地文件落盘到 .aweeclaw/screenshot） */
  getWorkspacePath: () => string | null
  /** 转发模型列表请求到主窗口（主窗口从 store 构建，通过 models-response 返回） */
  forwardRequestModels: (requestId: string) => void
  /** 转发模型切换到主窗口（主窗口更新 store + save + 重新 push voiceContext） */
  forwardSelectModel: (payload: SelectModelPayload) => void
  /** 转发授权方式切换到主窗口（主窗口更新 store + save + 重新 push voiceContext） */
  forwardSelectAuthorizationMode: (mode: 'every-step' | 'dangerous-only' | 'never') => void
  /** 转发工作模式切换到主窗口（主窗口更新 useModeStore + 重新 push voiceContext） */
  forwardSelectWorkMode: (mode: 'chat' | 'agent' | 'plan') => void
  /** 转发自定义智能体切换到主窗口（主窗口更新 store + save + 重新 push voiceContext） */
  forwardSelectAgent: (agentId: string | null) => void
}

/**
 * 初始化悬浮头像模块
 *
 * 流程：
 * 1. 加载持久化配置（位置/尺寸/开关）
 * 2. 注册 IPC handler（注入回调）
 * 3. 创建头像窗口（按 showOnStartup 决定是否显示）
 * 4. 绑定右键菜单
 * 5. 创建系统托盘
 *
 * 幂等：重复调用安全（单例 + registered 标志）。
 *
 * @param deps 外部依赖（由 moduleInitializer 注入）
 */
export function initFloatingAvatar(deps: FloatingAvatarDeps): void {
  try {
    const manager = FloatingAvatarManager.getInstance()
    const tray = TrayManager.getInstance()

    // 1. 加载持久化配置
    manager.loadConfig()
    const config = manager.getConfig()

    // 2. 注册 IPC handler
    // 截图提问管理器：右键菜单「截图提问」和迷你助手截图按钮共用，
    // 截图完成后落盘 + 推送 base64 到头像窗口（作为附件添加到输入框）
    const screenshotAskManager = new ScreenshotAskManager(deps.getWorkspacePath)
    // 截图流程的窗口可见性回调：start 时隐藏迷你助手避免遮挡桌面，end 时恢复
    // 迷你助手按钮和右键菜单共用同一回调，确保两条入口行为一致
    const onScreenshotVisibilityChange = (phase: 'start' | 'end') => {
      if (phase === 'start') {
        // 截图覆盖窗口全屏显示前，隐藏迷你助手避免遮挡桌面
        manager.hide()
      } else {
        // 截图流程结束，恢复迷你助手显示（用户从迷你助手发起截图，本就期望恢复显示）
        manager.show()
      }
    }
    const ipcCallbacks: FloatingAvatarIpcCallbacks = {
      openMainWindow: () => {
        const win = deps.getOrCreateMainWindow()
        if (win) {
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
        }
      },
      quitApp: () => deps.quitApp(),
      forwardSaveConversation: (payload) => deps.forwardSaveConversation(payload),
      forwardVoiceStateChanged: (payload) => deps.forwardVoiceStateChanged(payload),
      isWakeWordEnabled: () => deps.isWakeWordEnabled(),
      toggleWakeWord: () => deps.toggleWakeWord(),
      forwardRequestModels: (requestId) => deps.forwardRequestModels(requestId),
      forwardSelectModel: (payload) => deps.forwardSelectModel(payload),
      forwardSelectAuthorizationMode: (mode) => deps.forwardSelectAuthorizationMode(mode),
      forwardSelectWorkMode: (mode) => deps.forwardSelectWorkMode(mode),
      forwardSelectAgent: (agentId) => deps.forwardSelectAgent(agentId),
      openSettings: () => deps.openSettings(),
      startScreenshotAsk: async () => {
        // 复用右键菜单的 screenshotAskManager 实例，截图完成后推送结果到头像窗口
        try {
          await screenshotAskManager.start(
            (payload) => {
              manager.sendToAvatar('floating-avatar:screenshot-result', payload)
            },
            onScreenshotVisibilityChange,
          )
          return { success: true }
        } catch (err) {
          const screenPermission = (err as { screenPermission?: string })?.screenPermission
          logger.system.warn(
            '[FloatingAvatar] Start screenshot ask failed:',
            err instanceof Error ? err.message : err,
          )
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            ...(screenPermission ? { screenPermission } : {}),
          }
        }
      },
    }
    registerFloatingAvatarIpc(ipcCallbacks)

    // 3. 创建头像窗口
    const avatarWin = manager.create()

    // 4. 绑定右键菜单
    // 会议纪要管理器：右键「会议纪要」触发，显示独立常驻窗口
    // 复用主进程单例（首次 getInstance 注入 getWorkspacePath，后续 show 时幂等注册 IPC）
    const meetingNotesManager = MeetingNotesManager.getInstance(deps.getWorkspacePath)
    const menuCallbacks: AvatarMenuCallbacks = {
      openMainWindow: () => {
        const win = deps.getOrCreateMainWindow()
        if (win) {
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
        }
      },
      startScreenshotAsk: async () => {
        // 右键菜单「截图提问」：同样受屏幕录制权限约束，未授权时返回错误供上层引导
        try {
          await screenshotAskManager.start(
            (payload) => {
              // 截图完成 → 推送到头像窗口（携带 base64 + 落盘路径）
              manager.sendToAvatar('floating-avatar:screenshot-result', payload)
            },
            onScreenshotVisibilityChange,
          )
          return { success: true }
        } catch (err) {
          const screenPermission = (err as { screenPermission?: string })?.screenPermission
          logger.system.warn(
            '[FloatingAvatar] Menu screenshot ask failed:',
            err instanceof Error ? err.message : err,
          )
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            ...(screenPermission ? { screenPermission } : {}),
          }
        }
      },
      startMeetingNotes: () => {
        // 显示会议纪要窗口（已存在则聚焦，不存在则创建）
        meetingNotesManager.show()
      },
      openSettings: () => deps.openSettings(),
      quitApp: () => deps.quitApp(),
      isWakeWordEnabled: () => deps.isWakeWordEnabled(),
      toggleWakeWord: () => deps.toggleWakeWord(),
      notifyWakeWordChanged: () => {
        // 由 IPC handler 内部已通知头像窗口，此处无需重复
      },
    }
    const menu = new AvatarMenu(menuCallbacks)
    menu.setLanguage(deps.getLanguage())
    menu.attach(avatarWin)

    // 5. 创建系统托盘
    tray.create({
      openMainWindow: () => {
        const win = deps.getOrCreateMainWindow()
        if (win) {
          if (win.isMinimized()) win.restore()
          win.show()
          win.focus()
        }
      },
      openSettings: () => deps.openSettings(),
      quitApp: () => deps.quitApp(),
    })
    tray.setLanguage(deps.getLanguage())

    // 6. 按 showOnStartup 决定是否显示头像
    //    延迟到主窗口 dom-ready 后显示，避免应用启动过程中头像先于主窗口出现背景闪烁
    if (config.enabled && config.showOnStartup) {
      const doShow = (): void => {
        try {
          manager.show()
        } catch (err) {
          logger.system.warn('[FloatingAvatar] Delayed show failed:', err)
        }
      }
      // 主窗口已销毁则立即显示，否则等待 webContents dom-ready
      if (deps.mainWindow.isDestroyed() || deps.mainWindow.webContents.isDestroyed()) {
        doShow()
      } else {
        // dom-ready 是 webContents 事件；once 确保只触发一次
        deps.mainWindow.webContents.once('dom-ready', doShow)
        // 兜底：若 dom-ready 已错过（事件在注册前触发），5s 后强制显示
        setTimeout(() => {
          if (!manager.isVisible() && !deps.mainWindow.isDestroyed()) {
            doShow()
          }
        }, 5000)
      }
    }

    logger.system.info('[FloatingAvatar] Initialized', {
      enabled: config.enabled,
      showOnStartup: config.showOnStartup,
    })
  } catch (err) {
    logger.system.error('[FloatingAvatar] Init failed:', err)
  }
}

/**
 * 同步唤醒开关配置到头像窗口（设置页修改唤醒开关后调用）
 *
 * @param enabled 新的开关状态
 */
export function syncWakeWordEnabledToAvatar(enabled: boolean): void {
  FloatingAvatarManager.getInstance().sendToAvatar(
    'floating-avatar:wake-word-toggled',
    enabled,
  )
}
