/**
 * Shell 桥接层
 *
 * 让插件能用**系统默认程序**打开一个产物文件或一个外部链接，典型场景是
 * 生成型插件（image → 3D、文生图、文生视频、PPT 预览）在产物落盘后自动弹窗预览。
 *
 * 为什么需要单独一层：
 * 插件此前只能借 `host.getDesktopControlManager().openFile()` —— 那是**桌面自动化**
 * 的入口（模拟鼠标键盘、杀进程），按权限表需要声明 `desktop.input`（"模拟输入"）。
 * 一个只想"打开预览"的插件被迫申请输入模拟权限，既误导用户也放大攻击面。
 * 因此把「打开」这一个动作单独收敛成本桥，权限归到语义正确的 `desktop.apps`。
 *
 * 暴露能力：
 * - openPath(filePath)      用系统默认程序打开文件（预览 HTML / PDF / 视频 / 图片…）
 * - openExternal(url)       用系统浏览器打开 http/https/mailto 链接（协议白名单）
 * - showInFolder(filePath)  在文件管理器中定位文件
 *
 * 安全约束：
 * - openPath 只接受**绝对路径**且必须是已存在的**文件**（目录会被拒绝），
 *   含 URL scheme（`http://`、`file://` …）的字符串一律拒绝，避免把"路径"当链接用
 * - openExternal 复用 guard/safeExternalUrl 的协议白名单，不做自己的判断
 * - 三者都不抛出：失败以 `{ ok: false, error }` 返回，插件自行决定是否降级
 *
 * @module plugin-sdk/ShellBridge
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { shell } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import { safeOpenExternal } from '../../guard/safeExternalUrl'

/** 打开操作结果 */
export interface ShellOpenResult {
  /** 是否成功 */
  ok: boolean
  /** 实际操作的路径 / URL */
  target: string
  /** 失败原因（ok=false 时存在） */
  error?: string
}

/**
 * Shell 桥接服务
 *
 * 无状态，直接委托 Electron shell；只做入参校验与结果归一。
 */
class ShellBridgeService {
  /**
   * 用系统默认程序打开一个文件。
   *
   * @param filePath 文件**绝对路径**
   */
  async openPath(filePath: string): Promise<ShellOpenResult> {
    const target = typeof filePath === 'string' ? filePath.trim() : ''

    if (!target) {
      return { ok: false, target: '', error: 'filePath 不能为空' }
    }
    // 含 scheme 的字符串是链接，不是路径；让调用方走 openExternal
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
      return {
        ok: false,
        target,
        error: `openPath 只接受文件系统路径，收到带 scheme 的值：${target}（外部链接请用 openExternal）`,
      }
    }
    if (!path.isAbsolute(target)) {
      return { ok: false, target, error: `路径必须是绝对路径：${target}` }
    }

    let stat: fs.Stats
    try {
      stat = fs.statSync(target)
    } catch {
      return { ok: false, target, error: `文件不存在：${target}` }
    }
    if (!stat.isFile()) {
      return { ok: false, target, error: `openPath 只接受文件，收到目录：${target}` }
    }

    try {
      // shell.openPath 成功返回空字符串，失败返回错误消息
      const message = await shell.openPath(target)
      if (message) {
        logger.system.warn(`[ShellBridge] openPath 失败: ${target} — ${message}`)
        return { ok: false, target, error: message }
      }
      logger.system.debug(`[ShellBridge] openPath ok: ${target}`)
      return { ok: true, target }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      logger.system.warn(`[ShellBridge] openPath 异常: ${target} — ${message}`)
      return { ok: false, target, error: message }
    }
  }

  /**
   * 用系统浏览器 / 邮件客户端打开一个外部链接。
   * 协议白名单复用 guard/safeExternalUrl（http / https / mailto）。
   *
   * @param url 外部链接
   */
  async openExternal(url: string): Promise<ShellOpenResult> {
    const target = typeof url === 'string' ? url.trim() : ''
    if (!target) {
      return { ok: false, target: '', error: 'url 不能为空' }
    }
    try {
      // safeOpenExternal 返回布尔值，并在内部记录被拒原因
      const opened = await safeOpenExternal(target)
      if (!opened) {
        return { ok: false, target, error: '链接被安全策略拒绝（仅允许 http / https / mailto）' }
      }
      return { ok: true, target }
    } catch (err) {
      return { ok: false, target, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * 在系统文件管理器中定位（选中）一个文件或目录。
   *
   * @param target 文件或目录路径
   */
  showInFolder(target: string): ShellOpenResult {
    const value = typeof target === 'string' ? target.trim() : ''
    if (!value || !path.isAbsolute(value)) {
      return { ok: false, target: value, error: `路径必须是绝对路径：${value}` }
    }
    if (!fs.existsSync(value)) {
      return { ok: false, target: value, error: `路径不存在：${value}` }
    }
    try {
      shell.showItemInFolder(value)
      return { ok: true, target: value }
    } catch (err) {
      return { ok: false, target: value, error: err instanceof Error ? err.message : String(err) }
    }
  }
}

/** Shell 桥接单例 */
export const shellBridge = new ShellBridgeService()

/** 桥接服务类型（供 HostServices 接口声明使用） */
export type ShellBridge = typeof shellBridge
