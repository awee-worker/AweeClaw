/**
 * Mermaid 实例管理 Hook
 * 负责懒加载 mermaid 库、初始化、渲染、缓存和主题同步
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import { useStore } from '@store'
import { themeManager } from '../../../../config/themeDefinition'

// mermaid 实例缓存（全局单例）
let mermaidInstance: any = null
let mermaidInitPromise: Promise<any> | null = null

// SVG 缓存：code hash → svg string
const svgCache = new Map<string, string>()

// 主题跟踪
let lastTheme: 'dark' | 'default' | null = null

/**
 * 计算字符串简单哈希
 */
function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // 转换为 32 位整数
  }
  return hash.toString(36)
}

/**
 * 懒加载 mermaid 库
 */
async function loadMermaid(): Promise<any> {
  if (mermaidInstance) {
    return mermaidInstance
  }

  if (mermaidInitPromise) {
    return mermaidInitPromise
  }

  mermaidInitPromise = (async () => {
    try {
      const mermaidModule = await import('mermaid')
      mermaidInstance = mermaidModule.default
      return mermaidInstance
    } catch (error) {
      mermaidInitPromise = null
      throw error
    }
  })()

  return mermaidInitPromise
}

/**
 * 初始化 mermaid 配置
 */
async function initializeMermaid(mermaid: any, theme: 'dark' | 'default'): Promise<void> {
  if (lastTheme === theme) {
    return
  }

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: theme,
    fontFamily: 'inherit',
    flowchart: {
      useMaxWidth: true,
      htmlLabels: true,
      curve: 'basis',
    },
    sequence: {
      useMaxWidth: true,
      wrap: true,
      mirrorActors: false,
    },
    gantt: {
      useMaxWidth: true,
    },
  })

  lastTheme = theme

  // 主题切换时清空缓存
  svgCache.clear()
}

/**
 * 渲染 mermaid 代码为 SVG
 */
async function renderMermaid(code: string, theme: 'dark' | 'default'): Promise<string> {
  const mermaid = await loadMermaid()
  await initializeMermaid(mermaid, theme)

  // 生成唯一 ID
  const id = `mermaid-${hashString(code)}-${Date.now()}`

  try {
    const { svg } = await mermaid.render(id, code)

    // 清理 mermaid 产生的临时节点
    const tempElement = document.getElementById(id)
    if (tempElement) {
      tempElement.remove()
    }

    // 缓存 SVG
    const cacheKey = `${hashString(code)}-${theme}`
    svgCache.set(cacheKey, svg)

    return svg
  } catch (error) {
    // 清理可能的临时节点
    const tempElement = document.getElementById(id)
    if (tempElement) {
      tempElement.remove()
    }
    throw error
  }
}

/**
 * 检查是否是有效的 mermaid 语法
 */
function isValidMermaidSyntax(code: string): boolean {
  if (!code || typeof code !== 'string') {
    return false
  }

  const trimmed = code.trim()

  // 基本检查：必须以有效的 mermaid 关键字开头
  const validStarts = [
    'graph ', 'flowchart ', 'sequenceDiagram', 'classDiagram',
    'stateDiagram', 'erDiagram', 'gantt', 'pie', 'requirementDiagram',
    'gitGraph', 'journey', 'mindmap', 'timeline', 'sankey',
    'block-beta', 'packet-beta'
  ]

  return validStarts.some(start => trimmed.startsWith(start))
}

/**
 * useMermaid Hook
 */
export function useMermaid() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentTheme = useStore(s => s.currentTheme)
  const themeType = themeManager.getThemeById(currentTheme)?.type === 'dark' ? 'dark' : 'default'

  // 防抖渲染
  const renderTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingRenderRef = useRef<string | null>(null)

  /**
   * 渲染 mermaid 代码
   */
  const render = useCallback(async (code: string): Promise<string | null> => {
    if (!isValidMermaidSyntax(code)) {
      setError('Invalid mermaid syntax')
      return null
    }

    // 检查缓存
    const cacheKey = `${hashString(code)}-${themeType}`
    const cached = svgCache.get(cacheKey)
    if (cached) {
      setError(null)
      return cached
    }

    setIsLoading(true)
    setError(null)

    try {
      const svg = await renderMermaid(code, themeType)
      return svg
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      setError(errorMessage)
      return null
    } finally {
      setIsLoading(false)
    }
  }, [themeType])

  /**
   * 防抖渲染（用于流式输出）
   */
  const debouncedRender = useCallback((code: string, callback: (svg: string | null) => void, delay: number = 400) => {
    // 清除之前的定时器
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current)
    }

    // 存储待渲染的代码
    pendingRenderRef.current = code

    renderTimeoutRef.current = setTimeout(async () => {
      // 检查是否还是最新的请求
      if (pendingRenderRef.current !== code) {
        return
      }

      const svg = await render(code)
      callback(svg)
    }, delay)
  }, [render])

  /**
   * 取消待处理的渲染
   */
  const cancelPendingRender = useCallback(() => {
    if (renderTimeoutRef.current) {
      clearTimeout(renderTimeoutRef.current)
      renderTimeoutRef.current = null
    }
    pendingRenderRef.current = null
  }, [])

  // 清理定时器
  useEffect(() => {
    return () => {
      cancelPendingRender()
    }
  }, [cancelPendingRender])

  return {
    render,
    debouncedRender,
    cancelPendingRender,
    isLoading,
    error,
    isValidSyntax: isValidMermaidSyntax,
  }
}

/**
 * 预加载 mermaid 库（可选）
 */
export function preloadMermaid(): void {
  loadMermaid().catch(() => {
    // 预加载失败静默处理
  })
}

/**
 * 清除 mermaid 缓存
 */
export function clearMermaidCache(): void {
  svgCache.clear()
  lastTheme = null
}