/**
 * 项目附件本地存储桥接 — 本地优先架构（工作区级存储）
 *
 * 数据安全隐私原则：
 * - 附件文件优先存储到【工作区】根目录下的 .aweeclaw/attachments/{projectId}/
 *   （跟随工作区走：换工作区即换附件集，拷贝工作区即带走全部附件）
 * - 后端仅作为可选的跨设备同步兜底（当前未启用自动同步）
 * - AI 读取附件文本时优先从本地读取，无需请求后端
 *
 * 存储位置解析（优先级从高到低）：
 *   1. 当前窗口绑定的工作区根目录：{workspaceRoot}/.aweeclaw/attachments/{projectId}/
 *   2. 持久化的最近工作区：{lastWorkspaceRoot}/.aweeclaw/attachments/{projectId}/
 *   3. 兜底（无工作区时）：{userData}/.aweeclaw/attachments/{projectId}/
 *
 * 目录结构：
 *   - 文件本体：{projectId}/{fileName}
 *   - 元数据+文本：{projectId}/_meta.json
 *
 * IPC 接口：
 * - attachment:save     — 保存文件 + 提取文本 + 更新元数据
 * - attachment:list     — 读取本地附件列表
 * - attachment:delete   — 删除文件 + 更新元数据
 * - attachment:readText — 读取附件文本内容（供 AI 使用）
 */

import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs/promises'
import { BRAND } from '@shared/brand'
import { logger } from '@shared/toolkit/LogEngine'
import { safeIpcHandle } from '../core/ipcGuard'
import { extractDocument } from '../../guard/documentExtractor'

// ============================================
// 常量（限制值统一来自 BRAND.attachmentConfig，单一真相源）
// ============================================

/** 元数据文件名 */
const META_FILE_NAME = '_meta.json'

/** 文本内容截断阈值 */
const MAX_TEXT_CONTENT_LENGTH = BRAND.attachmentConfig.maxTextLength

/** 单文件大小上限 */
const MAX_FILE_SIZE = BRAND.attachmentConfig.maxFileSize

/** 单项目附件数量上限 */
const MAX_ATTACHMENTS_PER_PROJECT = BRAND.attachmentConfig.maxCount

/** 允许的文件扩展名（与渲染进程共用，避免前后端不一致） */
const ALLOWED_EXTENSIONS = new Set<string>(BRAND.attachmentConfig.allowedExtensions)

// ============================================
// 类型定义
// ============================================

/** 获取当前工作区根目录的函数（同步） */
export type WorkspaceRootGetter = () => string | null

/** 本地附件元数据 */
export interface LocalAttachmentItem {
  id: string
  projectId: string
  fileName: string
  fileSize: number
  mimeType: string
  textContent: string | null
  textTruncated: boolean
  hasText: boolean
  createdAt: string
  /** 本地文件绝对路径 */
  localPath: string
}

/** _meta.json 结构 */
interface AttachmentMetaFile {
  attachments: LocalAttachmentItem[]
}

// ============================================
// 工具函数
// ============================================

/**
 * 解析附件根目录（工作区优先，userData 兜底）
 *
 * 优先级：
 *   1. getWorkspaceRoot() 返回的当前工作区根 → {root}/.aweeclaw/attachments/
 *   2. 无工作区时回退到 userData → {userData}/.aweeclaw/attachments/
 *
 * 设计意图：附件跟随工作区走，保证数据归属与项目代码同目录，
 * 拷贝/迁移工作区时附件随行；仅在未打开任何工作区时才落userData。
 */
function getAttachmentsBaseDir(getWorkspaceRoot: WorkspaceRootGetter): string {
  const workspaceRoot = getWorkspaceRoot()
  if (workspaceRoot && workspaceRoot.trim() !== '') {
    return path.join(workspaceRoot, BRAND.dirName, 'attachments')
  }
  // 兜底：userData（无工作区场景，例如全局设置面板触发）
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, BRAND.dirName, 'attachments')
}

/** 获取项目附件目录 */
function getProjectDir(getWorkspaceRoot: WorkspaceRootGetter, projectId: string): string {
  return path.join(getAttachmentsBaseDir(getWorkspaceRoot), projectId)
}

/** 获取元数据文件路径 */
function getMetaFilePath(getWorkspaceRoot: WorkspaceRootGetter, projectId: string): string {
  return path.join(getProjectDir(getWorkspaceRoot, projectId), META_FILE_NAME)
}

/** 生成唯一 ID */
function generateId(): string {
  return `att-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 根据文件名推断 MIME 类型 */
function inferMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const mimeMap: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    md: 'text/markdown',
    csv: 'text/csv',
    json: 'application/json',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
  }
  return mimeMap[ext] || 'application/octet-stream'
}

/** 校验文件扩展名 */
function isAllowedFile(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  return ALLOWED_EXTENSIONS.has(ext)
}

/** 读取元数据文件 */
async function readMetaFile(getWorkspaceRoot: WorkspaceRootGetter, projectId: string): Promise<AttachmentMetaFile> {
  const metaPath = getMetaFilePath(getWorkspaceRoot, projectId)
  try {
    const content = await fs.readFile(metaPath, 'utf-8')
    return JSON.parse(content) as AttachmentMetaFile
  } catch {
    return { attachments: [] }
  }
}

/** 写入元数据文件 */
async function writeMetaFile(
  getWorkspaceRoot: WorkspaceRootGetter,
  projectId: string,
  meta: AttachmentMetaFile,
): Promise<void> {
  const projectDir = getProjectDir(getWorkspaceRoot, projectId)
  await fs.mkdir(projectDir, { recursive: true })
  const metaPath = getMetaFilePath(getWorkspaceRoot, projectId)
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
}

// ============================================
// IPC Handlers
// ============================================

/**
 * 注册项目附件 IPC handlers
 *
 * @param getWorkspaceRoot 获取当前工作区根目录的函数
 *   （参考 registerMainWindowScreenshotHandlers 的模式：
 *    优先窗口绑定工作区，兜底 lastWorkspaceSession）
 */
export function registerProjectAttachmentIpcHandlers(
  getWorkspaceRoot: WorkspaceRootGetter,
): void {
  /**
   * 保存附件
   *
   * 流程：
   * 1. 校验文件类型和大小
   * 2. 写入文件到 {workspaceRoot}/.aweeclaw/attachments/{projectId}/
   * 3. 调用 extractDocument 提取文本内容
   * 4. 更新 _meta.json
   * 5. 返回附件元数据
   */
  safeIpcHandle('attachment:save', async (
    _event,
    params: { projectId: string; fileName: string; base64Data: string; mimeType?: string },
  ): Promise<LocalAttachmentItem> => {
    const { projectId, fileName, base64Data, mimeType } = params

    // 1. 校验文件名
    if (!fileName || !isAllowedFile(fileName)) {
      throw new Error(`不支持的文件类型: ${fileName}`)
    }

    // 2. 解码 base64
    const buffer = Buffer.from(base64Data, 'base64')
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`文件超过 ${MAX_FILE_SIZE / (1024 * 1024)}MB 限制: ${fileName}`)
    }

    // 3. 校验附件数量上限
    const meta = await readMetaFile(getWorkspaceRoot, projectId)
    if (meta.attachments.length >= MAX_ATTACHMENTS_PER_PROJECT) {
      throw new Error(`附件数量已达上限（${MAX_ATTACHMENTS_PER_PROJECT} 个）`)
    }

    // 4. 确保目录存在（工作区优先）
    const projectDir = getProjectDir(getWorkspaceRoot, projectId)
    await fs.mkdir(projectDir, { recursive: true })

    // 5. 处理文件名冲突（同名文件加序号）
    let finalFileName = fileName
    let filePath = path.join(projectDir, finalFileName)
    if (await fs.access(filePath).then(() => true).catch(() => false)) {
      const ext = path.extname(fileName)
      const base = path.basename(fileName, ext)
      let seq = 1
      do {
        finalFileName = `${base} (${seq})${ext}`
        filePath = path.join(projectDir, finalFileName)
        seq++
      } while (await fs.access(filePath).then(() => true).catch(() => false))
    }

    // 6. 写入文件
    await fs.writeFile(filePath, buffer)
    logger.file.info(`[Attachment] Saved: ${finalFileName} (${buffer.length} bytes) -> ${projectDir}`)

    // 7. 提取文本内容（失败不阻断）
    let textContent: string | null = null
    let textTruncated = false
    try {
      const extractResult = await extractDocument(filePath)
      if (extractResult.success && extractResult.content) {
        if (extractResult.content.length > MAX_TEXT_CONTENT_LENGTH) {
          textContent = extractResult.content.slice(0, MAX_TEXT_CONTENT_LENGTH)
          textTruncated = true
        } else {
          textContent = extractResult.content
          textTruncated = extractResult.meta.truncated
        }
      }
    } catch (err) {
      logger.file.warn(`[Attachment] Text extraction failed for ${finalFileName}:`, err)
    }

    // 8. 构建元数据
    const item: LocalAttachmentItem = {
      id: generateId(),
      projectId,
      fileName: finalFileName,
      fileSize: buffer.length,
      mimeType: mimeType || inferMimeType(finalFileName),
      textContent,
      textTruncated,
      hasText: !!textContent,
      createdAt: new Date().toISOString(),
      localPath: filePath,
    }

    // 9. 更新 _meta.json
    meta.attachments.push(item)
    await writeMetaFile(getWorkspaceRoot, projectId, meta)

    logger.file.info(`[Attachment] Registered: ${item.id} (${finalFileName})`)
    return item
  })

  /**
   * 查询项目附件列表
   */
  safeIpcHandle('attachment:list', async (
    _event,
    projectId: string,
  ): Promise<LocalAttachmentItem[]> => {
    const meta = await readMetaFile(getWorkspaceRoot, projectId)
    return meta.attachments
  })

  /**
   * 删除附件
   *
   * 流程：删本地文件 → 更新 _meta.json
   */
  safeIpcHandle('attachment:delete', async (
    _event,
    params: { projectId: string; attachmentId: string },
  ): Promise<void> => {
    const { projectId, attachmentId } = params
    const meta = await readMetaFile(getWorkspaceRoot, projectId)

    const item = meta.attachments.find(a => a.id === attachmentId)
    if (!item) {
      throw new Error(`附件不存在: ${attachmentId}`)
    }

    // 删除文件
    try {
      await fs.unlink(item.localPath)
    } catch (err) {
      // 文件可能已被手动删除，仅记录日志
      logger.file.warn(`[Attachment] File delete failed (may already be removed): ${item.localPath}`, err)
    }

    // 更新 _meta.json
    meta.attachments = meta.attachments.filter(a => a.id !== attachmentId)
    await writeMetaFile(getWorkspaceRoot, projectId, meta)

    logger.file.info(`[Attachment] Deleted: ${attachmentId} (${item.fileName})`)
  })

  /**
   * 读取附件文本内容（供 AI 使用）
   */
  safeIpcHandle('attachment:readText', async (
    _event,
    params: { projectId: string; attachmentId: string },
  ): Promise<{ textContent: string | null; textTruncated: boolean; fileName: string }> => {
    const { projectId, attachmentId } = params
    const meta = await readMetaFile(getWorkspaceRoot, projectId)

    const item = meta.attachments.find(a => a.id === attachmentId)
    if (!item) {
      throw new Error(`附件不存在: ${attachmentId}`)
    }

    return {
      textContent: item.textContent,
      textTruncated: item.textTruncated,
      fileName: item.fileName,
    }
  })

  logger.ipc.info('[ProjectAttachments] IPC handlers registered (workspace-first storage)')
}
