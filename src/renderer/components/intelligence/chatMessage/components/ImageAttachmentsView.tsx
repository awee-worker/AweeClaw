/**
 * 图片附件视图
 * 展示用户消息附带的图片，支持点击预览
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

function ImageAttachmentsViewBase({ images }: ImageAttachmentsViewProps) {
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  if (!images || images.length === 0) return null

  return (
    <>
      <div className="flex flex-wrap gap-2 mb-2 justify-end">
        {images.map((img, i) => {
          const imgSrc = `data:${img.source.media_type};base64,${img.source.data}`
          return (
            <div
              key={`img-${img.source.media_type}-${i}`}
              onClick={() => setPreviewImage(imgSrc)}
              className="rounded-lg overflow-hidden border border-text-inverted/10 shadow-md h-28 max-w-[200px] group/img relative cursor-zoom-in hover:opacity-90 transition-opacity"
            >
              <LazyImage
                src={imgSrc}
                alt="Upload"
                className="h-full w-auto object-cover"
              />
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
