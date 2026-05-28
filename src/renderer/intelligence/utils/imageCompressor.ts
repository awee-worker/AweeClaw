/**
 * 图片压缩工具 - 用于分析模式下压缩图片，减少请求体体积
 * 使用 Canvas API 在渲染进程中完成压缩
 */

const DEFAULT_MAX_DIMENSION = 1024
const DEFAULT_QUALITY = 0.8
const TARGET_MIME_TYPE = 'image/jpeg'

export interface CompressOptions {
  maxDimension?: number
  quality?: number
}

export interface CompressResult {
  base64: string
  mimeType: string
  width: number
  height: number
  originalSize: number
  compressedSize: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

function calculateTargetDimensions(
  originalWidth: number,
  originalHeight: number,
  maxDimension: number
): { width: number; height: number } {
  if (originalWidth <= maxDimension && originalHeight <= maxDimension) {
    return { width: originalWidth, height: originalHeight }
  }

  const ratio = Math.min(maxDimension / originalWidth, maxDimension / originalHeight)
  return {
    width: Math.round(originalWidth * ratio),
    height: Math.round(originalHeight * ratio),
  }
}

export async function compressImage(
  file: File | Blob,
  options: CompressOptions = {}
): Promise<CompressResult> {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION
  const quality = options.quality ?? DEFAULT_QUALITY
  const originalSize = file.size

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await loadImage(objectUrl)
    const { width, height } = calculateTargetDimensions(
      img.naturalWidth,
      img.naturalHeight,
      maxDimension
    )

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context not available')

    ctx.drawImage(img, 0, 0, width, height)

    const dataUrl = canvas.toDataURL(TARGET_MIME_TYPE, quality)
    const base64 = dataUrl.split(',')[1]
    const compressedSize = Math.round((base64.length * 3) / 4)

    return {
      base64,
      mimeType: TARGET_MIME_TYPE,
      width,
      height,
      originalSize,
      compressedSize,
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export async function compressImageFromBase64(
  base64: string,
  mimeType: string,
  options: CompressOptions = {}
): Promise<CompressResult> {
  const dataUrl = `data:${mimeType};base64,${base64}`
  const img = await loadImage(dataUrl)

  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION
  const quality = options.quality ?? DEFAULT_QUALITY
  const originalSize = Math.round((base64.length * 3) / 4)

  const { width, height } = calculateTargetDimensions(
    img.naturalWidth,
    img.naturalHeight,
    maxDimension
  )

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D context not available')

  ctx.drawImage(img, 0, 0, width, height)

  const resultDataUrl = canvas.toDataURL(TARGET_MIME_TYPE, quality)
  const resultBase64 = resultDataUrl.split(',')[1]
  const compressedSize = Math.round((resultBase64.length * 3) / 4)

  return {
    base64: resultBase64,
    mimeType: TARGET_MIME_TYPE,
    width,
    height,
    originalSize,
    compressedSize,
  }
}

export function estimateBase64SizeMB(base64: string): number {
  return (base64.length * 3) / 4 / (1024 * 1024)
}
