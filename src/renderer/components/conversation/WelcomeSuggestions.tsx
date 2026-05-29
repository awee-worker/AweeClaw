import { useState, useCallback } from 'react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import type { WelcomeTitleConfig } from '@shared/protocols/scenario'
import { Users, Sparkles } from 'lucide-react'

const DEFAULT_TITLE: WelcomeTitleConfig = {
  title: 'How can I help?',
  titleZh: '有什么可以帮您的？',
  subtitle: 'Choose a suggestion below, or ask me anything.',
  subtitleZh: '选择下方建议，或直接问我任何问题',
}

const TEAM_TITLE = {
  zh: '多智能体协作模式，AI 团队将协同完成复杂任务',
  en: 'Multi-agent collaboration — AI team works together on complex tasks',
}

export default function EmptyChatSuggestions() {
  const language = useStore(s => s.language)
  const activeScenarioId = useStore(s => s.activeScenarioId)
  const teamModeEnabled = useStore(s => s.teamModeEnabled)
  const setTeamModeEnabled = useStore(s => s.setTeamModeEnabled)

  const [activeWorkTab, setActiveWorkTab] = useState<'daily' | 'team'>(teamModeEnabled ? 'team' : 'daily')

  const scenario = scenarioRegistry.get(activeScenarioId)
  const ui = scenario?.ui
  const titleConfig = ui?.welcomeTitle || DEFAULT_TITLE

  const handleWorkTabChange = useCallback((tab: 'daily' | 'team') => {
    setActiveWorkTab(tab)
    setTeamModeEnabled(tab === 'team')
  }, [setTeamModeEnabled])

  const displayTitle = activeWorkTab === 'team'
    ? (language === 'zh' ? TEAM_TITLE.zh : TEAM_TITLE.en)
    : (language === 'zh' ? titleConfig.titleZh : titleConfig.title)

  return (
    <div className="flex flex-col items-center w-full select-none z-10">
      <div className="flex flex-col items-center w-full max-w-[640px] gap-6">
        <h1 className="text-3xl font-bold text-text-primary tracking-tight text-center">
          {displayTitle}
        </h1>

        <div className="relative flex items-center bg-surface/40 rounded-full p-1 border border-border/50 shadow-sm">
          <div
            className="absolute top-1 bottom-1 rounded-full bg-surface-active/80 shadow-sm transition-all duration-300 ease-out"
            style={{
              left: activeWorkTab === 'daily' ? '4px' : '50%',
              width: 'calc(50% - 4px)',
            }}
          />
          <button
            onClick={() => handleWorkTabChange('daily')}
            className={`
              relative z-10 flex items-center gap-2 px-6 py-2 rounded-full text-sm font-semibold
              transition-colors duration-300
              ${activeWorkTab === 'daily'
                ? 'text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
              }
            `}
          >
            <Sparkles className="w-4 h-4" />
            <span>{language === 'zh' ? '日常模式' : 'Daily'}</span>
          </button>

          <button
            onClick={() => handleWorkTabChange('team')}
            className={`
              relative z-10 flex items-center gap-2 px-6 py-2 rounded-full text-sm font-semibold
              transition-colors duration-300
              ${activeWorkTab === 'team'
                ? 'text-orange-400'
                : 'text-text-muted hover:text-orange-400/70'
              }
            `}
          >
            <Users className="w-4 h-4" />
            <span>{language === 'zh' ? '团队模式' : 'Team'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
