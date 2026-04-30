/**
 * 诊断信息全局存储
 *
 * 解决 StatusBar 和 ProblemsView 各自独立监听导致数据不同步的问题
 */

import { create } from 'zustand'
import type { LspDiagnostic } from '@shared/types'
import { onDiagnostics } from './lspService'
import { normalizePath } from '@shared/utils/pathUtils'

interface DiagnosticsState {
  // URI -> 诊断列表
  diagnostics: Map<string, LspDiagnostic[]>

  // 更新版本号（用于触发组件重新渲染）
  version: number

  // 全局统计
  errorCount: number
  warningCount: number

  // 操作
  setDiagnostics: (uri: string, diags: LspDiagnostic[]) => void
  clearAll: () => void
}

/**
 * 获取特定文件的诊断统计
 */
export function getFileStats(
  diagnostics: Map<string, LspDiagnostic[]>,
  filePath: string | null
): { errors: number; warnings: number } {
  if (!filePath) return { errors: 0, warnings: 0 }

  // 规范化路径：统一分隔符 + 小写（Windows 路径不区分大小写）
  const normalizedFilePath = normalizePath(filePath).toLowerCase()

  let diags: LspDiagnostic[] | undefined

  // 遍历所有诊断，查找匹配的文件
  for (const [uri, value] of diagnostics) {
    // 从 URI 中提取文件路径
    let uriPath = uri
    if (uri.startsWith('file:///')) {
      uriPath = decodeURIComponent(uri.slice(8))
    } else if (uri.startsWith('file://')) {
      uriPath = decodeURIComponent(uri.slice(7))
    }

    // 规范化路径：统一分隔符 + 小写
    const normalizedUri = normalizePath(uriPath).toLowerCase()

    // 比较路径（已经是小写，直接比较）
    if (normalizedUri === normalizedFilePath || normalizedUri.endsWith(normalizedFilePath)) {
      diags = value
      break
    }
  }

  if (!diags) return { errors: 0, warnings: 0 }

  let errors = 0
  let warnings = 0
  diags.forEach((d) => {
    if (d.severity === 1) errors++
    else if (d.severity === 2) warnings++
  })

  return { errors, warnings }
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
  diagnostics: new Map(),
  version: 0,
  errorCount: 0,
  warningCount: 0,

  setDiagnostics: (uri, diags) => {
    set((state) => {
      const next = new Map(state.diagnostics)
      if (diags.length === 0) {
        next.delete(uri)
      } else {
        next.set(uri, diags)
      }

      // 重新计算全局统计
      let errors = 0
      let warnings = 0
      next.forEach((d) => {
        d.forEach((diag) => {
          if (diag.severity === 1) errors++
          else if (diag.severity === 2) warnings++
        })
      })

      return {
        diagnostics: next,
        version: state.version + 1,
        errorCount: errors,
        warningCount: warnings,
      }
    })
  },

  clearAll: () => {
    set({
      diagnostics: new Map(),
      version: 0,
      errorCount: 0,
      warningCount: 0,
    })
  },
}))

// 初始化监听器（在应用启动时调用一次）
let initialized = false

export function initDiagnosticsListener(): () => void {
  if (initialized) return () => {}
  initialized = true

  const unsubscribe = onDiagnostics((uri, diags) => {
    useDiagnosticsStore.getState().setDiagnostics(uri, diags)
  })

  return () => {
    unsubscribe()
    initialized = false
  }
}
