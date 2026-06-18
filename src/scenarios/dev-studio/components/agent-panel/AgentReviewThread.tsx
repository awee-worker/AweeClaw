/**
 * AgentReviewThread - 代码审查讨论线程
 *
 * 展示 Reviewer Agent 的审查意见，支持回复、标记解决。
 */
import type React from 'react'
import { useState, useCallback } from 'react'
import { MessageSquare, CheckCircle2, XCircle, Reply, Send } from 'lucide-react'
import { useI18n } from '@renderer/i18n'
import type { AgentSessionState } from '../../services/AgentSessionService'
import type { AgentRole } from '../../types'

interface ReviewComment {
  id: string
  file: string
  line: number
  author: AgentRole
  content: string
  severity: 'error' | 'warning' | 'info'
  status: 'open' | 'resolved'
  replies: { id: string; author: AgentRole; content: string; timestamp: number }[]
  timestamp: number
}

interface AgentReviewThreadProps {
  session?: AgentSessionState | null
  onSendMessage?: (content: string, to: AgentRole | 'broadcast') => void
}

const MOCK_COMMENTS: ReviewComment[] = [
  {
    id: 'rc-1',
    file: 'src/components/Header.tsx',
    line: 5,
    author: 'reviewer',
    content: 'Consider using a custom hook for user state management to improve testability.',
    severity: 'warning',
    status: 'open',
    replies: [
      { id: 'rp-1', author: 'coder', content: 'Good point, will refactor to useAuth hook.', timestamp: Date.now() - 300000 },
    ],
    timestamp: Date.now() - 600000,
  },
  {
    id: 'rc-2',
    file: 'src/utils/format.ts',
    line: 12,
    author: 'reviewer',
    content: 'Missing null check for the date parameter. Could cause runtime error.',
    severity: 'error',
    status: 'open',
    replies: [],
    timestamp: Date.now() - 300000,
  },
  {
    id: 'rc-3',
    file: 'src/components/Header.tsx',
    line: 20,
    author: 'reviewer',
    content: 'The component could be memoized for better performance.',
    severity: 'info',
    status: 'resolved',
    replies: [
      { id: 'rp-2', author: 'coder', content: 'Done, added React.memo.', timestamp: Date.now() - 120000 },
    ],
    timestamp: Date.now() - 900000,
  },
]

const SEVERITY_BG: Record<string, string> = {
  error: 'bg-red-500/10',
  warning: 'bg-orange-500/10',
  info: 'bg-blue-500/10',
}

const SEVERITY_TEXT: Record<string, string> = {
  error: 'text-red-500',
  warning: 'text-orange-500',
  info: 'text-blue-500',
}

const AgentReviewThread: React.FC<AgentReviewThreadProps> = ({
  session: _session,
  onSendMessage,
}) => {
  const { t } = useI18n()
  const [comments] = useState<ReviewComment[]>(MOCK_COMMENTS)
  const [replyText, setReplyText] = useState('')
  const [activeReplyId, setActiveReplyId] = useState<string | null>(null)

  const openCount = comments.filter(c => c.status === 'open').length

  const handleSendReply = useCallback((commentId: string) => {
    if (!replyText.trim()) return
    onSendMessage?.(`Reply to review on ${commentId}: ${replyText}`, 'reviewer')
    setReplyText('')
    setActiveReplyId(null)
  }, [replyText, onSendMessage])

  if (!comments.length) {
    return (
      <div className="flex flex-col items-center justify-center py-4 text-muted-foreground gap-1">
        <MessageSquare className="w-6 h-6 opacity-30" />
        <p className="text-[10px]">{t('studio.agent.noReviewComments')}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col rounded-md border border-border overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="w-3.5 h-3.5 text-purple-400" />
          <span className="text-[10px] font-medium">{t('studio.agent.reviewComments')}</span>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {t('studio.agent.openCount', { open: openCount, resolved: comments.length - openCount })}
        </span>
      </div>

      {/* 评论列表 */}
      <div className="max-h-48 overflow-auto divide-y divide-border/50">
        {comments.map(comment => {
          const severityKey = comment.severity
          const isReplying = activeReplyId === comment.id

          return (
            <div key={comment.id} className="px-2 py-1.5">
              {/* 主评论 */}
              <div className="flex items-start gap-1.5">
                <div className="flex-shrink-0 mt-0.5">
                  {comment.status === 'resolved' ? (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 text-red-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1 mb-0.5">
                    <span className="text-[10px] font-medium">{comment.author}</span>
                    <span className={`px-1 py-0.5 rounded text-[8px] font-medium ${SEVERITY_BG[severityKey]} ${SEVERITY_TEXT[severityKey]}`}>
                      {t(`studio.agent.severity.${severityKey}`)}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {comment.file}:{comment.line}
                    </span>
                  </div>
                  <p className="text-[10px] text-foreground/80">{comment.content}</p>

                  {/* 回复列表 */}
                  {comment.replies.length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      {comment.replies.map(reply => (
                        <div key={reply.id} className="flex items-start gap-1 pl-2 border-l-2 border-muted/50">
                          <Reply className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5" />
                          <div>
                            <span className="text-[9px] font-medium">{reply.author}</span>
                            <p className="text-[9px] text-muted-foreground">{reply.content}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 操作栏 */}
                  <div className="flex items-center gap-1 mt-1">
                    <button
                      onClick={() => setActiveReplyId(isReplying ? null : comment.id)}
                      className="text-[9px] text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                    >
                      <Reply className="w-2.5 h-2.5" />
                      {t('studio.agent.reply')}
                    </button>
                  </div>
                </div>
              </div>

              {/* 回复输入框 */}
              {isReplying && (
                <div className="flex items-center gap-1 mt-1 pl-5">
                  <input
                    type="text"
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    placeholder={t('studio.agent.writeReply')}
                    className="flex-1 px-2 py-1 rounded border border-border bg-background text-[10px] focus:outline-none focus:border-primary"
                    onKeyDown={e => e.key === 'Enter' && handleSendReply(comment.id)}
                  />
                  <button
                    onClick={() => handleSendReply(comment.id)}
                    className="p-1 rounded bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    <Send className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default AgentReviewThread