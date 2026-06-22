/**
 * 记忆系统主页面
 * 整合列表视图、统计面板、健康报告、设置面板
 */
import { useEffect, useState, useCallback } from 'react'
import { List, BarChart3, Heart, Settings, Shield, X } from 'lucide-react'
import { useMemoryStore } from './store'
import { MemoryListView } from './components/MemoryListView'
import { MemoryDetailPanel } from './components/MemoryDetailPanel'
import { MemoryStatsPanel } from './components/MemoryStatsPanel'
import { MemoryHealthReport } from './components/MemoryHealthReport'
import { MemorySettingsPanel } from './components/MemorySettingsPanel'
import { MemoryPrivacyClear } from './components/MemoryPrivacyClear'

type MainTab = 'list' | 'stats' | 'health' | 'settings' | 'privacy'

const TABS: Array<{ id: MainTab; label: string; icon: typeof List }> = [
  { id: 'list', label: '记忆列表', icon: List },
  { id: 'stats', label: '统计面板', icon: BarChart3 },
  { id: 'health', label: '健康报告', icon: Heart },
  { id: 'settings', label: '设置', icon: Settings },
  { id: 'privacy', label: '隐私清除', icon: Shield },
]

interface MemoryPageProps {
  onClose?: () => void
}

export default function MemoryPage({ onClose }: MemoryPageProps = {}) {
  const { fetchCategories, fetchOverview, reset, showDetailPanel } = useMemoryStore()
  const [activeTab, setActiveTab] = useState<MainTab>('list')

  // 初始化加载
  useEffect(() => {
    fetchCategories()
    fetchOverview()
    return () => {
      reset()
    }
  }, [fetchCategories, fetchOverview, reset])

  const handleTabChange = useCallback((tab: MainTab) => {
    setActiveTab(tab)
  }, [])

  return (
    <div className="flex flex-col h-full bg-bg-base/30">
      {/* 顶部 Tab 栏 */}
      <div className="flex items-center justify-between px-4 pt-3 pb-0 border-b border-border/40 bg-surface/20">
        <div className="flex items-center gap-1">
          {TABS.map((tab) => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'text-accent border-accent'
                    : 'text-text-muted hover:text-text-primary border-transparent'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            )
          })}
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* 内容区 */}
      <div className="flex flex-1 overflow-hidden relative">
        {/* 主内容 */}
        <div className="flex-1 min-w-0 overflow-hidden">
          {activeTab === 'list' && <MemoryListView />}
          {activeTab === 'stats' && <MemoryStatsPanel />}
          {activeTab === 'health' && <MemoryHealthReport />}
          {activeTab === 'settings' && <MemorySettingsPanel />}
          {activeTab === 'privacy' && <MemoryPrivacyClear />}
        </div>

        {/* 悬浮详情面板（不影响主内容排版） */}
        {activeTab === 'list' && showDetailPanel && (
          <div className="absolute top-0 right-0 bottom-0 z-20 shadow-2xl">
            <MemoryDetailPanel floating />
          </div>
        )}
      </div>
    </div>
  )
}
