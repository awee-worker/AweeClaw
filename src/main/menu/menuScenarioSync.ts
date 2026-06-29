/**
 * 场景菜单数据同步
 *
 * 设计说明：
 * - Renderer 启动后通过 IPC 把已安装场景列表推送到 main
 * - Main 收到后重建"场景"菜单（动态子菜单 + radio 勾选当前场景）
 * - 场景切换/安装/卸载时 renderer 主动推送最新列表
 */

import { BrowserWindow, IpcMainEvent, ipcMain } from 'electron'

/**
 * 场景菜单数据（从 renderer 推送）
 * 仅包含菜单所需的精简字段，避免传输完整 ScenarioPlugin
 */
export interface ScenarioMenuItem {
  id: string
  name: string
  description?: string
  category?: string
  version?: string
}

/** IPC channel：renderer → main 推送场景列表 */
export const IPC_SCENARIO_SYNC = 'menu:syncScenarios'

/** IPC channel：main → renderer 请求场景列表（main 启动时主动拉取） */
export const IPC_SCENARIO_REQUEST = 'menu:requestScenarios'

/**
 * 场景菜单状态
 * 缓存最新场景列表 + 当前激活场景 ID，用于菜单重建
 */
class ScenarioMenuState {
  private scenarios: ScenarioMenuItem[] = []
  private activeScenarioId: string | null = null
  private onScenariosChange: (() => void) | null = null

  /** 更新场景列表 */
  setScenarios(scenarios: ScenarioMenuItem[]): void {
    this.scenarios = scenarios
    this.onScenariosChange?.()
  }

  /** 更新当前激活场景 */
  setActiveScenario(scenarioId: string | null): void {
    this.activeScenarioId = scenarioId
    this.onScenariosChange?.()
  }

  /** 获取场景列表 */
  getScenarios(): ScenarioMenuItem[] {
    return this.scenarios
  }

  /** 获取当前激活场景 ID */
  getActiveId(): string | null {
    return this.activeScenarioId
  }

  /** 注册场景变化回调（用于触发菜单重建） */
  onChange(callback: () => void): void {
    this.onScenariosChange = callback
  }
}

export const scenarioMenuState = new ScenarioMenuState()

/**
 * 初始化场景同步 IPC
 *
 * @param getWin 获取主窗口函数
 * @param onSync 场景同步后的回调（触发菜单重建）
 */
export function initScenarioSync(
  getWin: () => BrowserWindow | null,
  onSync: () => void,
): void {
  scenarioMenuState.onChange(onSync)

  // renderer 推送场景列表
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ipcMain.on(IPC_SCENARIO_SYNC, (_event: IpcMainEvent, data: { scenarios: ScenarioMenuItem[]; activeId: string | null }) => {
    if (data?.scenarios) {
      scenarioMenuState.setScenarios(data.scenarios)
    }
    if (data?.activeId !== undefined) {
      scenarioMenuState.setActiveScenario(data.activeId)
    }
  })

  // 主动请求一次场景列表（renderer ready 后会响应）
  const win = getWin()
  if (win && !win.isDestroyed()) {
    win.webContents.once('did-finish-load', () => {
      win.webContents.send(IPC_SCENARIO_REQUEST)
    })
  }
}
