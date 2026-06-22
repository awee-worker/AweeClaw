/**
 * 桌面控制中心面板
 * 提供应用启动、系统信息、进程管理、窗口控制、屏幕截图、输入模拟、文件操作七大功能
 * 通过 Tab 切换不同子页面
 */

import { useState } from 'react'
import { Monitor, AppWindow, Activity, Layers, Camera, MousePointerClick, FolderTree } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import { AppLauncherPanel } from './AppLauncherPanel'
import { SystemInfoPanel } from './SystemInfoPanel'
import { ProcessManagerPanel } from './ProcessManagerPanel'
import { WindowManagerPanel } from './WindowManagerPanel'
import { ScreenCapturePanel } from './ScreenCapturePanel'
import { InputSimulatorPanel } from './InputSimulatorPanel'
import { FileManagerPanel } from './FileManagerPanel'

type DesktopSubTab =
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
  const [activeTab, setActiveTab] = useState<DesktopSubTab>('apps')

  // 注：权限确认监听已提升到全局 AppContent，此处不再重复挂载

  const tabs = [
    { id: 'apps' as const, label: t('desktop.apps', language) || '应用启动', icon: <AppWindow className="w-4 h-4" /> },
    { id: 'system' as const, label: t('desktop.system', language) || '系统信息', icon: <Monitor className="w-4 h-4" /> },
    { id: 'processes' as const, label: t('desktop.processes', language) || '进程管理', icon: <Activity className="w-4 h-4" /> },
    { id: 'windows' as const, label: t('desktop.windows', language) || '窗口控制', icon: <Layers className="w-4 h-4" /> },
    { id: 'screenshot' as const, label: t('desktop.screenshot', language) || '屏幕截图', icon: <Camera className="w-4 h-4" /> },
    { id: 'input' as const, label: t('desktop.input', language) || '输入模拟', icon: <MousePointerClick className="w-4 h-4" /> },
    { id: 'files' as const, label: t('desktop.files', language) || '文件操作', icon: <FolderTree className="w-4 h-4" /> },
  ]

  return (
    <div className="flex flex-col h-full">
      {/* 子 Tab 切换 */}
      <div className="flex items-center gap-1 px-6 pt-4 pb-3 border-b border-border/40 flex-wrap">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'bg-accent/10 text-accent border border-accent/20'
                : 'text-text-secondary hover:bg-surface-hover border border-transparent'
            }`}
          >
            {tab.icon}
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto p-6">
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
