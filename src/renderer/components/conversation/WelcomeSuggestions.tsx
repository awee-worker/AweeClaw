import { useState, useCallback } from 'react'
import { useStore } from '@store'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import type { WelcomeTitleConfig } from '@shared/protocols/scenario'
import { Users, Sparkles, Rocket } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'

const DEFAULT_TITLE: WelcomeTitleConfig = {
  title: 'How can I help?',
  titleZh: '需要我帮您做什么？',
  subtitle: 'Choose a suggestion below, or ask me anything.',
  subtitleZh: '选择下方建议，或直接问我任何问题',
}

const TEAM_TITLE = {
  zh: '多智能体协作模式，AI 团队将协同完成复杂任务',
  en: 'Multi-agent collaboration — AI team works together on complex tasks',
}

const FREE_TITLE = {
  zh: '自主决策，连续执行，全程无需人工操作，权限高，需谨慎',
  en: 'Autonomous decisions, continuous execution, no manual operation required (high privileges, use with caution)',
}

type WorkTab = 'daily' | 'team' | 'free'

/**
 * 工作模式选择器是否展示。
 * 暂时隐藏「日常模式 | 团队模式 | 自由模式」选择器，
 * 新会话默认进入日常模式。后续需要恢复时改为 true 即可。
 */
const SHOW_WORK_MODE_SELECTOR = false

export default function EmptyChatSuggestions() {
  const language = useStore(s => s.language)
  const activeScenarioId = useStore(s => s.activeScenarioId)
  const teamModeEnabled = useStore(s => s.teamModeEnabled)
  const freeModeEnabled = useStore(s => s.freeModeEnabled)
  const setTeamModeEnabled = useStore(s => s.setTeamModeEnabled)
  const setFreeModeEnabled = useStore(s => s.setFreeModeEnabled)

  const [activeWorkTab, setActiveWorkTab] = useState<WorkTab>(
    freeModeEnabled ? 'free' : teamModeEnabled ? 'team' : 'daily'
  )

  const scenario = scenarioRegistry.get(activeScenarioId)
  const ui = scenario?.ui
  const titleConfig = ui?.welcomeTitle || DEFAULT_TITLE

  const handleWorkTabChange = useCallback((tab: WorkTab) => {
    setActiveWorkTab(tab)
    // 自由模式与团队模式互斥；日常模式关闭两者
    setTeamModeEnabled(tab === 'team')
    setFreeModeEnabled(tab === 'free')
  }, [setTeamModeEnabled, setFreeModeEnabled])

  const displayTitle = activeWorkTab === 'team'
    ? (language === 'zh' ? TEAM_TITLE.zh : TEAM_TITLE.en)
    : activeWorkTab === 'free'
      ? (language === 'zh' ? FREE_TITLE.zh : FREE_TITLE.en)
      : (language === 'zh' ? titleConfig.titleZh : titleConfig.title)

  // 三等分指示器宽度计算
  const indicatorLeft = activeWorkTab === 'daily' ? '4px' : activeWorkTab === 'team' ? 'calc(33.333% + 0px)' : 'calc(66.666% - 4px)'

  // 选择器隐藏时仅展示标题，去除原标题与选择器之间的大间距
  const contentGap = SHOW_WORK_MODE_SELECTOR ? 'gap-[66px]' : ''

  return (
    <div className="flex flex-col items-center w-full select-none">
      <div className={`flex flex-col items-center w-full max-w-[800px] ${contentGap}`}>
        <h1 className="text-3xl font-bold text-text-primary tracking-tight text-center">
          {displayTitle}
        </h1>

        {SHOW_WORK_MODE_SELECTOR && (
          <div className="relative flex items-center bg-surface/40 rounded-full p-1 border border-border/50 shadow-sm">
            <div
              className="absolute top-1 bottom-1 rounded-full bg-surface-active/80 shadow-sm transition-all duration-300 ease-out"
              style={{
                left: indicatorLeft,
                width: 'calc(33.333% - 4px)',
              }}
            />
            <button
              onClick={() => handleWorkTabChange('daily')}
              className={`
                relative z-10 flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold
                transition-colors duration-300
                ${activeWorkTab === 'daily'
                  ? 'text-text-primary'
                  : 'text-text-muted hover:text-text-secondary'
                }
              `}
            >
              <Sparkles className="w-4 h-4" />
              <span>{t('app.daily', language as Language)}</span>
            </button>

            <button
              onClick={() => handleWorkTabChange('team')}
              className={`
                relative z-10 flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold
                transition-colors duration-300
                ${activeWorkTab === 'team'
                  ? 'text-accent'
                  : 'text-text-muted hover:text-accent/70'
                }
              `}
            >
              <Users className="w-4 h-4" />
              <span>{t('app.team', language as Language)}</span>
            </button>

            <button
              onClick={() => handleWorkTabChange('free')}
              className={`
                relative z-10 flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold
                transition-colors duration-300
                ${activeWorkTab === 'free'
                  ? 'text-emerald-500'
                  : 'text-text-muted hover:text-emerald-500/70'
                }
              `}
            >
              <Rocket className="w-4 h-4" />
              <span>{t('app.freeMode', language as Language)}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
