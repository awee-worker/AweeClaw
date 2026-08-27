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
import { CollapsibleContent } from '../components/CollapsibleContent'
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

  const hasAttachments = images.length > 0 || files.length > 0
  const hasText = textContent.trim().length > 0

  return (
    <div className="w-full flex flex-col items-end gap-1.5">
      <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%] min-w-0 w-fit">
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
          <div className="flex flex-col items-end gap-1.5 w-full">
            {/* ── 附件区域：独立卡片，位于文本气泡上方 ── */}
            {hasAttachments && (
              <div className="flex flex-col items-end gap-1.5 max-w-full">
                {images.length > 0 && <ImageAttachmentsView images={images} />}
                {files.length > 0 && <FileAttachmentsView files={files} />}
              </div>
            )}

            {/* ── 文本气泡（仅有文本时显示；无文本但有附件时不显示空气泡） ── */}
            {hasText && (
              <div className="relative bg-surface text-text-primary/95 px-4 py-2.5 rounded-[18px] rounded-tr-[4px] shadow-sm w-fit max-w-full border border-border/50">
                <ContextItemsView items={(message as any).contextItems || []} />
                {/* 长内容折叠：超过 360px 自动隐藏，点击「展开更多」查看全部 */}
                <CollapsibleContent
                  maxHeight={360}
                  fadeColor="var(--surface)"
                  expandLabel={t('ai.expandmore', language)}
                  collapseLabel={t('ai.collapse', language)}
                >
                  <div className="text-[14px] leading-relaxed">
                    <MarkdownContentView content={textContent} fontSize={fontSize} preserveLineBreaks />
                  </div>
                </CollapsibleContent>
              </div>
            )}

            {/* ── 兜底：既无文本也无附件，但有 contextItems（如 @文件 引用） ── */}
            {!hasText && !hasAttachments && (message as any).contextItems?.length > 0 && (
              <div className="relative bg-surface text-text-primary/95 px-4 py-2.5 rounded-[18px] rounded-tr-[4px] shadow-sm w-fit max-w-full border border-border/50">
                <ContextItemsView items={(message as any).contextItems || []} />
              </div>
            )}
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
