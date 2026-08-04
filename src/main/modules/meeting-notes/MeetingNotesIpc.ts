/**
 * 会议纪要 IPC 处理器（主进程）
 *
 * 集中注册 meeting-notes:* 频道 handler，职责：
 * - save-transcript：将段列表格式化为 txt 落盘到工作区按日期分文件夹
 * - generate-docx：调用 DocxGenerator 生成 .docx 并落盘到同目录
 * - get-workspace：返回工作区根路径（供渲染层预览保存位置）
 *
 * 文件落盘路径：{workspaceRoot}/会议纪要/{YYYY-MM-DD}/
 *   - 录音原文_{HHmmss}.txt
 *   - 会议纪要_{HHmmss}.docx
 *
 * 所有 handler 通过 safeIpcHandle 注册，返回 {success, data?, error?} 统一结构。
 */

import { ipcMain } from 'electron'
import * as path from 'path'
import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { ensureDirectory, safeWriteFile } from '../../guard/fileAccessControl'
import { generateDocxBuffer } from './DocxGenerator'
import type { MeetingNotesManager } from './MeetingNotesManager'
import type {
  SaveTranscriptPayload,
  SaveTranscriptResult,
  GenerateDocxPayload,
  GenerateDocxResult,
} from '@shared/protocols/meetingNotes'

let registered = false

/** 注册会议纪要相关 IPC handler（幂等） */
export function registerMeetingNotesIpc(manager: MeetingNotesManager): void {
  if (registered) {
    logger.system.warn('[MeetingNotesIpc] Already registered, skipping')
    return
  }
  registered = true

  const getWorkspacePath = manager.getWorkspacePathGetter()

  // --------------------------------------------
  // 获取工作区路径（渲染层显示保存位置预览用）
  // --------------------------------------------
  safeIpcHandle('meeting-notes:get-workspace', async () => {
    const workspacePath = getWorkspacePath()
    if (!workspacePath) {
      return { success: false, error: '未打开工作区，请先在主窗口打开一个文件夹' }
    }
    return { success: true, data: { workspacePath } }
  })

  // --------------------------------------------
  // 显示窗口（渲染层也可触发，备用入口）
  // --------------------------------------------
  safeIpcHandle('meeting-notes:show', async () => {
    manager.show()
    return { success: true }
  })

  // --------------------------------------------
  // 保存录音原文 txt
  // --------------------------------------------
  safeIpcHandle(
    'meeting-notes:save-transcript',
    async (_event, payload: SaveTranscriptPayload): Promise<SaveTranscriptResult> => {
      try {
        const workspacePath = getWorkspacePath()
        if (!workspacePath) {
          return {
            success: false,
            error: '未打开工作区，请先在主窗口打开一个文件夹后再保存',
          }
        }

        if (!payload || !Array.isArray(payload.segments)) {
          return { success: false, error: '无效的保存数据' }
        }

        // 构建文件夹：{workspace}/会议纪要/{YYYY-MM-DD}/
        const date = payload.date || formatDate(new Date())
        const dayDir = path.join(workspacePath, '会议纪要', date)
        const dirOk = await ensureDirectory(dayDir)
        if (!dirOk) {
          return { success: false, error: `创建目录失败：${dayDir}` }
        }

        // 格式化 txt 内容
        const fileName = `录音原文_${formatTime(new Date(payload.startTime || Date.now()))}.txt`
        const filePath = path.join(dayDir, fileName)
        const content = buildTranscriptText(payload)

        const writeOk = await safeWriteFile(filePath, content, 'utf-8')
        if (!writeOk) {
          return { success: false, error: `写入文件失败：${filePath}` }
        }

        logger.system.info('[MeetingNotes] Transcript saved', {
          filePath,
          segments: payload.segments.length,
        })

        return { success: true, filePath, dirPath: dayDir }
      } catch (err) {
        logger.system.error('[MeetingNotes] Save transcript failed:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )

  // --------------------------------------------
  // 生成并保存 docx
  // --------------------------------------------
  safeIpcHandle(
    'meeting-notes:generate-docx',
    async (_event, payload: GenerateDocxPayload): Promise<GenerateDocxResult> => {
      try {
        const workspacePath = getWorkspacePath()
        if (!workspacePath) {
          return {
            success: false,
            error: '未打开工作区，请先在主窗口打开一个文件夹后再保存',
          }
        }

        if (!payload || !payload.minutes) {
          return { success: false, error: '无效的纪要数据' }
        }

        // 复用 save-transcript 的目录结构
        const date = payload.date || formatDate(new Date())
        const dayDir = path.join(workspacePath, '会议纪要', date)
        const dirOk = await ensureDirectory(dayDir)
        if (!dirOk) {
          return { success: false, error: `创建目录失败：${dayDir}` }
        }

        // 生成 docx buffer
        const buffer = await generateDocxBuffer(payload.minutes)
        if (!buffer) {
          return {
            success: false,
            error: 'Word 文档生成失败（docx 库未安装或生成异常）',
          }
        }

        // 落盘（docx 是二进制，直接用 fs 写）
        const fileName = `会议纪要_${formatTime(new Date(payload.startTime || Date.now()))}.docx`
        const filePath = path.join(dayDir, fileName)
        const { promises: fsPromises } = await import('fs')
        await fsPromises.writeFile(filePath, buffer)

        logger.system.info('[MeetingNotes] Docx saved', { filePath, bytes: buffer.length })

        return { success: true, filePath }
      } catch (err) {
        logger.system.error('[MeetingNotes] Generate docx failed:', err)
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        }
      }
    },
  )

  // --------------------------------------------
  // 整理进度推送（渲染层订阅，主进程预留推送能力）
  // --------------------------------------------
  // 当前整理逻辑在渲染层调用 LLM，主进程不主动推送；
  // 保留频道以备后续主进程整理方案。

  logger.system.info('[MeetingNotesIpc] Registered all handlers')
}

// ============================================
// 文本格式化辅助
// ============================================

/** 格式化日期为 YYYY-MM-DD */
function formatDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** 格式化时间为 HHmmss */
function formatTime(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

/** 格式化时间为 HH:mm:ss */
function formatTimeDisplay(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * 构建录音原文 txt 内容
 *
 * 格式：
 *   会议纪要 - 录音原文
 *   日期：YYYY-MM-DD
 *   时间：HH:mm:ss - HH:mm:ss
 *   参会人：xxx、xxx
 *
 *   [14:23:05] 我：
 *   原文：Hello everyone...
 *   译文：大家好...
 *
 *   [14:23:30] 环境音：
 *   (键盘敲击声)
 */
function buildTranscriptText(payload: SaveTranscriptPayload): string {
  const lines: string[] = []
  const date = payload.date || formatDate(new Date())
  const startStr = formatTimeDisplay(payload.startTime)
  const endStr = formatTimeDisplay(payload.endTime)

  lines.push('会议纪要 - 录音原文')
  lines.push(`日期：${date}`)
  lines.push(`时间：${startStr} - ${endStr}`)

  // 参会人（仅列出有发言记录的说话人）
  const speakerNames = (payload.speakers || [])
    .filter((s) => (s.segmentCount ?? 0) > 0)
    .map((s) => s.name)
  if (speakerNames.length > 0) {
    lines.push(`参会人：${speakerNames.join('、')}`)
  }
  lines.push('')
  lines.push('----------------------------------------')
  lines.push('')

  // 各段
  for (const seg of payload.segments) {
    const time = formatTimeDisplay(seg.startTime)
    const speakerName = seg.speakerName || '未知'

    lines.push(`[${time}] ${speakerName}：`)

    if (seg.isEnvironment) {
      lines.push(`(${seg.originalText || '环境音'})`)
    } else {
      if (seg.originalText) {
        lines.push(`原文：${seg.originalText}`)
      }
      if (seg.translatedText) {
        lines.push(`译文：${seg.translatedText}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

// 导出 ipcMain 以备未来扩展（避免 lint 未使用告警）
void ipcMain
