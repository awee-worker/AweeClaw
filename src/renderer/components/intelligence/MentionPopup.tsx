/**
 * @ 文件提及弹出菜单
 * 使用公共 InputPopup 组件
 */

import { useMemo } from 'react'
import { Search } from 'lucide-react'
import { t } from '@renderer/i18n'
import { MentionCandidate } from '@intelligence/utils/mentionDecoder'
import { useStore } from '@store'
import { InputPopup, InputPopupItem } from '@components/foundation/QuickInputDialog'

interface MentionPopupProps {
    position: { x: number; y: number }
    query: string
    candidates: MentionCandidate[]
    loading: boolean
    onSelect: (candidate: MentionCandidate) => void
    onClose: () => void
}

// 提及候选项与弹窗条目的映射接口
interface MentionItem extends InputPopupItem {
    candidate: MentionCandidate
}

export default function MentionPopup({
    position,
    query,
    candidates,
    loading,
    onSelect,
    onClose,
}: MentionPopupProps) {
    const language = useStore(s => s.language)

    // 候选项转换为弹窗可用的条目列表
    const items: MentionItem[] = useMemo(() => {
        return candidates.map(candidate => ({
            id: candidate.id,
            label: candidate.label,
            description: candidate.description,
            icon: candidate.icon,
            candidate,
        }))
    }, [candidates])

    const handleSelect = (item: MentionItem) => {
        onSelect(item.candidate)
    }

    // 条目渲染逻辑：文件类型用 muted 色，技能/插件类型用 accent 色
    const renderItem = (item: MentionItem, _index: number, isSelected: boolean) => {
        const Icon = item.icon
        const candidate = item.candidate
        const isToolType = candidate.type === 'skill' || candidate.type === 'plugin'
        // 中文界面优先显示中文名称/描述（技能、插件有中文名时）
        const isZh = language === 'zh'
        const displayLabel = isZh ? (candidate.labelZh || item.label) : item.label
        const displayDescription = isZh ? (candidate.descriptionZh || item.description) : item.description
        // 图标：字符串表示图片 URL，其余为图标组件
        const isImageIcon = typeof Icon === 'string'
        return (
            <div
                key={item.id}
                onClick={() => handleSelect(item)}
                className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors ${isSelected ? 'bg-accent/20 text-text-primary' : 'hover:bg-surface-hover text-text-secondary'}`}
            >
                {Icon && (isImageIcon ? (
                    <img src={Icon} alt="" className="w-4 h-4 flex-shrink-0 rounded object-cover" />
                ) : (
                    <Icon className={`w-4 h-4 flex-shrink-0 ${isToolType ? 'text-accent' : 'text-text-muted'}`} />
                ))}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <span className="text-sm truncate">{displayLabel}</span>
                        {candidate.type === 'plugin' && (
                            <span className="text-[9px] px-1 py-0.5 rounded bg-accent/10 text-accent/80 font-medium">
                                Plugin
                            </span>
                        )}
                    </div>
                    {displayDescription && (
                        <div className="text-[11px] text-text-muted truncate">{displayDescription}</div>
                    )}
                </div>
            </div>
        )
    }

    return (
        <InputPopup<MentionItem>
            position={position}
            items={items}
            loading={loading}
            onSelect={handleSelect}
            onClose={onClose}
            header={
                <>
                    <Search className="w-3.5 h-3.5 text-text-muted" />
                    <span>{query ? `${t('searching', language)}: ${query}` : t('selectFileToReference', language)}</span>
                </>
            }
            emptyText={query ? t('noResultsFound', language) : t('noFilesInWorkspace', language)}
            renderItem={renderItem}
        />
    )
}
