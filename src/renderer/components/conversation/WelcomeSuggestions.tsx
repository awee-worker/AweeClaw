/**
 * 空对话态欢迎屏
 *
 * UI1：问候语随场景模式变化，多句轮换
 * UI3：模式相关的快捷引导卡片，点击直接发送
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/06-ui-differentiation.md}
 */

import { useState, useCallback, useMemo, useRef } from 'react'
import { useStore } from '@store'
import { useSceneModeStore } from '@renderer/modes/sceneModeStore'
import * as LucideIcons from 'lucide-react'
import { Users, Sparkles, Rocket } from 'lucide-react'
import { t, type Language } from '@renderer/i18n'
import type { TimePeriod } from '@intelligence/capabilities/sceneMode/SceneModeDescriptor'

const DEFAULT_TITLE_ZH = '需要我帮您做什么？'
const DEFAULT_TITLE_EN = 'How can I help?'

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

/**
 * 从 lucide-react 动态获取图标组件
 */
function getIconComponent(name: string): React.ComponentType<{ className?: string; strokeWidth?: number }> {
  const Comp = (LucideIcons as Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>>)[name]
  return Comp ?? Sparkles
}

export default function EmptyChatSuggestions() {
  const language = useStore(s => s.language)
  const teamModeEnabled = useStore(s => s.teamModeEnabled)
  const freeModeEnabled = useStore(s => s.freeModeEnabled)
  const setTeamModeEnabled = useStore(s => s.setTeamModeEnabled)
  const setFreeModeEnabled = useStore(s => s.setFreeModeEnabled)

  const { activeProfile, currentSceneMode } = useSceneModeStore()
  const isZh = language === 'zh'

  const [activeWorkTab, setActiveWorkTab] = useState<WorkTab>(
    freeModeEnabled ? 'free' : teamModeEnabled ? 'team' : 'daily'
  )

  // ── UI1：问候语轮换 ──
  // 模式切换时重新随机，避免连续相同
  const lastGreetingRef = useRef<string>('')

  /** 根据当前小时映射问候时段 */
  const getTimePeriod = (hour: number): TimePeriod => {
    if (hour >= 5 && hour < 11) return 'morning'
    if (hour >= 11 && hour < 13) return 'noon'
    if (hour >= 13 && hour < 18) return 'afternoon'
    if (hour >= 18 && hour < 23) return 'evening'
    return 'night'
  }

  const greeting = useMemo(() => {
    const greetings = activeProfile.greetings
    // 时段问候：按当前时间动态选择，保证早上/中午/下午/晚上文案与真实时间一致
    const timeGreetings = greetings?.timeGreetings
    if (timeGreetings) {
      const period = getTimePeriod(new Date().getHours())
      const pool = isZh ? timeGreetings.zh : timeGreetings.en
      const timeGreeting = pool?.[period]
      // 50% 概率优先展示时段问候，其余从静态池轮换，兼顾准确与自然
      if (timeGreeting && Math.random() < 0.5) {
        lastGreetingRef.current = timeGreeting
        return timeGreeting
      }
    }
    if (!greetings) {
      return isZh ? DEFAULT_TITLE_ZH : DEFAULT_TITLE_EN
    }
    const pool = isZh ? greetings.zh : greetings.en
    if (!pool || pool.length === 0) {
      return isZh ? DEFAULT_TITLE_ZH : DEFAULT_TITLE_EN
    }
    if (pool.length === 1) return pool[0]
    // 排除上次的选择，避免连续相同
    const candidates = pool.filter(g => g !== lastGreetingRef.current)
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    lastGreetingRef.current = pick
    return pick
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSceneMode, isZh, activeProfile])

  const handleWorkTabChange = useCallback((tab: WorkTab) => {
    setActiveWorkTab(tab)
    setTeamModeEnabled(tab === 'team')
    setFreeModeEnabled(tab === 'free')
  }, [setTeamModeEnabled, setFreeModeEnabled])

  // 团队/自由模式覆盖问候语
  const displayTitle = activeWorkTab === 'team'
    ? (isZh ? TEAM_TITLE.zh : TEAM_TITLE.en)
    : activeWorkTab === 'free'
      ? (isZh ? FREE_TITLE.zh : FREE_TITLE.en)
      : greeting

  // 三等分指示器宽度计算
  const indicatorLeft = activeWorkTab === 'daily' ? '4px' : activeWorkTab === 'team' ? 'calc(33.333% + 0px)' : 'calc(66.666% - 4px)'

  // 选择器隐藏时仅展示标题，去除原标题与选择器之间的大间距
  const contentGap = SHOW_WORK_MODE_SELECTOR ? 'gap-[66px]' : ''

  // ── UI3：快捷引导卡片 ──
  const quickPrompts = activeProfile.quickPrompts ?? []

  // 点击卡片发送 prompt
  const handlePromptClick = useCallback((prompt: string) => {
    // 通过自定义事件通知 ChatPanel 发送
    window.dispatchEvent(new CustomEvent('aweeclaw:quick-prompt', { detail: prompt }))
  }, [])

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

        {/* UI3：快捷引导卡片 */}
        {quickPrompts.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-2 mt-6 max-w-[640px]">
            {quickPrompts.map((item, idx) => {
              const Icon = getIconComponent(item.icon)
              const label = isZh ? item.label : (item.labelEn ?? item.label)
              return (
                <button
                  key={`${item.icon}-${idx}`}
                  onClick={() => handlePromptClick(item.prompt)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-surface/60 border border-border/50 text-text-secondary hover:text-text-primary hover:border-accent/30 hover:bg-accent/5 transition-all duration-200"
                >
                  <Icon className="w-3.5 h-3.5" strokeWidth={1.5} />
                  <span>{label}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
