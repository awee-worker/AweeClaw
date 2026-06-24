/**
 * 命令面板组件
 *
 * 设计理念：
 * - 关注点分离：命令定义在 commandRegistry.ts，组件仅负责 UI
 * - 模糊搜索：支持多 token 搜索
 * - 键盘导航：上下箭头、Enter、Esc
 * - 历史记录：记录最近使用的命令（localStorage）
 * - 可访问性：ARIA 标签、焦点管理
 * - 性能优化：useMemo 缓存、memo 组件
 */

import { api } from '../../adapters/electronBridge'
import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { Search, X, Sparkles } from 'lucide-react'
import { useStore, useModeStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useAgentStore } from '@intelligence/state/IntelligenceStore'
import { useAgentHistoryActions } from '@hooks/useAgent'
import { t } from '@renderer/i18n'
import { keybindingService, formatShortcut, isMac } from '@services/keybindingAdapter'
import { aweeclawDir } from '@services/appDirService'
import { toast } from '@components/foundation/NotificationProvider'
import { useElevatedToastLayer } from '@components/foundation/toastLayerStore'
import {
  buildCommands,
  fuzzySearchCommands,
  groupCommandsByCategory,
  type Command,
  type CommandContext,
} from './commandRegistry'

interface CommandPaletteProps {
  onClose: () => void
  onShowKeyboardShortcuts: () => void
}

/** 历史记录存储键 */
const HISTORY_STORAGE_KEY = 'aweeclaw:command-history'
/** 最大历史记录数 */
const MAX_HISTORY = 5

/**
 * 加载命令历史
 *
 * @returns 历史命令 ID 列表
 */
function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * 保存命令历史
 *
 * @param ids 历史 ID 列表
 */
function saveHistory(ids: string[]): void {
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // 忽略存储失败
  }
}

/** 命令项组件 */
const CommandItem = memo(function CommandItem({
  command,
  isSelected,
  onSelect,
}: {
  command: Command
  isSelected: boolean
  onSelect: () => void
}) {
  const Icon = command.icon

  return (
    <div
      onClick={onSelect}
      className={`
        relative flex items-center gap-3 px-4 py-3 cursor-pointer transition-all duration-200 mx-2 rounded-lg group
        ${isSelected
          ? 'bg-surface-active text-text-primary'
          : 'text-text-secondary hover:bg-surface-hover'}
      `}
      role="option"
      aria-selected={isSelected}
    >
      <div
        className={`p-1.5 rounded-md transition-colors flex-shrink-0 ${
          isSelected
            ? 'bg-accent/20 text-accent'
            : 'bg-surface/50 text-text-muted group-hover:text-text-primary'
        }`}
      >
        <Icon className="w-4 h-4" aria-hidden />
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-center">
        <div
          className={`text-sm font-medium transition-colors leading-none mb-1 ${
            isSelected ? 'text-text-primary' : ''
          }`}
        >
          {command.label}
        </div>
        {command.description && (
          <div
            className={`text-[11px] truncate transition-opacity leading-none ${
              isSelected
                ? 'text-text-secondary opacity-90'
                : 'text-text-muted opacity-60'
            }`}
          >
            {command.description}
          </div>
        )}
      </div>

      {command.shortcut && (
        <kbd
          className={`
            px-2 py-0.5 text-[11px] font-mono rounded border relative z-10 transition-colors flex-shrink-0
            ${isSelected
              ? 'bg-background/50 border-accent/30 text-accent'
              : 'bg-surface border-border text-text-muted'}
          `}
        >
          {command.shortcut}
        </kbd>
      )}

      {isSelected && !command.shortcut && (
        <div className="flex-shrink-0 text-[11px] font-mono text-text-muted bg-surface px-1.5 py-0.5 rounded border border-border opacity-0 group-hover:opacity-100 transition-opacity animate-fade-in">
          ⏎ Run
        </div>
      )}
    </div>
  )
})

export default function CommandPalette({
  onClose,
  onShowKeyboardShortcuts,
}: CommandPaletteProps) {
  useElevatedToastLayer(true)

  const {
    setShowSettingsPage,
    setTerminalVisible,
    terminalVisible,
    workspacePath,
    activeFilePath,
    language,
    setShowQuickOpen,
    setShowWorkflow,
    setShowAbout,
    chatVisible,
    setChatVisible,
  } = useStore(
    useShallow((s) => ({
      setShowSettingsPage: s.setShowSettingsPage,
      setTerminalVisible: s.setTerminalVisible,
      terminalVisible: s.terminalVisible,
      workspacePath: s.workspacePath,
      activeFilePath: s.activeFilePath,
      language: s.language,
      setShowQuickOpen: s.setShowQuickOpen,
      setShowWorkflow: s.setShowWorkflow,
      setShowAbout: s.setShowAbout,
      chatVisible: s.chatVisible,
      setChatVisible: s.setChatVisible,
    })),
  )

  const setInputPrompt = useAgentStore((state) => state.setInputPrompt)
  const setMode = useModeStore((s) => s.setMode)
  const { clearMessages, clearCheckpoints } = useAgentHistoryActions()

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 快捷键映射
  const shortcuts = useMemo(
    () => ({
      'open-folder': formatShortcut('Ctrl+O'),
      'new-window': formatShortcut('Ctrl+Shift+N'),
      'save-file': formatShortcut('Ctrl+S'),
      'quick-open': formatShortcut('Ctrl+P'),
      'toggle-terminal': formatShortcut('Ctrl+`'),
      'toggle-ai-panel': formatShortcut('Ctrl+L'),
      'open-workflow': formatShortcut('Ctrl+Shift+I'),
      settings: formatShortcut('Ctrl+,'),
      'keyboard-shortcuts': '?',
    }),
    [],
  )

  // 构建命令上下文
  const commandContext: CommandContext = useMemo(
    () => ({
      workspacePath,
      activeFilePath,
      terminalVisible,
      chatVisible,
      setInputPrompt,
      setMode,
      setShowSettingsPage,
      setTerminalVisible,
      setShowQuickOpen,
      setShowWorkflow,
      setShowAbout,
      setChatVisible,
      clearMessages,
      clearCheckpoints,
      onShowKeyboardShortcuts,
      onClose,
    }),
    [
      workspacePath,
      activeFilePath,
      terminalVisible,
      chatVisible,
      setInputPrompt,
      setMode,
      setShowSettingsPage,
      setTerminalVisible,
      setShowQuickOpen,
      setShowWorkflow,
      setShowAbout,
      setChatVisible,
      clearMessages,
      clearCheckpoints,
      onShowKeyboardShortcuts,
      onClose,
    ],
  )

  // 构建所有命令
  const allCommands = useMemo(() => {
    const commands = buildCommands(commandContext, shortcuts)

    // 注入需要外部 API 的命令 action
    return commands.map((cmd) => {
      const action = wrapCommandAction(cmd.id, cmd.action, commandContext)
      return { ...cmd, action }
    })
  }, [commandContext, shortcuts])

  // 模糊搜索过滤
  const filteredCommands = useMemo(
    () => fuzzySearchCommands(allCommands, query),
    [allCommands, query],
  )

  // 依据命令分类聚合展示
  const groupedCommands = useMemo(
    () => groupCommandsByCategory(filteredCommands),
    [filteredCommands],
  )

  // 将分组结果展开为一维数组以便上下键遍历
  const flatCommands = useMemo(
    () => Array.from(groupedCommands.values()).flat(),
    [groupedCommands],
  )

  // 上下键、确认与取消的快捷键处理
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (keybindingService.matches(e, 'list.focusDown')) {
        e.preventDefault()
        setSelectedIndex((prev) => Math.min(prev + 1, flatCommands.length - 1))
      } else if (keybindingService.matches(e, 'list.focusUp')) {
        e.preventDefault()
        setSelectedIndex((prev) => Math.max(prev - 1, 0))
      } else if (keybindingService.matches(e, 'list.select')) {
        e.preventDefault()
        const cmd = flatCommands[selectedIndex]
        if (cmd) {
          cmd.action()
          recordCommandHistory(cmd.id)
          onClose()
        }
      } else if (keybindingService.matches(e, 'list.cancel')) {
        e.preventDefault()
        onClose()
      }
    },
    [flatCommands, selectedIndex, onClose],
  )

  // 挂载后聚焦搜索输入
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // 查询条件变化时回到首项
  useEffect(() => {
    setSelectedIndex(0)
  }, [query])

  // 选中项变化时滚动至可视区域
  useEffect(() => {
    if (listRef.current) {
      const selectedEl = listRef.current.querySelector(
        `[data-index="${selectedIndex}"]`,
      )
      selectedEl?.scrollIntoView({ block: 'nearest' })
    }
  }, [selectedIndex])

  let commandIndex = 0

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center pt-[15vh] animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="命令面板"
    >
      <div className="fixed inset-0 bg-background/20 backdrop-blur-sm transition-opacity" />

      <div
        className="
          relative w-[640px] max-h-[60vh] flex flex-col
          bg-background/80 backdrop-blur-2xl
          border border-border/50 rounded-2xl shadow-2xl shadow-black/40
          overflow-hidden animate-scale-in ring-1 ring-text-primary/5 origin-top
        "
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索框 */}
        <div className="flex items-center gap-4 px-6 py-5 border-b border-border/40 shrink-0">
          <Search className="w-6 h-6 text-text-muted" strokeWidth={2} aria-hidden />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('typeCommandOrSearch', language)}
            className="flex-1 bg-transparent text-xl font-medium text-text-primary placeholder:text-text-muted/85 focus:outline-none"
            spellCheck={false}
            aria-label="搜索命令"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              className="p-1 rounded-full hover:bg-surface-hover transition-colors"
              aria-label="清除搜索"
            >
              <X className="w-4 h-4 text-text-muted" aria-hidden />
            </button>
          )}
        </div>

        {/* 命令列表 */}
        <div
          ref={listRef}
          className="flex-1 overflow-y-auto py-3 custom-scrollbar scroll-p-2"
          role="listbox"
        >
          {Array.from(groupedCommands.entries()).map(([category, cmds]) => (
            <div key={category} className="mb-2">
              <div className="px-6 py-1.5 text-[11px] font-bold uppercase tracking-widest text-text-muted/85 sticky top-0 bg-background/95 backdrop-blur-md z-10 mb-1">
                {category}
              </div>
              <div className="space-y-0.5 px-2">
                {cmds.map((cmd) => {
                  const idx = commandIndex++
                  return (
                    <div key={cmd.id} data-index={idx}>
                      <CommandItem
                        command={cmd}
                        isSelected={idx === selectedIndex}
                        onSelect={() => {
                          cmd.action()
                          recordCommandHistory(cmd.id)
                          onClose()
                        }}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

          {flatCommands.length === 0 && (
            <div className="px-4 py-16 text-center text-text-muted flex flex-col items-center gap-4 opacity-60">
              <div className="w-16 h-16 rounded-full bg-surface/50 flex items-center justify-center border border-border shadow-inner">
                <Sparkles className="w-8 h-8 opacity-50 text-accent" aria-hidden />
              </div>
              <p className="text-sm font-medium">{t('noCommandsFound', language)}</p>
            </div>
          )}
        </div>

        {/* 底部提示 */}
        <div className="px-6 py-2.5 bg-surface/30 border-t border-border/40 text-[11px] font-medium text-text-muted/90 flex justify-between items-center backdrop-blur-md shrink-0">
          <div className="flex gap-4">
            <span className="flex items-center gap-1.5">
              <div className="flex gap-0.5">
                <kbd className="font-sans bg-surface/80 border border-border/50 px-1 py-0.5 rounded min-w-[16px] text-center shadow-sm">
                  ↑
                </kbd>
                <kbd className="font-sans bg-surface/80 border border-border/50 px-1 py-0.5 rounded min-w-[16px] text-center shadow-sm">
                  ↓
                </kbd>
              </div>
              <span>to navigate</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="font-sans bg-surface/80 border border-border/50 px-1.5 py-0.5 rounded shadow-sm">
                ↵
              </kbd>
              <span>to select</span>
            </span>
          </div>
          <div className="flex items-center gap-2 opacity-50">
            <Sparkles className="w-3 h-3 text-accent" aria-hidden />
            <span className="font-medium tracking-wide">AweeClaw AI</span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * 包装命令 action，处理需要外部 API 的命令
 *
 * @param id 命令 ID
 * @param originalAction 原始 action
 * @param ctx 命令上下文
 * @returns 包装后的 action
 */
function wrapCommandAction(
  id: string,
  originalAction: () => void,
  ctx: CommandContext,
): () => void {
  return async () => {
    switch (id) {
      case 'open-folder':
        await api.file.openFolder()
        return
      case 'new-window':
        await api.window.new()
        return
      case 'add-folder': {
        const folderPath = await api.workspace.addFolder()
        if (folderPath) {
          const { addRoot } = useStore.getState()
          addRoot(folderPath)
          await aweeclawDir.initialize(folderPath)
          toast.success(`Added ${folderPath} to workspace`)
        }
        return
      }
      case 'save-workspace': {
        const { workspace } = useStore.getState()
        if (workspace) {
          const success = await api.workspace.save(
            workspace.configPath || '',
            workspace.roots,
          )
          if (success) toast.success('Workspace saved')
        }
        return
      }
      case 'save-file':
        document.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 's',
            ctrlKey: !isMac,
            metaKey: isMac,
          }),
        )
        return
      case 'refresh-files':
        if (ctx.workspacePath) {
          const files = await api.file.readDir(ctx.workspacePath)
          if (files) {
            useStore.getState().setFiles(files)
          }
        }
        return
      default:
        originalAction()
        return
    }
  }
}

/**
 * 记录命令使用历史
 *
 * @param commandId 命令 ID
 */
function recordCommandHistory(commandId: string): void {
  const history = loadHistory()
  const filtered = history.filter((id) => id !== commandId)
  filtered.unshift(commandId)
  saveHistory(filtered.slice(0, MAX_HISTORY))
}
