/**
 * 斜杠命令弹出菜单
 *
 * 设计理念：
 * - 命令分类：按类别组织命令，便于查找
 * - 最近使用：记录最近使用的命令
 * - 键盘快捷键：显示命令快捷键
 * - 可访问性：ARIA 标签
 * - 性能优化：useMemo 缓存
 */

import { useMemo, useCallback } from 'react'
import {
  Command,
  Sparkles,
  FileCode,
  Wrench,
  Bug,
  Zap,
  MessageSquare,
  Code,
  type LucideIcon,
} from 'lucide-react'
import { slashCommandService, SlashCommand } from '@services/slashCommandAdapter'
import { InputPopup, InputPopupItem } from '@components/foundation/QuickInputDialog'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'

/** 命令分类 */
type CommandCategory = 'code' | 'debug' | 'docs' | 'ai'

/** 命令元数据 */
interface CommandMetadata {
  icon: LucideIcon
  category: CommandCategory
  shortcut?: string
}

/** 命令名称到元数据的映射 */
const COMMAND_METADATA: Record<string, CommandMetadata> = {
  test: { icon: FileCode, category: 'code' },
  explain: { icon: MessageSquare, category: 'docs' },
  refactor: { icon: Wrench, category: 'code' },
  fix: { icon: Bug, category: 'debug' },
  optimize: { icon: Zap, category: 'code' },
  comment: { icon: MessageSquare, category: 'docs' },
  type: { icon: Code, category: 'code' },
}

/** 分类显示名称 */
const CATEGORY_LABELS: Record<CommandCategory, string> = {
  code: '代码',
  debug: '调试',
  docs: '文档',
  ai: 'AI',
}

/** 默认元数据 */
const DEFAULT_METADATA: CommandMetadata = {
  icon: Sparkles,
  category: 'ai',
}

/** 最近使用存储键 */
const RECENT_STORAGE_KEY = 'aweeclaw:slash-recent'
/** 最大最近记录数 */
const MAX_RECENT = 3

interface SlashCommandPopupProps {
  /** 包含 / 的输入 */
  query: string
  /** 弹出位置 */
  position: { x: number; y: number }
  /** 选择命令回调 */
  onSelect: (command: SlashCommand) => void
  /** 关闭回调 */
  onClose: () => void
}

/** 带命令的弹出项 */
interface CommandItem extends InputPopupItem {
  command: SlashCommand
}

/**
 * 获取命令元数据
 *
 * @param name 命令名称
 * @returns 命令元数据
 */
function getCommandMetadata(name: string): CommandMetadata {
  return COMMAND_METADATA[name] || DEFAULT_METADATA
}

/**
 * 加载最近使用的命令
 *
 * @returns 最近使用的命令名称列表
 */
function loadRecentCommands(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

/**
 * 记录命令使用
 *
 * @param name 命令名称
 */
function recordCommandUsage(name: string): void {
  try {
    const recent = loadRecentCommands().filter((n) => n !== name)
    recent.unshift(name)
    localStorage.setItem(
      RECENT_STORAGE_KEY,
      JSON.stringify(recent.slice(0, MAX_RECENT)),
    )
  } catch {
    // 忽略存储失败
  }
}

export default function SlashCommandPopup({
  query,
  position,
  onSelect,
  onClose,
}: SlashCommandPopupProps) {
  const language = useStore((s) => s.language)

  const matchingCommands = slashCommandService.findMatching(query)
  const recentCommands = useMemo(() => loadRecentCommands(), [])

  // 转换为 InputPopup 需要的格式
  const items: CommandItem[] = useMemo(() => {
    // 按最近使用排序：最近使用的排前面
    const sorted = [...matchingCommands].sort((a, b) => {
      const aIndex = recentCommands.indexOf(a.name)
      const bIndex = recentCommands.indexOf(b.name)

      // 都在最近列表中，按最近顺序排
      if (aIndex !== -1 && bIndex !== -1) {
        return aIndex - bIndex
      }
      // 只有 a 在最近列表中，a 排前
      if (aIndex !== -1) return -1
      // 只有 b 在最近列表中，b 排前
      if (bIndex !== -1) return 1
      // 都不在，保持原顺序
      return 0
    })

    return sorted.map((cmd) => {
      const meta = getCommandMetadata(cmd.name)
      const isRecent = recentCommands.includes(cmd.name)

      return {
        id: cmd.name,
        label: `/${cmd.name}`,
        description: isRecent
          ? `${cmd.description} · ${CATEGORY_LABELS[meta.category]}`
          : `${cmd.description} · ${CATEGORY_LABELS[meta.category]}`,
        icon: meta.icon,
        command: cmd,
      }
    })
  }, [matchingCommands, recentCommands])

  const handleSelect = useCallback(
    (item: CommandItem) => {
      recordCommandUsage(item.command.name)
      onSelect(item.command)
    },
    [onSelect],
  )

  if (items.length === 0) return null

  return (
    <InputPopup<CommandItem>
      position={position}
      items={items}
      onSelect={handleSelect}
      onClose={onClose}
      header={
        <span className="flex items-center gap-2">
          <Command className="w-3 h-3" aria-hidden />
          {t('ai.quickcommands', language as Language)}
        </span>
      }
      emptyText={t('ai.nomatchingcommands', language as Language)}
    />
  )
}
