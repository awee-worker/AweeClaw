/**
 * 按需加载的语法高亮配置
 * 使用 PrismLight 替代全量 Prism，减少 ~800KB bundle 体积
 */
import { PrismLight as SyntaxHighlighter } from 'react-syntax-highlighter'

// 按需注册常用语言
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'

SyntaxHighlighter.registerLanguage('tsx', tsx)
SyntaxHighlighter.registerLanguage('typescript', typescript)
SyntaxHighlighter.registerLanguage('javascript', javascript)
SyntaxHighlighter.registerLanguage('json', json)
SyntaxHighlighter.registerLanguage('bash', bash)
SyntaxHighlighter.registerLanguage('shell', bash)
SyntaxHighlighter.registerLanguage('css', css)
SyntaxHighlighter.registerLanguage('python', python)
SyntaxHighlighter.registerLanguage('markdown', markdown)
SyntaxHighlighter.registerLanguage('yaml', yaml)
SyntaxHighlighter.registerLanguage('rust', rust)
SyntaxHighlighter.registerLanguage('go', go)
SyntaxHighlighter.registerLanguage('java', java)
SyntaxHighlighter.registerLanguage('csharp', csharp)
SyntaxHighlighter.registerLanguage('cpp', cpp)
SyntaxHighlighter.registerLanguage('sql', sql)

/**
 * 将 RGB 空格分隔字符串转为 hex 颜色
 * 例: "222 227 237" → "#dee3ed"
 */
function rgbToHex(rgb: string): string {
  const parts = rgb.trim().split(/\s+/)
  if (parts.length !== 3) return rgb
  const r = parseInt(parts[0], 10)
  const g = parseInt(parts[1], 10)
  const b = parseInt(parts[2], 10)
  if (isNaN(r) || isNaN(g) || isNaN(b)) return rgb
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * 替换语法高亮样式中的灰色为指定颜色
 * 遍历样式对象，将纯灰色 hex 颜色（RGB 通道相等，范围 #666~#E0）统一替换
 * 解决高亮主题下灰色文字太浅看不清的问题
 * @param style 原始语法高亮样式对象
 * @param targetColor 替换目标颜色（hex格式），暗色主题应传入 textPrimary 颜色
 */
function isGrayHex(val: unknown): val is string {
  if (typeof val !== 'string') return false
  const match = val.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/)
  if (!match) return false
  const r = parseInt(match[1], 16)
  const g = parseInt(match[2], 16)
  const b = parseInt(match[3], 16)
  return r === g && g === b && r >= 0x66 && r <= 0xe0
}

export function patchSyntaxStyle<T extends Record<string, unknown>>(style: T, targetColor?: string): T {
  const color = targetColor || '#333333'
  const cloned = JSON.parse(JSON.stringify(style)) as T
  const walk = (obj: Record<string, unknown>) => {
    for (const key of Object.keys(obj)) {
      const val = obj[key]
      if (isGrayHex(val)) {
        obj[key] = color
      } else if (val && typeof val === 'object' && !Array.isArray(val)) {
        walk(val as Record<string, unknown>)
      }
    }
  }
  walk(cloned as Record<string, unknown>)
  return cloned
}

export { SyntaxHighlighter, rgbToHex }
