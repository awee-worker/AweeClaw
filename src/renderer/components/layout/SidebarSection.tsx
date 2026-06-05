/**
 * 侧边栏区域组件
 *
 * 封装 ExplorerSidebar 的懒加载、ErrorBoundary、宽度拖拽调整逻辑。
 * 从 AweeApp.tsx 中提取，消除两种布局模式下的重复代码。
 */

import { Suspense, useRef, lazy } from 'react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { useSidebarResize } from '@hooks'
import { CrashGuard as ErrorBoundary } from '@components/foundation/CrashGuard'
import { PanelSkeleton } from '@components/ui/ProgressIndicator'

const Sidebar = lazy(() => import('@components/explorer/ExplorerSidebar'))

interface SidebarSectionProps {
  /** 是否隐藏侧边栏（某些面板/页面状态下需要隐藏） */
  hidden: boolean
}

export default function SidebarSection({ hidden }: SidebarSectionProps) {
  const { sidebarWidth, setSidebarWidth } = useStore(useShallow((s) => ({
    sidebarWidth: s.sidebarWidth,
    setSidebarWidth: s.setSidebarWidth,
  })))

  const sidebarRef = useRef<HTMLDivElement>(null)
  const { startResize } = useSidebarResize(setSidebarWidth, sidebarRef)

  if (hidden) return null

  return (
    <div
      ref={sidebarRef}
      style={{ width: sidebarWidth, minWidth: sidebarWidth }}
      className="flex-shrink-0 relative min-w-[220px]"
    >
      <ErrorBoundary>
        <Suspense fallback={<PanelSkeleton />}>
          <Sidebar />
        </Suspense>
      </ErrorBoundary>
      <div
        className="absolute top-0 right-0 w-1 h-full cursor-col-resize active:bg-accent transition-colors z-50 translate-x-[2px]"
        onMouseDown={startResize}
      />
    </div>
  )
}
