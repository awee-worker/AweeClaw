import React, { useState, useEffect, useRef } from 'react'
import { Image as ImageIcon } from 'lucide-react'

interface DeferredImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string
  alt?: string
  className?: string
  placeholderClassName?: string
  preloadMargin?: number
}

export const DeferredImage: React.FC<DeferredImageProps> = ({
  src,
  alt = '',
  className = '',
  placeholderClassName = '',
  preloadMargin = 100,
  ...rest
}) => {
  const [loaded, setLoaded] = useState(false)
  const [visible, setVisible] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const imgElRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const target = sentinelRef.current
    if (!target) return
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            io.disconnect()
          }
        }
      },
      { rootMargin: `${preloadMargin}px` },
    )
    io.observe(target)
    return () => io.disconnect()
  }, [preloadMargin])

  return (
    <div className={`relative overflow-hidden ${className}`} ref={sentinelRef}>
      {!loaded && (
        <div className={`absolute inset-0 flex items-center justify-center bg-surface-muted animate-pulse ${placeholderClassName}`}>
          <ImageIcon className="w-6 h-6 text-text-muted/75" />
        </div>
      )}
      {visible && (
        <img
          ref={imgElRef}
          src={src}
          alt={alt}
          className={`w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'} ${className}`}
          onLoad={() => setLoaded(true)}
          {...rest}
        />
      )}
    </div>
  )
}

export const LazyImage = DeferredImage
export default DeferredImage
