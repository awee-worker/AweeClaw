/**
 * 用户消息视图
 * 右对齐气泡布局，支持编辑、附件展示、操作按钮
 */
import React, { useState, useCallback } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import type { ChatMessage as ChatMessageType } from '@intelligence/providerTypes'
import { getMessageImages, getMessageFiles } from '@intelligence/providerTypes'
import { t, type Language } from '@renderer/i18n'

import { MarkdownContentView } from '../markdown/MarkdownContentView'
import { UserMessageEditor } from '../components/UserMessageEditor'
import { ContextItemsView } from '../components/ContextItemsView'
import { ImageAttachmentsView } from '../components/ImageAttachmentsView'
import { FileAttachmentsView } from '../components/FileAttachmentsView'
import { MessageActionsBar } from '../components/MessageActionsBar'

interface UserMessageViewProps {
  message: ChatMessageType
  textContent: string
  onEdit?: (messageId: string, newContent: string) => void
  onRestore?: (messageId: string) => void
  onDeleteRound?: (messageId: string) => void
  hasCheckpoint?: boolean
  isWorkspaceEditor?: boolean
  fontSize: number
}

function UserMessageViewBase({
  message,
  textContent,
  onEdit,
  onRestore,
  onDeleteRound,
  hasCheckpoint,
  isWorkspaceEditor,
  fontSize,
}: UserMessageViewProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [copied, setCopied] = useState(false)
  const { language } = useStore(useShallow(s => ({ language: s.language })))

  const userMessage = message as any
  const images = getMessageImages(userMessage.content) as any[]
  const files = getMessageFiles(userMessage.content) as any[]

  const handleStartEdit = useCallback(() => {
    setEditContent(textContent)
    setIsEditing(true)
  }, [textContent])

  const handleSaveEdit = useCallback(() => {
    if (onEdit && editContent.trim()) {
      onEdit(message.id, editContent.trim())
    }
    setIsEditing(false)
  }, [onEdit, editContent, message.id])

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(textContent)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [textContent])

  const saveLabel = t('ai.saveresend', language as Language)
  const cancelLabel = t('ai.cancel', language as Language)

  return (
    <div className="w-full flex flex-col items-end gap-1.5">
      <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%] min-w-0 w-full">
        {isEditing ? (
          <UserMessageEditor
            editContent={editContent}
            onChange={setEditContent}
            onSave={handleSaveEdit}
            onCancel={() => setIsEditing(false)}
            fontSize={fontSize}
            saveLabel={saveLabel}
            cancelLabel={cancelLabel}
          />
        ) : (
          <div className="relative bg-surface text-text-primary/95 px-4 py-3 rounded-[20px] rounded-tr-[4px] shadow-sm w-fit max-w-full border border-border/50">
            <ContextItemsView items={(message as any).contextItems || []} />
            <ImageAttachmentsView images={images} />
            <FileAttachmentsView files={files} />

            <div className="text-[14px] leading-relaxed">
              <MarkdownContentView content={textContent} fontSize={fontSize} preserveLineBreaks />
            </div>
          </div>
        )}

        {!isEditing && (
          <MessageActionsBar
            messageId={message.id}
            copied={copied}
            onCopy={handleCopy}
            onEdit={onEdit ? handleStartEdit : undefined}
            onRestore={onRestore ? () => onRestore(message.id) : undefined}
            onDeleteRound={onDeleteRound ? () => onDeleteRound(message.id) : undefined}
            textContent={textContent}
            isWorkspaceEditor={!!isWorkspaceEditor}
            hasCheckpoint={!!hasCheckpoint}
            language={language as Language}
            menuLabelKey="more"
          />
        )}
      </div>
    </div>
  )
}

export const UserMessageView = React.memo(UserMessageViewBase)
UserMessageView.displayName = 'UserMessageView'
