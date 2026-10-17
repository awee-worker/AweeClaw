import React, { useCallback, useMemo } from 'react'
import { openLinkSmart, openLocalFileInEditor } from '@utils/linkRouter'
import { FileCode, ExternalLink } from 'lucide-react'

interface FilePathAnchorProps {
    text: string
    className?: string
    enableLineNumbers?: boolean
}

interface ParsedSegment {
    type: 'text' | 'filepath' | 'url'
    content: string
    line?: number
}

function parseContentSegments(input: string): ParsedSegment[] {
    if (!input) return []

    const segments: ParsedSegment[] = []
    const filePathPattern = /((?:(?:[a-zA-Z]:[\\/]|[/])[\w.-]+(?:[\\/][\w.-]+)*)|(?:[a-zA-Z0-9_-]+(?:[\\/][a-zA-Z0-9_-]+)*\.[a-zA-Z0-9]+))(?::(\d+))?/g
    const urlPattern = /(https?:\/\/[^\s<>"')\]]+)/g

    const combinedPattern = new RegExp(`(${filePathPattern.source}|${urlPattern.source})`, 'g')

    let lastIndex = 0
    let match: RegExpExecArray | null

    const tempPattern = new RegExp(combinedPattern.source, combinedPattern.flags)
    while ((match = tempPattern.exec(input)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', content: input.slice(lastIndex, match.index) })
        }

        const matched = match[0]

        if (matched.startsWith('http://') || matched.startsWith('https://')) {
            segments.push({ type: 'url', content: matched })
        } else if (matched.length > 2) {
            const lineNum = match[2] ? parseInt(match[2], 10) : undefined
            segments.push({ type: 'filepath', content: matched, line: lineNum })
        } else {
            segments.push({ type: 'text', content: matched })
        }

        lastIndex = match.index + matched.length
    }

    if (lastIndex < input.length) {
        segments.push({ type: 'text', content: input.slice(lastIndex) })
    }

    return segments.length > 0 ? segments : [{ type: 'text', content: input }]
}

export function FilePathAnchor({ text, className = '', enableLineNumbers = true }: FilePathAnchorProps) {
    // 路径解析与预览器选择统一交给 linkRouter：此前这里只读文本，
    // 图片 / PDF / Office 文档点了没有任何反应。
    const handleFileOpen = useCallback((e: React.MouseEvent, filePath: string, _line?: number) => {
        e.stopPropagation()
        void openLocalFileInEditor(filePath)
    }, [])

    const handleUrlClick = useCallback((e: React.MouseEvent, url: string) => {
        e.stopPropagation()
        e.preventDefault()
        openLinkSmart(url)
    }, [])

    const renderedSegments = useMemo(() => {
        const segments = parseContentSegments(text)
        return segments.map((seg, i) => {
            if (seg.type === 'filepath') {
                // 行号单独展示，不能混进路径：带 :12 的字符串拿去读文件会直接失败
                const barePath = seg.content.replace(/:\d+$/, '')
                return (
                    <span
                        key={`fp-${i}-${seg.content.slice(0, 15)}`}
                        className="inline-flex items-center gap-1 cursor-pointer hover:underline text-accent/90 hover:text-accent transition-colors break-all group"
                        onClick={(e) => handleFileOpen(e, barePath, seg.line)}
                        title={`Open ${seg.content}${seg.line ? `:${seg.line}` : ''}`}
                    >
                        <FileCode className="w-3 h-3 opacity-0 group-hover:opacity-70 transition-opacity flex-shrink-0" />
                        {seg.content}
                        {enableLineNumbers && seg.line && (
                            <span className="text-[10px] text-accent/50 font-mono">:{seg.line}</span>
                        )}
                    </span>
                )
            }

            if (seg.type === 'url') {
                return (
                    <span
                        key={`url-${i}-${seg.content.slice(0, 15)}`}
                        className="inline-flex items-center gap-1 cursor-pointer hover:underline text-blue-400 hover:text-blue-300 transition-colors break-all"
                        onClick={(e) => handleUrlClick(e, seg.content)}
                        title="Open in browser"
                    >
                        <ExternalLink className="w-3 h-3 flex-shrink-0 opacity-50" />
                        {seg.content}
                    </span>
                )
            }

            return <span key={`txt-${i}-${seg.content.slice(0, 10)}`} className="break-all">{seg.content}</span>
        })
    }, [text, handleFileOpen, handleUrlClick, enableLineNumbers])

    return (
        <span className={className}>
            {renderedSegments}
        </span>
    )
}
