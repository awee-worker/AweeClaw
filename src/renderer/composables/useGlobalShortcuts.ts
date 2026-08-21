/**
 * 全局快捷键监听
 *
 * 通过命令表派发按键事件，不硬编码按键字符串。
 * 命令定义集中在 src/renderer/config/commands.ts。
 */

import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '@store'
import { api } from '../adapters/electronBridge'
import { keybindingService } from '@services/keybindingAdapter'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import type { SceneMode } from '@protocols/sceneModeProtocol'

const kb = keybindingService

/** 快捷键处理器返回是否已处理 */
type KeyHandler = (e: KeyboardEvent, ctx: ShortcutContext) => boolean

/** 快捷键上下文，避免闭包依赖导致重建 */
interface ShortcutContext {
  terminalVisible: boolean
  debugVisible: boolean
  chatVisible: boolean
  showCommandPalette: boolean
  showWorkflow: boolean
  showQuickOpen: boolean
  showAbout: boolean
  activeFilePath: string | null
  setShowSettingsPage: (v: boolean) => void
  setShowCommandPalette: (v: boolean) => void
  setShowWorkflow: (v: boolean) => void
  setShowQuickOpen: (v: boolean) => void
  setShowAbout: (v: boolean) => void
  setTerminalVisible: (v: boolean) => void
  setDebugVisible: (v: boolean) => void
  setChatVisible: (v: boolean) => void
  closeFile: (path: string) => void
}

/** 判断当前焦点是否在 Monaco 编辑器内 */
function isEditorFocused(): boolean {
  const active = document.activeElement
  if (!active) return false
  return active.classList.contains('inputarea') || !!active.closest('.monaco-editor')
}

/** 命令表：按优先级顺序匹配 */
const HANDLERS: KeyHandler[] = [
  // DevTools：F12 在编辑器外触发，编辑器内放行给 Monaco
  (e, _ctx) => {
    const isBareF12 = e.key === 'F12' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey
    const isCustom = !isBareF12 && kb.matches(e, 'workbench.action.toggleDevTools')
    if (!isBareF12 && !isCustom) return false

    if (!isEditorFocused()) {
      e.preventDefault()
      api.window.toggleDevTools()
    }
    return true
  },

  // 命令面板：F1 或 Ctrl+Shift+P
  (e, ctx) => {
    if (e.key === 'F1' || kb.matches(e, 'workbench.action.showCommands')) {
      e.preventDefault()
      ctx.setShowCommandPalette(true)
      return true
    }
    return false
  },

  // Quick Open
  (e, ctx) => {
    if (kb.matches(e, 'workbench.action.quickOpen')) {
      e.preventDefault()
      ctx.setShowQuickOpen(true)
      return true
    }
    return false
  },

  // 设置
  (e, ctx) => {
    if (kb.matches(e, 'workbench.action.openSettings')) {
      e.preventDefault()
      ctx.setShowSettingsPage(true)
      return true
    }
    return false
  },

  // 终端
  (e, ctx) => {
    if (kb.matches(e, 'view.toggleTerminal')) {
      e.preventDefault()
      ctx.setTerminalVisible(!ctx.terminalVisible)
      return true
    }
    return false
  },

  // 调试面板
  (e, ctx) => {
    if (kb.matches(e, 'view.toggleDebug')) {
      e.preventDefault()
      ctx.setDebugVisible(!ctx.debugVisible)
      return true
    }
    return false
  },

  // AI 面板
  (e, ctx) => {
    if (kb.matches(e, 'view.toggleAiPanel')) {
      e.preventDefault()
      ctx.setChatVisible(!ctx.chatVisible)
      return true
    }
    return false
  },

  // 开始调试
  (e, ctx) => {
    if (kb.matches(e, 'debug.start')) {
      e.preventDefault()
      if (!ctx.debugVisible) ctx.setDebugVisible(true)
      window.dispatchEvent(new CustomEvent('debug:start'))
      return true
    }
    return false
  },

  // 切换断点
  (e) => {
    if (kb.matches(e, 'debug.toggleBreakpoint')) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('debug:toggleBreakpoint'))
      return true
    }
    return false
  },

  // 工作流
  (e, ctx) => {
    if (kb.matches(e, 'workbench.action.toggleComposer')) {
      e.preventDefault()
      ctx.setShowWorkflow(true)
      return true
    }
    return false
  },

  // 在资源管理器中显示
  (e) => {
    if (kb.matches(e, 'explorer.revealActiveFile') || kb.matches(e, 'explorer.revealInSidebar')) {
      e.preventDefault()
      window.dispatchEvent(new CustomEvent('explorer:reveal-active-file'))
      return true
    }
    return false
  },

  // 关闭当前文件
  (e, ctx) => {
    if (kb.matches(e, 'editor.closeFile')) {
      e.preventDefault()
      if (ctx.activeFilePath) ctx.closeFile(ctx.activeFilePath)
      return true
    }
    return false
  },

  // Escape：关闭浮层
  (e, ctx) => {
    if (e.key !== 'Escape') return false
    if (ctx.showCommandPalette) ctx.setShowCommandPalette(false)
    if (ctx.showWorkflow) ctx.setShowWorkflow(false)
    if (ctx.showQuickOpen) ctx.setShowQuickOpen(false)
    if (ctx.showAbout) ctx.setShowAbout(false)
    return true
  },

  // 场景模式快捷键：Cmd/Ctrl+Shift+1/2/3 切换工作/生活/学习
  (e, _ctx) => {
    if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return false
    const modeMap: Record<string, SceneMode> = {
      '1': 'work',
      '2': 'life',
      '3': 'study',
    }
    const mode = modeMap[e.key]
    if (!mode) return false
    e.preventDefault()
    useSceneModeStore.getState().setSceneMode(mode)
    return true
  },
]

export function useGlobalShortcuts() {
  const setShowSettingsPage = useStore((s) => s.setShowSettingsPage)
  const setShowCommandPalette = useStore((s) => s.setShowCommandPalette)
  const setShowWorkflow = useStore((s) => s.setShowWorkflow)
  const setShowQuickOpen = useStore((s) => s.setShowQuickOpen)
  const setShowAbout = useStore((s) => s.setShowAbout)
  const setTerminalVisible = useStore((s) => s.setTerminalVisible)
  const setDebugVisible = useStore((s) => s.setDebugVisible)
  const setChatVisible = useStore((s) => s.setChatVisible)
  const closeFile = useStore((s) => s.closeFile)

  // 动态状态通过 ref 访问，避免 handleKeyDown 重建
  const ctxRef = useRef<ShortcutContext>({} as ShortcutContext)

  const terminalVisible = useStore((s) => s.terminalVisible)
  const debugVisible = useStore((s) => s.debugVisible)
  const chatVisible = useStore((s) => s.chatVisible)
  const showCommandPalette = useStore((s) => s.showCommandPalette)
  const showWorkflow = useStore((s) => s.showWorkflow)
  const showQuickOpen = useStore((s) => s.showQuickOpen)
  const showAbout = useStore((s) => s.showAbout)
  const activeFilePath = useStore((s) => s.activeFilePath)

  ctxRef.current = {
    terminalVisible,
    debugVisible,
    chatVisible,
    showCommandPalette,
    showWorkflow,
    showQuickOpen,
    showAbout,
    activeFilePath,
    setShowSettingsPage,
    setShowCommandPalette,
    setShowWorkflow,
    setShowQuickOpen,
    setShowAbout,
    setTerminalVisible,
    setDebugVisible,
    setChatVisible,
    closeFile,
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const ctx = ctxRef.current
    for (const handler of HANDLERS) {
      if (handler(e, ctx)) break
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // 主进程菜单命令
  useEffect(() => {
    const removeListener = api.onExecuteCommand((commandId: string) => {
      if (commandId === 'workbench.action.showCommands') {
        setShowCommandPalette(true)
      }
      if (commandId === 'workbench.action.toggleDevTools') {
        api.window.toggleDevTools()
      }
    })
    return () => {
      removeListener?.()
    }
  }, [setShowCommandPalette])
}
