/**
 * JSON 语法着色与可点击文件路径渲染
 *
 * 通过扫描器将 JSON 文本切分为 token，再按类型着色。
 * 字符串值若形似文件路径，则渲染为可点击元素。
 */

import React, { useCallback, useMemo } from 'react'
import { api } from '../adapters/electronBridge'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { joinPath } from '@shared/toolkit/pathHelper'

/* ------------------------------------------------------------------ */
/* 样式                                                              */
/* ------------------------------------------------------------------ */

/** 各类 token 的样式类名 */
export interface HighlightStyle {
  string: string
  number: string
  boolean: string
  null: string
  key: string
  punctuation: string
}

const DEFAULT_STYLE: HighlightStyle = {
  string: 'text-green-400',
  number: 'text-blue-400',
  boolean: 'text-yellow-400',
  null: 'text-gray-400',
  key: 'text-purple-400',
  punctuation: 'text-text-muted',
}

/* ------------------------------------------------------------------ */
/* Token 扫描                                                        */
/* ------------------------------------------------------------------ */

/** Token 类型 */
type TokenType = 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'whitespace' | 'other'

/** 扫描结果 */
interface Token {
  type: TokenType
  text: string
  /** 字符串 token 是否位于键位置（后跟冒号） */
  isKey: boolean
  /** 字符串内容（去除引号） */
  raw?: string
}

/** 将 JSON 文本扫描为 token 列表 */
function scanTokens(text: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    // 字符串
    if (ch === '"') {
      const start = i
      i++
      while (i < text.length && (text[i] !== '"' || text[i - 1] === '\\')) i++
      i++ // 包含结束引号
      const raw = text.slice(start, i)
      const inner = raw.slice(1, -1)
      const isKey = /^\s*:/.test(text.slice(i))
      tokens.push({ type: 'string', text: raw, isKey, raw: inner })
      continue
    }

    // 数字
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const start = i
      while (i < text.length && /[\d.eE+-]/.test(text[i])) i++
      tokens.push({ type: 'number', text: text.slice(start, i), isKey: false })
      continue
    }

    // 字面量
    if (text.startsWith('true', i)) {
      tokens.push({ type: 'boolean', text: 'true', isKey: false })
      i += 4
      continue
    }
    if (text.startsWith('false', i)) {
      tokens.push({ type: 'boolean', text: 'false', isKey: false })
      i += 5
      continue
    }
    if (text.startsWith('null', i)) {
      tokens.push({ type: 'null', text: 'null', isKey: false })
      i += 4
      continue
    }

    // 标点
    if ('{}[],:'.includes(ch)) {
      tokens.push({ type: 'punctuation', text: ch, isKey: false })
      i++
      continue
    }

    // 空白
    if (/\s/.test(ch)) {
      const start = i
      while (i < text.length && /\s/.test(text[i])) i++
      tokens.push({ type: 'whitespace', text: text.slice(start, i), isKey: false })
      continue
    }

    tokens.push({ type: 'other', text: ch, isKey: false })
    i++
  }

  return tokens
}

/** 判断字符串是否形似文件路径 */
function looksLikeFilePath(value: string): boolean {
  if (!value) return false
  if (/\s/.test(value)) return false
  if (/^([a-zA-Z]:[\\/]|[/])/.test(value)) return true
  return value.includes('.') || value.includes('/')
}

/* ------------------------------------------------------------------ */
/* 渲染                                                              */
/* ------------------------------------------------------------------ */

/** 将 JSON 文本渲染为带语法着色的 React 节点 */
export function highlightJson(
  json: string | unknown,
  style: Partial<HighlightStyle> = {},
  onFileClick?: (path: string) => void,
): React.ReactNode {
  const merged = { ...DEFAULT_STYLE, ...style }

  let text: string
  if (typeof json === 'string') {
    try {
      text = JSON.stringify(JSON.parse(json), null, 2)
    } catch {
      text = json
    }
  } else {
    text = JSON.stringify(json, null, 2)
  }

  if (!text) return null

  const tokens = scanTokens(text)
  const nodes: React.ReactNode[] = []

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx]

    if (token.type === 'string' && token.raw && looksLikeFilePath(token.raw) && onFileClick) {
      const clickable = (
        <span
          className="cursor-pointer hover:underline hover:text-accent transition-colors"
          onClick={(e) => {
            e.stopPropagation()
            onFileClick(token.raw!)
          }}
          title="Click to open file"
        >
          {token.raw}
        </span>
      )
      nodes.push(
        <span key={idx} className={token.isKey ? merged.key : merged.string}>
          "{clickable}"
        </span>,
      )
      continue
    }

    switch (token.type) {
      case 'string':
        nodes.push(<span key={idx} className={token.isKey ? merged.key : merged.string}>{token.text}</span>)
        break
      case 'number':
        nodes.push(<span key={idx} className={merged.number}>{token.text}</span>)
        break
      case 'boolean':
        nodes.push(<span key={idx} className={merged.boolean}>{token.text}</span>)
        break
      case 'null':
        nodes.push(<span key={idx} className={merged.null}>{token.text}</span>)
        break
      case 'punctuation':
        nodes.push(<span key={idx} className={merged.punctuation}>{token.text}</span>)
        break
      default:
        nodes.push(token.text)
    }
  }

  return <>{nodes}</>
}

/* ------------------------------------------------------------------ */
/* 预览组件                                                          */
/* ------------------------------------------------------------------ */

/** JSON 高亮预览组件 */
export function JsonHighlight({
  data,
  className = '',
  maxHeight = 'max-h-64',
  maxLength = 2000,
}: {
  data: unknown
  className?: string
  maxHeight?: string
  maxLength?: number
}) {
  const { content, truncated, originalLength } = useMemo(() => {
    let text: string
    if (typeof data === 'string') {
      text = data
    } else {
      try {
        text = JSON.stringify(data, null, 2)
      } catch {
        text = String(data)
      }
    }

    if (text.length > maxLength) {
      return { content: text.slice(0, maxLength), truncated: true, originalLength: text.length }
    }
    return { content: text, truncated: false, originalLength: text.length }
  }, [data, maxLength])

  const { workspacePath, openFile, setActiveFile } = useStore(
    useShallow((s) => ({ workspacePath: s.workspacePath, openFile: s.openFile, setActiveFile: s.setActiveFile })),
  )

  const handleFileClick = useCallback(
    async (filePath: string) => {
      let absPath = filePath
      const isAbsolute = /^([a-zA-Z]:[\\/]|[/])/.test(filePath)
      if (!isAbsolute && workspacePath) {
        absPath = joinPath(workspacePath, absPath)
      }

      try {
        const content = await api.file.read(absPath)
        if (content !== null) {
          openFile(absPath, content)
          setActiveFile(absPath)
        }
      } catch {
        // 字符串并非真实文件路径时静默忽略
      }
    },
    [workspacePath, openFile, setActiveFile],
  )

  return (
    <pre className={`text-xs font-mono overflow-auto ${maxHeight} ${className}`}>
      <code>{highlightJson(content, {}, handleFileClick)}</code>
      {truncated && (
        <span className="text-text-muted/85 italic block mt-2">
          ... ({(originalLength / 1000).toFixed(1)}KB truncated)
        </span>
      )}
    </pre>
  )
}
