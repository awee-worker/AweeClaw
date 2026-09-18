/**
 * 菜单命令分发器
 *
 * 统一处理「菜单命令 → 业务逻辑」的分发，供两个来源复用：
 * 1. 主进程原生菜单（macOS 系统菜单栏 / 快捷键加速器）经 IPC 下发
 * 2. 渲染进程自绘菜单（Windows/Linux 顶部菜单栏）经本地事件下发
 *
 * 命令清单参见 src/main/menu/menuItems/*.ts 中的 commandId。
 */

import { useStore } from '@store'
import type { SidePanel } from '@store'
import { api } from '../adapters/electronBridge'
import { workspaceManager } from '@services/WorkspaceAdapter'
import { scenarioLoader } from '@/scenarios'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { logger } from '@toolkit/LogEngine'

/** 自绘菜单触发命令时派发的本地事件名 */
export const MENU_EXECUTE_COMMAND_EVENT = 'menu:execute-command'

/** 自绘菜单触发命令的事件 detail */
export interface MenuExecuteCommandDetail {
  commandId: string
  payload?: unknown
}

/**
 * 派发一条菜单命令到当前渲染进程（供自绘菜单调用）
 */
export function emitMenuCommand(commandId: string, payload?: unknown): void {
  window.dispatchEvent(
    new CustomEvent<MenuExecuteCommandDetail>(MENU_EXECUTE_COMMAND_EVENT, {
      detail: { commandId, payload },
    }),
  )
}

/** 命令分发所需的上下文（由 useMenuBridge 维护最新引用） */
export interface MenuCommandContext {
  language: string
  setShowSettingsPage: (v: boolean) => void
  setShowCommandPalette: (v: boolean) => void
  setShowQuickOpen: (v: boolean) => void
  setShowAbout: (v: boolean) => void
  setActiveSidePanel: (panel: SidePanel) => void
  toggleSidebar: () => void
  toggleTerminal: () => void
  setChatVisible: (v: boolean) => void
  clearMessages: () => void
  clearCheckpoints: () => void
}

/**
 * 执行菜单命令
 */
export function dispatchMenuCommand(
  ctx: MenuCommandContext,
  commandId: string,
  payload?: unknown,
): void {
  try {
    switch (commandId) {
      // ===== 应用菜单 =====
      case 'app.about':
      case 'about':
        ctx.setShowAbout(true)
        break

      // ===== 文件菜单 =====
      case 'open-folder':
        // 与顶部工作区菜单共用同一链路：选择器同时接受文件夹与多根工作区文件
        void workspaceManager.openFolderFromDialog().catch((err) => {
          logger.system.error('[MenuBridge] Open folder failed', err)
        })
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
      case 'workspace.openRecent': {
        const path = (payload as { path?: string })?.path
        if (path) {
          workspaceManager.openFolder(path).catch((err) => {
            logger.system.error('[MenuBridge] Open recent workspace failed', err)
          })
        }
        break
      }
      case 'workspace.clearRecent':
        api.workspace.clearRecent().catch((err) => {
          logger.system.error('[MenuBridge] Clear recent workspaces failed', err)
        })
        break

      // ===== 视图菜单 =====
      case 'workbench.action.showCommands':
        ctx.setShowCommandPalette(true)
        break
      case 'workbench.action.quickOpen':
      case 'quick-open':
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
        const isZh = ctx.language.toLowerCase().includes('zh')
        const ok = window.confirm(
          isZh
            ? '确定要清除当前会话的所有消息吗？此操作不可撤销。'
            : 'Clear all messages in the current conversation? This cannot be undone.',
        )
        if (ok) ctx.clearMessages()
        break
      }
      case 'ai-clear-checkpoints': {
        const isZh = ctx.language.toLowerCase().includes('zh')
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
}
