/**
 * 快捷键设置面板
 *
 * 设计理念：
 * - 分类分组：按命令分类分组显示
 * - 冲突检测：实时检测快捷键冲突
 * - 搜索过滤：支持按命令名、分类、快捷键搜索
 * - 导入导出：支持快捷键配置导入导出
 * - 可访问性：ARIA 标签、键盘操作
 * - 性能优化：useMemo、useCallback
 */

import { useEffect, useState, useMemo, useCallback } from 'react'
import {
  Search,
  RotateCcw,
  Download,
  Upload,
  AlertCircle,
  Keyboard,
} from 'lucide-react'
import {
  keybindingService,
  Command,
  formatShortcut,
  isMac,
} from '@services/keybindingAdapter'
import { registerCoreCommands } from '@renderer/config/commandRegistry'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import { TextField, ActionButton, OverlayDialog } from '@components/ui'

/** 修饰键映射 */
const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta'])

/** 特殊键映射 */
const SPECIAL_KEYS: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
}

export default function KeybindingPanel() {
  const language = useStore((s) => s.language) as Language
  const [commands, setCommands] = useState<Command[]>([])
  const [bindings, setBindings] = useState<Record<string, string>>({})
  const [searchQuery, setSearchQuery] = useState('')
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [conflictMap, setConflictMap] = useState<Record<string, string[]>>({})

  /** 加载数据 */
  const loadData = useCallback(() => {
    const allCommands = keybindingService.getAllCommands()
    setCommands(allCommands)

    const newBindings: Record<string, string> = {}
    allCommands.forEach((cmd) => {
      const binding = keybindingService.getBinding(cmd.id)
      if (binding) newBindings[cmd.id] = binding
    })
    setBindings(newBindings)

    // 检测冲突
    const conflicts: Record<string, string[]> = {}
    const bindingToIds = new Map<string, string[]>()

    Object.entries(newBindings).forEach(([id, binding]) => {
      const existing = bindingToIds.get(binding) || []
      existing.push(id)
      bindingToIds.set(binding, existing)
    })

    bindingToIds.forEach((ids) => {
      if (ids.length > 1) {
        ids.forEach((id) => {
          conflicts[id] = ids.filter((i) => i !== id)
        })
      }
    })
    setConflictMap(conflicts)
  }, [])

  useEffect(() => {
    registerCoreCommands()
    keybindingService.init().then(() => {
      loadData()
    })
  }, [loadData])

  /** 处理按键录制 */
  const handleKeyDown = useCallback(
    async (e: React.KeyboardEvent) => {
      if (!recordingId) return
      e.preventDefault()
      e.stopPropagation()

      // 单独修饰键不处理
      if (MODIFIER_KEYS.has(e.key)) return

      // Esc 取消
      if (e.key === 'Escape') {
        setRecordingId(null)
        return
      }

      const modifiers: string[] = []
      if (isMac) {
        if (e.metaKey) modifiers.push('Ctrl')
        if (e.ctrlKey) modifiers.push('Control')
      } else {
        if (e.ctrlKey) modifiers.push('Ctrl')
        if (e.metaKey) modifiers.push('Meta')
      }
      if (e.shiftKey) modifiers.push('Shift')
      if (e.altKey) modifiers.push('Alt')

      let key = e.key
      if (SPECIAL_KEYS[key]) key = SPECIAL_KEYS[key]
      if (key.length === 1) key = key.toUpperCase()

      const binding = [...modifiers, key].join('+')

      await keybindingService.updateBinding(recordingId, binding)
      setRecordingId(null)
      loadData()
    },
    [recordingId, loadData],
  )

  /** 重置快捷键 */
  const handleReset = useCallback(
    async (id: string) => {
      await keybindingService.resetBinding(id)
      loadData()
    },
    [loadData],
  )

  /** 导出配置 */
  const handleExport = useCallback(() => {
    const data = JSON.stringify(bindings, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'keybindings.json'
    a.click()
    URL.revokeObjectURL(url)
  }, [bindings])

  /** 导入配置 */
  const handleImport = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      const reader = new FileReader()
      reader.onload = async (event) => {
        try {
          const imported = JSON.parse(event.target?.result as string)
          for (const [id, binding] of Object.entries(imported)) {
            await keybindingService.updateBinding(id, binding as string)
          }
          loadData()
        } catch {
          // 忽略导入失败
        }
      }
      reader.readAsText(file)
      e.target.value = ''
    },
    [loadData],
  )

  /** 过滤后的命令 */
  const filteredCommands = useMemo(() => {
    if (!searchQuery.trim()) return commands

    const query = searchQuery.toLowerCase()
    return commands.filter((cmd) => {
      const title = t(`cmd.${cmd.id}`, language) || cmd.title
      const category = cmd.category
        ? t(`kb.category.${cmd.category}`, language) || cmd.category
        : ''
      const binding = bindings[cmd.id] || ''

      return (
        title.toLowerCase().includes(query) ||
        category.toLowerCase().includes(query) ||
        binding.toLowerCase().includes(query)
      )
    })
  }, [commands, searchQuery, bindings, language])

  /** 按分类分组 */
  const groupedCommands = useMemo(() => {
    const groups = new Map<string, Command[]>()

    filteredCommands.forEach((cmd) => {
      const category = cmd.category
        ? t(`kb.category.${cmd.category}`, language) || cmd.category
        : t('kb.category.other', language) || '其他'
      if (!groups.has(category)) {
        groups.set(category, [])
      }
      groups.get(category)!.push(cmd)
    })

    return Array.from(groups.entries())
  }, [filteredCommands, language])

  return (
    <div className="flex flex-col h-full bg-background text-text-primary">
      {/* 工具栏 */}
      <div className="p-4 border-b border-border-subtle flex items-center gap-3">
        <div className="relative flex-1">
          <TextField
            leftIcon={<Search className="w-4 h-4" />}
            placeholder={
              t('kb.searchPlaceholder', language) || 'Search keybindings...'
            }
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <ActionButton
          variant="outline"
          size="icon"
          onClick={handleExport}
          title={t('kb.export', language) || '导出配置'}
        >
          <Download className="w-4 h-4" />
        </ActionButton>
        <label className="cursor-pointer">
          <ActionButton
            variant="outline"
            size="icon"
            onClick={() => document.getElementById('kb-import')?.click()}
            title={t('kb.import', language) || '导入配置'}
          >
            <Upload className="w-4 h-4" />
          </ActionButton>
          <input
            id="kb-import"
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImport}
          />
        </label>
      </div>

      {/* 命令列表 */}
      <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
        {groupedCommands.map(([category, cmds]) => (
          <div key={category} className="mb-6">
            <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-3">
              {category}
            </h3>
            <div className="space-y-1">
              {cmds.map((cmd) => {
                const hasConflict = !!conflictMap[cmd.id]
                return (
                  <div
                    key={cmd.id}
                    className={`flex items-center justify-between p-3 rounded-lg hover:bg-surface-hover group transition-colors ${
                      hasConflict ? 'bg-red-500/10' : ''
                    }`}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium">
                        {t(`cmd.${cmd.id}`, language) || cmd.title}
                      </span>
                      <span className="text-xs text-text-muted">
                        {cmd.id}
                        {hasConflict && (
                          <span className="ml-2 text-red-400 flex items-center gap-1 inline-flex">
                            <AlertCircle className="w-3 h-3" />
                            {t('kb.conflict', language) || '冲突'}
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <ActionButton
                        variant="outline"
                        size="sm"
                        onClick={() => setRecordingId(cmd.id)}
                        className={`font-mono min-w-[80px] ${
                          hasConflict ? 'border-red-500/50' : ''
                        }`}
                      >
                        {bindings[cmd.id]
                          ? formatShortcut(bindings[cmd.id])
                          : '-'}
                      </ActionButton>

                      {keybindingService.isOverridden(cmd.id) && (
                        <ActionButton
                          variant="ghost"
                          size="icon"
                          onClick={() => handleReset(cmd.id)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                          title={
                            t('kb.resetToDefault', language) || 'Reset to default'
                          }
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                        </ActionButton>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {filteredCommands.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-text-muted">
            <Keyboard className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">
              {t('kb.noResults', language) || '未找到匹配的命令'}
            </p>
          </div>
        )}
      </div>

      {/* 录制对话框 */}
      <OverlayDialog
        isOpen={!!recordingId}
        onClose={() => setRecordingId(null)}
        title={
          t('kb.pressKeyCombination', language) || 'Press desired key combination'
        }
        size="sm"
      >
        <div
          className="flex flex-col items-center gap-6 py-4 outline-none"
          tabIndex={0}
          ref={(el) => el?.focus()}
          onKeyDown={handleKeyDown}
        >
          <p className="text-text-muted text-sm">
            {t('kb.pressEscToCancel', language) || 'Press Esc to cancel'}
          </p>
          <div className="px-6 py-3 bg-surface-active rounded-lg border border-accent/30 text-2xl font-mono text-accent shadow-lg shadow-accent/10 animate-pulse">
            {t('kb.recording', language) || 'Recording...'}
          </div>
        </div>
      </OverlayDialog>
    </div>
  )
}
