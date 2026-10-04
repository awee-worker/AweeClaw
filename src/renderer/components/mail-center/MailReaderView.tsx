/**
 * 邮件阅读器
 *
 * - 展示邮件头（主题、发件人、收件人、时间、附件列表）
 * - 正文优先渲染 HTML（经 SanitizedHTML 消毒，剥离脚本/iframe/表单等）
 * - 无 HTML 时回退纯文本
 * - 预留 AI 整理结果展示区（摘要 / 分类 / 待办）
 */

import { useEffect, useState } from 'react'
import { Paperclip, Clock, User, Loader2, FileText, Sparkles } from 'lucide-react'
import { SanitizedHTML } from '@components/foundation/SanitizedHTML'
import type { MailAttachmentMeta, MailMessageDetail } from '@shared/protocols/mail'

interface MailReaderViewProps {
  detail: MailMessageDetail | null
  loading: boolean
  /** AI 整理结果（由上层注入；未整理时为 null） */
  aiPanel?: React.ReactNode
  /** 附件下载回调（未提供时不显示下载按钮） */
  onDownloadAttachment?: (att: MailAttachmentMeta) => void
}

/** 邮件正文消毒白名单：允许常见排版标签，禁止脚本/表单/iframe */
const MAIL_HTML_OPTIONS = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr', 'div', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a', 'img', 'font', 'center', 'sub', 'sup',
  ],
  ALLOWED_ATTR: ['href', 'title', 'src', 'alt', 'width', 'height', 'align', 'color', 'style'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'link', 'meta', 'base'],
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function formatFullDate(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function addressLine(list: { name?: string; address: string }[]): string {
  return list.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join('，')
}

export function MailReaderView({ detail, loading, aiPanel, onDownloadAttachment }: MailReaderViewProps) {
  const [showHtml, setShowHtml] = useState(true)

  // 切换邮件时重置为 HTML 优先
  useEffect(() => {
    setShowHtml(true)
  }, [detail?.meta.accountId, detail?.meta.folder, detail?.meta.uid])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-muted px-8 text-center">
        选择一封邮件查看内容
      </div>
    )
  }

  const { meta, body } = detail
  const hasHtml = Boolean(body?.html)

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* 邮件头 */}
      <div className="px-6 py-4 border-b border-border/30 space-y-2 shrink-0">
        <h2 className="text-sm font-semibold text-text-primary leading-snug">{meta.subject}</h2>
        <div className="flex items-center gap-2 text-[11px] text-text-secondary">
          <User className="w-3 h-3 shrink-0" />
          <span className="truncate">{addressLine(meta.from) || '(未知发件人)'}</span>
        </div>
        {meta.to.length > 0 && (
          <div className="text-[11px] text-text-muted truncate">收件人：{addressLine(meta.to)}</div>
        )}
        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <Clock className="w-3 h-3 shrink-0" />
          <span>{formatFullDate(meta.date)}</span>
          {meta.hasAttachments && (
            <span className="flex items-center gap-0.5 text-amber-400">
              <Paperclip className="w-3 h-3" />
              {meta.attachmentCount} 个附件
            </span>
          )}
          {hasHtml && (
            <button
              type="button"
              onClick={() => setShowHtml((v) => !v)}
              className="ml-auto text-accent hover:underline"
            >
              {showHtml ? '纯文本' : '网页格式'}
            </button>
          )}
        </div>

        {/* 附件列表 */}
        {body && body.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {body.attachments.map((att, idx) => (
              <div
                key={`${att.filename}-${idx}`}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface/60 border border-border/40 text-[11px] text-text-secondary"
              >
                <FileText className="w-3 h-3" />
                <span className="max-w-[200px] truncate">{att.filename}</span>
                <span className="text-text-muted">{formatSize(att.size)}</span>
                {onDownloadAttachment && (
                  <button
                    type="button"
                    onClick={() => onDownloadAttachment(att)}
                    className="ml-1 text-accent hover:underline"
                  >
                    下载
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI 整理面板（P4 注入） */}
      {aiPanel}

      {/* 正文 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {showHtml && hasHtml ? (
          <SanitizedHTML
            html={body?.html}
            options={MAIL_HTML_OPTIONS}
            className="mail-body text-xs text-text-primary leading-relaxed break-words"
            fallback={
              <pre className="whitespace-pre-wrap text-xs text-text-primary leading-relaxed">
                {body?.text || '(无正文)'}
              </pre>
            }
          />
        ) : (
          <pre className="whitespace-pre-wrap text-xs text-text-primary leading-relaxed font-sans">
            {body?.text || '(无正文)'}
          </pre>
        )}
      </div>
    </div>
  )
}

/** AI 整理结果占位（P4 完成前展示引导） */
export function MailAiPlaceholder() {
  return (
    <div className="px-6 py-2 border-b border-border/20 flex items-center gap-1.5 text-[11px] text-text-muted">
      <Sparkles className="w-3 h-3" />
      点击工具栏「AI 整理」生成摘要、分类与待办
    </div>
  )
}
