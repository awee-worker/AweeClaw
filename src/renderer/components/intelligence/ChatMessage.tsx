/**
 * 聊天消息组件
 * 负责根据消息类型分发到用户消息视图或助手消息视图
 */
import React from 'react'
import { Check } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import {
  isUserMessage,
  isAssistantMessage,
  getMessageText,
  type ChatMessage as ChatMessageType,
} from '@intelligence/providerTypes'

import { UserMessageView } from './chatMessage/blocks/UserMessageView'
import { AssistantMessageView } from './chatMessage/blocks/AssistantMessageView'
import { MarkdownContentView } from './chatMessage/markdown/MarkdownContentView'

interface ChatMessageProps {
  message: ChatMessageType
  onEdit?: (messageId: string, newContent: string) => void
  onRegenerate?: (messageId: string) => void
  onRestore?: (messageId: string) => void
  onApproveTool?: () => void
  onRejectTool?: () => void
  onOpenDiff?: (path: string, oldContent: string, newContent: string) => void
  onSelectOption?: (messageId: string, selectedIds: string[]) => void
  pendingToolId?: string
  pendingToolIds?: string[]
  hasCheckpoint?: boolean
  isWorkspaceEditor?: boolean
  onDeleteRound?: (messageId: string) => void
  selectionMode?: boolean
  isSelected?: boolean
  onToggleSelect?: (messageId: string) => void
}

function ChatMessageBase({
  message,
  onEdit,
  onRestore,
  onApproveTool,
  onRejectTool,
  onOpenDiff,
  pendingToolId,
  pendingToolIds,
  hasCheckpoint,
  isWorkspaceEditor,
  onDeleteRound,
  selectionMode,
  isSelected,
  onToggleSelect,
}: ChatMessageProps) {
  const { editorConfig } = useStore(useShallow(s => ({
    editorConfig: s.editorConfig,
  })))
  const fontSize = editorConfig.chatFontSize ?? editorConfig.fontSize

  if (!isUserMessage(message) && !isAssistantMessage(message)) {
    return null
  }

  const isUser = isUserMessage(message)
  const textContent = getMessageText((message as any).content)

  /** 选择模式下的渲染 */
  if (selectionMode) {
    return (
      <div className={`
        w-full group/msg transition-colors duration-300
        ${isUser ? 'py-1 bg-transparent' : 'py-2 bg-transparent'}
        ${selectionMode && isSelected ? 'bg-accent/5' : ''}
      `}>
        <div className="w-full px-4 flex items-start gap-3">
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect?.(message.id) }}
            className={`flex-shrink-0 mt-2 w-[18px] h-[18px] rounded flex items-center justify-center transition-all cursor-pointer ${
              isSelected
                ? 'bg-accent border-accent'
                : 'bg-transparent border-2 border-border/60 hover:border-accent/50'
            }`}
          >
            {isSelected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </button>
          <div className={`flex-1 min-w-0 px-3.5 py-2.5 rounded-2xl border ${isUser ? 'bg-accent/8 border-accent/15' : 'bg-surface/80 border-border/40'}`}>
            {isUser ? (
              <div className="text-[14px] leading-relaxed text-text-primary/90">
                <MarkdownContentView content={textContent} fontSize={fontSize} preserveLineBreaks />
              </div>
            ) : (
              <div className="prose-custom w-full max-w-none text-[15px] leading-relaxed text-text-primary/90">
                <AssistantMessageView
                  message={message}
                  pendingToolId={pendingToolId}
                  onApproveTool={onApproveTool}
                  onRejectTool={onRejectTool}
                  onOpenDiff={onOpenDiff}
                  hasCheckpoint={hasCheckpoint}
                  isWorkspaceEditor={isWorkspaceEditor}
                  onDeleteRound={onDeleteRound}
                  textContent={textContent}
                  fontSize={fontSize}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  /** 常规模式渲染 */
  return (
    <div className={`
      w-full group/msg transition-colors duration-300
      ${isUser ? 'py-1 bg-transparent' : 'py-2 bg-transparent'}
    `}>
      <div className="w-full px-4 flex flex-col gap-1">
        {isUser ? (
          <UserMessageView
            message={message}
            textContent={textContent}
            onEdit={onEdit}
            onRestore={onRestore}
            onDeleteRound={onDeleteRound}
            hasCheckpoint={hasCheckpoint}
            isWorkspaceEditor={isWorkspaceEditor}
            fontSize={fontSize}
          />
        ) : (
          <AssistantMessageView
            message={message}
            pendingToolId={pendingToolId}
            pendingToolIds={pendingToolIds}
            onApproveTool={onApproveTool}
            onRejectTool={onRejectTool}
            onOpenDiff={onOpenDiff}
            hasCheckpoint={hasCheckpoint}
            isWorkspaceEditor={isWorkspaceEditor}
            onDeleteRound={onDeleteRound}
            textContent={textContent}
            fontSize={fontSize}
          />
        )}
      </div>
    </div>
  )
}

const ChatMessage = React.memo(ChatMessageBase)
ChatMessage.displayName = 'ChatMessage'

export default ChatMessage

/* ------------------------------------------------------------------ */
/* 场景感知聊天消息组件                                              */
/* ------------------------------------------------------------------ */

import type { ScenarioDomain } from '@configuration/defaultProfile'

/** 场景消息渲染策略 */
export interface ScenarioMessageRenderPolicy {
  /** 场景类型 */
  domain: ScenarioDomain
  /** 是否显示场景标签 */
  showScenarioTag: boolean
  /** 场景标签样式 */
  tagStyle: 'badge' | 'prefix' | 'icon'
  /** 是否启用审计信息 */
  enableAuditInfo: boolean
  /** 是否显示合规提示 */
  showComplianceNotice: boolean
  /** 消息最大高度（像素，0 表示不限制） */
  maxMessageHeight: number
  /** 是否启用敏感内容遮罩 */
  maskSensitiveContent: boolean
  /** 是否允许编辑消息 */
  allowEdit: boolean
  /** 是否允许删除轮次 */
  allowDeleteRound: boolean
}

/** 场景消息渲染策略预设 */
const SCENARIO_MESSAGE_RENDER_POLICIES: Record<ScenarioDomain, ScenarioMessageRenderPolicy> = {
  /** 法律场景：显示标签 + 审计 + 合规提示 + 禁止编辑 */
  legal: {
    domain: 'legal',
    showScenarioTag: true,
    tagStyle: 'badge',
    enableAuditInfo: true,
    showComplianceNotice: true,
    maxMessageHeight: 0,
    maskSensitiveContent: true,
    allowEdit: false,
    allowDeleteRound: false,
  },

  /** 医疗场景：显示标签 + 审计 + 合规提示 + 遮罩敏感内容 */
  medical: {
    domain: 'medical',
    showScenarioTag: true,
    tagStyle: 'badge',
    enableAuditInfo: true,
    showComplianceNotice: true,
    maxMessageHeight: 600,
    maskSensitiveContent: true,
    allowEdit: false,
    allowDeleteRound: false,
  },

  /** 教育场景：显示标签 + 允许编辑 */
  education: {
    domain: 'education',
    showScenarioTag: true,
    tagStyle: 'icon',
    enableAuditInfo: false,
    showComplianceNotice: false,
    maxMessageHeight: 0,
    maskSensitiveContent: false,
    allowEdit: true,
    allowDeleteRound: true,
  },

  /** 通用场景：默认配置 */
  general: {
    domain: 'general',
    showScenarioTag: false,
    tagStyle: 'badge',
    enableAuditInfo: false,
    showComplianceNotice: false,
    maxMessageHeight: 0,
    maskSensitiveContent: false,
    allowEdit: true,
    allowDeleteRound: true,
  },
}

/**
 * 获取场景消息渲染策略
 */
export function getScenarioMessageRenderPolicy(
  domain: ScenarioDomain,
): ScenarioMessageRenderPolicy {
  return SCENARIO_MESSAGE_RENDER_POLICIES[domain]
}

/**
 * 场景感知聊天消息组件
 *
 * 根据场景类型调整消息渲染策略：
 * - 法律场景：显示场景标签、审计信息、合规提示，禁止编辑
 * - 医疗场景：显示场景标签、审计信息、合规提示，遮罩敏感内容
 * - 教育场景：显示场景标签，允许编辑和删除
 * - 通用场景：默认配置
 */
export function ScenarioChatMessage(props: ChatMessageProps & {
  domain?: ScenarioDomain
}) {
  const { domain = 'general', ...messageProps } = props
  const policy = SCENARIO_MESSAGE_RENDER_POLICIES[domain]

  // 根据场景策略调整 props
  const adjustedProps: ChatMessageProps = {
    ...messageProps,
    // 法律/医疗场景：禁用编辑
    onEdit: policy.allowEdit ? messageProps.onEdit : undefined,
    // 法律/医疗场景：禁用删除轮次
    onDeleteRound: policy.allowDeleteRound ? messageProps.onDeleteRound : undefined,
  }

  return (
    <div
      data-scenario={domain}
      data-audit={policy.enableAuditInfo ? 'true' : 'false'}
      style={policy.maxMessageHeight > 0 ? { maxHeight: policy.maxMessageHeight, overflowY: 'auto' } : undefined}
    >
      {policy.showComplianceNotice && (
        <div className="scenario-compliance-notice text-xs text-amber-600 dark:text-amber-400 mb-2 px-3 py-1 bg-amber-50 dark:bg-amber-900/20 rounded">
          {domain === 'legal'
            ? '⚠ Legal advisory context: Responses are for reference only and do not constitute legal advice.'
            : '⚠ Medical decision support: Responses must not replace professional medical judgment.'}
        </div>
      )}
      <ChatMessage {...adjustedProps} />
    </div>
  )
}
