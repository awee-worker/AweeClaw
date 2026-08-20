/**
 * 运行时环境统一检测与安装编排服务
 *
 * 职责：
 * - 检测 Python / uv / Node.js 三项核心运行时是否就绪（只读，不触发安装）
 * - 按"先 uv → 后 Python → 再 Node"的依赖顺序串行安装缺失项
 * - 安装过程中通过 BrowserWindow.webContents.send 推送实时进度
 * - 防止并发重复安装
 *
 * 设计原则：
 * - 不重写各 manager 的安装逻辑，仅做编排与进度转发
 * - 复用 pythonManager.setStatusCallback / nodeManager.setStatusCallback 获取阶段消息
 * - 检测方法纯只读，可安全频繁调用（秒级返回）
 */

import { BrowserWindow } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { pythonManager } from '../python-runtime'
import { nodeManager } from '../node-runtime'

// ============================================
// 类型定义
// ============================================

/** 单个运行时的检测状态 */
export interface RuntimeCheckResult {
  /** 是否就绪（已安装且可用） */
  ready: boolean
  /** 可执行文件路径（就绪时） */
  path?: string
  /** 版本号（就绪时） */
  version?: string
  /** 来源：system（系统已装）/ managed（应用托管）/ none（未安装） */
  source: 'system' | 'managed' | 'none'
}

/** 三项核心运行时的整体检测快照 */
export interface EnvironmentStatus {
  python: RuntimeCheckResult
  uv: RuntimeCheckResult
  node: RuntimeCheckResult
  /** 是否所有核心运行时都已就绪 */
  allReady: boolean
}

/** 安装进度事件阶段 */
export type InstallStage = 'downloading' | 'installing' | 'configuring' | 'done' | 'error'

/** 安装进度事件 */
export interface InstallProgressEvent {
  /** 运行时 id：'python' | 'uv' | 'node' */
  id: 'python' | 'uv' | 'node'
  /** 当前阶段 */
  stage: InstallStage
  /** 进度百分比 0-100（粗粒度，基于阶段估算） */
  percent: number
  /** 人类可读的阶段消息（来自 manager 的 notifyStatus） */
  message: string
}

// ============================================
// 常量
// ============================================

/** IPC 频道：安装进度推送 */
const IPC_CHANNEL_PROGRESS = 'environment:progress'

// ============================================
// 服务实现
// ============================================

class EnvironmentSetupService {
  /** 正在安装的运行时 id 集合，防止并发重复安装 */
  private installing = new Set<'python' | 'uv' | 'node'>()

  /** 推送进度事件到所有渲染窗口 */
  private emitProgress(event: InstallProgressEvent): void {
    try {
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNEL_PROGRESS, event)
        }
      }
    } catch (err) {
      logger.system.warn('[EnvironmentSetup] emitProgress failed:', err)
    }
  }

  /**
   * 检测 Python 运行时（只读，不触发安装）
   *
   * 复用 pythonManager 的状态检测，但仅读取已有状态，
   * 若 manager 尚未初始化则返回 none，让调用方决定是否触发安装。
   */
  private checkPython(): RuntimeCheckResult {
    const status = pythonManager.status
    if (status.ready && status.pythonPath) {
      return {
        ready: true,
        path: status.pythonPath,
        version: status.version || undefined,
        source: status.source === 'system' ? 'system' : 'managed',
      }
    }
    // pythonManager 尚未初始化（status.source === 'none'），返回 none
    return { ready: false, source: 'none' }
  }

  /**
   * 检测 uv 运行时（只读，不触发安装）
   *
   * 复用 pythonManager.detectUvAsync() 主动搜索系统 uv/uvx：
   * - 优先返回已缓存的 status.uvPath（之前找到过）
   * - 其次搜索 electron-store 持久化缓存
   * - 最后异步搜索用户 shell PATH（支持 ~/.local/bin 等非标准路径）
   *
   * 解决问题：首次启动时 status.uvPath 可能为空（ensureReady 未执行），
   * 但用户系统中实际已安装 uv，此时应主动搜索而不是直接判定为未安装。
   */
  private async checkUv(): Promise<RuntimeCheckResult> {
    const result = await pythonManager.detectUvAsync()
    if (result?.uvPath) {
      return {
        ready: true,
        path: result.uvPath,
        source: 'managed', // uv 由应用托管（可能是应用安装的，也可能是系统已装的，统一标记为 managed）
      }
    }
    return { ready: false, source: 'none' }
  }

  /**
   * 检测 Node.js 运行时（只读）
   */
  private checkNode(): RuntimeCheckResult {
    const status = nodeManager.status
    if (status.ready && status.nodePath) {
      return {
        ready: true,
        path: status.nodePath,
        version: status.version || undefined,
        source: status.source === 'system' ? 'system' : 'managed',
      }
    }
    return { ready: false, source: 'none' }
  }

  /**
   * 检测全部核心运行时（只读，秒级返回，不触发任何安装）
   *
   * 适用场景：
   * - 首次启动弹窗进入时展示当前状态
   * - 设置页"环境管理"面板刷新状态
   * - AI 执行命令前的预检
   *
   * @returns 三项运行时状态快照 + allReady 汇总标志
   */
  async checkAll(): Promise<EnvironmentStatus> {
    const python = this.checkPython()
    const uv = await this.checkUv()
    const node = this.checkNode()

    return {
      python,
      uv,
      node,
      allReady: python.ready && uv.ready && node.ready,
    }
  }

  /**
   * 安装指定运行时
   *
   * 复用对应 manager 的 ensureReady / ensureUvx，并通过 setStatusCallback
   * 转发安装进度到渲染进程。
   *
   * 安装顺序约束：
   * - 'uv'：直接调用 ensureUvx()
   * - 'python'：调用 ensureReady()（内部会按需安装 uv → Python → venv）
   * - 'node'：调用 ensureReady()
   *
   * @param id 运行时 id
   * @returns 是否成功（true=就绪或安装成功）
   */
  async installOne(id: 'python' | 'uv' | 'node'): Promise<boolean> {
    if (this.installing.has(id)) {
      logger.system.warn(`[EnvironmentSetup] ${id} is already installing, skip`)
      return false
    }

    this.installing.add(id)
    try {
      if (id === 'uv') {
        // uv 安装：注册进度回调后调用 ensureUvx
        pythonManager.setStatusCallback((message) => {
          this.emitProgress({
            id: 'uv',
            stage: message.includes('下载') ? 'downloading' : 'installing',
            percent: 50,
            message,
          })
        })

        const result = await pythonManager.ensureUvx()
        pythonManager.setStatusCallback(null)

        if (result) {
          this.emitProgress({ id: 'uv', stage: 'done', percent: 100, message: 'uv 安装完成' })
          return true
        }
        this.emitProgress({ id: 'uv', stage: 'error', percent: 0, message: 'uv 安装失败' })
        return false
      }

      if (id === 'python') {
        pythonManager.setStatusCallback((message) => {
          this.emitProgress({
            id: 'python',
            stage: message.includes('下载') ? 'downloading' : 'installing',
            percent: 50,
            message,
          })
        })

        const status = await pythonManager.ensureReady()
        pythonManager.setStatusCallback(null)

        if (status.ready) {
          this.emitProgress({ id: 'python', stage: 'done', percent: 100, message: 'Python 环境就绪' })
          return true
        }
        this.emitProgress({ id: 'python', stage: 'error', percent: 0, message: status.error || 'Python 安装失败' })
        return false
      }

      // node
      nodeManager.setStatusCallback((message) => {
        this.emitProgress({
          id: 'node',
          stage: message.includes('下载') ? 'downloading' : 'installing',
          percent: 50,
          message,
        })
      })

      const status = await nodeManager.ensureReady()
      nodeManager.setStatusCallback(null)

      if (status.ready) {
        this.emitProgress({ id: 'node', stage: 'done', percent: 100, message: 'Node.js 环境就绪' })
        return true
      }
      this.emitProgress({ id: 'node', stage: 'error', percent: 0, message: status.error || 'Node.js 安装失败' })
      return false
    } catch (err) {
      logger.system.error(`[EnvironmentSetup] install ${id} failed:`, err)
      this.emitProgress({
        id,
        stage: 'error',
        percent: 0,
        message: err instanceof Error ? err.message : String(err),
      })
      // 清理回调，防止泄漏
      if (id === 'node') {
        nodeManager.setStatusCallback(null)
      } else {
        pythonManager.setStatusCallback(null)
      }
      return false
    } finally {
      this.installing.delete(id)
    }
  }

  /**
   * 一键安装所有缺失的核心运行时
   *
   * 按依赖顺序串行：uv → python → node
   * 单步失败不阻断后续（node 独立于 python/uv）。
   *
   * @returns 安装后的整体状态快照
   */
  async installAll(): Promise<EnvironmentStatus> {
    const before = await this.checkAll()

    // 1. uv（若缺失）
    if (!before.uv.ready) {
      logger.system.info('[EnvironmentSetup] Installing missing uv...')
      await this.installOne('uv')
    }

    // 2. python（若缺失，ensureReady 内部会复用已安装的 uv）
    if (!before.python.ready) {
      logger.system.info('[EnvironmentSetup] Installing missing python...')
      await this.installOne('python')
    }

    // 3. node（独立于 python/uv）
    if (!before.node.ready) {
      logger.system.info('[EnvironmentSetup] Installing missing node...')
      await this.installOne('node')
    }

    return this.checkAll()
  }
}

/** 单例 */
export const environmentSetupService = new EnvironmentSetupService()
