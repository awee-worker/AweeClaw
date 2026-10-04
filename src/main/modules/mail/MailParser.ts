/**
 * 邮件解析器
 *
 * 将 IMAP 拉取到的原始 RFC822 报文，用 mailparser 解析为结构化数据：
 * - 元数据（主题、收发件人、时间、正文纯文本、附件清单）
 * - 正文缓存（纯文本 + HTML + 附件元信息）
 */

import { simpleParser, type AddressObject } from 'mailparser'
import type { MailAddress, MailAttachmentMeta, MailBodyCache, MailMessageMeta } from './types'

/** 解析上下文（来自 IMAP 拉取） */
export interface ParseContext {
  accountId: string
  folder: string
  uid: number
  size: number
  flags?: string[]
}

/** 单封解析结果 */
export interface ParsedMail {
  meta: MailMessageMeta
  body: MailBodyCache
}

/** 归一化地址字段（mailparser 返回单个或数组） */
function normalizeAddresses(input?: AddressObject | AddressObject[]): MailAddress[] {
  if (!input) return []
  const list = Array.isArray(input) ? input : [input]
  const out: MailAddress[] = []
  for (const obj of list) {
    for (const v of obj.value ?? []) {
      if (v.address) out.push({ name: v.name || undefined, address: v.address })
    }
  }
  return out
}

/** 解析单封原始报文 */
export async function parseRawMessage(raw: Buffer, ctx: ParseContext): Promise<ParsedMail> {
  const parsed = await simpleParser(raw)

  const flags = new Set(ctx.flags ?? [])
  const attachments: MailAttachmentMeta[] = (parsed.attachments ?? []).map((a) => ({
    filename: a.filename ?? '未命名附件',
    contentType: a.contentType ?? 'application/octet-stream',
    size: a.size ?? 0,
    inline: Boolean(a.cid),
  }))

  const html = typeof parsed.html === 'string' ? parsed.html : undefined
  const text = parsed.text ?? (html ? stripHtml(html) : '')

  const meta: MailMessageMeta = {
    uid: ctx.uid,
    folder: ctx.folder,
    accountId: ctx.accountId,
    subject: parsed.subject ?? '(无主题)',
    from: normalizeAddresses(parsed.from),
    to: normalizeAddresses(parsed.to),
    date: parsed.date ? parsed.date.getTime() : Date.now(),
    seen: flags.has('\\Seen'),
    flagged: flags.has('\\Flagged'),
    hasAttachments: attachments.length > 0,
    attachmentCount: attachments.length,
    size: ctx.size,
    cacheRef: `${ctx.accountId}/${ctx.folder}/${ctx.uid}.json`,
  }

  const body: MailBodyCache = {
    uid: ctx.uid,
    text,
    html,
    attachments,
    cachedAt: Date.now(),
  }

  return { meta, body }
}

/** 极简 HTML 剥离（仅用于无 text 部分的降级，展示与 AI 均使用清洗后的文本） */
function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}
