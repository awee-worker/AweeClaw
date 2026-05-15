import { useMemo } from 'react'
import DOMPurify from 'dompurify'

export interface PurifyConfig {
  ALLOWED_TAGS?: string[]
  ALLOWED_ATTR?: string[]
  ALLOW_DATA_ATTR?: boolean
  ALLOWED_URI_REGEXP?: RegExp
  FORCE_BODY?: boolean
  KEEP_CONTENT?: boolean
  SANITIZE_DOM?: boolean
  ALLOW_CSS?: boolean
}

export interface SanitizedHTMLProps {
  html: string | null | undefined
  options?: PurifyConfig
  className?: string
  as?: keyof JSX.IntrinsicElements
  fallback?: React.ReactNode
  debug?: boolean
  onClick?: (event: React.MouseEvent) => void
  style?: React.CSSProperties
}

export type SafeHTMLOptions = PurifyConfig
export type SafeHTMLProps = SanitizedHTMLProps

function escapeForFallback(raw: string): string {
  return raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function purify(input: string, config?: PurifyConfig): string {
  if (typeof input !== 'string') return ''
  const defaults: PurifyConfig = { ALLOW_DATA_ATTR: false, SANITIZE_DOM: true, KEEP_CONTENT: true }
  try {
    return DOMPurify.sanitize(input, { ...defaults, ...config })
  } catch {
    return escapeForFallback(input)
  }
}

function detectRisk(html: string): boolean {
  const patterns = [/<script\b/gi, /javascript:/gi, /on\w+\s*=/gi, /<iframe\b/gi, /<object\b/gi, /<embed\b/gi, /<form\b/gi]
  return patterns.some(p => p.test(html))
}

export function SanitizedHTML({
  html,
  options,
  className,
  as: Tag = 'div',
  fallback = null,
  debug = false,
  onClick,
  style,
}: SanitizedHTMLProps): JSX.Element {
  const cleaned = useMemo(() => {
    if (html == null || html === '') return ''
    const original = String(html)
    const result = purify(original, options)
    if (debug && import.meta.env.DEV) {
      console.log('[SanitizedHTML] before:', original.slice(0, 200))
      console.log('[SanitizedHTML] after:', result.slice(0, 200))
      if (detectRisk(original)) console.warn('[SanitizedHTML] risky content removed')
    }
    return result
  }, [html, options, debug])

  if (cleaned === '') return <>{fallback}</>

  const Element = Tag as React.ElementType
  return <Element className={className} style={style} onClick={onClick} dangerouslySetInnerHTML={{ __html: cleaned }} />
}

export function SafeHTML(props: SanitizedHTMLProps): JSX.Element {
  return SanitizedHTML(props)
}

export function useSanitizedHTML(html: string | null | undefined, options?: PurifyConfig): string {
  return useMemo(() => {
    if (html == null || html === '') return ''
    return purify(String(html), options)
  }, [html, options])
}

export const useSafeHTML = useSanitizedHTML

export function SanitizedMarkdown({ html, className, ...rest }: Omit<SanitizedHTMLProps, 'options'>): JSX.Element {
  const mdConfig: PurifyConfig = {
    ALLOWED_TAGS: ['p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre', 'a', 'img', 'blockquote', 'q', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'span', 'sup', 'sub'],
    ALLOWED_ATTR: ['href', 'title', 'target', 'src', 'alt', 'width', 'height', 'class', 'id', 'align'],
    ALLOW_DATA_ATTR: false,
  }
  return <SanitizedHTML html={html} options={mdConfig} className={className} {...rest} />
}

export const SafeMarkdownHTML = SanitizedMarkdown

export function PlainTextExtract({ html, className, fallback = '' }: Pick<SanitizedHTMLProps, 'html' | 'className' | 'fallback'>): JSX.Element {
  const text = useMemo(() => {
    if (html == null || html === '') return fallback as string
    return purify(String(html), { ALLOWED_TAGS: [] }).replace(/<[^>]+>/g, '')
  }, [html, fallback])
  return <span className={className}>{text}</span>
}

export const SafeText = PlainTextExtract

export default SanitizedHTML
