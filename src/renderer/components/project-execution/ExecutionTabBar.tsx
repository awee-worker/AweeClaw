/**
 * ExecutionTabBar — 多项目执行 Tab 栏
 *
 * 当执行窗口有多个项目 Tab 时显示，支持切换和关闭。
 *
 * 布局：
 * ┌──────────────────────────────────────────────┐
 * │  [● 项目A]  [○ 项目B]  [○ 项目C]              │
 * └──────────────────────────────────────────────┘
 *
 * - 每个 Tab 显示项目名 + 状态指示点（运行中=蓝色脉动 / 空闲=灰色）
 * - 点击 Tab 切换激活
 * - Tab 右侧关闭按钮关闭该 Tab
 * - 无 Tab 剩余时窗口自动关闭（由父组件处理）
 */

import { X } from 'lucide-react'
import type { ExecutionTab } from './types'

interface ExecutionTabBarProps {
  tabs: ExecutionTab[]
  activeTabId: string
  onSwitch: (tabId: string) => void
  onClose: (tabId: string) => void
}

export function ExecutionTabBar({ tabs, activeTabId, onSwitch, onClose }: ExecutionTabBarProps) {
  return (
    <div className="flex-shrink-0 flex items-center gap-1 px-2 h-9 bg-surface/20 border-b border-border/30 overflow-x-auto custom-scrollbar">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId
        return (
          <div
            key={tab.id}
            onClick={() => onSwitch(tab.id)}
            className={`group flex items-center gap-1.5 px-3 h-7 rounded-md cursor-pointer transition-colors flex-shrink-0 ${
              isActive
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-text-muted hover:bg-surface-hover/40 hover:text-text-primary border border-transparent'
            }`}
          >
            {/* 状态指示点 */}
            <span
              className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                isActive ? 'bg-accent animate-pulse' : 'bg-slate-500'
              }`}
            />
            {/* 项目名 */}
            <span className="text-[12px] font-medium max-w-[120px] truncate" title={tab.projectName}>
              {tab.projectName}
            </span>
            {/* 关闭按钮 */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(tab.id)
              }}
              className="p-0.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100"
              title="关闭 Tab"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
