/**
 * 菜单动作分发
 *
 * 设计说明：
 * - 菜单项 click 通过此模块统一发送到 renderer
 * - renderer 端通过 api.onExecuteCommand 监听并分发到 commandRegistry
 * - 命令 ID 与 commandRegistry.ts 的 STATIC_COMMANDS id 保持一致
 * - 部分命令（场景切换、最近工作区）带参数，通过 payload 传递
 */

import { BrowserWindow } from 'electron'

/**
 * 发送命令到渲染进程
 *
 * @param win 目标窗口（默认主窗口）
 * @param commandId 命令 ID（与 commandRegistry 对齐）
 * @param payload 可选参数（场景 ID、工作区路径等）
 */
export function sendCommand(
  win: BrowserWindow | null,
  commandId: string,
  payload?: unknown,
): void {
  if (!win || win.isDestroyed()) return
  // 命令 ID 通过 channel 传递，payload 作为第二个参数
  win.webContents.send('workbench:execute-command', commandId, payload)
}

/**
 * 发送带参数的命令
 * 便于在菜单定义中作为 click handler 使用
 */
export function createCommandSender(
  getWin: () => BrowserWindow | null,
  commandId: string,
  payload?: unknown,
): () => void {
  return () => sendCommand(getWin(), commandId, payload)
}

/**
 * 发送场景切换命令
 *
 * 命令格式：scenario.switch + payload = { scenarioId }
 * renderer 端监听后调用 scenarioRegistry.setActive(scenarioId)
 */
export function sendSwitchScenario(
  getWin: () => BrowserWindow | null,
  scenarioId: string,
): () => void {
  return createCommandSender(getWin, 'scenario.switch', { scenarioId })
}

/**
 * 发送打开最近工作区命令
 *
 * 命令格式：workspace.openRecent + payload = { path }
 * renderer 端监听后调用 api.workspace.openPath(path)
 */
export function sendOpenRecentWorkspace(
  getWin: () => BrowserWindow | null,
  workspacePath: string,
): () => void {
  return createCommandSender(getWin, 'workspace.openRecent', { path: workspacePath })
}
