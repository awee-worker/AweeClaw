/**
 * 环境检测与安装桥接 — 运行时环境管理的 IPC 接口
 *
 * 职责：
 * - environment:check     — 检测 Python/uv/Node 三项核心运行时状态（只读，秒级返回）
 * - environment:install   — 安装指定运行时（推送进度事件 environment:progress）
 * - environment:installAll — 一键安装所有缺失项
 *
 * 设计：
 * - 转发到 EnvironmentSetupService 单例，bridge 层不包含业务逻辑
 * - 安装进度通过 webContents.send 推送，渲染进程通过 onEnvironmentProgress 订阅
 */

import { safeIpcHandle } from '../core/ipcGuard'
import { environmentSetupService } from '../../modules/runtime/EnvironmentSetupService'
import type { EnvironmentStatus } from '../../modules/runtime/EnvironmentSetupService'

export function registerEnvironmentHandlers(): void {
  /** 检测全部核心运行时状态（只读，不触发安装） */
  safeIpcHandle('environment:check', async (): Promise<{ success: boolean; status: EnvironmentStatus }> => {
    try {
      const status = await environmentSetupService.checkAll()
      return { success: true, status }
    } catch (err) {
      return {
        success: false,
        status: {
          python: { ready: false, source: 'none' },
          uv: { ready: false, source: 'none' },
          node: { ready: false, source: 'none' },
          allReady: false,
        },
      }
    }
  })

  /** 安装指定运行时 */
  safeIpcHandle('environment:install', async (_, id: 'python' | 'uv' | 'node'): Promise<{ success: boolean }> => {
    try {
      const ok = await environmentSetupService.installOne(id)
      return { success: ok }
    } catch (err) {
      return { success: false }
    }
  })

  /** 一键安装所有缺失项 */
  safeIpcHandle('environment:installAll', async (): Promise<{ success: boolean; status: EnvironmentStatus }> => {
    try {
      const status = await environmentSetupService.installAll()
      return { success: status.allReady, status }
    } catch (err) {
      return {
        success: false,
        status: {
          python: { ready: false, source: 'none' },
          uv: { ready: false, source: 'none' },
          node: { ready: false, source: 'none' },
          allReady: false,
        },
      }
    }
  })
}
