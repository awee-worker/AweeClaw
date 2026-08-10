/**
 * PluginMarketView — 插件与技能市场工作台（宽屏模式）
 *
 * 作为通用助手场景左侧导航的「插件与技能市场」面板入口，整合：
 *   - 插件市场（浏览 / 搜索 / 安装 / 付费购买）
 *   - 已安装（启用 / 禁用 / 卸载 / 更新）
 *
 * 与 PluginCenterPage（全屏页面，由左下角用户菜单打开）的区别：
 *   本组件作为侧边栏 wideMode 面板渲染，无需「返回应用」按钮——
 *   侧边栏导航本身提供切换能力（点击其他菜单项或再次点击当前图标即可收起）。
 *   两个入口共用 PluginMarketplacePanel / PluginInstalledPanel 子面板，保持体验一致。
 *
 * 布局结构：
 * ┌────────────┬──────────────────────────────────────┐
 * │  Tab 导航   │  标题栏（当前 Tab 名称 + 副标题）     │
 * │  (左侧)    │  ─────────────────────────           │
 * │  插件市场   │  内容区（滚动）                       │
 * │  已安装     │                                      │
 * └────────────┴──────────────────────────────────────┘
 */
import { useState } from 'react'
import { Store, Package } from 'lucide-react'
import { useStore } from '@store'
import { PluginMarketplacePanel } from '@components/plugin/PluginMarketplacePanel'
import { PluginInstalledPanel } from '@components/plugin/PluginInstalledPanel'

type PluginTab = 'marketplace' | 'installed'

interface TabDescriptor {
  id: PluginTab
  icon: React.ReactNode
  label: string
}

export function PluginMarketView() {
  const language = useStore(s => s.language)
  const isZh = language === 'zh'

  const [activeTab, setActiveTab] = useState<PluginTab>('marketplace')

  const tabs: TabDescriptor[] = [
    { id: 'marketplace', icon: <Store className="w-4 h-4" />, label: isZh ? '插件与技能市场' : 'Plugin & Skill Market' },
    { id: 'installed', icon: <Package className="w-4 h-4" />, label: isZh ? '已安装' : 'Installed' },
  ]

  const currentTab = tabs.find(t => t.id === activeTab) ?? tabs[0]
  const subtitle = isZh ? '发现、安装并管理你的插件与技能' : 'Discover, install and manage your plugins & skills'

  return (
    <div className="flex h-full w-full relative">
      {/* 左侧 Tab 导航 */}
      <div className="bg-surface/30 backdrop-blur-xl flex flex-col pt-10 pb-6 w-56 border-r border-border/40 shadow-xl shadow-black/10">
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 group ${
                activeTab === tab.id
                  ? 'bg-accent/10 text-text-primary border border-accent/20'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'
              }`}
            >
              <span
                className={`transition-colors duration-200 ${
                  activeTab === tab.id ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'
                }`}
              >
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 flex justify-center overflow-hidden">
        <div className="w-full max-w-[1000px] flex flex-col min-w-0 bg-transparent relative">
          {/* 顶部标题栏 */}
          <div className="shrink-0 px-8 pt-10 pb-4 border-b border-border/40 drag-region">
            <div className="no-drag">
              <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
                {currentTab.label}
              </h3>
              <p className="text-sm text-text-muted mt-1.5 opacity-80">{subtitle}</p>
            </div>
          </div>

          {/* 内容区 */}
          <div className="flex-1 overflow-y-auto px-8 py-6 custom-scrollbar">
            <div className="space-y-6 h-full">
              {activeTab === 'marketplace' && <PluginMarketplacePanel key="marketplace" />}
              {activeTab === 'installed' && <PluginInstalledPanel key="installed" />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PluginMarketView
