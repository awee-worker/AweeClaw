/**
 * 本地附件服务 — 本地优先架构（工作区级存储）
 *
 * 数据安全隐私原则：
 * - 附件文件优先存储到【工作区】根目录下的 .aweeclaw/attachments/{projectId}/
 *   （跟随工作区走：换工作区即换附件集，拷贝工作区即带走全部附件）
 * - 后端仅作为可选的跨设备同步兜底（当前未启用自动同步）
 * - AI 读取附件文本时优先从本地读取，无需请求后端
 *
 * 职责：
 * - 封装主进程 IPC 调用（attachment:save/list/delete/readText）
 * - File 对象转 base64（供 IPC 传输）
 * - 提供统一的附件操作接口，与后端 API 接口保持兼容
 */

import { api } from './electronBridge'
import type { LocalAttachmentItem } from './electronBridge'
import { logger } from '@shared/toolkit/LogEngine'

/**
 * 将 File 对象转为 base64 字符串
 *
 * 使用 FileReader 读取，适用于渲染进程。
 * 大文件可能产生较大的 base64 字符串，但有 20MB 大小限制保护。
 */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // 移除 data:xxx;base64, 前缀
      const base64 = result.includes(',') ? result.split(',')[1] : result
      resolve(base64)
    }
    reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`))
    reader.readAsDataURL(file)
  })
}

export const localAttachmentsService = {
  /**
   * 上传多个附件到本地存储
   *
   * 逐文件处理：File → base64 → IPC 保存 → 文本提取
   * 单文件失败不影响其他文件
   */
  async upload(
    projectId: string,
    files: File[],
  ): Promise<LocalAttachmentItem[]> {
    const results: LocalAttachmentItem[] = []
    const errors: string[] = []

    for (const file of files) {
      try {
        const base64Data = await fileToBase64(file)
        const item = await api.attachment.save({
          projectId,
          fileName: file.name,
          base64Data,
          mimeType: file.type || undefined,
        })
        results.push(item)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        errors.push(`${file.name}: ${msg}`)
        logger.file.warn(`[LocalAttachments] Upload failed for "${file.name}": ${msg}`)
      }
    }

    if (results.length === 0 && errors.length > 0) {
      throw new Error(errors.join('; '))
    }

    return results
  },

  /** 查询项目附件列表（本地） */
  async list(projectId: string): Promise<LocalAttachmentItem[]> {
    return api.attachment.list(projectId)
  },

  /** 删除附件（本地） */
  async remove(projectId: string, attachmentId: string): Promise<void> {
    return api.attachment.delete({ projectId, attachmentId })
  },

  /** 读取附件文本内容（供 AI 使用） */
  async readText(
    projectId: string,
    attachmentId: string,
  ): Promise<{ textContent: string | null; textTruncated: boolean; fileName: string }> {
    return api.attachment.readText({ projectId, attachmentId })
  },
}
