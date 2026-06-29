/**
 * 菜单系统桥接 Hook
 *
 * 职责：
 * 1. 监听主进程菜单命令（onExecuteCommand），分发到对应业务逻辑
 * 2. 将场景列表 + 当前激活场景同步到主进程（用于动态构建场景菜单）
 * 3. 监听主进程的场景请求，按需推送最新场景数据
 *
 * 与 useGlobalShortcuts 的分工：
 * - useGlobalShortcuts：处理键盘快捷键
 * - useMenuBridge：处理菜单点击（通过 IPC 命令）
 *
 * 命令清单参见 src/main/menu/menuItems/*.ts 中的 commandId
 */

import { useEffect, useRef } from 'react'
import { useStore } from '@store'
import { api } from '../adapters/electronBridge'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { scenarioLoader } from '@/scenarios'
import { useAgentHistoryActions } from './useAgent'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { logger } from '@toolkit/LogEngine'

/** 需要主进程菜单派发的命令 ID */
type MenuCommandId =
  // 应用菜单
  | 'app.about'
  // 文件菜单
  | 'new-window'
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
  const stateRef = useRef({
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

  // 1. 监听主进程菜单命令
  useEffect(() => {
    const unsubscribe = api.onExecuteCommand((commandId: MenuCommandId, payload?: unknown) => {
      const ctx = stateRef.current
      try {
        switch (commandId) {
          // ===== 应用菜单 =====
          case 'app.about':
          case 'about':
            ctx.setShowAbout(true)
            break

          // ===== 文件菜单 =====
          case 'new-window':
            api.window.new()
            break
          case 'open-folder':
            api.workspace.open()
            break
          case 'add-folder':
            api.workspace.addFolder()
            break
          case 'save-workspace': {
            const { workspace } = useStore.getState()
            if (workspace) {
              api.workspace.save(workspace.configPath || '', workspace.roots).catch((err) => {
                logger.system.error('[MenuBridge] Save workspace failed', err)
              })
            }
            break
          }
          case 'save-file':
            // 触发编辑器保存当前文件（通过全局事件）
            window.dispatchEvent(new CustomEvent('editor:save-active-file'))
            break
          case 'refresh-files':
            // 触发文件树刷新（FileExplorer 监听此事件）
            window.dispatchEvent(
              new CustomEvent('workspace:files-changed', { detail: { refreshRoot: true } }),
            )
            break
          case 'settings':
            ctx.setShowSettingsPage(true)
            break

          // ===== 视图菜单 =====
          case 'workbench.action.showCommands':
            ctx.setShowCommandPalette(true)
            break
          case 'workbench.action.quickOpen':
            ctx.setShowQuickOpen(true)
            break
          case 'toggle-terminal':
            ctx.toggleTerminal()
            break
          case 'toggle-ai-panel':
            ctx.setChatVisible(true)
            break
          case 'workbench.action.toggleSidebar':
            ctx.toggleSidebar()
            break
          case 'workbench.action.toggleDevTools':
            api.window.toggleDevTools()
            break

          // ===== 场景菜单 =====
          case 'scenario.switch': {
            const scenarioId = (payload as { scenarioId?: string })?.scenarioId
            if (scenarioId && scenarioLoader.has(scenarioId)) {
              useStore.getState().set('activeScenarioId', scenarioId)
            } else {
              logger.system.warn(`[MenuBridge] Scenario not found: ${scenarioId}`)
            }
            break
          }
          case 'scenario.openManager':
            // 打开场景管理侧边面板
            ctx.setActiveSidePanel('scenarios')
            break

          // ===== 会话菜单 =====
          case 'ai-chat':
            // 显示聊天面板 + 创建新会话（与右上角"新对话"按钮一致）
            ctx.setChatVisible(true)
            useAgentStore.getState().createThread()
            break
          case 'ai-explain':
            ctx.setChatVisible(true)
            window.dispatchEvent(new CustomEvent('ai:explain-current-file'))
            break
          case 'ai-refactor':
            ctx.setChatVisible(true)
            window.dispatchEvent(new CustomEvent('ai:refactor-current-file'))
            break
          case 'ai-fix':
            ctx.setChatVisible(true)
            window.dispatchEvent(new CustomEvent('ai:fix-current-file'))
            break
          case 'ai-clear-history': {
            const isZh = stateRef.current.language.toLowerCase().includes('zh')
            const ok = window.confirm(
              isZh
                ? '确定要清除当前会话的所有消息吗？此操作不可撤销。'
                : 'Clear all messages in the current conversation? This cannot be undone.',
            )
            if (ok) ctx.clearMessages()
            break
          }
          case 'ai-clear-checkpoints': {
            const isZh = stateRef.current.language.toLowerCase().includes('zh')
            const ok = window.confirm(
              isZh
                ? '确定要清除所有检查点吗？此操作不可撤销。'
                : 'Clear all checkpoints? This cannot be undone.',
            )
            if (ok) ctx.clearCheckpoints()
            break
          }

          // ===== 帮助菜单 =====
          case 'keyboard-shortcuts':
            // 通过全局事件触发快捷键面板（AweeApp 监听）
            window.dispatchEvent(new CustomEvent('app:show-keyboard-shortcuts'))
            break

          default:
            logger.system.warn(`[MenuBridge] Unknown command: ${commandId}`)
        }
      } catch (err) {
        logger.system.error(`[MenuBridge] Command failed: ${commandId}`, err)
      }
    })
    return () => {
      unsubscribe?.()
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
