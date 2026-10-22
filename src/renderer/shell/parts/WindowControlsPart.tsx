/**
 * 窗口控制部件（window-controls）
 *
 * 非 macOS 平台的最小化 / 最大化 / 关闭。macOS 使用系统红绿灯，因此该部件
 * 在 mac 下渲染 null —— 但区域树里仍要求它存在（保留集），否则场景在
 * Windows 上会把窗口关不掉。
 */

import { Minus, Square, X } from 'lucide-react'
import { api } from '@renderer/adapters/electronBridge'
import type { HostPartComponentProps } from '../HostPartRegistry'

/** Windows 平台判定：与外壳层保持一致，避免两处口径不同 */
const isMac = typeof navigator !== 'undefined' && (
  navigator.platform.toUpperCase().indexOf('MAC') >= 0 ||
  ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform?.toUpperCase().indexOf('MAC') ?? -1) >= 0
)

export function WindowControlsPart(_props: HostPartComponentProps) {
  if (isMac) return null

  return (
    <div className="no-drag flex items-center h-full pl-2 border-l border-border-subtle">
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => api.window.minimize()}
          className="w-9 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-all group"
        >
          <Minus className="w-4 h-4 opacity-70 group-hover:opacity-100" />
        </button>
        <button
          onClick={() => api.window.maximize()}
          className="w-9 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-text-primary/[0.05] transition-all group"
        >
          <Square className="w-3 h-3 opacity-70 group-hover:opacity-100" />
        </button>
        <button
          onClick={() => api.window.close()}
          className="w-9 h-8 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-red-500/90 transition-all group"
        >
          <X className="w-4 h-4 opacity-70 group-hover:opacity-100" />
        </button>
      </div>
    </div>
  )
}

export default WindowControlsPart
