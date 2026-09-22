/**
 * 电脑控制中心面板
 * 提供应用启动、系统信息、进程管理、窗口控制、屏幕截图、输入模拟、文件操作七大功能
 * 通过 Tab 切换不同子页面
 * 底部的电脑控制插件（computer-use）引导：未安装时提示用户前往插件市场，
 * 因为本页手动功能走 IPC 不依赖插件，而 AI 操控电脑必须依赖该插件。
 */

import { useEffect, useState } from 'react'
import { Monitor, AppWindow, Activity, Layers, Camera, MousePointerClick, FolderTree, ShieldCheck, Puzzle, ExternalLink } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { useStore } from '@store'
import { isPluginInstalled } from '@services/pluginService'
import { AppLauncherPanel } from './AppLauncherPanel'
import { SystemInfoPanel } from './SystemInfoPanel'
import { ProcessManagerPanel } from './ProcessManagerPanel'
import { WindowManagerPanel } from './WindowManagerPanel'
import { ScreenCapturePanel } from './ScreenCapturePanel'
import { InputSimulatorPanel } from './InputSimulatorPanel'
import { FileManagerPanel } from './FileManagerPanel'
import { PermissionStatusPanel } from './PermissionStatusPanel'

type DesktopSubTab =
  | 'permission'
  | 'apps'
  | 'system'
  | 'processes'
  | 'windows'
  | 'screenshot'
  | 'input'
  | 'files'

interface DesktopControlPanelProps {
  language: Language
}

export function DesktopControlPanel({ language }: DesktopControlPanelProps) {
  const [activeTab, setActiveTab] = useState<DesktopSubTab>('permission')
  const [pluginInstalled, setPluginInstalled] = useState<boolean | null>(null)

  // 注：权限确认监听已提升到全局 AppContent，此处不再重复挂载

  // 检查电脑控制插件（computer-use）安装状态，未安装时展示引导条
  useEffect(() => {
    let cancelled = false
    isPluginInstalled('computer-use')
      .then((installed) => { if (!cancelled) setPluginInstalled(installed) })
      .catch(() => { if (!cancelled) setPluginInstalled(null) })
    return () => { cancelled = true }
  }, [])

  // 关闭设置页/设置弹窗，跳转插件中心
  const handleOpenPluginCenter = () => {
    const store = useStore.getState()
    store.setShowSettings(false)
    store.setShowSettingsPage(false)
    store.setShowPluginCenterPage(true)
  }
  const tabs = [
    { id: 'permission' as const, label: t('desktop.permission.title', language) || '权限状态', icon: <ShieldCheck className="w-4 h-4" /> },
    { id: 'apps' as const, label: t('desktop.apps', language) || '应用启动', icon: <AppWindow className="w-4 h-4" /> },
    { id: 'system' as const, label: t('desktop.system', language) || '系统信息', icon: <Monitor className="w-4 h-4" /> },
    { id: 'processes' as const, label: t('desktop.processes', language) || '进程管理', icon: <Activity className="w-4 h-4" /> },
    { id: 'windows' as const, label: t('desktop.windows', language) || '窗口控制', icon: <Layers className="w-4 h-4" /> },
    { id: 'screenshot' as const, label: t('desktop.screenshot', language) || '屏幕截图', icon: <Camera className="w-4 h-4" /> },
    { id: 'input' as const, label: t('desktop.input', language) || '输入模拟', icon: <MousePointerClick className="w-4 h-4" /> },
    { id: 'files' as const, label: t('desktop.files', language) || '文件操作', icon: <FolderTree className="w-4 h-4" /> },
  ]

  return (
    <div className="flex h-full">
      {/* 左侧导航菜单 */}
      <nav className="w-44 shrink-0 border-r border-border/40 bg-surface/20 backdrop-blur-sm p-3 space-y-1 overflow-y-auto no-scrollbar">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors group ${
              activeTab === tab.id
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary border border-transparent'
            }`}
          >
            <span className={`transition-colors ${activeTab === tab.id ? 'text-accent' : 'text-text-muted group-hover:text-text-primary'}`}>
              {tab.icon}
            </span>
            <span>{tab.label}</span>
          </button>
        ))}
      </nav>

      {/* 右侧内容区 */}
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
        {/* 电脑控制插件未安装引导条 */}
        {pluginInstalled === false && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <div className="mt-0.5 shrink-0 p-1.5 rounded-lg bg-amber-500/15">
              <Puzzle className="w-4 h-4 text-amber-500" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary">
                {t('desktop.plugin.guide.title', language) || '未安装「电脑控制」插件'}
              </p>
              <p className="text-xs text-text-muted mt-1 leading-relaxed">
                {t('desktop.plugin.guide.desc', language) || '本页手动功能无需插件即可使用；安装「电脑控制」插件后，AI 才能截屏、模拟鼠标键盘来操控这台电脑。'}
              </p>
            </div>
            <button
              onClick={handleOpenPluginCenter}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-500/15 text-amber-500 border border-amber-500/30 hover:bg-amber-500/25 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {t('desktop.plugin.guide.install', language) || '前往插件市场'}
            </button>
          </div>
        )}

        {activeTab === 'permission' && <PermissionStatusPanel />}
        {activeTab === 'apps' && <AppLauncherPanel language={language} />}
        {activeTab === 'system' && <SystemInfoPanel language={language} />}
        {activeTab === 'processes' && <ProcessManagerPanel language={language} />}
        {activeTab === 'windows' && <WindowManagerPanel language={language} />}
        {activeTab === 'screenshot' && <ScreenCapturePanel language={language} />}
        {activeTab === 'input' && <InputSimulatorPanel language={language} />}
        {activeTab === 'files' && <FileManagerPanel language={language} />}
      </div>
    </div>
  )
}

export default DesktopControlPanel
