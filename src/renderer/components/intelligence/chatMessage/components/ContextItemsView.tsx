/**
 * 上下文项标签视图
 * 展示用户消息附带的上文上下文（文件、代码、文件夹、技能等）
 */
import React from 'react'
import { FileText, Code, Folder, Puzzle } from 'lucide-react'
import { getFileName } from '@shared/toolkit/pathHelper'

interface ContextItemTag {
  type: string
  uri?: string
  range?: [number, number]
  skillId?: string
  pluginId?: string
  name?: string
  /** 界面展示名（技能中文名） */
  displayName?: string
  /** 技能/插件二级项的选择结果（如「模板：商务浅色」） */
  subSelection?: string
  /** 插件侧写回的状态说明；没有 subSelection 时兜底展示，避免选择结果丢失 */
  stateNote?: string
  /** 静默项（上传附件自动添加），UI 不显示 */
  silent?: boolean
}

interface ContextItemsViewProps {
  items: ContextItemTag[]
}

/** 根据上下文类型获取样式配置 */
function getContextStyle(type: string) {
  switch (type) {
    case 'File':
      return { bg: 'bg-text-primary/[0.04]', text: 'text-text-secondary', border: 'border-transparent', Icon: FileText }
    case 'CodeSelection':
      return { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-transparent', Icon: Code }
    case 'Folder':
      return { bg: 'bg-yellow-500/10', text: 'text-yellow-400', border: 'border-transparent', Icon: Folder }
    case 'Skill':
      return { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20', Icon: null }
    case 'Plugin':
      return { bg: 'bg-purple-500/10', text: 'text-purple-400', border: 'border-purple-500/20', Icon: Puzzle }
    default:
      return { bg: 'bg-text-primary/[0.04]', text: 'text-text-muted', border: 'border-transparent', Icon: FileText }
  }
}

/** 根据上下文类型获取显示标签 */
function getContextLabel(item: ContextItemTag): string {
  switch (item.type) {
    case 'File':
    case 'Folder': {
      const uri = item.uri || ''
      return getFileName(uri) || uri
    }
    case 'CodeSelection': {
      const uri = item.uri || ''
      const range = item.range
      const name = getFileName(uri) || uri
      return range ? `${name}:${range[0]}-${range[1]}` : name
    }
    case 'Skill':
      return `@${item.displayName || item.name || item.skillId || 'skill'}`
    case 'Plugin':
      return `@${item.displayName || item.name || item.pluginId || 'plugin'}`
    default:
      return 'Context'
  }
}

function ContextItemsViewBase({ items }: ContextItemsViewProps) {
  if (!items || items.length === 0) return null

  // 过滤掉静默项（上传附件自动添加的 File context，不在 UI 显示文件名）
  const visibleItems = items.filter(item => !item.silent)
  if (visibleItems.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 mb-2 -mt-1 pt-1 justify-end">
      {visibleItems.map((item, i) => {
        const style = getContextStyle(item.type)
        const label = getContextLabel(item)
        const IconComponent = style.Icon
        // 二级项结果：优先用专门的选择字段，历史消息里只写了状态说明时退回它
        const selection = item.subSelection || item.stateNote

        return (
          <span
            key={i}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 ${style.bg} ${style.text} text-[11px] font-medium rounded-md border ${style.border} select-none opacity-80 hover:opacity-100 transition-opacity`}
          >
            {IconComponent && <IconComponent className="w-3 h-3 opacity-70" />}
            <span className="max-w-[150px] truncate">{label}</span>
            {/* 二级项结果跟在技能标签后：只有技能名会被单独截断，选择本身始终可读 */}
            {selection && (
              <span className="max-w-[160px] truncate opacity-80" title={selection}>
                · {selection}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

export const ContextItemsView = React.memo(ContextItemsViewBase)
ContextItemsView.displayName = 'ContextItemsView'
