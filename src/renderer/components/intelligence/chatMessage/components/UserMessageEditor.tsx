/**
 * 用户消息编辑器
 * 内联编辑用户消息，支持 Enter 保存、Esc 取消
 */
import React from 'react'
import { Check, X } from 'lucide-react'
import { HintOverlay } from '../../../ui/HintOverlay'

interface UserMessageEditorProps {
  editContent: string
  onChange: (value: string) => void
  onSave: () => void
  onCancel: () => void
  fontSize: number
  saveLabel: string
  cancelLabel: string
}

function UserMessageEditorBase({
  editContent,
  onChange,
  onSave,
  onCancel,
  fontSize,
  saveLabel,
  cancelLabel,
}: UserMessageEditorProps) {
  return (
    <div className="w-full relative group/edit">
      <div className="absolute inset-0 -m-1 rounded-[20px] bg-accent/5 opacity-0 group-focus-within/edit:opacity-100 transition-opacity duration-300 pointer-events-none" />
      <div className="relative bg-surface border border-accent/30 rounded-[18px] shadow-lg overflow-hidden animate-scale-in origin-right transition-all duration-200 group-focus-within/edit:border-accent group-focus-within/edit:ring-1 group-focus-within/edit:ring-accent/50">
        <textarea
          value={editContent}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSave()
            }
            if (e.key === 'Escape') {
              onCancel()
            }
          }}
          className="w-full bg-transparent border-none outline-none px-4 py-3 text-text-primary resize-none focus:ring-0 focus:outline-none transition-all custom-scrollbar font-mono text-sm leading-relaxed placeholder:text-text-muted/75"
          rows={Math.max(2, Math.min(15, editContent.split('\n').length))}
          autoFocus
          style={{ fontSize: `${fontSize}px` }}
          placeholder="Type your message..."
        />
        <div className="flex items-center justify-between px-2 py-1.5 bg-black/5 border-t border-black/5">
          <span className="text-[11px] text-text-muted/85 ml-2 font-medium">
            Esc to cancel • Enter to save
          </span>
          <div className="flex gap-1">
            <HintOverlay content={cancelLabel}>
              <button
                onClick={onCancel}
                className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-black/10 transition-colors"
                title={cancelLabel}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </HintOverlay>
            <HintOverlay content={saveLabel}>
              <button
                onClick={onSave}
                className="p-1.5 rounded-lg text-accent hover:text-white hover:bg-accent transition-all shadow-sm"
                title={saveLabel}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
            </HintOverlay>
          </div>
        </div>
      </div>
    </div>
  )
}

export const UserMessageEditor = React.memo(UserMessageEditorBase)
UserMessageEditor.displayName = 'UserMessageEditor'
