/**
 * 删除选择模式工具栏
 * 在消息删除选择模式下显示确认/取消按钮
 */
import { t, type Language } from '@renderer/i18n'

interface DeleteSelectionBarProps {
  selectedCount: number
  onCancel: () => void
  onConfirm: () => void
  language: Language
}

export function DeleteSelectionBar({
  selectedCount,
  onCancel,
  onConfirm,
  language,
}: DeleteSelectionBarProps) {
  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 flex justify-center pb-6 pointer-events-none">
      <div className="pointer-events-auto flex items-center gap-3 px-5 py-3 rounded-2xl bg-surface/95 backdrop-blur-xl border border-border/60 shadow-2xl shadow-black/30">
        <span className="text-sm text-text-secondary">
          {t('ai.selected', language, { size: selectedCount })}
        </span>
        <button
          onClick={onCancel}
          className="px-4 py-1.5 rounded-lg text-sm text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-all border border-border/50"
        >
          {t('ai.cancel', language)}
        </button>
        <button
          onClick={onConfirm}
          disabled={selectedCount === 0}
          className="px-4 py-1.5 rounded-lg text-sm text-white bg-red-500 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {t('ai.delete2', language)}
        </button>
      </div>
    </div>
  )
}
