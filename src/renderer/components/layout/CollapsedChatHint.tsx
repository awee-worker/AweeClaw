/**
 * 会话面板收起提示
 *
 * 对话面板收起时只把外框 display:none 掉（见 chatFrame），不占位、也不卸载内容。
 * 主区域若同时没有其它内容（未打开文件、没有内置浏览器、底部面板不可见），整块
 * 区域就变成纯空白 —— 用户看不出面板去哪了，也找不到恢复入口。
 *
 * 这里在该位置给出说明，并把「从哪里恢复」讲清楚：右上角的会话面板开关。
 * 场景声明 hideChatToggle 时开关并不存在（见 SidebarTogglePart），此时不渲染
 * 提示，否则指路会指向一个不存在的按钮。
 */

import { PanelRight } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'

export function CollapsedChatHint() {
  const { language, setChatVisible, activeScenarioId } = useStore(
    useShallow((s) => ({
      language: s.language,
      setChatVisible: s.setChatVisible,
      activeScenarioId: s.activeScenarioId,
    })),
  )

  const scenarioChrome = scenarioRegistry.get(activeScenarioId)?.ui?.chrome
  if (scenarioChrome?.hideChatToggle === true) return null

  const isZh = language === 'zh'

  return (
    <div className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-6">
      <div className="max-w-[340px] text-center space-y-4 select-none">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-text-primary/[0.04] border border-border/50 flex items-center justify-center text-text-muted">
          <PanelRight className="w-5 h-5" />
        </div>

        <div className="space-y-1.5">
          <p className="text-[13px] font-medium text-text-primary">
            {isZh ? 'AI 会话面板已收起' : 'AI chat panel is collapsed'}
          </p>
          <p className="text-[12px] leading-relaxed text-text-muted">
            {isZh
              ? '点击右上角的会话面板按钮即可重新展开，也可以直接点下面的按钮打开。'
              : 'Click the chat panel button in the top-right corner to reopen it, or use the button below.'}
          </p>
        </div>

        <button
          onClick={() => setChatVisible(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-accent hover:bg-accent-hover text-white text-[12px] font-medium transition-colors"
        >
          <PanelRight className="w-3.5 h-3.5" />
          {isZh ? '打开会话面板' : 'Open chat panel'}
        </button>
      </div>
    </div>
  )
}

export default CollapsedChatHint
