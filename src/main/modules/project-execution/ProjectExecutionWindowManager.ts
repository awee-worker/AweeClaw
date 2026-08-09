/**
 * 项目执行窗口管理器（单例）
 *
 * 职责：
 * - 创建/复用项目执行独立窗口（BrowserWindow）
 * - 窗口最小化到悬浮球（缩放动画 → hide）
 * - 从悬浮球恢复窗口（show → 缩放展开动画）
 * - 多 Tab 支持：已存在窗口时 focus + 推送 new-tab 事件
 * - IPC 通道注册与中转
 *
 * 窗口配置：
 * - frame:false 自定义标题栏
 * - 不透明（transparent:false），可调整大小
 * - alwaysOnTop:false（普通窗口层级，可放到第二显示器）
 * - 加载 execution.html 入口
 *
 * 动画策略：
 * - 最小化：渲染层 CSS transform scale(0.1) + translate 到悬浮球方向 + opacity 0
 *   动画完成后渲染层 IPC 通知主进程 hide 窗口
 * - 恢复：主进程 show 窗口 → 渲染层反向动画（scale 0.1→1, opacity 0→1）
 * - 主进程不直接做逐帧 setSize/ setPosition 动画（性能差且抖动），
 *   由渲染层 CSS transform 完成视觉动画，主进程只负责 show/hide
 *
 * @module project-execution/ProjectExecutionWindowManager
 */

import { app, BrowserWindow, screen, ipcMain } from 'electron'
import * as path from 'path'
import { logger } from '@shared/toolkit/LogEngine'
import { FloatingAvatarManager } from '../floating-avatar/FloatingAvatarManager'

// ============================================
// 常量
// ============================================

/** 窗口最小尺寸（允许缩小但保持三栏可用） */
const MIN_WIDTH = 1024
const MIN_HEIGHT = 600

/** 动画持续时间（ms），与渲染层 CSS transition 保持一致 */
const ANIMATION_DURATION = 200

// ============================================
// 类型定义
// ============================================

/** 打开执行窗口的参数 */
export interface OpenExecutionWindowParams {
  /** 项目 ID */
  projectId: string
  /** 项目名称（用于窗口标题） */
  projectName: string
  /** 执行会话 ID */
  sessionId: string
  /** 对话线程 ID */
  threadId: string
  /** 初始任务消息（执行窗口打开后自动发送给 AI 的首条消息） */
  initialMessage?: string
  /** 是否静默注入（不显示为用户消息气泡，但仍发送给 LLM） */
  silent?: boolean
  /** 任务执行上下文（批量执行时用于自动推进 + 同步任务状态） */
  taskContext?: {
    /** 按执行顺序排列的任务 ID 列表 */
    taskIds: string[]
    /** 执行模式：单任务 / 批量 */
    kind: 'task' | 'batch'
  }
}

/** 悬浮球位置（供渲染层计算动画方向） */
export interface AvatarPosition {
  x: number
  y: number
}

// ============================================
// ProjectExecutionWindowManager 单例
// ============================================

export class ProjectExecutionWindowManager {
  private static instance: ProjectExecutionWindowManager | null = null

  /** 执行窗口实例 */
  private window: BrowserWindow | null = null

  /** 窗口关闭前保存的位置/尺寸（恢复时使用） */
  private savedBounds: { x: number; y: number; width: number; height: number } | null = null

  /** 是否正在执行最小化动画（防止重复触发） */
  private minimizing = false

  /** 是否正在执行恢复动画（防止重复触发） */
  private restoring = false

  /** IPC 是否已注册 */
  private ipcRegistered = false

  /**
   * 待发送的初始任务消息（按 threadId 索引）
   *
   * 主窗口通过 open() 传入 initialMessage，存储在这里（不通过 URL 传递，避免 URL 长度限制）。
   * 执行窗口启动后通过 IPC invoke 'execution-window:get-initial-message' 读取。
   * 消息被读取后自动清除（一次性消费）。
   */
  private pendingMessages = new Map<string, {
    message: string
    silent: boolean
    taskContext?: { taskIds: string[]; kind: 'task' | 'batch' }
  }>()

  private constructor() {
    // 构造时即注册 IPC，确保主窗口在执行窗口未创建前也能通过 IPC 请求打开
    this.registerIpc()
  }

  static getInstance(): ProjectExecutionWindowManager {
    if (!ProjectExecutionWindowManager.instance) {
      ProjectExecutionWindowManager.instance = new ProjectExecutionWindowManager()
    }
    return ProjectExecutionWindowManager.instance
  }

  // --------------------------------------------
  // 窗口生命周期
  // --------------------------------------------

  /**
   * 打开执行窗口（若已存在则 focus + 新增 Tab）
   *
   * @param params 项目/会话/线程信息
   */
  open(params: OpenExecutionWindowParams): void {
    try {
      // 存储 initialMessage（不通过 URL 传递，避免长度限制）
      // ⚠️ key 使用 threadId || sessionId：
      //    - 主窗口传了 threadId 时用 threadId（已有线程场景）
      //    - 主窗口传空 threadId 时用 sessionId（执行窗口自己创建线程场景）
      //    执行窗口侧用同样的逻辑计算 key 来读取，保证两端一致
      if (params.initialMessage) {
        const messageKey = params.threadId || params.sessionId
        this.pendingMessages.set(messageKey, {
          message: params.initialMessage,
          silent: params.silent ?? false,
          taskContext: params.taskContext,
        })
      }

      // 已存在窗口 → focus + 推送 new-tab 事件
      if (this.window && !this.window.isDestroyed()) {
        if (this.window.isMinimized()) {
          this.window.restore()
        }
        if (!this.window.isVisible()) {
          this.window.show()
        }
        this.window.focus()
        // 推送新 Tab 数据到渲染层
        this.window.webContents.send('execution-window:new-tab', params)
        logger.system.info('[ProjectExecutionWindow] Window exists, sent new-tab event', params)
        return
      }

      // 创建新窗口
      this.window = this.createWindow(params)
      logger.system.info('[ProjectExecutionWindow] Window created', params)
    } catch (err) {
      logger.system.error('[ProjectExecutionWindow] open failed:', err)
    }
  }

  /**
   * 创建执行窗口
   *
   * 全屏窗口：占满整个工作区（不含任务栏/Dock），三栏布局需要足够宽度。
   */
  private createWindow(params: OpenExecutionWindowParams): BrowserWindow {
    const workArea = screen.getPrimaryDisplay().workArea

    const win = new BrowserWindow({
      width: workArea.width,
      height: workArea.height,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      x: workArea.x,
      y: workArea.y,
      frame: false,
      transparent: false,
      alwaysOnTop: false,
      skipTaskbar: false,
      focusable: true,
      resizable: true,
      maximizable: false,
      minimizable: false, // 禁用系统最小化，使用自定义最小化到悬浮球
      fullscreenable: false,
      hasShadow: true,
      show: false, // ready-to-show 后再显示，避免白底闪现
      backgroundColor: '#0a0a0c', // 与 globals.css --background 一致，避免色差闪烁
      title: `AweeClaw - ${params.projectName}`,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })

    // 首次渲染完成后再显示窗口
    win.once('ready-to-show', () => {
      win.show()
      win.focus()
    })

    // 窗口关闭时清理引用 + 清除悬浮球执行状态（兜底：捕获系统强关等非正常关闭路径）
    win.on('closed', () => {
      this.window = null
      this.savedBounds = null
      this.minimizing = false
      this.restoring = false
      FloatingAvatarManager.getInstance().sendToAvatar('floating-avatar:execution-status', null)
    })

    // 记录窗口位置/尺寸（最小化前保存）
    win.on('resize', () => {
      if (!this.minimizing && !this.restoring) {
        const bounds = win.getBounds()
        this.savedBounds = bounds
      }
    })

    win.on('move', () => {
      if (!this.minimizing && !this.restoring) {
        const bounds = win.getBounds()
        this.savedBounds = bounds
      }
    })

    // 加载执行窗口内容
    this.loadExecutionContent(win, params)

    return win
  }

  /**
   * 加载执行窗口内容：生产 loadFile / 开发 loadURL
   *
   * 通过 URL query 参数传递项目/会话信息：
   * execution.html?projectId=xxx&projectName=xxx&sessionId=xxx&threadId=xxx
   */
  private loadExecutionContent(win: BrowserWindow, params: OpenExecutionWindowParams): void {
    // initialMessage 不通过 URL 传递（避免 URL 长度限制截断长 prompt）
    // 而是存储在 pendingMessages 中，执行窗口通过 IPC getInitialMessage 获取
    const queryParts: Record<string, string> = {
      projectId: params.projectId,
      projectName: params.projectName,
      sessionId: params.sessionId,
      threadId: params.threadId,
    }
    const query = new URLSearchParams(queryParts).toString()

    if (app.isPackaged) {
      const execPath = path.join(__dirname, '../renderer/execution.html')
      win.loadFile(execPath, { query: Object.fromEntries(new URLSearchParams(query)) })
      return
    }

    if (process.env.VITE_DEV_SERVER_URL) {
      const devUrl = `${process.env.VITE_DEV_SERVER_URL}execution.html?${query}`
      win.loadURL(devUrl)
      return
    }

    // 非打包模式但无开发服务器：回退到构建产物
    const execPath = path.join(__dirname, '../renderer/execution.html')
    win.loadFile(execPath, { query: Object.fromEntries(new URLSearchParams(query)) })
  }

  // --------------------------------------------
  // 最小化 / 恢复
  // --------------------------------------------

  /**
   * 最小化到悬浮球
   *
   * 流程：
   * 1. 标记 minimizing 状态
   * 2. 保存当前窗口位置/尺寸
   * 3. 通知渲染层开始最小化动画（渲染层 CSS transform）
   * 4. 等待动画完成（ANIMATION_DURATION）后 hide 窗口
   *
   * 注意：不使用 win.minimize()（会最小化到任务栏），
   * 而是自定义 hide + 悬浮球状态指示。
   */
  minimize(): void {
    if (!this.window || this.window.isDestroyed() || this.minimizing) return

    this.minimizing = true

    // 保存当前位置/尺寸
    this.savedBounds = this.window.getBounds()

    // 通知渲染层开始最小化动画
    this.window.webContents.send('execution-window:start-minimize-animation')

    // 等待渲染层动画完成后 hide 窗口
    setTimeout(() => {
      if (this.window && !this.window.isDestroyed()) {
        this.window.hide()
      }
      this.minimizing = false
      logger.system.info('[ProjectExecutionWindow] Window minimized to avatar')
    }, ANIMATION_DURATION + 50) // 额外 50ms 确保渲染层动画完成
  }

  /**
   * 从悬浮球恢复窗口
   *
   * 流程：
   * 1. 标记 restoring 状态
   * 2. show 窗口（恢复到 savedBounds 位置）
   * 3. 通知渲染层开始恢复动画（渲染层 CSS transform 反向）
   * 4. 等待动画完成后清除状态
   */
  restore(): void {
    if (!this.window || this.window.isDestroyed() || this.restoring) return

    this.restoring = true

    // 恢复到保存的位置/尺寸（或默认居中）
    if (this.savedBounds) {
      this.window.setBounds(this.savedBounds)
    }

    // show 窗口
    this.window.show()
    this.window.focus()

    // 通知渲染层开始恢复动画
    this.window.webContents.send('execution-window:start-restore-animation')

    // 等待渲染层动画完成后清除状态
    setTimeout(() => {
      this.restoring = false
      logger.system.info('[ProjectExecutionWindow] Window restored from avatar')
    }, ANIMATION_DURATION + 50)
  }

  /**
   * 关闭窗口（非最小化，真正关闭）
   *
   * 关闭前清除悬浮球执行状态（推送 null），避免关闭后 Pill 残留。
   */
  close(): void {
    if (!this.window || this.window.isDestroyed()) return
    // 清除悬浮球执行状态
    FloatingAvatarManager.getInstance().sendToAvatar('floating-avatar:execution-status', null)
    this.window.close()
  }

  /**
   * 窗口是否可见
   */
  isVisible(): boolean {
    return !!this.window && !this.window.isDestroyed() && this.window.isVisible()
  }

  /**
   * 窗口是否存在（含隐藏状态）
   */
  exists(): boolean {
    return !!this.window && !this.window.isDestroyed()
  }

  /**
   * 获取悬浮球位置（供渲染层计算动画方向）
   *
   * @returns 悬浮球屏幕坐标，悬浮球不可用时返回 null
   */
  getAvatarPosition(): AvatarPosition | null {
    return FloatingAvatarManager.getInstance().getPosition()
  }

  // --------------------------------------------
  // IPC 注册
  // --------------------------------------------

  /**
   * 注册 IPC 通道（幂等）
   *
   * 通道说明：
   * - execution-window:minimize → 渲染层请求最小化
   * - execution-window:restore → 渲染层请求恢复（通常由悬浮球触发）
   * - execution-window:close → 渲染层请求关闭
   * - execution-window:get-avatar-position → 渲染层获取悬浮球位置
   * - execution-window:status-update → 渲染层推送执行状态（转发到主窗口 → 悬浮球）
   * - execution-window:open → 主窗口请求打开执行窗口（含参数）
   */
  private registerIpc(): void {
    if (this.ipcRegistered) return
    this.ipcRegistered = true

    // 渲染层请求最小化
    ipcMain.on('execution-window:minimize', () => {
      this.minimize()
    })

    // 渲染层请求关闭
    ipcMain.on('execution-window:close', () => {
      this.close()
    })

    // 渲染层获取悬浮球位置
    ipcMain.handle('execution-window:get-avatar-position', () => {
      return this.getAvatarPosition()
    })

    // 渲染层查询执行窗口是否存在（含最小化/隐藏状态）
    // 主窗口 ExecutionStatusDock 用此判断是否应推送状态到悬浮球，
    // 避免覆盖执行窗口自己推送的状态（执行窗口最小化后仍在运行）
    ipcMain.handle('execution-window:exists', () => {
      return this.exists()
    })

    // 执行窗口获取初始任务消息（一次性消费，读取后自动清除）
    // 主窗口通过 open() 传入 initialMessage，存储在 pendingMessages 中，
    // 执行窗口启动后通过此接口读取（不通过 URL 传递，避免 URL 长度限制截断长 prompt）
    ipcMain.handle(
      'execution-window:get-initial-message',
      (_event, messageKey: string): {
        message: string
        silent: boolean
        taskContext?: { taskIds: string[]; kind: 'task' | 'batch' }
      } | null => {
        const data = this.pendingMessages.get(messageKey)
        if (data) {
          this.pendingMessages.delete(messageKey) // 一次性消费
          return data
        }
        return null
      },
    )

    // 执行窗口回传 threadId（执行窗口自己创建线程后，通知主窗口）
    // 主窗口收到后更新任务的 threadId，建立 task ↔ thread 关联
    ipcMain.on(
      'execution-window:report-thread-id',
      (_event, payload: { sessionId: string; threadId: string }) => {
        logger.system.info(
          '[ProjectExecutionWindow] Thread ID reported:',
          payload.sessionId,
          '→',
          payload.threadId,
        )
        // 转发到主窗口（主窗口监听 execution-window:thread-id-reported）
        for (const win of BrowserWindow.getAllWindows()) {
          if (win.id !== this.window?.id && !win.isDestroyed()) {
            win.webContents.send('execution-window:thread-id-reported', payload)
          }
        }
      },
    )

    // 渲染层推送执行状态（转发到主窗口和悬浮球）
    ipcMain.on('execution-window:status-update', (_event, status: unknown) => {
      // 1. 转发到主窗口（ExecutionStatusDock 监听 execution-window:status-broadcast）
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.id !== this.window?.id && !win.isDestroyed()) {
          win.webContents.send('execution-window:status-broadcast', status)
        }
      }
      // 2. 转发到悬浮球窗口（AvatarExecutionStatus 监听 floating-avatar:execution-status）
      //    悬浮球与主窗口使用不同的频道，需单独转发
      FloatingAvatarManager.getInstance().sendToAvatar('floating-avatar:execution-status', status)
    })

    // 主窗口请求打开执行窗口
    ipcMain.on('execution-window:open', (_event, params: OpenExecutionWindowParams) => {
      this.open(params)
    })

    // 悬浮球请求恢复执行窗口
    ipcMain.on('execution-window:restore', () => {
      this.restore()
    })

    logger.system.info('[ProjectExecutionWindow] IPC channels registered')
  }
}

/** 单例实例 */
export const projectExecutionWindowManager = ProjectExecutionWindowManager.getInstance()
