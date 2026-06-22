/**
 * 记忆系统移动端适配组件
 * 在小屏幕设备上提供优化的交互体验
 */
import { useEffect, useState, useCallback } from 'react'
import { ArrowLeft } from 'lucide-react'
import { useMemoryStore } from '../store'
import { MemoryListView } from './MemoryListView'
import { MemoryDetailPanel } from './MemoryDetailPanel'
import { MemoryStatsPanel } from './MemoryStatsPanel'
import { MemoryHealthReport } from './MemoryHealthReport'
import { MemorySettingsPanel } from './MemorySettingsPanel'
import MemoryPage from '../MemoryPage'

type MobileTab = 'list' | 'stats' | 'health' | 'settings'
type MobileView = 'main' | 'detail'

const TABS: Array<{ id: MobileTab; label: string }> = [
  { id: 'list', label: '记忆' },
  { id: 'stats', label: '统计' },
  { id: 'health', label: '健康' },
  { id: 'settings', label: '设置' },
]

export function MemoryMobileView() {
  const { showDetailPanel, setShowDetailPanel, currentMemory } = useMemoryStore()
  const [activeTab, setActiveTab] = useState<MobileTab>('list')
  const [view, setView] = useState<MobileView>('main')

  // 监听详情面板状态，自动切换视图
  useEffect(() => {
    if (showDetailPanel && currentMemory) {
      setView('detail')
    } else {
      setView('main')
    }
  }, [showDetailPanel, currentMemory])

  const handleBack = useCallback(() => {
    setShowDetailPanel(false)
    setView('main')
  }, [setShowDetailPanel])

  return (
    <div className="flex flex-col h-full bg-bg-base">
      {/* 主视图 */}
      {view === 'main' && (
        <>
          {/* 内容区 */}
          <div className="flex-1 overflow-hidden">
            {activeTab === 'list' && <MemoryListView />}
            {activeTab === 'stats' && <MemoryStatsPanel />}
            {activeTab === 'health' && <MemoryHealthReport />}
            {activeTab === 'settings' && <MemorySettingsPanel />}
          </div>

          {/* 底部 Tab 栏 */}
          <div className="flex items-center justify-around border-t border-border/40 bg-surface/80 backdrop-blur pb-safe">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors ${
                  activeTab === tab.id
                    ? 'text-accent'
                    : 'text-text-muted hover:text-text-primary'
                }`}
              >
                <span className="text-[10px] font-medium">{tab.label}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {/* 详情视图 */}
      {view === 'detail' && (
        <div className="flex flex-col h-full">
          {/* 移动端顶部导航 */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border/40 bg-surface/80 backdrop-blur">
            <button
              onClick={handleBack}
              className="p-1.5 rounded-lg text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-medium text-text-primary flex-1 truncate">
              记忆详情
            </span>
          </div>

          {/* 详情内容 */}
          <div className="flex-1 overflow-hidden">
            <MemoryDetailPanel />
          </div>
        </div>
      )}
    </div>
  )
}

// ============ 响应式容器 ============
interface ResponsiveMemoryPageProps {
  onClose?: () => void
}

export function ResponsiveMemoryPage({ onClose }: ResponsiveMemoryPageProps) {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  if (isMobile) {
    return <MemoryMobileView />
  }

  // 桌面端使用标准 MemoryPage
  return <MemoryPage onClose={onClose} />
}
