import { memo } from 'react'
import { ChevronRight, AlertTriangle } from 'lucide-react'
import { getPathSeparator } from '@shared/toolkit/pathHelper'
import { getLargeFileWarning } from '@services/largeFileAdapter'
import type { LargeFileInfo } from '@services/largeFileAdapter'
import { useStore } from '@store'

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

export const EditorBreadcrumbs = memo(function EditorBreadcrumbs({
  filePath,
  largeFileInfo,
  language,
}: EditorBreadcrumbsProps) {
  const workspacePath = useStore(state => state.workspacePath)
  const parts = getBreadcrumbParts(filePath, workspacePath)

  return (
    <div className="h-6 flex items-center gap-2 px-3 bg-background/50 border-b border-border/20 text-[12px] text-text-muted select-none min-w-0">
      {/* 面包屑：从工作区子目录开始的相对物理路径，悬停可看完整绝对路径 */}
      <div
        className="flex items-center flex-1 min-w-0 overflow-x-auto scrollbar-none"
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

      {largeFileInfo?.isLarge && (
        <div className="flex-shrink-0 flex items-center gap-1 text-status-warning">
          <AlertTriangle className="w-3 h-3" />
          <span>{getLargeFileWarning(largeFileInfo, language)}</span>
        </div>
      )}
    </div>
  )
})
