/**
 * 消息操作菜单
 * 提供更多操作（如删除该轮对话）的浮动菜单
 */
import React, { useEffect, useRef, useState } from 'react'
import { MoreHorizontal, Trash2 } from 'lucide-react'
import { HintOverlay } from '../../../ui/HintOverlay'
import { t, type Language } from '@renderer/i18n'

interface MessageActionMenuProps {
  messageId: string
  onDeleteRound?: (messageId: string) => void
  labelKey: 'more' | 'more2'
  language: Language
}

function MessageActionMenuBase({ messageId, onDeleteRound, labelKey, language }: MessageActionMenuProps) {
  const [showMenu, setShowMenu] = useState(false)
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  /** 点击外部关闭菜单 */
  useEffect(() => {
    if (!showMenu) return
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('[data-msg-menu]')) {
        setShowMenu(false)
        setMenuPos(null)
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', handleClickOutside)
    }
  }, [showMenu])

  if (!onDeleteRound) return null

  const handleToggle = () => {
    if (showMenu) {
      setShowMenu(false)
      setMenuPos(null)
    } else {
      if (btnRef.current) {
        const rect = btnRef.current.getBoundingClientRect()
        setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
      }
      setShowMenu(true)
    }
  }

  const handleDelete = () => {
    setShowMenu(false)
    setMenuPos(null)
    onDeleteRound(messageId)
  }

  return (
    <>
      <div data-msg-menu={messageId} className="inline-flex items-center">
        <HintOverlay content={t(`ai.${labelKey}`, language)}>
          <button
            ref={btnRef}
            onClick={handleToggle}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-all"
          >
            <MoreHorizontal className="w-4 h-4" />
          </button>
        </HintOverlay>
      </div>

      {showMenu && menuPos && (
        <div
          style={{ position: 'fixed', top: menuPos.top, right: menuPos.right, zIndex: 9999 }}
          className="w-32 bg-surface border border-border/60 rounded-lg shadow-xl py-1 animate-fade-in"
          data-msg-menu={messageId}
        >
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400/70 hover:bg-red-500/10 hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t('ai.delete', language)}
          </button>
        </div>
      )}
    </>
  )
}

export const MessageActionMenu = React.memo(MessageActionMenuBase)
MessageActionMenu.displayName = 'MessageActionMenu'
