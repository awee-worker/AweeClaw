/**
 * 附件管理器 Hook
 * 负责图片/文件的添加、粘贴、拖放、压缩、保存等全生命周期管理
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import { api } from '../../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { BRAND } from '@shared/brand'
import { compressImage } from '@intelligence/utils/imageCompressor'
import { needsVisualAnalysis } from '@intelligence/utils/imageIntentDetector'
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
          setImages(prev => [
            ...prev,
            {
              id,
              file: new File([], fileName, { type: mimeType }),
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

  /** 粘贴事件处理 */
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData.items
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (file) addImage(file)
        }
      }
    },
    [addImage],
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
        const imageFiles = files.filter(f => f.type.startsWith('image/'))
        const otherFiles = files.filter(f => !f.type.startsWith('image/'))
        imageFiles.forEach(addImage)
        otherFiles.forEach(addImage)
        if (imageFiles.length > 0 || otherFiles.length > 0) return

        for (const file of files) {
          const filePath = (file as any).path
          if (filePath) {
            await addImageFromPath(filePath)
          }
        }
        return
      }

      const items = e.dataTransfer.items
      if (!items || items.length === 0) return

      let filePath: string | null = null
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind === 'string') {
          if (item.type === BRAND.dragDrop.fileMimeType) {
            filePath = await new Promise<string>(resolve => {
              item.getAsString(s => resolve(s))
            })
            break
          } else if (item.type === 'text/uri-list' && !filePath) {
            const uriList = await new Promise<string>(resolve => {
              item.getAsString(s => resolve(s))
            })
            const match = uriList.match(/file:\/\/\/(.+)/)
            if (match) {
              filePath = decodeURIComponent(match[1])
            }
          }
        }
      }

      if (filePath) {
        await addImageFromPath(filePath)
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

  /** 构建消息内容（处理图片压缩、文件保存等） */
  const buildMessageContent = useCallback(
    async (
      text: string,
    ): Promise<
      | string
      | Array<
          | { type: 'text'; text: string }
          | { type: 'image'; source: { type: 'base64'; media_type: string; data: string }; referenceOnly?: boolean; localPath?: string }
          | { type: 'file'; name: string; media_type: string; data: string }
        >
    > => {
      if (images.length === 0) return text

      const readyImages = images.filter(img => img.base64)
      if (readyImages.length !== images.length) return text

      const imageParts = readyImages.filter(img => img.isImage)
      const fileParts = readyImages.filter(img => !img.isImage)
      const uploadDir = workspacePath ? `${workspacePath}/${BRAND.dirName}/uploads` : null

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

      // 保存图片到工作空间
      const savedImagePaths: string[] = []
      if (imageParts.length > 0 && uploadDir) {
        for (const img of imageParts) {
          const timestamp = Date.now()
          const safeName = img.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const filePath = `${uploadDir}/${timestamp}_${safeName}`
          try {
            const saved = await api.file.writeBinary(filePath, img.base64!)
            if (saved) {
              savedImagePaths.push(filePath)
            } else {
              logger.agent.error('[AttachmentManager] Failed to save uploaded image:', filePath)
            }
          } catch (err) {
            logger.agent.error('[AttachmentManager] Failed to save uploaded image:', err)
          }
        }
      }

      // 保存非图片文件到工作空间
      const savedFilePaths: string[] = []
      if (fileParts.length > 0 && uploadDir) {
        for (const fileImg of fileParts) {
          const timestamp = Date.now()
          const safeName = fileImg.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
          const filePath = `${uploadDir}/${timestamp}_${safeName}`
          try {
            const saved = await api.file.writeBinary(filePath, fileImg.base64!)
            if (saved) {
              addContextItem({ type: 'File', uri: filePath })
              savedFilePaths.push(filePath)
            } else {
              logger.agent.error('[AttachmentManager] Failed to save uploaded file:', filePath)
            }
          } catch (err) {
            logger.agent.error('[AttachmentManager] Failed to save uploaded file:', err)
          }
        }
      }

      const userWantsAnalysis = needsVisualAnalysis(text.trim())

      const imageContentParts: Array<{
        type: 'image'
        source: { type: 'base64'; media_type: string; data: string }
        referenceOnly?: boolean
        localPath?: string
      }> = []

      for (let i = 0; i < imageParts.length; i++) {
        const img = imageParts[i]
        const localPath = savedImagePaths[i]
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
        })),
      ]
    },
    [images, workspacePath, addContextItem],
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
