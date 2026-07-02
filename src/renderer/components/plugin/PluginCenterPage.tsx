/**
 * PluginCenterPage — 插件中心全屏页面
 *
 * 作为插件功能的统一入口，整合：
 *   - 插件市场（浏览 / 搜索 / 安装 / 付费购买）
 *   - 已安装（启用 / 禁用 / 卸载 / 更新）
 *
 * 布局参考 BillingCenterPage：左侧 Tab 导航 + 右侧内容区。
 * 每个子面板保持独立组件，便于后续扩展「开发者上传」「插件设置」等 Tab。
 */
import { useState, useCallback } from 'react'
import { Puzzle, Store, Package, X } from 'lucide-react'
import { useStore } from '@store'
import { useShallow } from 'zustand/react/shallow'
import { PluginMarketplacePanel } from './PluginMarketplacePanel'
import { PluginInstalledPanel } from './PluginInstalledPanel'
import { t, type Language } from '@renderer/i18n'

type PluginTab = 'marketplace' | 'installed'

const pluginTabs: { id: PluginTab; icon: React.ReactNode; labelZh: string; labelEn: string }[] = [
  { id: 'marketplace', icon: <Store className="w-4 h-4" />, labelZh: '插件市场', labelEn: 'Marketplace' },
  { id: 'installed', icon: <Package className="w-4 h-4" />, labelZh: '已安装', labelEn: 'Installed' },
]

export default function PluginCenterPage() {
  const { language, setShowPluginCenterPage } = useStore(
    useShallow((s) => ({
      language: s.language,
      setShowPluginCenterPage: s.setShowPluginCenterPage,
    })),
  )

  const [activeTab, setActiveTab] = useState<PluginTab>('marketplace')

  const handleClose = useCallback(() => {
    setShowPluginCenterPage(false)
  }, [setShowPluginCenterPage])

  const lang = language as Language

  return (
    <div className="flex h-full">
      {/* 左侧导航 */}
      <div className="bg-surface/30 backdrop-blur-xl flex flex-col pt-8 pb-6 w-56">
        <div className="px-6 mb-6">
          <h2 className="text-lg font-semibold text-text-primary tracking-tight flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-accent/10 border border-accent/20">
              <Puzzle className="w-5 h-5 text-accent" />
            </div>
            {t('layout.plugins', lang)}
          </h2>
        </div>

        <nav className="flex-1 p-4 space-y-1 overflow-y-auto no-scrollbar">
          {pluginTabs.map((tab) => (
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
                  activeTab === tab.id
                    ? 'text-accent'
                    : 'text-text-muted group-hover:text-text-primary'
                }`}
              >
                {tab.icon}
              </span>
              <span>{lang === 'zh' ? tab.labelZh : tab.labelEn}</span>
            </button>
          ))}
        </nav>
      </div>

      {/* 右侧内容 */}
      <div className="flex-1 flex justify-center overflow-hidden">
        <div className="w-full max-w-[1000px] flex flex-col min-w-0 bg-transparent relative">
          {/* 顶部标题栏 */}
          <div className="shrink-0 px-8 pt-6 pb-4 border-b border-border/40 flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-semibold text-text-primary tracking-tight">
                {lang === 'zh'
                  ? pluginTabs.find((tab) => tab.id === activeTab)?.labelZh
                  : pluginTabs.find((tab) => tab.id === activeTab)?.labelEn}
              </h3>
              <p className="text-sm text-text-muted mt-1.5 opacity-80">
                {lang === 'zh'
                  ? '发现、安装并管理你的插件'
                  : 'Discover, install and manage your plugins'}
              </p>
            </div>
            <button
              onClick={handleClose}
              className="p-2 rounded-xl hover:bg-text-primary/[0.05] text-text-muted hover:text-text-primary transition-all duration-200 group"
              title={t('user.close', lang)}
            >
              <X className="w-5 h-5 group-hover:rotate-90 transition-transform duration-300" />
            </button>
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
