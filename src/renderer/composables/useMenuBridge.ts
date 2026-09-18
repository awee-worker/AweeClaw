/**
 * 菜单系统桥接 Hook
 *
 * 职责：
 * 1. 监听主进程菜单命令（onExecuteCommand）→ menuCommandDispatcher
 * 2. 监听渲染进程自绘菜单本地事件（Windows/Linux）→ 同一分发器
 * 3. 将场景列表 + 当前激活场景同步到主进程（用于动态构建场景菜单）
 * 4. 监听主进程的场景请求，按需推送最新场景数据
 *
 * 与 useGlobalShortcuts 的分工：
 * - useGlobalShortcuts：处理键盘快捷键
 * - useMenuBridge：处理菜单点击（原生菜单 IPC + 自绘菜单本地事件）
 *
 * 命令清单参见 src/main/menu/menuItems/*.ts 中的 commandId
 */

import { useEffect, useRef } from 'react'
import { useStore } from '@store'
import { api } from '../adapters/electronBridge'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { useAgentHistoryActions } from './useAgent'
import { logger } from '@toolkit/LogEngine'
import {
  dispatchMenuCommand,
  MENU_EXECUTE_COMMAND_EVENT,
  type MenuCommandContext,
  type MenuExecuteCommandDetail,
} from './menuCommandDispatcher'

/** 需要主进程菜单派发的命令 ID */
type MenuCommandId =
  // 应用菜单
  | 'app.about'
  // 文件菜单
  | 'open-folder'
  | 'add-folder'
  | 'save-workspace'
  | 'save-file'
  | 'refresh-files'
  | 'settings'
  // 视图菜单
  | 'workbench.action.showCommands'
  | 'workbench.action.quickOpen'
  | 'toggle-terminal'
  | 'toggle-ai-panel'
  | 'workbench.action.toggleSidebar'
  | 'workbench.action.toggleDevTools'
  // 场景菜单
  | 'scenario.switch'
  | 'scenario.openManager'
  // AI 菜单
  | 'ai-chat'
  | 'ai-explain'
  | 'ai-refactor'
  | 'ai-fix'
  | 'ai-clear-history'
  | 'ai-clear-checkpoints'
  // 帮助菜单
  | 'keyboard-shortcuts'
  | 'about'
  | (string & {})

/**
 * 菜单系统桥接 Hook
 */
export function useMenuBridge(): void {
  const language = useStore((s) => s.language)
  const setShowSettingsPage = useStore((s) => s.setShowSettingsPage)
  const setShowCommandPalette = useStore((s) => s.setShowCommandPalette)
  const setShowQuickOpen = useStore((s) => s.setShowQuickOpen)
  const setShowAbout = useStore((s) => s.setShowAbout)
  const setActiveSidePanel = useStore((s) => s.setActiveSidePanel)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const toggleTerminal = useStore((s) => s.toggleTerminal)
  const setChatVisible = useStore((s) => s.setChatVisible)

  const { clearMessages, clearCheckpoints } = useAgentHistoryActions()

  // 通过 ref 保持最新值，避免重新订阅 IPC
  const stateRef = useRef<MenuCommandContext>({
    language,
    setShowSettingsPage,
    setShowCommandPalette,
    setShowQuickOpen,
    setShowAbout,
    setActiveSidePanel,
    toggleSidebar,
    toggleTerminal,
    setChatVisible,
    clearMessages,
    clearCheckpoints,
  })
  stateRef.current = {
    language,
    setShowSettingsPage,
    setShowCommandPalette,
    setShowQuickOpen,
    setShowAbout,
    setActiveSidePanel,
    toggleSidebar,
    toggleTerminal,
    setChatVisible,
    clearMessages,
    clearCheckpoints,
  }

  // 1. 监听菜单命令（原生菜单 IPC + 自绘菜单本地事件）
  useEffect(() => {
    const handle = (commandId: string, payload?: unknown) => {
      dispatchMenuCommand(stateRef.current, commandId, payload)
    }

    // 原生菜单：主进程 → 渲染进程
    const unsubscribe = api.onExecuteCommand((commandId: MenuCommandId, payload?: unknown) => {
      handle(commandId, payload)
    })

    // 自绘菜单（Windows/Linux）：渲染进程本地事件
    const onLocalCommand = (event: Event) => {
      const detail = (event as CustomEvent<MenuExecuteCommandDetail>).detail
      if (detail?.commandId) handle(detail.commandId, detail.payload)
    }
    window.addEventListener(MENU_EXECUTE_COMMAND_EVENT, onLocalCommand)

    return () => {
      unsubscribe?.()
      window.removeEventListener(MENU_EXECUTE_COMMAND_EVENT, onLocalCommand)
    }
  }, [])


  // 2. 场景列表同步到主进程
  useEffect(() => {
    const syncScenarios = (lang: string) => {
      try {
        const all = scenarioRegistry.getAll()
        const isZh = lang.toLowerCase().includes('zh')
        const scenarios = all.map((s) => ({
          id: s.id,
          name: isZh ? (s.nameZh || s.name) : s.name,
          description: isZh ? (s.descriptionZh || s.description) : s.description,
          category: s.category,
        }))
        api.syncScenarios({
          scenarios,
          activeId: useStore.getState().activeScenarioId,
        })
      } catch (err) {
        logger.system.error('[MenuBridge] Sync scenarios failed', err)
      }
    }

    // 初始同步（从 store 直接读取最新 language，避免闭包问题）
    syncScenarios(useStore.getState().language)

    // 监听主进程主动请求
    const unsubscribe = api.onScenarioRequest(() => {
      syncScenarios(useStore.getState().language)
    })

    // 场景/语言切换时同步（直接从 subscribe 的 state 参数读取，避免 ref 延迟）
    let prevActiveScenarioId = useStore.getState().activeScenarioId
    let prevLanguage = useStore.getState().language
    const unsubscribeStore = useStore.subscribe((state) => {
      if (state.activeScenarioId !== prevActiveScenarioId || state.language !== prevLanguage) {
        prevActiveScenarioId = state.activeScenarioId
        prevLanguage = state.language
        syncScenarios(state.language)
      }
    })

    return () => {
      unsubscribe?.()
      unsubscribeStore()
    }
  }, [])
}
