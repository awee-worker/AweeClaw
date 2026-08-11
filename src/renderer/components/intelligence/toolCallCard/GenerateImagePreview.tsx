/**
 * GenerateImage 工具预览渲染器
 *
 * 专为 design-image-gen 插件的 generate_image 工具设计，
 * 解析工具返回的 JSON（含 output_path），在聊天界面中渲染：
 *   1. 图片缩略图（限制最大高度，点击放大全屏预览）
 *   2. 元信息条（服务商、尺寸、耗时）
 *   3. 操作按钮（复制路径、在文件夹中显示）
 *
 * 图片加载使用 local-preview:// 自定义协议安全访问本地文件。
 */
import { useState, useMemo, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Copy, Check, Maximize2, FolderOpen, X, ImageIcon, AlertCircle } from 'lucide-react'
import { type Language } from '@renderer/i18n'
import type { ToolCall } from '@intelligence/providerTypes'
import { api } from '../../../adapters/electronBridge'
import { ExpandablePreviewContainer } from './ExpandablePreviewContainer'

/** generate_image 工具结果解析后的结构 */
interface ImageResult {
  success: boolean
  output_path?: string
  path?: string
  meta?: {
    provider?: string
    width?: number
    height?: number
    elapsedMs?: number
    ignoredCapabilities?: string[]
    [k: string]: unknown
  }
  error?: string
}

/** 支持的图片扩展名 */
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])

/** 判断文件是否为图片 */
function isImageFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase() || ''
  return IMAGE_EXTS.has(ext)
}

/** 将本地路径转为 local-preview:// 协议 URL */
function toLocalPreviewUrl(filePath: string): string {
  // local-preview:// 协议处理器会解码 pathname 并用 net.fetch 加载
  return `local-preview:///${encodeURIComponent(filePath).replace(/%2F/g, '/')}`
}

/**
 * 解析 generate_image 工具结果
 *
 * result 可能是：
 * - JSON 字符串 { success, output_path, meta }
 * - 纯文本（错误信息）
 */
function parseImageResult(result: string | undefined): ImageResult | null {
  if (!result) return null
  try {
    const parsed = JSON.parse(result)
    if (parsed && typeof parsed === 'object') {
      return parsed as ImageResult
    }
  } catch {
    // 非纯 JSON，尝试从文本中提取路径（兜底）
    const pathMatch = result.match(/([^\s"'<>]+\.(?:png|jpg|jpeg|webp|gif))/i)
    if (pathMatch) {
      return { success: true, output_path: pathMatch[1] }
    }
  }
  return null
}

/** 全屏图片预览 Lightbox */
function ImageLightbox({
  src,
  title,
  onClose,
}: {
  src: string
  title: string
  onClose: () => void
}) {
  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/95 backdrop-blur-lg p-8"
        onClick={onClose}
        style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <img
            src={src}
            alt={title}
            className="max-w-full max-h-[90vh] object-contain rounded-xl shadow-2xl"
          />
        </motion.div>
        <button
          onClick={onClose}
          className="absolute top-6 right-6 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 transition-all z-[100000]"
          aria-label="关闭"
        >
          <X className="w-5 h-5" />
        </button>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}

/**
 * generate_image 工具预览渲染器
 *
 * @param ctx - 预览上下文（与 previewRegistry 的 PreviewContext 一致）
 */
export function renderGenerateImage(ctx: {
  toolCall: ToolCall
  isRunning: boolean
  language: Language
}): React.ReactNode {
  const { toolCall, isRunning, language } = ctx
  const isZh = language === 'zh'
  const [isExpanded, setIsExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  // 解析工具结果
  const imageResult = useMemo(() => parseImageResult(toolCall.result), [toolCall.result])

  // 提取图片路径（output_path 优先，path 兜底）
  const imagePath = imageResult?.output_path || imageResult?.path || ''
  const imageUrl = useMemo(
    () => (imagePath ? toLocalPreviewUrl(imagePath) : ''),
    [imagePath],
  )

  // 图片加载失败状态
  const [loadError, setLoadError] = useState(false)

  const handleShowInFolder = useCallback(() => {
    if (imagePath) {
      api.file.showInFolder(imagePath)
    }
  }, [imagePath])

  const handleCopyPath = useCallback(() => {
    if (!imagePath) return
    navigator.clipboard.writeText(imagePath).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {
      // 剪贴板不可用时静默失败
    })
  }, [imagePath])

  // 运行中：显示等待骨架
  if (isRunning && !imageResult) {
    return (
      <ExpandablePreviewContainer language={language}>
        <div className="p-3 flex items-center gap-2 text-[12px] text-text-muted">
          <ImageIcon className="w-3.5 h-3.5 animate-pulse text-accent" />
          <span>{isZh ? '正在生成图片...' : 'Generating image...'}</span>
        </div>
        <div className="p-2 space-y-1.5 opacity-70">
          <div className="h-2 rounded-full bg-text-primary/[0.06] animate-pulse w-[72%]" />
          <div className="h-2 rounded-full bg-text-primary/[0.06] animate-pulse w-[48%]" />
        </div>
      </ExpandablePreviewContainer>
    )
  }

  // 失败：显示错误信息
  if (imageResult && !imageResult.success) {
    return (
      <div className="mt-1 p-2.5 rounded-lg bg-status-error/5 border border-status-error/20">
        <div className="flex items-center gap-1.5 text-[12px] text-status-error">
          <AlertCircle className="w-3.5 h-3.5" />
          <span className="font-medium">{isZh ? '生成失败' : 'Generation Failed'}</span>
        </div>
        {imageResult.error && (
          <p className="mt-1 text-[12px] text-text-muted leading-relaxed">{imageResult.error}</p>
        )}
      </div>
    )
  }

  // 无图片路径：降级为通用渲染
  if (!imagePath || !isImageFile(imagePath)) return null

  const meta = imageResult?.meta || {}
  const provider = meta.provider as string | undefined
  const elapsedMs = meta.elapsedMs as number | undefined

  return (
    <>
      <div className="mt-1 space-y-2">
        {/* 图片缩略图 */}
        <div className="relative group rounded-lg overflow-hidden border border-border/40 bg-bg-hover/20">
          {!loadError ? (
            <img
              src={imageUrl}
              alt={isZh ? '生成的图片' : 'Generated image'}
              className="w-full max-h-[200px] object-contain cursor-zoom-in transition-transform duration-200 group-hover:scale-[1.01]"
              onClick={() => setIsExpanded(true)}
              onError={() => setLoadError(true)}
              loading="lazy"
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-[120px] gap-1.5 text-text-muted">
              <AlertCircle className="w-5 h-5" />
              <span className="text-[12px]">{isZh ? '图片加载失败' : 'Image load failed'}</span>
              <span className="text-[12px] text-text-muted/60 truncate max-w-[300px]">{imagePath}</span>
            </div>
          )}

          {/* 悬浮放大按钮 */}
          {!loadError && (
            <button
              onClick={() => setIsExpanded(true)}
              className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/40 text-white opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/60"
              title={isZh ? '放大查看' : 'Zoom in'}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 元信息 + 操作按钮 */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          {/* 元信息 */}
          <div className="flex items-center gap-2 text-[12px] text-text-muted flex-wrap">
            {provider && (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-accent/60" />
                {provider}
              </span>
            )}
            {meta.width && meta.height && (
              <span>{meta.width}×{meta.height}</span>
            )}
            {typeof elapsedMs === 'number' && (
              <span>{(elapsedMs / 1000).toFixed(1)}s</span>
            )}
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center gap-1">
            <button
              onClick={handleCopyPath}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary transition-colors"
              title={isZh ? '复制路径' : 'Copy path'}
            >
              {copied ? (
                <Check className="w-3 h-3 text-green-400" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
            <button
              onClick={handleShowInFolder}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[12px] text-text-muted hover:bg-text-primary/[0.06] hover:text-text-primary transition-colors"
              title={isZh ? '在文件夹中显示' : 'Show in folder'}
            >
              <FolderOpen className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* 全屏预览 */}
      {isExpanded && (
        <ImageLightbox
          src={imageUrl}
          title={isZh ? '生成的图片' : 'Generated image'}
          onClose={() => setIsExpanded(false)}
        />
      )}
    </>
  )
}

export default renderGenerateImage
