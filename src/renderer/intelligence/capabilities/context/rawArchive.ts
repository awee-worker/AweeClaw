/**
 * 原文归档降级
 *
 * 摘要链路连续失败时启用：不调用模型，把待压缩的消息按可读格式直接写入归档文件。
 *
 * 目的是「不丢数据 + 不原地打转」：摘要能力不可用（模型报错、配额耗尽、网络中断）时，
 * 被移出上下文的内容必须可回溯，而不是被静默丢弃；同时连续失败后要停止重试，
 * 否则每一轮都会白白消耗一次模型调用，既拿不到摘要，又拖慢主循环。
 */

import { logger } from '@toolkit/LogEngine'
import { api } from '../../../adapters/electronBridge'
import {
  getMessageText,
  type ChatMessage,
  type AssistantMessage,
  type ToolResultMessage,
  type UserMessage,
} from '@intelligence/providerTypes'

/** 归档目录名（位于用户数据目录下，随应用数据一起清理） */
const ARCHIVE_DIR_NAME = 'context-archive'

export interface RawArchiveResult {
  /** 已归档的消息条数 */
  archivedCount: number
  /** 归档文件绝对路径；目录不可用或写入失败时为 null */
  filePath: string | null
  /** 是否因文件已存在而跳过写入 */
  skipped: boolean
}

/** 归档文件名只保留安全字符，避免路径穿越与非法文件名 */
function sanitizeFileSegment(segment: string): string {
  const safe = segment.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 120)
  return safe || 'unknown'
}

function formatTimestamp(ms?: number): string {
  if (!ms) return ''
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 单条消息的归档文本
 *
 * 工具调用以 [tools: 名称] 标注：内容被移出上下文之后，
 * 仍需要能看出当时执行了哪些工具，才具备回溯价值。
 */
function formatMessage(msg: ChatMessage): string {
  const timestamp = formatTimestamp((msg as { timestamp?: number }).timestamp)
  const prefix = timestamp ? `[${timestamp}] ` : ''
  const role = msg.role

  if (role === 'tool') {
    const tm = msg as ToolResultMessage
    const body = typeof tm.content === 'string' ? tm.content : ''
    return `${prefix}TOOL(${tm.name || 'unknown'}): ${body}`
  }

  if (role === 'assistant') {
    const am = msg as AssistantMessage
    const text = typeof am.content === 'string' ? am.content : getMessageText(am.content)
    const tools = am.toolCalls?.length
      ? ` [tools: ${am.toolCalls.map(tc => tc.name).join(', ')}]`
      : ''
    return `${prefix}ASSISTANT${tools}: ${text}`
  }

  const um = msg as UserMessage
  const text = typeof um.content === 'string' ? um.content : getMessageText(um.content)
  return `${prefix}${String(role).toUpperCase()}: ${text}`
}

/**
 * 把一批消息原文归档到磁盘
 *
 * 文件名由「会话 + 批次起始索引」决定：同一批消息重复触发归档会命中同一路径，
 * 已存在即跳过，避免重试产生重复文件。
 *
 * 本函数不抛异常 —— 归档属于保命路径，写入失败只记录日志，主循环照常推进。
 */
export async function rawArchiveMessages(
  sessionId: string,
  messages: ChatMessage[],
  reason: string,
  batchStartIndex = 0
): Promise<RawArchiveResult> {
  if (!messages.length) {
    return { archivedCount: 0, filePath: null, skipped: false }
  }

  try {
    const userDataPath = await api.settings.getUserDataPath()
    if (!userDataPath) {
      logger.agent.warn('[RawArchive] 用户数据目录不可用，跳过原文归档')
      return { archivedCount: 0, filePath: null, skipped: false }
    }

    const dir = `${userDataPath}/${ARCHIVE_DIR_NAME}`
    await api.file.ensureDir(dir)

    const fileName = `${sanitizeFileSegment(sessionId)}-${batchStartIndex}.md`
    const filePath = `${dir}/${fileName}`

    if (await api.file.exists(filePath)) {
      logger.agent.info(`[RawArchive] 归档文件已存在，跳过写入: ${fileName}`)
      return { archivedCount: messages.length, filePath, skipped: true }
    }

    const lines = [
      '# 上下文原文归档',
      '',
      `- 会话：${sessionId}`,
      `- 批次起始索引：${batchStartIndex}`,
      `- 消息数：${messages.length}`,
      `- 归档原因：${reason}`,
      `- 归档时间：${formatTimestamp(Date.now())}`,
      '',
      '---',
      '',
      ...messages.map(formatMessage),
      '',
    ]

    await api.file.write(filePath, lines.join('\n'))

    logger.agent.info(
      `[RawArchive] 已归档 ${messages.length} 条消息到 ${fileName}（原因：${reason}）`
    )
    return { archivedCount: messages.length, filePath, skipped: false }
  } catch (err) {
    logger.agent.warn('[RawArchive] 原文归档失败，主循环继续:', err)
    return { archivedCount: 0, filePath: null, skipped: false }
  }
}
