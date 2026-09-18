/**
 * 附件管理器 Hook
 * 负责图片/文件的添加、粘贴、拖放、压缩、保存等全生命周期管理
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '../../../adapters/electronBridge'
import { localAttachmentsService } from '../../../adapters/localAttachmentsService'
import { logger } from '@toolkit/LogEngine'
import { BRAND } from '@shared/brand'
import { compressImage } from '@intelligence/utils/imageCompressor'
import { needsVisualAnalysis } from '@intelligence/utils/imageIntentDetector'
import { convertUriToPath, resolveUploadDir } from '@shared/toolkit/pathHelper'
import type { PendingAttachment } from '../../conversation'
import type { ContextItem } from '@intelligence/providerTypes'

interface UseAttachmentManagerParams {
  workspacePath: string | null
  addContextItem: (item: ContextItem) => void
}

interface ImageMimeTypeRegistry {
  [key: string]: string
}

const IMAGE_MIME_TYPES: ImageMimeTypeRegistry = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
}

/** 附件读取就绪的等待上限（ms）：FileReader 读取大图/大文件的兜底超时 */
const ATTACHMENT_READY_TIMEOUT_MS = 3000

/**
 * 等待附件 base64 就绪
 *
 * FileReader 是异步的，用户极快回车时附件的 base64 可能还没读完；
 * 直接退回纯文本会让图片/文件彻底丢失（AI 完全感知不到附件）。
 *
 * @returns 是否在超时前全部就绪
 */
async function waitForBase64(
  ref: { current: PendingAttachment[] },
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (ref.current.some(img => !img.base64)) {
    if (Date.now() >= deadline) return false
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return true
}

/**
 * 等待所有附件就绪，并返回「已就绪」的附件列表
 *
 * 调用方据此判断是否全部就绪：就绪数少于附件总数时，
 * 说明存在读取超时或读取失败的附件，上层退回纯文本而不是发送残缺内容。
 */
async function waitThenCollectReadyImages(
  ref: { current: PendingAttachment[] },
  timeoutMs: number = ATTACHMENT_READY_TIMEOUT_MS,
): Promise<PendingAttachment[]> {
  const allReady = await waitForBase64(ref, timeoutMs)
  if (!allReady) {
    logger.agent.warn('[AttachmentManager] Attachment base64 not ready before timeout:', {
      total: ref.current.length,
      pending: ref.current.filter(img => !img.base64).map(img => img.file.name),
    })
  }
  return ref.current.filter(img => img.base64)
}

export function useAttachmentManager({ workspacePath, addContextItem }: UseAttachmentManagerParams) {
  const [images, setImages] = useState<PendingAttachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const imagesRef = useRef(images)
  imagesRef.current = images

  // 组件卸载时释放所有未发送图片的 ObjectURL
  useEffect(() => {
    return () => {
      imagesRef.current.forEach(img => {
        if (img.previewUrl) URL.revokeObjectURL(img.previewUrl)
      })
    }
  }, [])

  /** 添加单个图片文件 */
  const addImage = useCallback(async (file: File) => {
    const id = crypto.randomUUID()
    const isImage = file.type.startsWith('image/')
    const previewUrl = isImage ? URL.createObjectURL(file) : undefined

    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      const base64 = result.split(',')[1]
      setImages(prev => prev.map(img => (img.id === id ? { ...img, base64 } : img)))
    }
    reader.readAsDataURL(file)

    setImages(prev => [...prev, { id, file, previewUrl, isImage }])
  }, [])

  /** 从文件路径读取并添加为附件 */
  const addImageFromPath = useCallback(
    async (path: string): Promise<boolean> => {
      try {
        const base64 = await api.file.readBinary(path)
        if (base64) {
          const ext = path.split('.').pop()?.toLowerCase() || 'png'
          const isImage = ext in IMAGE_MIME_TYPES
          const mimeType = IMAGE_MIME_TYPES[ext] || 'application/octet-stream'
          const dataUrl = `data:${mimeType};base64,${base64}`
          const fileName = path.split(/[/\\]/).pop() || 'file'
          const id = crypto.randomUUID()
          // 用真实字节构造 File：后续图片压缩依赖 file 内容，空 File 会压缩失败而被迫降级
          const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0))
          const file = new File([bytes], fileName, { type: mimeType })
          setImages(prev => [
            ...prev,
            {
              id,
              file,
              previewUrl: isImage ? dataUrl : undefined,
              base64,
              isImage,
            },
          ])
          return true
        }
      } catch (err) {
        logger.ui.error('Failed to load image:', err)
      }
      return false
    },
    [],
  )

  /**
   * 粘贴事件处理
   *
   * 三层检测策略：
   * 1. 同步：clipboardData.items 中的 file kind（图片 + Electron File.path 扩展）
   * 2. 同步：clipboardData.files（FileList，Electron 有时直接暴露）
   * 3. 异步：原生剪贴板 IPC（macOS Finder / Windows Explorer 复制的非图片文件）
   *
   * 对于第 3 层，先同步 preventDefault 阻止文件名文本插入，
   * 再异步 IPC 读取文件路径；若无文件则回退恢复文本。
   */
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items
      const pastedText = e.clipboardData.getData('text/plain')

      // ── 层 1：clipboardData.items 中的 file kind ──
      let handledFile = false
      for (const item of items) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (!file) continue

        if (file.type.startsWith('image/')) {
          // 图片：直接添加
          if (!handledFile) e.preventDefault()
          addImage(file)
          handledFile = true
        } else if ((file as any).path) {
          // Electron 扩展：非图片 File 对象附带 path 属性
          if (!handledFile) e.preventDefault()
          await addImageFromPath((file as any).path)
          handledFile = true
        }
      }
      if (handledFile) return

      // ── 层 2：clipboardData.files（FileList，Electron 有时直接暴露） ──
      const fileList = e.clipboardData.files
      if (fileList && fileList.length > 0) {
        let handledAny = false
        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i]
          const filePath = (file as any).path
          if (filePath) {
            if (!handledAny) e.preventDefault()
            await addImageFromPath(filePath)
            handledAny = true
          } else if (file.type.startsWith('image/')) {
            if (!handledAny) e.preventDefault()
            addImage(file)
            handledAny = true
          }
        }
        if (handledAny) return
      }

      // ── 层 3：原生剪贴板 IPC（macOS Finder / Windows Explorer 复制文件） ──
      // 当从 Finder/Explorer 复制非图片文件时，clipboardData 可能：
      // - macOS Finder：完全无 text/plain 数据（只有 public.file-url），pastedText 为空
      // - 部分 Windows 场景：仅含文件名文本
      // 因此在以下两种情况都触发 IPC 检测：
      //   a) pastedText 为空（macOS Finder 典型场景）
      //   b) pastedText 看起来像文件名（单行、短、非 URL）
      const looksLikeFilename =
        pastedText &&
        !pastedText.includes('\n') &&
        pastedText.length < 256 &&
        !pastedText.startsWith('http')

      // 无文本数据 或 文本像文件名 → 触发原生剪贴板检测
      const shouldCheckNativeClipboard = !pastedText || !!looksLikeFilename

      if (shouldCheckNativeClipboard) {
        // 同步 preventDefault 阻止文件名文本插入（或空文本的默认行为）
        e.preventDefault()

        try {
          // 直接读取文件附件数据（base64 + 元信息）
          // 使用专用 clipboard:getFileAttachments handler，绕过工作区安全检查
          // （用户主动粘贴是明确意图，不应被工作区边界限制）
          const attachments = await api.clipboard?.getFileAttachments?.()
          if (attachments && attachments.length > 0) {
            for (const att of attachments) {
              const id = crypto.randomUUID()
              const dataUrl = `data:${att.mimeType};base64,${att.base64}`
              setImages(prev => [
                ...prev,
                {
                  id,
                  file: new File([], att.name, { type: att.mimeType }),
                  previewUrl: att.isImage ? dataUrl : undefined,
                  base64: att.base64,
                  isImage: att.isImage,
                },
              ])
            }
            return // 文件已添加为附件，文本已被阻止
          }
        } catch (err) {
          logger.ui.warn('[AttachmentManager] Clipboard IPC failed:', err)
        }

        // 回退：未发现文件，恢复文本粘贴
        // execCommand('insertText') 在 Chromium/Electron 中可用，会触发 input 事件
        // pastedText 为空时无需恢复
        if (pastedText) {
          document.execCommand('insertText', false, pastedText)
        }
      }
    },
    [addImage, addImageFromPath],
  )

  /** 拖拽进入 */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  /** 拖拽离开 */
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = e.currentTarget.getBoundingClientRect()
    if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
      setIsDragging(false)
    }
  }, [])

  /** 拖放处理 */
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        let handled = false
        for (const file of files) {
          // Electron 拖拽的 File 带真实绝对路径：优先按路径读取。
          // 原因：macOS 下部分来源的 File.type 为空字符串，直接按 MIME 判断会把图片
          // 误判为非图片附件（丢失图片语义，也没有可引用的本地路径）。
          const filePath = (file as File & { path?: string }).path
          if (filePath) {
            handled = (await addImageFromPath(filePath)) || handled
          } else {
            addImage(file)
            handled = true
          }
        }
        if (handled) return
      }

      // 使用同步 getData() 读取拖拽数据，避免异步 getAsString() 在 await 后
      // 因 Chromium 清理 DataTransferItemList 导致自定义 MIME type 读取失败
      //
      // 优先级：
      // 1. 自定义 MIME type（应用内部文件树拖拽，携带原始绝对路径）
      // 2. text/uri-list（外部应用拖拽，如 Finder/Explorer/VS Code）

      // 1. 自定义 MIME type — 绝对路径，直接使用
      const customPath = e.dataTransfer.getData(BRAND.dragDrop.fileMimeType)
      if (customPath) {
        await addImageFromPath(customPath)
        return
      }

      // 2. text/uri-list — 需将 file:// URI 转换为本地路径
      //    注意：原 regex file:\/\/\/(.+) 会丢失 Unix 路径的前导斜杠，
      //    导致 path.resolve() 误判为相对路径，工作区边界校验失败。
      //    改用 convertUriToPath() 正确处理 file:/// → /path
      const uriList = e.dataTransfer.getData('text/uri-list')
      if (uriList) {
        // text/uri-list 可能多行，取第一行有效 URI（跳过 # 注释行）
        const uri = uriList
          .split(/\r?\n/)
          .map(l => l.trim())
          .find(l => l && !l.startsWith('#'))
        if (uri) {
          let filePath = convertUriToPath(uri)
          try {
            filePath = decodeURIComponent(filePath)
          } catch {
            // 路径中可能含有非百分号编码的 % 字符，解码失败时保留原始路径
          }
          if (filePath) {
            await addImageFromPath(filePath)
          }
        }
      }
    },
    [addImage, addImageFromPath],
  )

  /** 清空所有附件 */
  const clearImages = useCallback(() => {
    setImages(prev => {
      prev.forEach(img => {
        if (img.previewUrl) URL.revokeObjectURL(img.previewUrl)
      })
      return []
    })
  }, [])

  /**
   * 将附件落盘，返回本地绝对路径
   *
   * 路径解析顺序（核心目标：AI 必须拿到真实路径，不能"找不到图片"）：
   *   1. 工作区上传目录：{workspacePath}/.aweeclaw/uploads/
   *   2. 用户数据目录兜底：{userData}/.aweeclaw/uploads/（聊天窗口未打开工作区时；
   *      注意主进程 strictWorkspaceMode 下该目录在工作区外，仅"无工作区"场景可写入）
   *   3. 附件服务兜底：attachment:save（工作区/userData 由主进程解析，含 20 个上限）
   *
   * 全部失败才返回 null，此时上层会明确告知模型「路径不可用」而不是留空。
   */
  const persistAttachment = useCallback(async (
    img: PendingAttachment,
    uploadDir: string | null,
  ): Promise<string | null> => {
    if (!img.base64) return null

    const safeName = (img.file.name || `attachment_${img.id}`).replace(/[^a-zA-Z0-9._-]/g, '_')
    const fileName = `${Date.now()}_${safeName}`

    // 1. 工作区上传目录
    if (uploadDir) {
      const target = `${uploadDir}/${fileName}`
      try {
        if (await api.file.writeBinary(target, img.base64)) return target
        logger.agent.warn('[AttachmentManager] Workspace upload write failed, falling back:', target)
      } catch (err) {
        logger.agent.warn('[AttachmentManager] Workspace upload write error, falling back:', err)
      }
    }

    // 2. 用户数据目录兜底（无工作区场景）
    try {
      const userDataPath = await api.settings.getUserDataPath()
      if (userDataPath) {
        const fallbackDir = resolveUploadDir(userDataPath)
        await api.file.ensureDir(fallbackDir)
        const target = `${fallbackDir}/${fileName}`
        if (await api.file.writeBinary(target, img.base64)) return target
        logger.agent.warn('[AttachmentManager] userData upload write failed, falling back:', target)
      }
    } catch (err) {
      logger.agent.warn('[AttachmentManager] userData upload write error, falling back:', err)
    }

    // 3. 附件服务兜底（由主进程解析存储目录）
    try {
      const bytes = Uint8Array.from(atob(img.base64), c => c.charCodeAt(0))
      const mimeType = img.file.type || 'application/octet-stream'
      const blobFile = new File([bytes], safeName, { type: mimeType })
      const saved = await localAttachmentsService.upload('chat-uploads', [blobFile])
      if (saved[0]?.localPath) return saved[0].localPath
    } catch (err) {
      logger.agent.warn('[AttachmentManager] Attachment service write error:', err)
    }

    return null
  }, [])

  /** 构建消息内容（处理图片压缩、文件保存等） */
  const buildMessageContent = useCallback(
    async (
      text: string,
    ): Promise<
      | string
      | Array<
          | { type: 'text'; text: string }
          | { type: 'image'; source: { type: 'base64'; media_type: string; data: string }; referenceOnly?: boolean; localPath?: string; fileName?: string }
          | { type: 'file'; name: string; media_type: string; data: string; localPath?: string }
        >
    > => {
      if (images.length === 0) return text

      const readyImages = await waitThenCollectReadyImages(imagesRef)

      if (readyImages.length === 0) return text
      if (readyImages.length !== imagesRef.current.length) {
        logger.agent.warn('[AttachmentManager] Some attachments are not ready, sending text only:', {
          total: imagesRef.current.length,
          ready: readyImages.length,
        })
        return text
      }

      const imageParts = readyImages.filter(img => img.isImage)
      const fileParts = readyImages.filter(img => !img.isImage)
      // 上传目录：{workspacePath}/.aweeclaw/uploads（BRAND.paths.uploads 为唯一真相源）
      const uploadDir = workspacePath ? resolveUploadDir(workspacePath) : null

      if (uploadDir) {
        try {
          const dirCreated = await api.file.ensureDir(uploadDir)
          if (!dirCreated) {
            logger.agent.error('[AttachmentManager] Failed to create upload directory:', uploadDir)
          }
        } catch (err) {
          logger.agent.error('[AttachmentManager] Failed to create upload directory:', err)
        }
      }

      // 附件落盘：建立「附件 ID → 本地绝对路径」映射
      // 用 Map 而非并行数组下标，避免个别附件保存失败时路径与附件错位
      const pathByAttachmentId = new Map<string, string>()
      for (const img of readyImages) {
        const savedPath = await persistAttachment(img, uploadDir)
        if (savedPath) {
          pathByAttachmentId.set(img.id, savedPath)
        } else {
          logger.agent.error('[AttachmentManager] Failed to persist attachment:', img.file.name)
        }
      }

      // 非图片文件落盘成功时注册到上下文（保持原有行为）
      for (const fileImg of fileParts) {
        const savedPath = pathByAttachmentId.get(fileImg.id)
        if (savedPath) {
          addContextItem({ type: 'File', uri: savedPath, silent: true })
        }
      }

      const userWantsAnalysis = needsVisualAnalysis(text.trim())

      const imageContentParts: Array<{
        type: 'image'
        source: { type: 'base64'; media_type: string; data: string }
        referenceOnly?: boolean
        localPath?: string
        fileName?: string
      }> = []

      for (const img of imageParts) {
        const localPath = pathByAttachmentId.get(img.id)
        const shouldAnalyze = img.analyzeMode || userWantsAnalysis

        if (shouldAnalyze) {
          try {
            const compressed = await compressImage(img.file, {
              maxDimension: 1024,
              quality: 0.8,
            })
            imageContentParts.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: compressed.mimeType,
                data: compressed.base64,
              },
              localPath,
              fileName: img.file.name,
            })
            logger.agent.info('[AttachmentManager] Image compressed for analysis:', {
              name: img.file.name,
              originalSize: compressed.originalSize,
              compressedSize: compressed.compressedSize,
              ratio: `${Math.round((1 - compressed.compressedSize / compressed.originalSize) * 100)}%`,
            })
          } catch (err) {
            logger.agent.warn('[AttachmentManager] Image compression failed, falling back to reference mode:', err)
            imageContentParts.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: img.file.type,
                data: img.base64!,
              },
              referenceOnly: true,
              localPath,
              fileName: img.file.name,
            })
          }
        } else {
          imageContentParts.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: img.file.type,
              data: img.base64!,
            },
            referenceOnly: true,
            localPath,
            fileName: img.file.name,
          })
        }
      }

      return [
        { type: 'text', text: text.trim() },
        ...imageContentParts,
        ...fileParts.map(img => ({
          type: 'file' as const,
          name: img.file.name,
          media_type: img.file.type || 'application/octet-stream',
          data: img.base64!,
          localPath: pathByAttachmentId.get(img.id),
        })),
      ]
    },
    [images, workspacePath, addContextItem, persistAttachment],
  )

  /** 从恢复数据重建附件 */
  const restoreFromImages = useCallback(
    (restoredImages: Array<{ id: string; base64: string; mimeType: string }>) => {
      const restored: PendingAttachment[] = restoredImages.map(img => {
        const byteCharacters = atob(img.base64)
        const byteNumbers = new Array(byteCharacters.length)
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i)
        }
        const byteArray = new Uint8Array(byteNumbers)
        const blob = new Blob([byteArray], { type: img.mimeType })
        const isImage = img.mimeType.startsWith('image/')
        const file = new File([blob], `restored-${img.id}.${img.mimeType.split('/')[1] || 'bin'}`, { type: img.mimeType })
        const previewUrl = isImage ? URL.createObjectURL(blob) : undefined

        return {
          id: img.id,
          file,
          previewUrl,
          base64: img.base64,
          isImage,
        }
      })
      setImages(restored)
    },
    [],
  )

  return {
    images,
    setImages,
    isDragging,
    addImage,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    clearImages,
    buildMessageContent,
    restoreFromImages,
  }
}
