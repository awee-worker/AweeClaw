/**
 * 写邮件面板
 *
 * 一个弹层承载三种场景，靠 initial 里的来源标识区分：
 * - 写信（默认）：填写收件人/主题/正文，可发送或存草稿
 * - 编辑草稿（draftId）：内容预填，发送后自动移出草稿箱
 * - 重发失败邮件（outboxId）：内容只读，仅提供重试发送
 *
 * 发送能力复用收件账户：发件服务器与凭据由主进程按账户自动推导，
 * 因此这里只需选择用哪个账户发、填什么内容。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  X,
  Send,
  Save,
  Loader2,
  AlertCircle,
  RefreshCw,
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Undo2,
  Redo2,
  Image as ImageIcon,
  Paperclip,
  Trash2,
  Sparkles,
} from 'lucide-react'
import { api } from '../../adapters/electronBridge'
import { composeMail } from '../../composables/mail/mailAi'
import type { EmailAccount } from '@shared/configuration/configTypes'
import type { LLMConfig } from '@shared/protocols/modelProtocol'
import type { MailAttachment } from '@shared/protocols/mail'

/** 打开写邮件面板时的初始内容 */
export interface MailComposerInitial {
  accountId: string
  to: string
  cc?: string
  subject: string
  body: string
  /** 正文是否为 HTML（草稿恢复时决定按富文本还是纯文本载入） */
  html?: boolean
  /** 已带附件（编辑草稿 / 重发时恢复） */
  attachments?: MailAttachment[]
  /** 来源草稿 id：发送成功后移出草稿箱 */
  draftId?: string
  /** 来源发件箱条目 id：仅允许重试发送 */
  outboxId?: string
}

interface MailComposerViewProps {
  language: 'en' | 'zh'
  accounts: EmailAccount[]
  initial: MailComposerInitial
  /** 当前会话模型配置；为空时「AI 帮写」不可用 */
  llmConfig?: LLMConfig | null
  onClose: () => void
  /** 发送成功或草稿落库后触发，供调用方刷新列表 */
  onDone: () => void
}

const INPUT_CLS =
  'w-full px-3 py-2 rounded-lg bg-background/60 border border-border text-xs text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50 transition-colors'

const TOOL_BTN_CLS =
  'w-7 h-7 flex items-center justify-center rounded-md text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors'

/** 纯文本转义为可放进编辑器的 HTML（保留换行） */
function plainTextToHtml(text: string): string {
  if (!text) return ''
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')
}

/** 把草稿里保存的 cid 引用还原为可在编辑区显示的 base64 图片 */
function hydrateInlineImages(html: string, attachments?: MailAttachment[]): string {
  if (!html) return ''
  const map = new Map(
    (attachments || [])
      .filter((a) => a.contentId)
      .map((a) => [a.contentId as string, a] as [string, MailAttachment]),
  )
  return html.replace(/src="cid:([^"]+)"/g, (whole, cid: string) => {
    const att = map.get(cid)
    if (!att) return whole
    return `src="data:${att.contentType || 'image/png'};base64,${att.content}" data-cid="${cid}"`
  })
}

/** 读取本地文件为 data URL */
function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

/** 去掉 data URL 前缀，取 base64 主体 */
function dataUrlToBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : ''
}

export function MailComposerView({
  language,
  accounts,
  initial,
  llmConfig,
  onClose,
  onDone,
}: MailComposerViewProps) {
  const zh = language === 'zh'
  const [accountId, setAccountId] = useState(initial.accountId || accounts[0]?.id || '')
  const [to, setTo] = useState(initial.to)
  const [cc, setCc] = useState(initial.cc ?? '')
  const [subject, setSubject] = useState(initial.subject)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** AI 帮写：输入区开关 / 用户要求 / 生成中 / 错误 */
  const [aiOpen, setAiOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  /** 普通附件 */
  const [files, setFiles] = useState<MailAttachment[]>(() =>
    (initial.attachments ?? []).filter((a) => !a.contentId),
  )
  /** 正文内联图片（编辑区以 data-cid 标记，发送时改写为 cid 引用） */
  const [inlineImages, setInlineImages] = useState<MailAttachment[]>(() =>
    (initial.attachments ?? []).filter((a) => a.contentId),
  )

  const editorRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 发件箱条目只能重发，不允许改内容（改了会与失败原文不一致）
  const retryOnly = Boolean(initial.outboxId)

  // 账户列表异步加载：初值未命中时在账户就绪后回落到第一个可用账户，
  // 避免「打开写邮件时账户尚未加载」导致发件账户为空、无法发送。
  useEffect(() => {
    if (accountId && accounts.some((a) => a.id === accountId)) return
    const fallback = accounts[0]?.id
    if (fallback) setAccountId(fallback)
  }, [accounts, accountId])

  // 初始化编辑器内容（仅一次）：HTML 草稿走 cid 还原，纯文本走转义
  useEffect(() => {
    const el = editorRef.current
    if (!el) return
    el.innerHTML = initial.html
      ? hydrateInlineImages(initial.body, initial.attachments)
      : plainTextToHtml(initial.body)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** 执行编辑器命令（工具栏按钮已在 mousedown 阻止失焦，保留选区） */
  const exec = useCallback((command: string, value?: string) => {
    editorRef.current?.focus()
    // 关闭 styleWithCSS 以生成 <b>/<font> 等标签，邮件客户端兼容性更好
    try {
      document.execCommand('styleWithCSS', false, 'false')
    } catch {
      // 部分环境不支持，忽略
    }
    document.execCommand(command, false, value)
  }, [])

  /** 编辑区 HTML → 待发送正文（内联图还原为 cid 引用） */
  const buildOutgoingHtml = useCallback((): string => {
    const el = editorRef.current
    if (!el) return ''
    const doc = new DOMParser().parseFromString(el.innerHTML, 'text/html')
    doc.querySelectorAll('img[data-cid]').forEach((node) => {
      const cid = node.getAttribute('data-cid') || ''
      node.setAttribute('src', `cid:${cid}`)
      node.removeAttribute('data-cid')
    })
    return doc.body.innerHTML
  }, [])

  /** 仅保留仍被正文引用的内联图 + 普通附件 */
  const collectAttachments = useCallback(
    (html: string): MailAttachment[] => [
      ...inlineImages.filter((img) => img.contentId && html.includes(`cid:${img.contentId}`)),
      ...files,
    ],
    [inlineImages, files],
  )

  const handlePickImages = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return
      for (const file of Array.from(list)) {
        try {
          const dataUrl = await readAsDataURL(file)
          const cid = `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@aweeclaw`
          setInlineImages((prev) => [
            ...prev,
            {
              filename: file.name || `image-${Date.now()}.png`,
              content: dataUrlToBase64(dataUrl),
              encoding: 'base64',
              contentType: file.type || 'image/png',
              contentId: cid,
            },
          ])
          editorRef.current?.focus()
          document.execCommand(
            'insertHTML',
            false,
            `<img src="${dataUrl}" data-cid="${cid}" style="max-width:100%;height:auto;" />`,
          )
        } catch {
          setError(zh ? '图片读取失败' : 'Failed to read image')
        }
      }
    },
    [zh],
  )

  const handlePickFiles = useCallback(
    async (list: FileList | null) => {
      if (!list || list.length === 0) return
      const next: MailAttachment[] = []
      for (const file of Array.from(list)) {
        try {
          const dataUrl = await readAsDataURL(file)
          next.push({
            filename: file.name,
            content: dataUrlToBase64(dataUrl),
            encoding: 'base64',
            contentType: file.type || 'application/octet-stream',
          })
        } catch {
          setError(zh ? '附件读取失败' : 'Failed to read attachment')
        }
      }
      if (next.length > 0) setFiles((prev) => [...prev, ...next])
    },
    [zh],
  )

  /** AI 帮写：调用当前会话模型生成正文并填入编辑器 */
  const handleAiCompose = useCallback(async () => {
    const instruction = aiPrompt.trim()
    if (!instruction || aiBusy) return
    if (!llmConfig) {
      setAiError(
        zh ? '未获取到模型配置，请先在主窗口配置模型' : 'No model config; configure a model first',
      )
      return
    }
    const el = editorRef.current
    setAiBusy(true)
    setAiError(null)
    try {
      const res = await composeMail(llmConfig, {
        instruction,
        to: to.trim() || undefined,
        subject: subject.trim() || undefined,
        currentBody: el?.innerText || '',
      })
      if (!res.success || !res.body) {
        setAiError(res.error || (zh ? '生成失败' : 'Generation failed'))
        return
      }
      // 追加到现有正文之后，保留用户已写内容（insertHTML 可被撤销）
      const html = plainTextToHtml(res.body)
      if (el) {
        el.focus()
        const hasContent = (el.textContent || '').trim().length > 0
        document.execCommand('insertHTML', false, hasContent ? `<br><br>${html}` : html)
      }
      if (!subject.trim() && res.subject) setSubject(res.subject)
      setAiPrompt('')
      setAiOpen(false)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(false)
    }
  }, [aiPrompt, aiBusy, llmConfig, to, subject, zh])

  const handleSend = async () => {
    if (retryOnly) {
      if (!initial.outboxId) return
      setBusy(true)
      setError(null)
      try {
        const res = await api.mail.outboxRetry({ id: initial.outboxId })
        onDone()
        if (res?.success) {
          onClose()
        } else {
          setError(res?.error || (zh ? '发送失败' : 'Send failed'))
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
      return
    }

    if (!accountId) {
      setError(zh ? '请先选择发件账户' : 'Select a sending account')
      return
    }
    if (!to.trim()) {
      setError(zh ? '请填写收件人' : 'Recipient is required')
      return
    }

    const html = buildOutgoingHtml()
    if (!editorRef.current?.textContent?.trim() && inlineImages.length === 0) {
      setError(zh ? '请填写邮件正文' : 'Message body is required')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const res = await api.mail.sendMessage({
        accountId,
        to,
        cc: cc.trim() || undefined,
        subject,
        body: html,
        html: true,
        attachments: collectAttachments(html),
        draftId: initial.draftId,
      })
      // 失败时主进程已把内容存入发件箱，这里同样刷新列表让用户看到
      onDone()
      if (res?.success) {
        onClose()
      } else {
        setError(res?.error || (zh ? '发送失败，已存入发件箱' : 'Send failed; moved to Outbox'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const handleSaveDraft = async () => {
    if (!accountId) {
      setError(zh ? '请先选择账户' : 'Select an account')
      return
    }
    const html = buildOutgoingHtml()
    setBusy(true)
    setError(null)
    try {
      await api.mail.draftSave({
        accountId,
        id: initial.draftId,
        to,
        cc: cc.trim() || undefined,
        subject,
        body: html,
        html: true,
        attachments: collectAttachments(html),
      })
      onDone()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    // 遮罩层不响应点击：写邮件过程中误触窗口外不应关闭面板，仅右上角关闭按钮可关闭
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-[620px] max-h-[86%] flex flex-col rounded-xl bg-background border border-border/50 shadow-2xl">
        {/* 标题栏 */}
        <div className="h-12 px-5 flex items-center justify-between border-b border-border/30 shrink-0">
          <span className="text-sm font-semibold text-text-primary">
            {retryOnly ? (zh ? '重发邮件' : 'Resend') : zh ? '写邮件' : 'New message'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {/* 发件账户 */}
          {!retryOnly && (
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-xs text-text-muted">{zh ? '发件账户' : 'From'}</span>
              {accounts.length > 1 ? (
                <select
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                  className={INPUT_CLS}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.label || account.address}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-xs text-text-secondary truncate">
                  {accounts[0]?.label || accounts[0]?.address || (zh ? '未配置账户' : 'No account')}
                </span>
              )}
            </div>
          )}

          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-xs text-text-muted">{zh ? '收件人' : 'To'}</span>
            <input
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={retryOnly}
              placeholder={zh ? '多个收件人用逗号分隔' : 'Separate multiple recipients with commas'}
              className={INPUT_CLS}
            />
          </div>

          {!retryOnly && (
            <div className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-xs text-text-muted">{zh ? '抄送' : 'Cc'}</span>
              <input
                type="text"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder={zh ? '可选' : 'Optional'}
                className={INPUT_CLS}
              />
            </div>
          )}

          <div className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-xs text-text-muted">{zh ? '主题' : 'Subject'}</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={retryOnly}
              placeholder={zh ? '邮件主题' : 'Subject'}
              className={INPUT_CLS}
            />
          </div>

          {retryOnly ? (
            /* 重发场景：只读展示原文（HTML 或纯文本） */
            <div
              className="w-full min-h-[220px] px-3 py-2 rounded-lg bg-background/60 border border-border text-xs text-text-primary leading-relaxed overflow-y-auto [&_img]:max-w-full"
              dangerouslySetInnerHTML={{
                __html: initial.html ? initial.body : plainTextToHtml(initial.body),
              }}
            />
          ) : (
            <div className="rounded-lg border border-border bg-background/60 overflow-hidden">
              {/* 富文本工具栏 */}
              <div className="flex items-center flex-wrap gap-0.5 px-2 py-1.5 border-b border-border/60 bg-surface/40">
                <button type="button" title={zh ? '加粗' : 'Bold'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')}>
                  <Bold className="w-3.5 h-3.5" />
                </button>
                <button type="button" title={zh ? '斜体' : 'Italic'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')}>
                  <Italic className="w-3.5 h-3.5" />
                </button>
                <button type="button" title={zh ? '下划线' : 'Underline'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')}>
                  <Underline className="w-3.5 h-3.5" />
                </button>

                <span className="w-px h-4 bg-border/60 mx-1" />

                <select
                  title={zh ? '字号' : 'Font size'}
                  defaultValue=""
                  onChange={(e) => {
                    if (e.target.value) exec('fontSize', e.target.value)
                    e.target.value = ''
                  }}
                  className="h-7 px-1 rounded-md bg-transparent text-[11px] text-text-secondary border border-border/60 focus:outline-none"
                >
                  <option value="">{zh ? '字号' : 'Size'}</option>
                  <option value="2">{zh ? '小' : 'Small'}</option>
                  <option value="3">{zh ? '正常' : 'Normal'}</option>
                  <option value="4">{zh ? '大' : 'Large'}</option>
                  <option value="5">{zh ? '特大' : 'Huge'}</option>
                </select>

                <label
                  title={zh ? '字体颜色' : 'Text color'}
                  className="w-7 h-7 flex items-center justify-center rounded-md cursor-pointer hover:bg-accent/10"
                >
                  <span className="w-3.5 h-3.5 rounded-sm border border-border/70 bg-gradient-to-br from-rose-500 to-amber-400" />
                  <input type="color" className="sr-only" onChange={(e) => exec('foreColor', e.target.value)} />
                </label>

                <span className="w-px h-4 bg-border/60 mx-1" />

                <button type="button" title={zh ? '无序列表' : 'Bulleted list'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')}>
                  <List className="w-3.5 h-3.5" />
                </button>
                <button type="button" title={zh ? '有序列表' : 'Numbered list'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')}>
                  <ListOrdered className="w-3.5 h-3.5" />
                </button>

                <span className="w-px h-4 bg-border/60 mx-1" />

                <button type="button" title={zh ? '左对齐' : 'Align left'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyLeft')}>
                  <AlignLeft className="w-3.5 h-3.5" />
                </button>
                <button type="button" title={zh ? '居中' : 'Align center'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyCenter')}>
                  <AlignCenter className="w-3.5 h-3.5" />
                </button>
                <button type="button" title={zh ? '右对齐' : 'Align right'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => exec('justifyRight')}>
                  <AlignRight className="w-3.5 h-3.5" />
                </button>

                <span className="w-px h-4 bg-border/60 mx-1" />

                <button type="button" title={zh ? '撤销' : 'Undo'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => exec('undo')}>
                  <Undo2 className="w-3.5 h-3.5" />
                </button>
                <button type="button" title={zh ? '重做' : 'Redo'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => exec('redo')}>
                  <Redo2 className="w-3.5 h-3.5" />
                </button>

                <span className="w-px h-4 bg-border/60 mx-1" />

                <button type="button" title={zh ? '插入图片' : 'Insert image'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => imageInputRef.current?.click()}>
                  <ImageIcon className="w-3.5 h-3.5" />
                </button>
                <button type="button" title={zh ? '添加附件' : 'Add attachment'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => fileInputRef.current?.click()}>
                  <Paperclip className="w-3.5 h-3.5" />
                </button>
                <button type="button" title={zh ? 'AI 帮写' : 'AI compose'} className={TOOL_BTN_CLS}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setAiOpen((v) => !v)
                    setAiError(null)
                  }}>
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* AI 帮写输入区（点击工具栏「AI 帮写」展开） */}
              {aiOpen && (
                <div className="px-2 py-2 space-y-1.5 border-b border-border/60 bg-accent/5">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault()
                          void handleAiCompose()
                        }
                      }}
                      autoFocus
                      placeholder={zh ? '想让 AI 写什么？例如：回复客户确认下周一交付' : 'What should AI write? e.g. reply confirming delivery'}
                      className="flex-1 h-7 px-2 rounded-md bg-background/60 border border-border text-[11px] text-text-primary placeholder:text-text-muted/50 focus:outline-none focus:border-accent/50"
                    />
                    <button
                      type="button"
                      onClick={() => void handleAiCompose()}
                      disabled={aiBusy || !aiPrompt.trim()}
                      className="flex items-center gap-1 h-7 px-2 rounded-md text-[11px] font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                    >
                      {aiBusy ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      {zh ? '生成' : 'Generate'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAiOpen(false)
                        setAiError(null)
                      }}
                      className="w-7 h-7 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary"
                      title={zh ? '关闭' : 'Close'}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                  <div className="text-[10px] text-text-muted">
                    {aiBusy
                      ? zh
                        ? '正在调用当前会话模型生成…'
                        : 'Generating with the current session model…'
                      : zh
                        ? '内容将追加到正文末尾，可撤销'
                        : 'Content is appended to the body and can be undone'}
                  </div>
                  {aiError && <div className="text-[10px] text-red-400 break-all">{aiError}</div>}
                </div>
              )}

              {/* 编辑区 */}
              <div
                ref={editorRef}
                contentEditable
                suppressContentEditableWarning
                className="min-h-[240px] max-h-[420px] overflow-y-auto px-3 py-2 text-xs text-text-primary leading-relaxed focus:outline-none [&_img]:max-w-full [&_a]:text-accent [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5"
              />
            </div>
          )}

          {/* 附件区 */}
          {!retryOnly && (files.length > 0 || inlineImages.length > 0) && (
            <div className="space-y-1.5">
              {inlineImages.length > 0 && (
                <div className="text-[11px] text-text-muted">
                  {zh ? `正文内联图片 ${inlineImages.length} 张` : `${inlineImages.length} inline image(s)`}
                </div>
              )}
              {files.map((f, i) => (
                <div
                  key={`${f.filename}-${i}`}
                  className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-surface/60 text-xs text-text-secondary"
                >
                  <Paperclip className="w-3.5 h-3.5 shrink-0 text-text-muted" />
                  <span className="truncate flex-1">{f.filename}</span>
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                    className="shrink-0 text-text-muted hover:text-red-400 transition-colors"
                    title={zh ? '移除附件' : 'Remove'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-1.5 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="break-all flex-1">{error}</span>
            </div>
          )}
        </div>

        {/* 操作栏 */}
        <div className="h-14 px-5 flex items-center gap-3 border-t border-border/30 shrink-0">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-50 transition-colors"
          >
            {busy ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : retryOnly ? (
              <RefreshCw className="w-3.5 h-3.5" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {retryOnly ? (zh ? '重试发送' : 'Retry') : zh ? '发送' : 'Send'}
          </button>

          {!retryOnly && (
            <button
              type="button"
              onClick={() => void handleSaveDraft()}
              disabled={busy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-surface/60 text-text-secondary hover:text-accent hover:bg-accent/10 disabled:opacity-50 transition-colors"
            >
              <Save className="w-3.5 h-3.5" />
              {zh ? '存草稿' : 'Save draft'}
            </button>
          )}

          <span className="ml-auto text-[11px] text-text-muted">
            {zh ? '发件服务器按账户自动配置' : 'Server derived from account'}
          </span>
        </div>

        {/* 隐藏文件选择器：插入图片 / 添加附件 */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            void handlePickImages(e.target.files)
            e.target.value = ''
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            void handlePickFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}

export default MailComposerView
