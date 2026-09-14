import { memo, useEffect, useState } from 'react'
import { ChevronRight, AlertTriangle, ArrowLeft, ArrowRight } from 'lucide-react'
import { getPathSeparator } from '@shared/toolkit/pathHelper'
import { getLargeFileWarning } from '@services/largeFileAdapter'
import type { LargeFileInfo } from '@services/largeFileAdapter'
import { useStore } from '@store'
import { t, type Language } from '@renderer/i18n'
import {
  getNavigationHistoryState,
  subscribeNavigationHistory,
  goBack,
  goForward,
} from '@services/editorNavigation'
import { SymbolBreadcrumbs } from './SymbolBreadcrumbs'

interface EditorBreadcrumbsProps {
  filePath: string
  largeFileInfo: LargeFileInfo | null
  language: 'en' | 'zh'
}

/**
 * 计算面包屑片段：以工作区为参照显示相对物理路径（去掉工作区目录一级），
 * 文件不在工作区内时回退为完整绝对路径。
 */
function getBreadcrumbParts(filePath: string, workspacePath: string | null): string[] {
  const sep = getPathSeparator(filePath)
  const split = (p: string) => p.split(sep === '\\' ? /\\/ : /\//).filter(Boolean)

  // diff:// 等虚拟协议直接按原样拆分展示
  const protocolMatch = filePath.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)
  if (protocolMatch) return split(filePath)

  const normalizedFile = filePath.replace(/\\/g, '/')
  const normalizedWs = workspacePath?.replace(/\\/g, '/').replace(/\/+$/, '') ?? ''

  // 相对工作区的物理路径（从工作区第一个子目录开始，去掉工作区父目录一级）
  if (normalizedWs && (normalizedFile === normalizedWs || normalizedFile.startsWith(`${normalizedWs}/`))) {
    const wsName = normalizedWs.split('/').pop() || ''
    const relParts = split(filePath.slice(normalizedWs.length + 1))
    return relParts.length ? relParts : [wsName]
  }

  return split(filePath)
}

/**
 * 导航历史按钮（后退 / 前进）
 * 订阅导航历史栈，跳转记录变化时实时更新可用状态。
 */
export const NavHistoryControls = memo(function NavHistoryControls() {
  const language = useStore(state => state.language) as Language
  const [historyState, setHistoryState] = useState(() => getNavigationHistoryState())

  useEffect(() => subscribeNavigationHistory(() => setHistoryState(getNavigationHistoryState())), [])

  return (
    <div className="flex items-center gap-0.5 flex-shrink-0 mr-1">
      <button
        onClick={() => { void goBack() }}
        disabled={!historyState.canGoBack}
        title={t('editor.navBack', language)}
        className="flex items-center justify-center w-5 h-5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <ArrowLeft className="w-3 h-3" />
      </button>
      <button
        onClick={() => { void goForward() }}
        disabled={!historyState.canGoForward}
        title={t('editor.navForward', language)}
        className="flex items-center justify-center w-5 h-5 rounded-md text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent"
      >
        <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  )
})

export const EditorBreadcrumbs = memo(function EditorBreadcrumbs({
  filePath,
  largeFileInfo,
  language,
}: EditorBreadcrumbsProps) {
  const workspacePath = useStore(state => state.workspacePath)
  const parts = getBreadcrumbParts(filePath, workspacePath)

  return (
    <div className="h-6 flex items-center gap-1 px-2 bg-background/50 border-b border-border/20 text-[12px] text-text-muted select-none min-w-0">
      <NavHistoryControls />

      <div className="flex items-center flex-1 min-w-0 gap-1">
        {/* 面包屑：从工作区子目录开始的相对物理路径，悬停可看完整绝对路径 */}
        <div
          className="flex items-center min-w-0 overflow-x-auto scrollbar-none"
          title={filePath}
        >
          {parts.map((part, index) => {
            const isLast = index === parts.length - 1
            // 工作区根节点允许收缩截断，保证长路径不把整条栏撑爆
            const cls = index === 0 && !isLast
              ? 'px-1 whitespace-nowrap max-w-[160px] truncate'
              : `px-1 whitespace-nowrap${isLast ? ' text-text-primary font-medium' : ''}`
            return (
              <span key={`${part}-${index}`} className="flex items-center flex-shrink-0">
                {index > 0 && <ChevronRight className="w-3 h-3 opacity-25 mx-0.5" />}
                <span className={cls}>{part}</span>
              </span>
            )
          })}
        </div>

        {/* 大纲面包屑：路径 › 类 › 方法 › 变量（点击可切换符号） */}
        <SymbolBreadcrumbs filePath={filePath} language={language as Language} />
      </div>

      {largeFileInfo?.isLarge && (
        <div className="flex-shrink-0 flex items-center gap-1 text-status-warning">
          <AlertTriangle className="w-3 h-3" />
          <span>{getLargeFileWarning(largeFileInfo, language)}</span>
        </div>
      )}
    </div>
  )
})
