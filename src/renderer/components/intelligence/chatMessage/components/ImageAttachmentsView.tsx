/**
 * 图片附件视图
 * 展示用户消息附带的图片，支持点击预览
 *
 * 布局策略：
 * - 1 张：大图展示，最大 240px
 * - 2 张：并排，各 160px
 * - 3 张：1 大 2 小
 * - 4+ 张：网格，每张 120px
 */
import React, { useState } from 'react'
import { LazyImage } from '../../../foundation/DeferredImage'
import { OverlayDialog } from '../../../ui/OverlayDialog'

interface ImageAttachment {
  source: {
    media_type: string
    data: string
  }
}

interface ImageAttachmentsViewProps {
  images: ImageAttachment[]
}

/** 根据图片数量返回容器类名 */
function getGridClassName(count: number): string {
  if (count === 1) return 'grid grid-cols-1 gap-1.5'
  if (count === 2) return 'grid grid-cols-2 gap-1.5'
  if (count === 3) return 'grid grid-cols-2 gap-1.5'
  return 'grid grid-cols-3 gap-1.5'
}

/** 根据图片数量返回单张图片容器类名 */
function getItemClassName(count: number, index: number): string {
  if (count === 1) return 'h-40 max-w-[240px]'
  if (count === 2) return 'h-32 w-full'
  if (count === 3) return index === 0 ? 'h-40 col-span-2' : 'h-20'
  return 'h-24 w-full'
}

function ImageAttachmentsViewBase({ images }: ImageAttachmentsViewProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  if (!images || images.length === 0) return null

  const gridClassName = getGridClassName(images.length)

  return (
    <>
      <div className={`${gridClassName} max-w-[360px]`}>
        {images.map((img, i) => {
          const imgSrc = `data:${img.source.media_type};base64,${img.source.data}`
          const itemClassName = getItemClassName(images.length, i)
          return (
            <div
              key={`img-${img.source.media_type}-${i}`}
              onClick={() => setPreviewImage(imgSrc)}
              className={`relative rounded-xl overflow-hidden border border-text-inverted/10 shadow-sm cursor-zoom-in hover:opacity-90 transition-opacity group/img ${itemClassName}`}
            >
              <LazyImage
                src={imgSrc}
                alt="Upload"
                className="h-full w-full object-cover"
              />
              {/* 悬浮遮罩，增加视觉层次 */}
              <div className="absolute inset-0 bg-black/0 group-hover/img:bg-black/10 transition-colors" />
            </div>
          )
        })}
      </div>

      <OverlayDialog isOpen={!!previewImage} onClose={() => setPreviewImage(null)} size="full" noPadding showCloseButton={false}>
        <div
          className="w-full h-full flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 cursor-zoom-out"
          onClick={() => setPreviewImage(null)}
        >
          {previewImage && (
            <img
              src={previewImage}
              alt="Preview"
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            />
          )}
        </div>
      </OverlayDialog>
    </>
  )
}

export const ImageAttachmentsView = React.memo(ImageAttachmentsViewBase)
ImageAttachmentsView.displayName = 'ImageAttachmentsView'
