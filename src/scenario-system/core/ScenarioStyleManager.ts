/**
 * 场景样式动态注入/移除管理器
 *
 * 负责场景 CSS 的动态注入、命名空间隔离和卸载清理。
 * 每个场景的样式被包裹在 [data-scenario="{id}"] 选择器下，
 * 确保样式不会泄漏到其他场景或宿主应用。
 *
 * 功能：
 * - 动态注入场景 CSS（link 或 inline style）
 * - 自动添加命名空间前缀实现样式隔离
 * - 场景卸载时自动清理所有样式
 * - 支持热更新：场景更新时替换样式
 * - 批量清理：一次清理所有场景样式
 */

import { logger } from '@shared/toolkit/LogEngine'

interface ScenarioStyleEntry {
  scenarioId: string
  type: 'link' | 'inline'
  element: HTMLElement
  injectedAt: number
}

class ScenarioStyleManagerClass {
  private entries = new Map<string, ScenarioStyleEntry[]>()

  injectFromUrl(scenarioId: string, cssUrl: string): void {
    this.removeScenarioStyles(scenarioId)

    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = cssUrl
    link.setAttribute('data-scenario', scenarioId)
    link.setAttribute('data-scenario-style-type', 'url')

    document.head.appendChild(link)

    this.addEntry(scenarioId, {
      scenarioId,
      type: 'link',
      element: link,
      injectedAt: Date.now(),
    })

    logger.agent.info(`[StyleManager] Injected CSS from URL for scenario "${scenarioId}"`)
  }

  injectInline(scenarioId: string, cssContent: string, namespace?: boolean): void {
    this.removeScenarioStyles(scenarioId)

    let processedCss = cssContent

    if (namespace) {
      processedCss = this.namespaceCss(scenarioId, cssContent)
    }

    const style = document.createElement('style')
    style.setAttribute('data-scenario', scenarioId)
    style.setAttribute('data-scenario-style-type', 'inline')
    style.textContent = processedCss

    document.head.appendChild(style)

    this.addEntry(scenarioId, {
      scenarioId,
      type: 'inline',
      element: style,
      injectedAt: Date.now(),
    })

    logger.agent.info(`[StyleManager] Injected inline CSS for scenario "${scenarioId}"${namespace ? ' (namespaced)' : ''}`)
  }

  removeScenarioStyles(scenarioId: string): number {
    const entries = this.entries.get(scenarioId)
    if (!entries || entries.length === 0) return 0

    let removed = 0
    for (const entry of entries) {
      if (entry.element.parentNode) {
        entry.element.parentNode.removeChild(entry.element)
        removed++
      }
    }

    this.entries.delete(scenarioId)
    logger.agent.info(`[StyleManager] Removed ${removed} style(s) for scenario "${scenarioId}"`)
    return removed
  }

  removeAllStyles(): number {
    let total = 0
    for (const scenarioId of this.entries.keys()) {
      total += this.removeScenarioStyles(scenarioId)
    }
    return total
  }

  hasStyles(scenarioId: string): boolean {
    const entries = this.entries.get(scenarioId)
    return !!entries && entries.length > 0
  }

  getStyleCount(scenarioId: string): number {
    return this.entries.get(scenarioId)?.length || 0
  }

  getActiveScenarioIds(): string[] {
    return Array.from(this.entries.keys())
  }

  updateInlineStyle(scenarioId: string, cssContent: string, namespace?: boolean): void {
    const entries = this.entries.get(scenarioId)
    if (!entries) {
      this.injectInline(scenarioId, cssContent, namespace)
      return
    }

    const inlineEntry = entries.find(e => e.type === 'inline')
    if (inlineEntry) {
      let processedCss = cssContent
      if (namespace) {
        processedCss = this.namespaceCss(scenarioId, cssContent)
      }
      ;(inlineEntry.element as HTMLStyleElement).textContent = processedCss
      logger.agent.info(`[StyleManager] Updated inline CSS for scenario "${scenarioId}"`)
    } else {
      this.injectInline(scenarioId, cssContent, namespace)
    }
  }

  private namespaceCss(scenarioId: string, css: string): string {
    const selector = `[data-scenario="${scenarioId}"]`

    const namespaced = css.replace(
      /([^{}@/][^{]*?)(\{[^{}]*?\})/g,
      (match, selectorPart, declarationBlock) => {
        const trimmed = selectorPart.trim()
        if (!trimmed) return match

        const selectors = trimmed.split(',').map((s: string) => {
          const t = s.trim()
          if (t.startsWith('@') || t.startsWith('from') || t.startsWith('to') || /^\d+%$/.test(t)) {
            return t
          }
          if (t.startsWith(':root') || t.startsWith('html') || t.startsWith('body')) {
            return `${selector} ${t}`
          }
          return `${selector} ${t}`
        })

        return `${selectors.join(', ')}${declarationBlock}`
      }
    )

    return namespaced
  }

  private addEntry(scenarioId: string, entry: ScenarioStyleEntry): void {
    const existing = this.entries.get(scenarioId) || []
    existing.push(entry)
    this.entries.set(scenarioId, existing)
  }
}

export const scenarioStyleManager = new ScenarioStyleManagerClass()
