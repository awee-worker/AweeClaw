/**
 * 文件预览组件
 * 支持 Markdown 预览、图片显示、不支持文件类型提示
 */
import { api } from '../../adapters/electronBridge'
import { openUrlInBrowser } from '@utils/browserLauncher'
import { logger } from '@toolkit/LogEngine'
import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import { CodeHighlight } from '../intelligence/CodeHighlight'
import { Eye, Edit, FileQuestion, Image as ImageIcon, AlertTriangle, Columns, Download, ExternalLink } from 'lucide-react'
import { ActionButton } from '../ui'
import { getFileName } from '@shared/toolkit/pathHelper'
import { useStore } from '@store'
import { themeManager } from '../../config/themeDefinition'
import {t, type Language} from '@renderer/i18n'

// 文件类型分类
const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico']
const VIDEO_EXTENSIONS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'ogv', '3gp']
const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdx']
const HTML_EXTENSIONS = ['html', 'htm']
const PDF_EXTENSIONS = ['pdf']
const DOCX_EXTENSIONS = ['docx']
const DOC_EXTENSIONS = ['doc']
const PPTX_EXTENSIONS = ['pptx']
const PPT_EXTENSIONS = ['ppt']
const XLSX_EXTENSIONS = ['xlsx', 'xls']
const CSV_EXTENSIONS = ['csv', 'tsv']
const BINARY_EXTENSIONS = ['exe', 'dll', 'so', 'dylib', 'bin', 'zip', 'tar', 'gz', 'rar', '7z', 'mp3', 'wav', 'flac', 'psd', 'ai', 'sketch']
// 3D 模型文件扩展名（GLB 自包含纹理，glTF 需要外部 .bin/.png）
const MODEL_3D_EXTENSIONS = ['glb', 'gltf']

export type FileType = 'text' | 'markdown' | 'image' | 'video' | 'html' | 'pdf' | 'docx' | 'doc' | 'pptx' | 'ppt' | 'xlsx' | 'csv' | 'binary' | 'model3d' | 'unknown'

export function getFileType(path: string): FileType {
    const ext = path.split('.').pop()?.toLowerCase() || ''

    if (IMAGE_EXTENSIONS.includes(ext)) return 'image'
    if (VIDEO_EXTENSIONS.includes(ext)) return 'video'
    if (MARKDOWN_EXTENSIONS.includes(ext)) return 'markdown'
    if (HTML_EXTENSIONS.includes(ext)) return 'html'
    if (PDF_EXTENSIONS.includes(ext)) return 'pdf'
    if (DOCX_EXTENSIONS.includes(ext)) return 'docx'
    if (DOC_EXTENSIONS.includes(ext)) return 'doc'
    if (PPTX_EXTENSIONS.includes(ext)) return 'pptx'
    if (PPT_EXTENSIONS.includes(ext)) return 'ppt'
    if (XLSX_EXTENSIONS.includes(ext)) return 'xlsx'
    if (CSV_EXTENSIONS.includes(ext)) return 'csv'
    if (MODEL_3D_EXTENSIONS.includes(ext)) return 'model3d'
    if (BINARY_EXTENSIONS.includes(ext)) return 'binary'

    return 'text'
}

export function isPreviewableFile(path: string): boolean {
    const type = getFileType(path)
    return type === 'markdown' || type === 'image' || type === 'video' || type === 'pdf' || type === 'docx' || type === 'doc' || type === 'pptx' || type === 'ppt' || type === 'xlsx' || type === 'csv' || type === 'model3d'
}

/**
 * 将本地文件路径转为 local-preview:// 协议 URL
 *
 * local-preview:// 是主进程注册的 privileged scheme（stream:true, bypassCSP:true），
 * handler 用 net.fetch('file://...') 在主进程内读取，支持 HTTP Range 请求，
 * 可直接喂给 <video src> / <img src>，支持 seek 和流式播放。
 *
 * 与 GenerateImagePreview.tsx 中的 toLocalPreviewUrl 保持一致
 */
function toLocalPreviewUrl(filePath: string): string {
    return `local-preview:///${encodeURIComponent(filePath).replace(/%2F/g, '/')}`
}

export function isBinaryFile(path: string): boolean {
    return getFileType(path) === 'binary'
}

// ===== Markdown 预览组件 =====

interface MarkdownPreviewProps {
    content: string
    fontSize?: number
    isStreaming?: boolean
}

export function MarkdownPreview({ content, fontSize = 14, isStreaming }: MarkdownPreviewProps) {
    const currentTheme = useStore(s => s.currentTheme)
    const theme = themeManager.getThemeById(currentTheme)
    const isLight = theme?.type === 'light'
    const containerRef = useRef<HTMLDivElement>(null)
    const isUserScrollingRef = useRef(false)
    const lastContentLengthRef = useRef(0)
    const autoScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
    const recentGrowthCountRef = useRef(0)
    const growthWindowRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleScroll = useCallback(() => {
        const el = containerRef.current
        if (!el) return
        const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
        isUserScrollingRef.current = distanceFromBottom > 80
    }, [])

    useEffect(() => {
        const contentGrew = content.length > lastContentLengthRef.current
        lastContentLengthRef.current = content.length

        if (!contentGrew) return

        const shouldAutoScroll = isStreaming === true || recentGrowthCountRef.current >= 3
        if (!shouldAutoScroll) {
            recentGrowthCountRef.current++
            if (growthWindowRef.current) clearTimeout(growthWindowRef.current)
            growthWindowRef.current = setTimeout(() => {
                recentGrowthCountRef.current = 0
            }, 2000)
            return
        }

        if (isUserScrollingRef.current) return

        if (autoScrollTimerRef.current) clearTimeout(autoScrollTimerRef.current)
        autoScrollTimerRef.current = setTimeout(() => {
            if (containerRef.current && !isUserScrollingRef.current) {
                containerRef.current.scrollTo({
                    top: containerRef.current.scrollHeight,
                    behavior: 'smooth',
                })
            }
        }, 60)
    }, [content, isStreaming])

    useEffect(() => {
        if (isStreaming === false) {
            isUserScrollingRef.current = false
            recentGrowthCountRef.current = 0
        }
    }, [isStreaming])

    useEffect(() => {
        return () => {
            if (autoScrollTimerRef.current) clearTimeout(autoScrollTimerRef.current)
            if (growthWindowRef.current) clearTimeout(growthWindowRef.current)
        }
    }, [])

    return (
        <div
            ref={containerRef}
            className="absolute inset-0 overflow-y-auto p-6 bg-background-editor-editor custom-scrollbar"
            style={{ fontSize: `${fontSize}px` }}
            onScroll={handleScroll}
        >
            <div className={`w-full prose ${isLight ? '' : 'prose-invert'}`}>
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                    components={{
                        code({ className, children, node, ...props }) {
                            const match = /language-(\w+)/.exec(className || '')
                            const codeContent = String(children)
                            const isInline = !match && !codeContent.includes('\n')

                            return isInline ? (
                                <code className="bg-white/10 px-1.5 py-0.5 rounded text-accent-light font-mono text-[0.9em]" {...props}>
                                    {children}
                                </code>
                            ) : (
                                <CodeHighlight
                                    code={String(children).replace(/\n$/, '')}
                                    language={match?.[1] || 'text'}
                                    isDark={!isLight}
                                    fontSize={fontSize}
                                />
                            )
                        },
                        h1: ({ children }) => <h1 className="text-2xl font-bold mt-8 mb-4 text-text-primary border-b border-border pb-2">{children}</h1>,
                        h2: ({ children }) => <h2 className="text-xl font-bold mt-6 mb-3 text-text-primary">{children}</h2>,
                        h3: ({ children }) => <h3 className="text-lg font-semibold mt-4 mb-2 text-text-primary">{children}</h3>,
                        p: ({ children }) => <p className="mb-4 text-text-secondary leading-relaxed">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-6 mb-4 space-y-1 text-text-secondary">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-6 mb-4 space-y-1 text-text-secondary">{children}</ol>,
                        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                        a: ({ href, children }) => {
                            const cleanHref = href ? href.replace(/[*_~`#|]+$/g, '').replace(/^[*_~`#|]+/g, '').trim() : href
                            return (
                                <a href={cleanHref} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline"
                                    onClick={(e) => { e.preventDefault(); if (cleanHref) openUrlInBrowser(cleanHref) }}
                                >
                                    {children}
                                </a>
                            )
                        },
                        blockquote: ({ children }) => (
                            <blockquote className="border-l-4 border-accent/50 pl-4 my-4 text-text-muted italic bg-white/5 py-2 rounded-r">
                                {children}
                            </blockquote>
                        ),
                        table: ({ children }) => (
                            <div className="overflow-x-auto my-4">
                                <table className="min-w-full border-collapse border border-border">{children}</table>
                            </div>
                        ),
                        thead: ({ children }) => <thead className="bg-surface/50">{children}</thead>,
                        tbody: ({ children }) => <tbody>{children}</tbody>,
                        tr: ({ children }) => <tr className="border-b border-border hover:bg-white/5 transition-colors">{children}</tr>,
                        th: ({ children }) => <th className="border border-border px-4 py-2 bg-surface/50 text-left font-semibold">{children}</th>,
                        td: ({ children }) => <td className="border border-border px-4 py-2">{children}</td>,
                        img: ({ src, alt }) => (
                            <img src={src} alt={alt} className="max-w-full rounded-lg border border-border my-4" />
                        ),
                        hr: () => <hr className="border-border my-6" />,
                    }}
                >
                    {content}
                </ReactMarkdown>
            </div>
        </div>
    )
}

// ===== 图片预览组件 =====

interface ImagePreviewProps {
    path: string
}

export function ImagePreview({ path }: ImagePreviewProps) {
    const language = useStore(s => s.language)
    const [error, setError] = useState(false)
    const [zoom, setZoom] = useState<number | 'fit'>('fit') // 默认自适应
    const [imageSrc, setImageSrc] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const containerRef = useRef<HTMLDivElement>(null)
    const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)

    // 拖动状态
    const [position, setPosition] = useState({ x: 0, y: 0 })
    const isDraggingRef = useRef(false)
    const dragStart = useRef({ x: 0, y: 0 })

    // 使用 Electron API 读取图片为 base64
    useEffect(() => {
        const loadImage = async () => {
            try {
                setLoading(true)
                setZoom('fit') // 重置为自适应
                setPosition({ x: 0, y: 0 }) // 重置位置
                // 读取文件为 base64 (已经是 base64 编码)
                const base64 = await api.file.readBinary(path)
                if (base64) {
                    // 检测图片类型
                    const ext = path.split('.').pop()?.toLowerCase() || 'png'
                    const mimeTypes: Record<string, string> = {
                        png: 'image/png',
                        jpg: 'image/jpeg',
                        jpeg: 'image/jpeg',
                        gif: 'image/gif',
                        webp: 'image/webp',
                        svg: 'image/svg+xml',
                        bmp: 'image/bmp',
                        ico: 'image/x-icon',
                    }
                    const mimeType = mimeTypes[ext] || 'image/png'
                    setImageSrc(`data:${mimeType};base64,${base64}`)
                } else {
                    setError(true)
                }
            } catch (e) {
                logger.file.error('Failed to load image:', e)
                setError(true)
            } finally {
                setLoading(false)
            }
        }
        loadImage()
    }, [path])

    // 计算自适应缩放比例
    const fitScale = useMemo(() => {
        if (!containerRef.current || !imageSize) return 1
        const container = containerRef.current
        const containerWidth = container.clientWidth - 32 // padding
        const containerHeight = container.clientHeight - 32
        const scaleX = containerWidth / imageSize.width
        const scaleY = containerHeight / imageSize.height
        return Math.min(scaleX, scaleY, 1) // 不超过 100%
    }, [imageSize])

    const actualZoom = zoom === 'fit' ? fitScale : zoom
    const displayZoom = zoom === 'fit' ? Math.round(fitScale * 100) : Math.round(zoom * 100)

    // 拖动处理
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        if (zoom === 'fit') return // 自适应模式不需要拖动
        e.preventDefault()
        isDraggingRef.current = true
        dragStart.current = { x: e.clientX - position.x, y: e.clientY - position.y }
    }, [zoom, position])

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDraggingRef.current) return
        e.preventDefault()
        setPosition({
            x: e.clientX - dragStart.current.x,
            y: e.clientY - dragStart.current.y
        })
    }, [])

    const handleMouseUp = useCallback(() => {
        isDraggingRef.current = false
    }, [])

    // 切换缩放时重置位置
    const handleZoomChange = useCallback((newZoom: number | 'fit') => {
        setZoom(newZoom)
        if (newZoom === 'fit') {
            setPosition({ x: 0, y: 0 })
        }
    }, [])

    // 滚轮缩放
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault()
        const delta = e.deltaY > 0 ? -0.1 : 0.1
        setZoom(z => {
            const current = z === 'fit' ? fitScale : z
            const newZoom = Math.max(0.1, Math.min(5, current + delta))
            return newZoom
        })
    }, [fitScale])

    if (error) {
        return (
            <div className="h-full flex items-center justify-center bg-background-editor">
                <div className="text-center p-8">
                    <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-text-primary mb-2">{t('filePreview.cannotLoadImage', language)}</h3>
                    <p className="text-sm text-text-muted">{path}</p>
                </div>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-background-editor">
                <div className="text-text-muted">{t('settings.loadingSettings', language)}</div>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col bg-background-editor">
            {/* 工具栏 */}
            <div className="flex-shrink-0 flex items-center justify-center gap-2 p-2 border-b border-border bg-surface/50">
                <ActionButton
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        const current = zoom === 'fit' ? fitScale : zoom
                        handleZoomChange(Math.max(0.1, current - 0.25))
                    }}
                    className="h-7 px-2 text-xs"
                >
                    −
                </ActionButton>
                <span className="text-xs text-text-muted w-16 text-center">{displayZoom}%</span>
                <ActionButton
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                        const current = zoom === 'fit' ? fitScale : zoom
                        handleZoomChange(Math.min(5, current + 0.25))
                    }}
                    className="h-7 px-2 text-xs"
                >
                    +
                </ActionButton>
                <ActionButton
                    variant="ghost"
                    size="sm"
                    onClick={() => handleZoomChange('fit')}
                    className={`h-7 px-2 text-xs ${zoom === 'fit' ? 'bg-accent/20 text-accent' : ''}`}
                >
                    {t('filePreview.fit', language)}
                </ActionButton>
                <ActionButton
                    variant="ghost"
                    size="sm"
                    onClick={() => handleZoomChange(1)}
                    className={`h-7 px-2 text-xs ${zoom === 1 ? 'bg-accent/20 text-accent' : ''}`}
                >
                    100%
                </ActionButton>
            </div>

            {/* 图片显示 */}
            <div
                ref={containerRef}
                className={`flex-1 overflow-hidden flex items-center justify-center p-4 ${zoom !== 'fit' ? 'cursor-grab active:cursor-grabbing' : ''}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                onWheel={handleWheel}
            >
                {imageSrc && (
                    <img
                        src={imageSrc}
                        alt={getFileName(path)}
                        className="max-w-none select-none pointer-events-none"
                        draggable={false}
                        style={{
                            transform: `translate(${position.x}px, ${position.y}px) scale(${actualZoom})`,
                            transformOrigin: 'center'
                        }}
                        onLoad={(e) => {
                            const img = e.currentTarget
                            setImageSize({ width: img.naturalWidth, height: img.naturalHeight })
                        }}
                        onError={() => setError(true)}
                    />
                )}
            </div>
        </div>
    )
}

// ===== 视频预览组件 =====

interface VideoPreviewProps {
    path: string
}

/** 转码状态 */
type TranscodeState = 'idle' | 'probing' | 'transcoding' | 'done' | 'error'

/**
 * 执行转码的辅助函数（共用逻辑）
 *
 * 返回转码后的文件 URL，失败时抛出异常。
 */
async function doTranscode(
    filePath: string,
    language: string,
    onProgress: (percent: number, info: string) => void,
    setTranscodeState: (s: TranscodeState) => void,
): Promise<string> {
    logger.file.info(`[VideoPreview] Transcoding: ${filePath}`)
    setTranscodeState('transcoding')
    onProgress(0, language === 'zh' ? '正在转码...' : 'Transcoding...')

    const result = await api.videoTranscode.transcode(filePath)
    logger.file.info(`[VideoPreview] Transcode done: ${result.outputPath} ` +
        `(fromCache=${result.fromCache}, ${result.elapsedMs}ms)`)
    setTranscodeState('done')
    return toLocalPreviewUrl(result.outputPath)
}

/**
 * 视频预览组件
 *
 * 工作流程（三重保障，确保最终能播放）：
 *
 * 1. 【probe 路径】检查文件存在 → ffmpeg probe 探测编码
 *    - Chromium 支持（H.264/VP8/VP9/AV1）→ 直接播放
 *    - Chromium 不支持（H.265/HEVC 等）→ 转码后播放
 *
 * 2. 【fallback 路径】probe 失败（ffmpeg 异常等）→ 尝试直接播放
 *    - 播放成功 → 正常显示
 *    - 播放失败（onError, MEDIA_ERR_SRC_NOT_SUPPORTED）→ 自动触发转码
 *
 * 3. 【转码兜底】转码后播放 → 成功则显示"已转码"标签
 *
 * 转码特性：
 * - 显示转码进度条
 * - 转码结果缓存到 os.tmpdir()/aweeclaw-video-cache/
 * - 重复播放同一文件时命中缓存，无需再次转码
 * - 支持取消转码
 */
export function VideoPreview({ path }: VideoPreviewProps) {
    const language = useStore(s => s.language)
    const [error, setError] = useState(false)
    const [errorMsg, setErrorMsg] = useState<string>('')
    const [loading, setLoading] = useState(true)
    const [videoUrl, setVideoUrl] = useState<string | null>(null)
    const [transcodeState, setTranscodeState] = useState<TranscodeState>('idle')
    const [transcodeProgress, setTranscodeProgress] = useState(0)
    const [transcodeInfo, setTranscodeInfo] = useState<string>('')
    const videoRef = useRef<HTMLVideoElement>(null)
    const unsubscribeProgressRef = useRef<(() => void) | null>(null)
    // 标记是否已经尝试过转码（避免 onError 死循环）
    const transcodeAttemptedRef = useRef(false)

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        setError(false)
        setErrorMsg('')
        setVideoUrl(null)
        setTranscodeState('idle')
        setTranscodeProgress(0)
        transcodeAttemptedRef.current = false

        // 订阅转码进度
        unsubscribeProgressRef.current = api.videoTranscode.onProgress((payload) => {
            if (payload.filePath !== path || cancelled) return
            setTranscodeProgress(payload.percent)
            if (payload.speed) {
                setTranscodeInfo(`${payload.percent.toFixed(0)}% · ${payload.speed}`)
            } else {
                setTranscodeInfo(`${payload.percent.toFixed(0)}%`)
            }
        })

        // 先检查文件是否存在
        api.file.exists(path).then(async (exists) => {
            if (cancelled) return
            if (!exists) {
                logger.file.error(`[VideoPreview] File not found: ${path}`)
                setErrorMsg('File not found')
                setError(true)
                setLoading(false)
                return
            }

            try {
                // 探测视频编码
                setTranscodeState('probing')
                logger.file.info(`[VideoPreview] Probing: ${path}`)
                const probe = await api.videoTranscode.probe(path)
                if (cancelled) return

                logger.file.info(`[VideoPreview] Probe result: codec=${probe.videoCodec}, ` +
                    `${probe.width}x${probe.height}, duration=${probe.duration}s, format=${probe.format}`)

                // 判断 Chromium 是否支持
                const { supported, reason } = await api.videoTranscode.isSupported(probe)
                if (cancelled) return

                if (supported) {
                    // 直接播放
                    logger.file.info(`[VideoPreview] Codec supported, playing directly: ${path}`)
                    setVideoUrl(toLocalPreviewUrl(path))
                    setTranscodeState('idle')
                    setLoading(false)
                } else {
                    // 不支持 → 转码
                    logger.file.info(`[VideoPreview] Codec not supported (${reason}), transcoding: ${path}`)
                    setLoading(false)
                    try {
                        const url = await doTranscode(path, language,
                            (p, info) => { setTranscodeProgress(p); setTranscodeInfo(info) },
                            setTranscodeState)
                        if (cancelled) return
                        setVideoUrl(url)
                    } catch (e) {
                        if (cancelled) return
                        logger.file.error(`[VideoPreview] Transcode failed:`, e)
                        setErrorMsg(language === 'zh'
                            ? `转码失败: ${(e as Error).message}`
                            : `Transcode failed: ${(e as Error).message}`)
                        setError(true)
                        setTranscodeState('error')
                    }
                }
            } catch (e) {
                if (cancelled) return
                // probe 失败 → 尝试直接播放，播放失败时由 onError 触发转码
                logger.file.warn('[VideoPreview] Probe failed, trying direct playback:', e)
                setVideoUrl(toLocalPreviewUrl(path))
                setTranscodeState('idle')
                setLoading(false)
            }
        }).catch((e) => {
            if (cancelled) return
            logger.file.error('[VideoPreview] Failed to check file existence:', e)
            setErrorMsg(String(e))
            setError(true)
            setLoading(false)
        })

        return () => {
            cancelled = true
            if (unsubscribeProgressRef.current) {
                unsubscribeProgressRef.current()
                unsubscribeProgressRef.current = null
            }
        }
    }, [path, language])

    const handleDownload = useCallback(() => {
        api.file.showInFolder?.(path)
    }, [path])

    // 使用系统默认程序打开（通过 desktop:openFile IPC 通道）
    const handleOpenExternal = useCallback(async () => {
        try {
            await api.desktop.openFile(path)
        } catch (e) {
            logger.file.error('[VideoPreview] Failed to open with default app:', e)
        }
    }, [path])

    const handleCancelTranscode = useCallback(() => {
        api.videoTranscode.cancel(path)
        setTranscodeState('error')
        setErrorMsg(language === 'zh' ? '转码已取消' : 'Transcode cancelled')
        setError(true)
    }, [path, language])

    /**
     * 视频播放错误处理
     *
     * 如果尚未尝试过转码，自动触发转码作为兜底；
     * 如果已经转码过仍然失败，显示错误界面。
     */
    const handleVideoError = useCallback(async (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const video = e.currentTarget
        const errorObj = video.error
        const code = errorObj?.code
        const codeMap: Record<number, string> = {
            1: 'MEDIA_ERR_ABORTED',
            2: 'MEDIA_ERR_NETWORK',
            3: 'MEDIA_ERR_DECODE',
            4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
        }
        const codeName = code ? codeMap[code] || `code=${code}` : 'unknown'
        logger.file.error(`[VideoPreview] Video playback error: ${codeName}, url=${videoUrl}, path=${path}`)

        // 如果是编码不支持，且尚未尝试过转码 → 自动转码
        if ((code === 4 || code === 3) && !transcodeAttemptedRef.current) {
            transcodeAttemptedRef.current = true
            logger.file.info('[VideoPreview] Auto-transcoding due to playback error')
            setVideoUrl(null)
            try {
                const url = await doTranscode(path, language,
                    (p, info) => { setTranscodeProgress(p); setTranscodeInfo(info) },
                    setTranscodeState)
                setVideoUrl(url)
            } catch (transcodeErr) {
                logger.file.error('[VideoPreview] Auto-transcode failed:', transcodeErr)
                setErrorMsg(language === 'zh'
                    ? `转码失败: ${(transcodeErr as Error).message}`
                    : `Transcode failed: ${(transcodeErr as Error).message}`)
                setError(true)
                setTranscodeState('error')
            }
        } else {
            // 已经尝试过转码或非编码问题 → 显示错误
            setErrorMsg(`Playback error: ${codeName}`)
            setError(true)
        }
    }, [videoUrl, path, language])

    if (error) {
        return (
            <div className="h-full flex items-center justify-center bg-background-editor">
                <div className="text-center p-8">
                    <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-text-primary mb-2">{t('filePreview.cannotLoadVideo', language)}</h3>
                    <p className="text-sm text-text-muted break-all">{path}</p>
                    {errorMsg && <p className="text-xs text-text-muted/60 mt-2">{errorMsg}</p>}
                    <div className="mt-4 flex justify-center gap-2">
                        <ActionButton
                            variant="ghost"
                            size="sm"
                            onClick={handleOpenExternal}
                            className="h-7 px-3 text-xs gap-1"
                        >
                            <ExternalLink className="w-3.5 h-3.5" />
                            {t('filePreview.openWithDefault', language)}
                        </ActionButton>
                    </div>
                </div>
            </div>
        )
    }

    if (loading) {
        return (
            <div className="h-full flex items-center justify-center bg-background-editor">
                <div className="text-text-muted">{t('settings.loadingSettings', language)}</div>
            </div>
        )
    }

    // 转码中
    if (transcodeState === 'transcoding') {
        return (
            <div className="h-full flex flex-col bg-background-editor">
                <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-surface/50">
                    <span className="text-xs text-text-muted truncate max-w-xs" title={getFileName(path)}>
                        {getFileName(path)}
                    </span>
                </div>
                <div className="flex-1 flex flex-col items-center justify-center p-8">
                    <div className="w-12 h-12 border-3 border-accent/30 border-t-accent rounded-full animate-spin mb-4" />
                    <p className="text-sm text-text-primary mb-2">
                        {language === 'zh' ? '正在转码视频...' : 'Transcoding video...'}
                    </p>
                    <p className="text-xs text-text-muted mb-4">{transcodeInfo}</p>
                    {/* 进度条 */}
                    <div className="w-64 h-2 bg-surface rounded-full overflow-hidden mb-4">
                        <div
                            className="h-full bg-accent rounded-full transition-all duration-300"
                            style={{ width: `${transcodeProgress}%` }}
                        />
                    </div>
                    <ActionButton
                        variant="ghost"
                        size="sm"
                        onClick={handleCancelTranscode}
                        className="h-7 px-3 text-xs"
                    >
                        {language === 'zh' ? '取消' : 'Cancel'}
                    </ActionButton>
                </div>
            </div>
        )
    }

    if (!videoUrl) {
        return (
            <div className="h-full flex items-center justify-center bg-background-editor">
                <div className="text-text-muted">{t('settings.loadingSettings', language)}</div>
            </div>
        )
    }

    return (
        <div className="h-full flex flex-col bg-background-editor">
            {/* 工具栏 */}
            <div className="flex-shrink-0 flex items-center justify-between gap-2 px-3 py-2 border-b border-border bg-surface/50">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-text-muted truncate max-w-xs" title={getFileName(path)}>
                        {getFileName(path)}
                    </span>
                    {transcodeState === 'done' && (
                        <span className="text-[12px] px-1.5 py-0.5 rounded bg-accent/10 text-accent flex-shrink-0">
                            {language === 'zh' ? '已转码' : 'Transcoded'}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1">
                    <ActionButton
                        variant="ghost"
                        size="sm"
                        onClick={handleDownload}
                        className="h-7 px-2 text-xs gap-1"
                        title={t('filePreview.showInFolder', language)}
                    >
                        <Download className="w-3.5 h-3.5" />
                        {t('filePreview.showInFolder', language)}
                    </ActionButton>
                    <ActionButton
                        variant="ghost"
                        size="sm"
                        onClick={handleOpenExternal}
                        className="h-7 px-2 text-xs gap-1"
                        title={t('filePreview.openWithDefault', language)}
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        {t('filePreview.openWithDefault', language)}
                    </ActionButton>
                </div>
            </div>

            {/* 视频播放器 */}
            <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
                <video
                    ref={videoRef}
                    src={videoUrl}
                    controls
                    autoPlay
                    className="max-w-full max-h-full rounded-lg shadow-lg"
                    style={{ backgroundColor: '#000' }}
                    onError={handleVideoError}
                    onLoadedData={() => {
                        logger.file.info(`[VideoPreview] Video loaded successfully: ${path}`)
                    }}
                >
                    {t('filePreview.videoNotSupported', language)}
                </video>
            </div>
        </div>
    )
}

// ===== 不支持文件提示组件 =====

interface UnsupportedFileProps {
    path: string
    fileType: 'binary' | 'unknown'
}

export function UnsupportedFile({ path, fileType }: UnsupportedFileProps) {
    const language = useStore(s => s.language)
    const ext = path.split('.').pop()?.toLowerCase() || ''
    const fileName = getFileName(path)

    const handleOpenExternal = useCallback(() => {
        // 使用 shell:openPath IPC 打开文件
        ; (window.electronAPI as any).openPath?.(path) ||
            api.shell.executeSecure?.({ command: 'start', args: ['""', path], cwd: '.' })
    }, [path])

    return (
        <div className="h-full flex items-center justify-center bg-background-editor">
            <div className="text-center p-8 max-w-md">
                <div className="w-16 h-16 rounded-2xl bg-surface/50 border border-border flex items-center justify-center mx-auto mb-6">
                    {fileType === 'binary' ? (
                        <FileQuestion className="w-8 h-8 text-text-muted" />
                    ) : (
                        <AlertTriangle className="w-8 h-8 text-warning" />
                    )}
                </div>

                <h3 className="text-lg font-medium text-text-primary mb-2">
                    {t('filePreview.cannotOpenFile', language)}
                </h3>

                <p className="text-sm text-text-muted mb-6">
                    {fileType === 'binary'
                        ? t('filePreview.binaryFileDesc', language, { name: fileName, ext })
                        : t('filePreview.unsupportedFileDesc', language, { ext })
                    }
                </p>

                <ActionButton
                    variant="secondary"
                    onClick={handleOpenExternal}
                    className="gap-2"
                >
                    <ImageIcon className="w-4 h-4" />
                    {t('filePreview.openWithDefault', language)}
                </ActionButton>
            </div>
        </div>
    )
}

// ===== Markdown 编辑器工具栏 =====

interface MarkdownToolbarProps {
    mode: 'edit' | 'preview' | 'split'
    onModeChange: (mode: 'edit' | 'preview' | 'split') => void
}

export function MarkdownToolbar({ mode, onModeChange }: MarkdownToolbarProps) {
    const language = useStore(s => s.language)
    return (
        <div className="flex items-center gap-1 px-2 py-1 border-b border-border bg-surface/30">
            <ActionButton
                variant={mode === 'edit' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => onModeChange('edit')}
                className="h-6 px-2 text-xs gap-1"
                title={t('editor.editMode', language)}
            >
                <Edit className="w-3 h-3" />
                {t('editor.edit', language)}
            </ActionButton>
            <ActionButton
                variant={mode === 'split' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => onModeChange('split')}
                className="h-6 px-2 text-xs gap-1"
                title={t('editor.splitMode', language)}
            >
                <Columns className="w-3 h-3" />
                {t('editor.split', language)}
            </ActionButton>
            <ActionButton
                variant={mode === 'preview' ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => onModeChange('preview')}
                className="h-6 px-2 text-xs gap-1"
                title={t('editor.previewMode', language)}
            >
                <Eye className="w-3 h-3" />
                {t('editor.preview', language)}
            </ActionButton>
        </div>
    )
}

// ===== HTML 预览组件 =====

interface HtmlPreviewProps {
    content: string
    filePath?: string
}

function injectBaseTag(html: string, dirPath: string): string {
    const baseHref = `local-preview://${dirPath}/`
    const baseTag = `<base href="${baseHref}">`
    if (html.match(/<head[^>]*>/i)) {
        return html.replace(/<head[^>]*>/i, `$&${baseTag}`)
    }
    if (html.match(/<html[^>]*>/i)) {
        return html.replace(/<html[^>]*>/i, `$&<head>${baseTag}</head>`)
    }
    return `${baseTag}${html}`
}

export function HtmlPreview({ content, filePath }: HtmlPreviewProps) {
    const language = useStore(s => s.language)
    const iframeRef = useRef<HTMLIFrameElement>(null)

    const processedContent = useMemo(() => {
        if (!filePath) return content
        const dirPath = filePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
        return injectBaseTag(content, dirPath)
    }, [content, filePath])

    useEffect(() => {
        if (!iframeRef.current) return
        const doc = iframeRef.current.contentDocument
        if (!doc) return
        doc.open()
        doc.write(processedContent)
        doc.close()
    }, [processedContent])

    return (
        <div className="h-full flex flex-col bg-white">
            <iframe
                ref={iframeRef}
                title={t('editor.htmlpreview', language as Language)}
                className="flex-1 w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
        </div>
    )
}
