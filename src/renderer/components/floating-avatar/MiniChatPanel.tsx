/**
 * MiniChatPanel - 悬浮头像迷你聊天面板（类豆包）
 *
 * 与普通聊天窗口功能完全一致（工具调用、命令执行等），只是窗口更小。
 *
 * 特性：
 * - 纯文本输入 + 流式 LLM 输出（带工具调用循环）
 * - 支持图片/文件附件上传（多模态消息）
 * - 支持模型切换（通过 IPC 从主窗口获取模型列表）
 * - 工具调用状态实时展示（正在执行/已完成/失败）
 * - 发送/语音按钮合并：有内容→发送，无内容→语音，流式中→停止
 * - 主题色跟随系统（CSS 变量 var(--accent) 等）
 *
 * 响应式布局（窗口可拖动调整宽度 340~560）：
 * - 宽度 < 380px：收起模型选择器（仅显示当前模型名）
 * - 宽度 ≥ 380px：显示完整工具栏（附件 + 模型选择器）
 * - 宽度 ≥ 460px：显示模型 provider 名称
 *
 * 布局（展开窗口 340×480）：
 * ┌──────────────────────────────┐
 * │ [头像] 迷你助手          [×]  │  顶栏（44px）
 * ├──────────────────────────────┤
 * │ [附件预览区]                  │  可选（有附件时显示）
 * ├──────────────────────────────┤
 * │ 消息列表（气泡，可滚动）       │  弹性高度
 * │  user 气泡（右） / ai 气泡（左）│
 * │  [工具调用状态]               │
 * ├──────────────────────────────┤
 * │ [活动状态栏]                  │  可选（AI 执行工具时显示）
 * ├──────────────────────────────┤
 * │ [📎] [模型选择] [输入框] [➤/🎤]│  工具栏 + 输入栏
 * └──────────────────────────────┘
 */

import { memo, useEffect, useRef, useState, useCallback } from 'react'
import {
  Send,
  Mic,
  X,
  Loader2,
  AlertCircle,
  Paperclip,
  ChevronDown,
  Check,
  Cloud,
  FileText,
  FileCode,
  File,
  Square,
  Wrench,
  Maximize2,
  Puzzle,
  AlertTriangle,
  Terminal,
  Globe,
  MousePointer,
  Folder,
  Brain,
  ChevronRight,
} from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import {
  readFileAsAttachment,
  type MiniChatMessage,
  type MiniChatToolCall,
  type MiniChatActivity,
  type ChatAttachment,
} from '../../composables/useAvatarMiniChat'
import type { PendingApprovalToolCall } from '@intelligence/voice/miniChatApprovalService'
import { MiniMarkdown } from './MiniMarkdown'
import { MiniAuthorizationSelector } from './MiniAuthorizationSelector'
import { getToolDisplayName } from '@configuration/toolDefinitions'
import type { AvatarModelOption } from '../../types/electronBridge'

// ============================================
// 类型定义
// ============================================

export interface MiniChatPanelProps {
  /** 消息列表 */
  messages: MiniChatMessage[]
  /** 是否正在生成回复 */
  streaming: boolean
  /** 当前活动状态（AI 正在执行的工具） */
  activity: MiniChatActivity | null
  /** 待审批的工具调用列表（与普通聊天窗口的 pendingApprovalToolCalls 一致） */
  pendingApproval: PendingApprovalToolCall[]
  /** 语言 */
  language: 'zh' | 'en'
  /** 错误信息 */
  errorMessage: string | null
  /** 发送一条消息（可携带附件） */
  onSend: (text: string, attachments?: ChatAttachment[]) => void
  /** 中止当前生成 */
  onAbort: () => void
  /** 清空消息 */
  onClear: () => void
  /** 关闭面板（收起窗口） */
  onClose: () => void
  /** 切换到语音对话模式 */
  onSwitchToVoice: () => void
  /** 最大化：打开主聊天窗口 */
  onOpenMain: () => void
  /** 批准所有待审批工具 */
  onApproveAll: () => void
  /** 拒绝所有待审批工具 */
  onRejectAll: () => void
  /** 当前 LLM 配置 */
  currentProvider?: string
  currentModel?: string
  cloudMode?: 'cloud' | 'local'
  /** 工具执行授权方式（来自 voiceContext，同步主窗口 authorizationMode） */
  authorizationMode?: 'every-step' | 'dangerous-only' | 'never'
  /** 外部注入的待添加附件（如截图提问结果），组件合并到输入框附件区后调用 onPendingAttachmentConsumed */
  pendingAttachment?: ChatAttachment | null
  /** 外部附件已被合并消费，调用方应清空 pendingAttachment */
  onPendingAttachmentConsumed?: () => void
}

// ============================================
// 常量
// ============================================

const TOOLBAR_COLLAPSE_THRESHOLD = 380

// ============================================
// 主组件
// ============================================

function MiniChatPanelImpl({
  messages,
  streaming,
  activity,
  pendingApproval,
  language,
  errorMessage,
  onSend,
  onAbort,
  onClear,
  onClose,
  onSwitchToVoice,
  onOpenMain,
  onApproveAll,
  onRejectAll,
  currentProvider,
  currentModel,
  cloudMode,
  authorizationMode,
  pendingAttachment,
  onPendingAttachmentConsumed,
}: MiniChatPanelProps) {
  const isZh = language === 'zh'
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])

  // 响应式：监听窗口宽度
  const containerRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(340)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const showFullToolbar = containerWidth >= TOOLBAR_COLLAPSE_THRESHOLD
  const showProviderName = containerWidth >= 460

  // 自动滚动控制
  const scrollRef = useRef<HTMLDivElement>(null)
  const userScrolledUpRef = useRef(false)

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => {
    if (!userScrolledUpRef.current) {
      scrollToBottom()
    }
  }, [messages, activity, pendingApproval, scrollToBottom])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    userScrolledUpRef.current = !atBottom
  }, [])

  // --------------------------------------------
  // 附件处理
  // --------------------------------------------
  const fileInputRef = useRef<HTMLInputElement>(null)
  // 输入框 ref：外部注入附件后自动聚焦，引导用户输入问题
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return
    const files = Array.from(e.target.files)
    e.target.value = ''

    for (const file of files) {
      try {
        const att = await readFileAsAttachment(file)
        setAttachments((prev) => [...prev, att])
      } catch (err) {
        console.error('[MiniChatPanel] Read file failed:', err)
      }
    }
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => {
      const target = prev.find((a) => a.id === id)
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
      return prev.filter((a) => a.id !== id)
    })
  }, [])

  // --------------------------------------------
  // 外部注入附件（如截图提问结果）：合并到输入框附件区，不自动发送
  // 用户自行输入问题后点发送，实现「截图 → 添加附件 → 输入问题 → 发送」流程
  // --------------------------------------------
  useEffect(() => {
    if (!pendingAttachment) return
    setAttachments((prev) => [...prev, pendingAttachment])
    onPendingAttachmentConsumed?.()
    // 聚焦输入框，引导用户输入提问内容
    requestAnimationFrame(() => textareaRef.current?.focus())
  }, [pendingAttachment, onPendingAttachmentConsumed])

  // --------------------------------------------
  // 发送消息
  // --------------------------------------------
  const isSendable = input.trim().length > 0 || attachments.length > 0

  const handleSend = useCallback(() => {
    if (!isSendable || streaming) return
    const text = input.trim()
    const atts = attachments.length > 0 ? attachments : undefined
    onSend(text, atts)
    setInput('')
    attachments.forEach((a) => {
      if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
    })
    setAttachments([])
    userScrolledUpRef.current = false
    requestAnimationFrame(() => scrollToBottom())
  }, [input, attachments, streaming, onSend, scrollToBottom])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend],
  )

  // --------------------------------------------
  // 渲染
  // --------------------------------------------

  return (
    <div ref={containerRef} style={panelStyle}>
      <style>{`
        @keyframes mini-chat-blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        @keyframes mini-chat-dot-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>

      {/* ============ 顶栏 ============ */}
      <div style={headerStyle}>
        {/* 最大化按钮：打开主聊天窗口并关闭迷你助手 */}
        <button
          onClick={onOpenMain}
          style={headerMaximizeBtnStyle}
          title={isZh ? '打开主窗口' : 'Open main window'}
        >
          <Maximize2 size={15} color="rgb(var(--text-secondary) / 0.9)" />
        </button>

        <div style={{ flex: 1 }} />

        {messages.length > 0 && !streaming && (
          <button onClick={onClear} style={headerBtnStyle} title={isZh ? '清空对话' : 'Clear'}>
            <span style={{ fontSize: '12px' }}>{isZh ? '清空' : 'Clear'}</span>
          </button>
        )}

        <button onClick={onClose} style={headerCloseBtnStyle} title={isZh ? '关闭' : 'Close'}>
          <X size={14} color="rgb(var(--text-secondary) / 0.8)" />
        </button>
      </div>

      {/* ============ 消息列表 ============ */}
      <div ref={scrollRef} style={messageListStyle} onScroll={handleScroll}>
        {messages.length === 0 && !errorMessage && pendingApproval.length === 0 && (
          <div style={emptyStyle}>
            <p style={{ fontSize: '13px', color: 'rgb(var(--text-muted) / 0.6)', margin: 0 }}>
              {isZh ? '有什么可以帮你的？' : 'How can I help you?'}
            </p>
          </div>
        )}

        {errorMessage && (
          <div style={errorBannerStyle}>
            <AlertCircle size={13} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} isZh={isZh} />
        ))}

        {/* 工具审批卡片（与普通聊天窗口的 BatchApprovalPanel 一致） */}
        {pendingApproval.length > 0 && (
          <MiniApprovalCard
            pendingTools={pendingApproval}
            isZh={isZh}
            onApproveAll={onApproveAll}
            onRejectAll={onRejectAll}
          />
        )}
      </div>

      {/* ============ 活动状态栏 ============ */}
      {activity && streaming && (
        <div style={activityBarStyle}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'rgb(var(--accent))',
            animation: 'mini-chat-dot-pulse 1.5s ease-in-out infinite',
            flexShrink: 0,
          }} />
          <span style={activityTextStyle}>
            {activity.text}
            {activity.toolName ? ` · ${activity.toolName}` : ''}
          </span>
        </div>
      )}

      {/* ============ 工具栏 + 输入栏 ============ */}
      <div style={inputBarStyle}>
        {/* 附件预览区：紧贴输入栏上方（上传附件按钮上方），让用户直观看到已添加的截图等附件 */}
        {attachments.length > 0 && (
          <div style={attachmentPreviewStyle}>
            {attachments.map((att) => (
              <div key={att.id} style={attachmentItemStyle}>
                {att.isImage && att.previewUrl ? (
                  <img src={att.previewUrl} alt={att.name} style={{ width: 40, height: 40, objectFit: 'cover', borderRadius: 6 }} />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    {getAttachmentIcon(att.name, att.mediaType)}
                    <span style={{ fontSize: '12px', color: 'rgb(var(--text-secondary) / 0.8)', maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {att.name}
                    </span>
                  </div>
                )}
                <button onClick={() => removeAttachment(att.id)} style={attachmentRemoveBtnStyle} title={isZh ? '移除' : 'Remove'}>
                  <X size={10} color="#fff" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 工具栏：附件按钮 + 模型选择器 + 授权选择器 */}
        <div style={toolbarStyle}>
          <input type="file" ref={fileInputRef} multiple onChange={handleFileSelect} style={{ display: 'none' }} />
          {/* 附件按钮（正方形） */}
          <button
            onClick={() => !streaming && fileInputRef.current?.click()}
            disabled={streaming}
            style={{
              ...attachBtnStyle,
              opacity: streaming ? 0.4 : 1,
              cursor: streaming ? 'not-allowed' : 'pointer',
            }}
            title={isZh ? '上传附件' : 'Upload attachment'}
          >
            <Paperclip size={14} color="rgb(var(--text-secondary) / 0.8)" />
          </button>

          <ModelSelectorButton
            currentProvider={currentProvider}
            currentModel={currentModel}
            cloudMode={cloudMode}
            showFull={showFullToolbar}
            showProviderName={showProviderName}
            disabled={streaming}
            language={language}
          />

          {/* 授权方式选择器（与普通会话一致，控制工具执行审批门禁） */}
          <MiniAuthorizationSelector
            currentMode={authorizationMode}
            language={language}
            disabled={streaming}
          />
        </div>

        {/* 输入行 */}
        <div style={inputRowStyle}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isZh ? '输入消息...' : 'Type a message...'}
            rows={1}
            style={textareaStyle}
            disabled={streaming}
          />

          {/* 合并按钮：发送 / 停止 / 语音 */}
          {streaming ? (
            <button onClick={onAbort} style={stopBtnStyle} title={isZh ? '停止生成' : 'Stop'}>
              <Square size={13} color="#fff" fill="currentColor" />
            </button>
          ) : isSendable ? (
            <button onClick={handleSend} style={sendBtnStyle} title={isZh ? '发送' : 'Send'}>
              <Send size={14} color="#fff" />
            </button>
          ) : (
            <button onClick={onSwitchToVoice} style={micBtnStyle} title={isZh ? '语音对话' : 'Voice chat'}>
              <Mic size={14} color="rgb(var(--text-secondary) / 0.9)" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// 消息气泡子组件（含工具调用状态）
// ============================================

function MessageBubble({ message, isZh }: { message: MiniChatMessage; isZh: boolean }) {
  const isUser = message.role === 'user'
  const hasError = !!message.error
  const hasToolCalls = message.toolCalls && message.toolCalls.length > 0
  const hasReasoning = !isUser && !!message.reasoning && message.reasoning.trim().length > 0

  return (
    <div style={{
      display: 'flex', flexDirection: 'column',
      alignItems: isUser ? 'flex-end' : 'flex-start',
      marginBottom: 8,
    }}>
      {/* 附件预览（仅 user 消息） */}
      {message.attachments && message.attachments.length > 0 && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap', maxWidth: '80%' }}>
          {message.attachments.map((att) => (
            <div key={att.id} style={{ borderRadius: 6, overflow: 'hidden', border: '1px solid rgb(var(--border) / 0.4)' }}>
              {att.isImage && att.previewUrl ? (
                <img src={att.previewUrl} alt={att.name} style={{ width: 60, height: 60, objectFit: 'cover' }} />
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', background: 'rgb(var(--surface) / 0.4)' }}>
                  {getAttachmentIcon(att.name, att.mediaType)}
                  <span style={{ fontSize: '12px', color: 'rgb(var(--text-secondary) / 0.8)', maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {att.name}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 推理内容（思考模型的思考过程，与普通聊天窗口一致） */}
      {hasReasoning && (
        <ReasoningSection reasoning={message.reasoning!} isStreaming={message.streaming} isZh={isZh} />
      )}

      {/* 文本气泡 */}
      {(message.content || !hasToolCalls) && (
        <div style={{
          ...bubbleBaseStyle,
          ...(isUser ? userBubbleStyle : aiBubbleStyle),
          ...(hasError ? errorBubbleStyle : {}),
        }}>
          {hasError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
              <AlertCircle size={12} color="rgb(var(--status-error))" />
              <span style={{ fontSize: '12px', color: 'rgb(var(--status-error))' }}>
                {isZh ? '生成失败' : 'Error'}
              </span>
            </div>
          )}
          {isUser ? (
            /* 用户消息：纯文本渲染 */
            <span style={bubbleTextStyle}>
              {message.content || ''}
            </span>
          ) : (
            /* AI 消息：Markdown 渲染（支持代码块、列表、标题等，与主窗口体验一致） */
            <>
              {message.content ? (
                <MiniMarkdown content={message.content} isStreaming={message.streaming} />
              ) : message.streaming ? (
                <span style={{ ...bubbleTextStyle, color: 'rgb(var(--text-muted) / 0.5)' }}>...</span>
              ) : null}
              {message.streaming && message.content && (
                <span style={cursorBlinkStyle}>▋</span>
              )}
            </>
          )}
        </div>
      )}

      {/* 工具调用状态 */}
      {hasToolCalls && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2, maxWidth: '80%' }}>
          {message.toolCalls!.map((tc) => (
            <ToolCallStatus key={tc.id} toolCall={tc} isZh={isZh} />
          ))}
        </div>
      )}
    </div>
  )
}

// ============================================
// 推理内容子组件（思考模型的思考过程）
// ============================================

function ReasoningSection({
  reasoning,
  isStreaming,
  isZh,
}: {
  reasoning: string
  isStreaming?: boolean
  isZh: boolean
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div style={reasoningContainerStyle}>
      <button
        onClick={() => setExpanded((p) => !p)}
        style={reasoningHeaderStyle}
      >
        <Brain size={12} color="rgb(var(--text-muted) / 0.7)" style={{ flexShrink: 0 }} />
        <span style={reasoningTitleStyle}>
          {isZh ? '思考过程' : 'Reasoning'}
        </span>
        {isStreaming && (
          <Loader2 size={11} className="animate-spin" style={{ flexShrink: 0, color: 'rgb(var(--text-muted) / 0.5)' }} />
        )}
        <ChevronRight
          size={12}
          color="rgb(var(--text-muted) / 0.5)"
          style={{ flexShrink: 0, transition: 'transform 0.2s', transform: expanded ? 'rotate(90deg)' : 'none' }}
        />
      </button>
      {expanded && (
        <div style={reasoningContentStyle}>
          {reasoning}
        </div>
      )}
    </div>
  )
}

// ============================================
// 工具审批卡片子组件（与普通聊天窗口的 BatchApprovalPanel 一致）
// ============================================

/** 根据工具名获取操作图标 */
function getApprovalToolIcon(toolName: string) {
  if (toolName.startsWith('desktop_')) return MousePointer
  if (toolName === 'run_command') return Terminal
  if (['web_search', 'read_url'].includes(toolName)) return Globe
  if (['delete_file_or_folder', 'create_file_or_folder'].includes(toolName)) return Folder
  return FileText
}

/** 提取工具操作摘要（用于审批卡片展示） */
function getApprovalToolSummary(tc: PendingApprovalToolCall): string {
  const displayName = getToolDisplayName(tc.name)
  const args = tc.arguments || {}
  const path = (args.path as string) || (args.filePath as string) || (args.directory as string)

  if (path) {
    const fileName = path.split('/').pop() || path
    return `${displayName} ${fileName}`
  }

  if (tc.name === 'run_command' && typeof args.command === 'string') {
    const cmd = args.command.length > 50 ? args.command.slice(0, 50) + '...' : args.command
    return `${displayName} ${cmd}`
  }

  return displayName
}

function MiniApprovalCard({
  pendingTools,
  isZh,
  onApproveAll,
  onRejectAll,
}: {
  pendingTools: PendingApprovalToolCall[]
  isZh: boolean
  onApproveAll: () => void
  onRejectAll: () => void
}) {
  if (pendingTools.length === 0) return null

  return (
    <div style={approvalCardStyle}>
      <style>{`
        @keyframes mini-approval-breath {
          0%, 100% { opacity: 1; box-shadow: 0 0 8px rgba(245, 158, 11, 0.2); }
          50% { opacity: 0.85; box-shadow: 0 0 16px rgba(245, 158, 11, 0.4); }
        }
      `}</style>

      {/* 头部：警告图标 + 标题（呼吸动画 2 秒周期，符合告警样式规范） */}
      <div style={approvalHeaderStyle}>
        <div
          style={{
            width: 24, height: 24, borderRadius: '50%',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'rgba(245, 158, 11, 0.15)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            flexShrink: 0,
            animation: 'mini-approval-breath 2s ease-in-out infinite',
          }}
        >
          <AlertTriangle size={13} color="rgb(245, 158, 11)" />
        </div>
        <span style={approvalTitleStyle}>
          {isZh ? '待批准操作' : 'Pending Approval'}
        </span>
        <span style={approvalCountStyle}>
          {pendingTools.length}
        </span>
        <span style={approvalHintStyle}>
          {isZh ? '请确认后执行' : 'Confirm to proceed'}
        </span>
      </div>

      {/* 操作列表 */}
      <div style={approvalListStyle}>
        {pendingTools.map((tc) => {
          const Icon = getApprovalToolIcon(tc.name)
          const summary = getApprovalToolSummary(tc)
          return (
            <div key={tc.id} style={approvalItemStyle}>
              <Icon size={13} color="rgb(var(--text-muted) / 0.7)" style={{ flexShrink: 0 }} />
              <span style={approvalItemTextStyle}>
                {summary}
              </span>
              <span style={approvalItemNameStyle}>
                {tc.name}
              </span>
            </div>
          )
        })}
      </div>

      {/* 底部：批准/拒绝按钮 */}
      <div style={approvalFooterStyle}>
        <button onClick={onRejectAll} style={approvalRejectBtnStyle}>
          <X size={13} color="rgb(var(--status-error))" />
          <span>{isZh ? '全部拒绝' : 'Reject All'}</span>
        </button>
        <button onClick={onApproveAll} style={approvalApproveBtnStyle}>
          <Check size={13} color="#fff" />
          <span>{isZh ? '全部批准' : 'Approve All'}</span>
        </button>
      </div>
    </div>
  )
}

// ============================================
// 工具调用状态子组件
// ============================================

function ToolCallStatus({ toolCall }: { toolCall: MiniChatToolCall; isZh: boolean }) {
  const isRunning = toolCall.status === 'running'
  const isCompleted = toolCall.status === 'completed'
  const isFailed = toolCall.status === 'failed'

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 5,
      padding: '4px 8px',
      borderRadius: 8,
      background: 'rgb(var(--surface) / 0.3)',
      border: '1px solid rgb(var(--border) / 0.3)',
      fontSize: '12px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
    }}>
      <Wrench size={11} style={{ flexShrink: 0, color: 'rgb(var(--text-muted) / 0.7)' }} />

      {isRunning && <Loader2 size={11} className="animate-spin" style={{ flexShrink: 0, color: 'rgb(var(--accent))' }} />}
      {isCompleted && <Check size={11} style={{ flexShrink: 0, color: 'rgb(var(--status-success))' }} />}
      {isFailed && <X size={11} style={{ flexShrink: 0, color: 'rgb(var(--status-error))' }} />}

      <span style={{
        color: isRunning ? 'rgb(var(--text-secondary))' : isFailed ? 'rgb(var(--status-error))' : 'rgb(var(--text-secondary) / 0.8)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        flex: 1,
      }}>
        {toolCall.name}
      </span>

      {toolCall.result && !isRunning && (
        <span style={{
          fontSize: '12px',
          color: 'rgb(var(--text-muted) / 0.6)',
          maxWidth: 100,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {toolCall.result}
        </span>
      )}
    </div>
  )
}

// ============================================
// 模型选择器子组件
// ============================================

function ModelSelectorButton({
  currentProvider, currentModel, cloudMode,
  showFull, showProviderName, disabled, language,
}: {
  currentProvider?: string
  currentModel?: string
  cloudMode?: 'cloud' | 'local'
  showFull: boolean
  showProviderName: boolean
  disabled: boolean
  language: 'zh' | 'en'
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [models, setModels] = useState<AvatarModelOption[]>([])
  const [loading, setLoading] = useState(false)
  // Tab 状态：跟随当前 cloudMode，弹窗内可独立切换（与普通会话体验一致）
  const [activeTab, setActiveTab] = useState<'local' | 'cloud'>(
    cloudMode === 'cloud' ? 'cloud' : 'local',
  )
  const dropdownRef = useRef<HTMLDivElement>(null)
  const isZh = language === 'zh'

  const loadModels = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.floatingAvatar.getAvailableModels()
      console.log('[MiniChatPanel] getAvailableModels result:', {
        success: res.success,
        modelCount: res.data?.length || 0,
        error: res.error,
        cloudCount: res.data?.filter((m) => m.isCloud).length || 0,
        localCount: res.data?.filter((m) => !m.isCloud).length || 0,
      })
      if (res.success && res.data) setModels(res.data)
    } catch (err) {
      console.error('[MiniChatPanel] Load models failed:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  // 仅在弹窗打开时加载一次模型列表（移除 loading 依赖，避免无限循环：
  // loading true→false 会触发 effect 重跑，导致请求完成后立即重新发起）
  useEffect(() => {
    if (isOpen) void loadModels()
  }, [isOpen, loadModels])

  // 打开弹窗时同步 Tab 状态到当前 cloudMode
  useEffect(() => {
    if (isOpen) {
      setActiveTab(cloudMode === 'cloud' ? 'cloud' : 'local')
    }
  }, [isOpen, cloudMode])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  const handleSelectModel = useCallback(async (model: AvatarModelOption) => {
    try {
      await api.floatingAvatar.selectModel({ provider: model.provider, model: model.id, isCloud: model.isCloud })
      setIsOpen(false)
    } catch (err) {
      console.error('[MiniChatPanel] Select model failed:', err)
    }
  }, [])

  // 按 Tab 过滤模型
  const filteredModels = models.filter((m) =>
    activeTab === 'cloud' ? m.isCloud : !m.isCloud,
  )

  const displayName = currentModel ? (currentModel.split('/').pop() || currentModel) : (isZh ? '选择模型' : 'Select model')

  return (
    <div ref={dropdownRef} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
      <button
        onClick={() => !disabled && setIsOpen((p) => !p)}
        disabled={disabled}
        style={{
          ...toolbarBtnStyle, opacity: disabled ? 0.4 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
          flex: 1, justifyContent: 'flex-start', gap: 4, padding: '0 6px',
        }}
        title={displayName}
      >
        {cloudMode === 'cloud' && <Cloud size={12} color="rgb(var(--accent) / 0.8)" />}
        <span style={{
          fontSize: '12px', color: 'rgb(var(--text-secondary) / 0.85)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          maxWidth: showFull ? (showProviderName ? 140 : 100) : 70,
        }}>
          {displayName}
        </span>
        <ChevronDown size={11} color="rgb(var(--text-muted) / 0.5)" style={{ flexShrink: 0, transition: 'transform 0.2s', transform: isOpen ? 'rotate(180deg)' : 'none' }} />
      </button>

      {isOpen && (
        <div style={modelDropdownStyle}>
          {/* Tab 切换栏：自定义 / 云端（与普通会话一致） */}
          <div style={modelTabBarStyle}>
            <button
              onClick={() => setActiveTab('local')}
              style={{
                ...modelTabStyle,
                ...(activeTab === 'local' ? modelTabActiveStyle : {}),
              }}
            >
              <Puzzle size={11} style={{ flexShrink: 0 }} />
              <span>{isZh ? '自定义' : 'Custom'}</span>
            </button>
            <button
              onClick={() => setActiveTab('cloud')}
              style={{
                ...modelTabStyle,
                ...(activeTab === 'cloud' ? modelTabActiveStyle : {}),
              }}
            >
              <Cloud size={11} style={{ flexShrink: 0 }} />
              <span>{isZh ? '云端' : 'Cloud'}</span>
            </button>
          </div>

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
              <Loader2 size={14} className="animate-spin" color="rgb(var(--text-muted) / 0.6)" />
            </div>
          )}
          {!loading && filteredModels.length === 0 && (
            <div style={{ padding: 16, textAlign: 'center', fontSize: '12px', color: 'rgb(var(--text-muted) / 0.6)' }}>
              {activeTab === 'cloud' ? (isZh ? '暂无云端模型' : 'No cloud models') : (isZh ? '暂无自定义模型' : 'No custom models')}
            </div>
          )}
          {!loading && filteredModels.map((model) => {
            const isSelected = model.provider === currentProvider && model.id === currentModel
            return (
              <button key={`${model.provider}-${model.id}`} onClick={() => void handleSelectModel(model)} style={{ ...modelItemStyle, ...(isSelected ? modelItemSelectedStyle : {}) }}>
                <span style={{
                  fontSize: '12px',
                  color: isSelected ? 'rgb(var(--accent))' : 'rgb(var(--text-primary) / 0.9)',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
                }}>
                  {model.name}
                </span>
                {model.isCloud && <Cloud size={10} color="rgb(var(--accent) / 0.6)" style={{ flexShrink: 0 }} />}
                {isSelected && <Check size={12} color="rgb(var(--accent))" style={{ flexShrink: 0 }} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ============================================
// 辅助函数
// ============================================

function getAttachmentIcon(fileName: string, mimeType: string) {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  if (mimeType.startsWith('image/')) return <FileText size={14} color="rgb(var(--status-success))" />
  const codeExts = ['js', 'ts', 'tsx', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'rb', 'php', 'swift', 'kt', 'vue', 'svelte']
  if (codeExts.includes(ext)) return <FileCode size={14} color="rgb(var(--status-info))" />
  return <File size={14} color="rgb(var(--text-muted) / 0.6)" />
}

// ============================================
// 样式（使用 CSS 变量，跟随系统主题色）
// ============================================

const panelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
  background: 'rgb(var(--background-secondary) / 0.98)',
  backdropFilter: 'blur(20px)', borderRadius: '16px', overflow: 'hidden',
  // 极淡边框（勾勒轮廓，不抢眼）+ 极淡大模糊阴影（自然淡出，无硬边缘）
  border: '1px solid rgba(128, 128, 128, 0.15)',
  boxShadow: '0 0 10px rgba(0, 0, 0, 0.1)',
}

const headerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
  borderBottom: '1px solid rgb(var(--border) / 0.4)',
  background: 'rgb(var(--background) / 0.85)', flexShrink: 0, height: 44,
}

/** 顶栏「最大化」图标按钮（点击打开主聊天窗口并关闭迷你助手） */
const headerMaximizeBtnStyle: React.CSSProperties = {
  width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: '50%', border: '1px solid rgb(var(--border) / 0.4)', background: 'rgb(var(--surface) / 0.3)',
  cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s',
}

const headerBtnStyle: React.CSSProperties = {
  padding: '3px 8px', borderRadius: 6,
  border: '1px solid rgb(var(--border) / 0.4)', background: 'rgb(var(--surface) / 0.3)',
  color: 'rgb(var(--text-secondary) / 0.8)', cursor: 'pointer',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  transition: 'background 0.15s',
}

const headerCloseBtnStyle: React.CSSProperties = {
  width: 26, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: '50%', border: '1px solid rgb(var(--border) / 0.4)', background: 'rgb(var(--surface) / 0.3)',
  cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s',
}

const attachmentPreviewStyle: React.CSSProperties = {
  display: 'flex', gap: 6, padding: '6px 12px', flexShrink: 0,
  overflowX: 'auto', borderBottom: '1px solid rgb(var(--border) / 0.2)',
}

const attachmentItemStyle: React.CSSProperties = {
  position: 'relative', display: 'flex', alignItems: 'center', padding: 4,
  borderRadius: 6, background: 'rgb(var(--surface) / 0.3)',
  border: '1px solid rgb(var(--border) / 0.4)', flexShrink: 0,
}

const attachmentRemoveBtnStyle: React.CSSProperties = {
  position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: '50%',
  background: 'rgb(var(--status-error) / 0.85)', border: '1px solid rgb(var(--border) / 0.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 10,
}

const messageListStyle: React.CSSProperties = {
  flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '12px 14px',
  minHeight: 0, scrollbarWidth: 'thin',
}

const emptyStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const errorBannerStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', marginBottom: 8,
  background: 'rgb(var(--status-error) / 0.1)', border: '1px solid rgb(var(--status-error) / 0.2)',
  borderRadius: 8, color: 'rgb(var(--status-error))', fontSize: '12px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const activityBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '5px 12px', borderTop: '1px solid rgb(var(--border) / 0.3)',
  background: 'rgb(var(--background) / 0.85)', flexShrink: 0,
}

const activityTextStyle: React.CSSProperties = {
  fontSize: '12px', color: 'rgb(var(--text-secondary) / 0.9)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
}

const bubbleBaseStyle: React.CSSProperties = {
  maxWidth: '80%', padding: '8px 12px', borderRadius: 12,
  fontSize: '13px', lineHeight: 1.5, wordBreak: 'break-word',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
}

const userBubbleStyle: React.CSSProperties = {
  background: 'rgb(var(--accent) / 0.85)', color: 'rgb(var(--accent-foreground))',
  borderBottomRightRadius: 4,
}

const aiBubbleStyle: React.CSSProperties = {
  background: 'rgb(var(--surface) / 0.4)', border: '1px solid rgb(var(--border) / 0.4)',
  color: 'rgb(var(--text-primary) / 0.95)', borderBottomLeftRadius: 4,
}

const errorBubbleStyle: React.CSSProperties = {
  background: 'rgb(var(--status-error) / 0.08)', border: '1px solid rgb(var(--status-error) / 0.2)',
}

const bubbleTextStyle: React.CSSProperties = { whiteSpace: 'pre-wrap' }

const cursorBlinkStyle: React.CSSProperties = {
  animation: 'mini-chat-blink 1s step-end infinite', marginLeft: 1, opacity: 0.7,
}

const inputBarStyle: React.CSSProperties = {
  padding: '6px 10px 8px', borderTop: '1px solid rgb(var(--border) / 0.4)',
  background: 'rgb(var(--background) / 0.85)', flexShrink: 0,
}

const toolbarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6,
}

const toolbarBtnStyle: React.CSSProperties = {
  height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8, border: '1px solid rgb(var(--border) / 0.4)', background: 'rgb(var(--surface) / 0.3)',
  cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s',
}

/** 附件上传按钮（正方形，与输入框高度协调） */
const attachBtnStyle: React.CSSProperties = {
  width: 28, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8, border: '1px solid rgb(var(--border) / 0.4)', background: 'rgb(var(--surface) / 0.3)',
  cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s',
}

const inputRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'flex-end', gap: 6,
}

const textareaStyle: React.CSSProperties = {
  flex: 1, minHeight: 32, maxHeight: 100, padding: '7px 10px', borderRadius: 10,
  border: '1px solid rgb(var(--border) / 0.4)', background: 'rgb(var(--surface) / 0.3)',
  color: 'rgb(var(--text-primary) / 0.95)', fontSize: '13px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  resize: 'none', outline: 'none', lineHeight: 1.4, transition: 'border-color 0.15s',
}

const sendBtnStyle: React.CSSProperties = {
  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8, border: 'none', background: 'rgb(var(--accent) / 0.85)',
  cursor: 'pointer', flexShrink: 0, transition: 'opacity 0.15s',
}

const stopBtnStyle: React.CSSProperties = {
  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8, border: 'none', background: 'rgb(var(--status-error) / 0.8)',
  cursor: 'pointer', flexShrink: 0,
}

const micBtnStyle: React.CSSProperties = {
  width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
  borderRadius: 8, border: '1px solid rgb(var(--border) / 0.4)', background: 'rgb(var(--surface) / 0.3)',
  cursor: 'pointer', flexShrink: 0, transition: 'background 0.15s',
}

const modelDropdownStyle: React.CSSProperties = {
  position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, right: 0,
  maxHeight: 280, overflowY: 'auto',
  background: 'rgb(var(--background-secondary) / 0.98)', backdropFilter: 'blur(20px)',
  border: '1px solid rgb(var(--border) / 0.6)', borderRadius: 10,
  boxShadow: '0 -4px 20px rgba(0, 0, 0, 0.4)', zIndex: 100, padding: 4,
}

/** Tab 切换栏容器 */
const modelTabBarStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4,
  padding: '4px 4px 6px',
  borderBottom: '1px solid rgb(var(--border) / 0.4)',
  marginBottom: 4, position: 'sticky', top: -4,
  background: 'rgb(var(--background-secondary) / 0.98)', zIndex: 1,
}

/** 单个 Tab 按钮 */
const modelTabStyle: React.CSSProperties = {
  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '5px 8px', borderRadius: 6,
  border: 'none', background: 'transparent',
  fontSize: '12px', fontWeight: 500,
  color: 'rgb(var(--text-muted) / 0.8)',
  cursor: 'pointer', transition: 'all 0.15s',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

/** 激活的 Tab */
const modelTabActiveStyle: React.CSSProperties = {
  background: 'rgb(var(--surface) / 0.6)',
  color: 'rgb(var(--text-primary))',
}

const modelItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '7px 8px', borderRadius: 6,
  border: 'none', background: 'transparent', cursor: 'pointer', width: '100%',
  textAlign: 'left', transition: 'background 0.15s',
}

const modelItemSelectedStyle: React.CSSProperties = {
  background: 'rgb(var(--accent) / 0.12)',
}

// ============================================
// 推理内容样式
// ============================================

const reasoningContainerStyle: React.CSSProperties = {
  maxWidth: '80%', marginBottom: 4, borderRadius: 10,
  background: 'rgb(var(--surface) / 0.2)',
  border: '1px solid rgb(var(--border) / 0.3)',
  overflow: 'hidden',
}

const reasoningHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px',
  background: 'transparent', border: 'none', cursor: 'pointer', width: '100%',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const reasoningTitleStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 500, color: 'rgb(var(--text-muted) / 0.8)',
  flex: 1, textAlign: 'left',
}

const reasoningContentStyle: React.CSSProperties = {
  padding: '4px 10px 8px', fontSize: '12px', lineHeight: 1.5,
  color: 'rgb(var(--text-muted) / 0.7)', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
  maxHeight: 200, overflowY: 'auto', borderTop: '1px solid rgb(var(--border) / 0.2)',
}

// ============================================
// 工具审批卡片样式
// ============================================

const approvalCardStyle: React.CSSProperties = {
  marginTop: 4, marginBottom: 8, borderRadius: 10, overflow: 'hidden',
  border: '1px solid rgba(245, 158, 11, 0.3)',
  background: 'rgba(245, 158, 11, 0.05)',
}

const approvalHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px',
  background: 'rgba(245, 158, 11, 0.1)',
  borderBottom: '1px solid rgba(245, 158, 11, 0.2)',
}

const approvalTitleStyle: React.CSSProperties = {
  fontSize: '12px', fontWeight: 600, color: 'rgb(245, 158, 11)',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const approvalCountStyle: React.CSSProperties = {
  fontSize: '12px', padding: '1px 6px', borderRadius: 4,
  background: 'rgba(245, 158, 11, 0.2)', color: 'rgb(245, 158, 11)',
  fontFamily: 'Menlo, Monaco, Consolas, monospace', flexShrink: 0,
}

const approvalHintStyle: React.CSSProperties = {
  fontSize: '12px', color: 'rgba(245, 158, 11, 0.6)', marginLeft: 'auto',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const approvalListStyle: React.CSSProperties = {
  maxHeight: 120, overflowY: 'auto', padding: '4px 0',
}

const approvalItemStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px',
  transition: 'background 0.15s',
}

const approvalItemTextStyle: React.CSSProperties = {
  fontSize: '12px', color: 'rgb(var(--text-primary) / 0.9)',
  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const approvalItemNameStyle: React.CSSProperties = {
  fontSize: '12px', color: 'rgb(var(--text-muted) / 0.5)',
  fontFamily: 'Menlo, Monaco, Consolas, monospace', flexShrink: 0,
}

const approvalFooterStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 6,
  padding: '6px 10px', borderTop: '1px solid rgba(245, 158, 11, 0.2)',
  background: 'rgba(245, 158, 11, 0.05)',
}

const approvalRejectBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6,
  border: '1px solid rgb(var(--status-error) / 0.3)', background: 'transparent',
  cursor: 'pointer', transition: 'background 0.15s',
  fontSize: '12px', fontWeight: 500, color: 'rgb(var(--status-error))',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

const approvalApproveBtnStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6,
  border: 'none', background: 'rgb(var(--accent) / 0.85)',
  cursor: 'pointer', transition: 'opacity 0.15s',
  fontSize: '12px', fontWeight: 600, color: 'rgb(var(--accent-foreground))',
  fontFamily: '-apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif',
}

export const MiniChatPanel = memo(MiniChatPanelImpl)
