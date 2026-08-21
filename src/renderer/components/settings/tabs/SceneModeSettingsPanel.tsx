/**
 * 场景模式设置面板（方向3）
 *
 * 提供以下功能：
 * 1. 当前模式展示与快速切换
 * 2. 三模式配置预览（人设、技能、Cron、规则）
 * 3. 时间自动切换开关
 * 4. 使用统计（各模式累计时长 + 占比）
 * 5. 数据迁移（知识库域迁移）
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/05-extensions.md} 方向3 设计
 */

import { useState, useMemo } from 'react'
import { useSceneModeStore, type ModeUsageStats } from '@renderer/modes/sceneModeStore'
import { sceneModeRegistry } from '@intelligence/capabilities/sceneMode/SceneModeRegistry'
import type { SceneModeProfile } from '@intelligence/capabilities/sceneMode/SceneModeDescriptor'
import type { SceneMode } from '@protocols/sceneModeProtocol'
import { knowledgeService } from '@intelligence/runtime/knowledgeService'
import { sceneCronManager } from '@intelligence/capabilities/sceneMode/sceneCronManager'
import { toast } from '@components/foundation/InlineNotification'
import { logger } from '@toolkit/LogEngine'
import {
  Briefcase,
  Home,
  BookOpen,
  Clock,
  TrendingUp,
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  Zap,
  CalendarClock,
  Sparkles,
} from 'lucide-react'

/** 模式图标映射 */
const MODE_ICONS: Record<SceneMode, typeof Briefcase> = {
  work: Briefcase,
  life: Home,
  study: BookOpen,
}

/** 模式主题色映射 */
const MODE_COLORS: Record<SceneMode, string> = {
  work: '#3b82f6',
  life: '#10b981',
  study: '#8b5cf6',
}

/** 格式化时长（秒 → 可读字符串） */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}秒`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`
}

/** 单个模式配置卡片 */
function ModeProfileCard({ profile, isCurrent, onSelect }: {
  profile: SceneModeProfile
  isCurrent: boolean
  onSelect: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const Icon = MODE_ICONS[profile.id] ?? Briefcase
  const color = MODE_COLORS[profile.id] ?? '#3b82f6'

  return (
    <div
      className={`rounded-lg border transition-all ${
        isCurrent ? 'border-accent shadow-md' : 'border-border hover:border-border-hover'
      }`}
      style={isCurrent ? { borderColor: color } : undefined}
    >
      {/* 头部：模式名 + 切换按钮 */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-text-muted hover:text-text flex-shrink-0"
            aria-label={expanded ? '收起' : '展开'}
          >
            {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: `${color}20` }}
          >
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-text truncate">
              {profile.displayNameZh}
              {isCurrent && (
                <span className="ml-2 text-xs text-accent">当前</span>
              )}
            </div>
            <div className="text-xs text-text-muted truncate">{profile.description}</div>
          </div>
        </div>
        {!isCurrent && (
          <button
            onClick={onSelect}
            className="ml-2 px-3 py-1 text-xs bg-accent/10 text-accent hover:bg-accent/20 rounded transition-colors flex-shrink-0"
          >
            切换
          </button>
        )}
      </div>

      {/* 展开内容：配置详情 */}
      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
          {/* 人设提示词 */}
          <div>
            <div className="text-xs font-medium text-text-muted mb-1">人设提示词</div>
            <div className="text-xs text-text bg-bg-hover rounded p-2 line-clamp-3">
              {profile.personaPrompt}
            </div>
          </div>

          {/* 技能集 */}
          <div>
            <div className="text-xs font-medium text-text-muted mb-1">
              技能集（{profile.modeSkills.length}）
            </div>
            <div className="flex flex-wrap gap-1">
              {profile.modeSkills.map((id) => (
                <span key={id} className="text-xs bg-bg-hover text-text-muted px-2 py-0.5 rounded">
                  {id}
                </span>
              ))}
            </div>
          </div>

          {/* Cron 任务 */}
          {profile.cronJobs.length > 0 && (
            <div>
              <div className="text-xs font-medium text-text-muted mb-1">
                Cron 任务（{profile.cronJobs.length}）
              </div>
              <div className="space-y-1">
                {profile.cronJobs.map((job) => (
                  <div key={job.id} className="text-xs text-text-muted flex items-center gap-2">
                    <code className="bg-bg-hover px-1 rounded">{job.schedule}</code>
                    <span>{job.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 主动行为规则 */}
          {profile.proactiveRules.length > 0 && (
            <div>
              <div className="text-xs font-medium text-text-muted mb-1">
                主动行为规则（{profile.proactiveRules.length}）
              </div>
              <div className="space-y-1">
                {profile.proactiveRules.map((rule) => (
                  <div key={rule.id} className="text-xs text-text-muted">
                    <span className="font-medium">{rule.name}</span>
                    <span className="ml-2 text-text-disabled">{rule.condition}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 使用统计卡片 */
function UsageStatsCard({ stats }: { stats: ModeUsageStats }) {
  const modes: SceneMode[] = ['work', 'life', 'study']
  const total = stats.work + stats.life + stats.study

  const modeLabels: Record<SceneMode, string> = {
    work: '工作',
    life: '生活',
    study: '学习',
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 mb-3">
        <TrendingUp className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-medium text-text">使用统计</h3>
      </div>

      {total === 0 ? (
        <div className="text-xs text-text-muted text-center py-4">暂无统计数据</div>
      ) : (
        <div className="space-y-2">
          {modes.map((mode) => {
            const seconds = stats[mode]
            const percent = total > 0 ? Math.round((seconds / total) * 100) : 0
            const color = MODE_COLORS[mode]
            return (
              <div key={mode}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-text">{modeLabels[mode]}</span>
                  <span className="text-text-muted">
                    {formatDuration(seconds)} · {percent}%
                  </span>
                </div>
                <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${percent}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      <button
        onClick={() => useSceneModeStore.getState().resetModeUsageStats()}
        className="mt-3 text-xs text-text-muted hover:text-text transition-colors"
      >
        重置统计
      </button>
    </div>
  )
}

/** 数据迁移卡片 */
function DataMigrationCard() {
  const [sourceMode, setSourceMode] = useState<SceneMode>('work')
  const [targetMode, setTargetMode] = useState<SceneMode>('study')
  const [migrating, setMigrating] = useState(false)

  const modes: SceneMode[] = ['work', 'life', 'study']
  const modeLabels: Record<SceneMode, string> = {
    work: '工作模式',
    life: '生活模式',
    study: '学习模式',
  }

  const handleMigrate = async () => {
    if (sourceMode === targetMode) {
      toast.warning('源模式和目标模式不能相同')
      return
    }
    setMigrating(true)
    try {
      const sourceTag = `domain:${sourceMode}`
      const targetTag = `domain:${targetMode}`
      const count = await knowledgeService.migrateDomain(sourceTag, targetTag)
      if (count > 0) {
        toast.success(`已迁移 ${count} 条知识到${modeLabels[targetMode]}`)
      } else {
        toast.info(`${modeLabels[sourceMode]}中没有可迁移的知识`)
      }
    } catch (err) {
      logger.system.warn('[SceneModeSettings] Migration failed:', err)
      toast.error('迁移失败，请查看日志')
    } finally {
      setMigrating(false)
    }
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2 mb-3">
        <ArrowRightLeft className="w-4 h-4 text-accent" />
        <h3 className="text-sm font-medium text-text">数据迁移</h3>
      </div>

      <div className="text-xs text-text-muted mb-3">
        将知识库条目从一个模式的记忆域迁移到另一个模式
      </div>

      <div className="flex items-center gap-2">
        <select
          value={sourceMode}
          onChange={(e) => setSourceMode(e.target.value as SceneMode)}
          className="text-xs bg-bg-hover text-text rounded px-2 py-1 border border-border flex-1"
        >
          {modes.map((m) => (
            <option key={m} value={m}>{modeLabels[m]}</option>
          ))}
        </select>

        <ArrowRightLeft className="w-4 h-4 text-text-muted flex-shrink-0" />

        <select
          value={targetMode}
          onChange={(e) => setTargetMode(e.target.value as SceneMode)}
          className="text-xs bg-bg-hover text-text rounded px-2 py-1 border border-border flex-1"
        >
          {modes.map((m) => (
            <option key={m} value={m}>{modeLabels[m]}</option>
          ))}
        </select>
      </div>

      <button
        onClick={handleMigrate}
        disabled={migrating || sourceMode === targetMode}
        className="mt-3 w-full px-3 py-1.5 text-xs bg-accent/10 text-accent hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed rounded transition-colors"
      >
        {migrating ? '迁移中...' : '开始迁移'}
      </button>
    </div>
  )
}

/** Cron 任务频率选项 */
const CRON_FREQUENCY_OPTIONS = [
  { label: '每15分钟', value: '*/15 * * * *' },
  { label: '每30分钟', value: '*/30 * * * *' },
  { label: '每1小时', value: '0 * * * *' },
  { label: '每2小时', value: '0 */2 * * *' },
  { label: '每4小时', value: '0 */4 * * *' },
  { label: '每天', value: '0 9 * * *' },
  { label: '自定义', value: 'custom' },
]

/** Cron 任务管理卡片 */
function CronManagerCard() {
  const {
    currentSceneMode,
    cronGlobalEnabled,
    cronOverrides,
    setCronGlobalEnabled,
    setCronOverride,
    resetCronOverride,
  } = useSceneModeStore()

  const [refreshing, setRefreshing] = useState(false)

  const profile = sceneModeRegistry.getOrDefault(currentSceneMode)
  const cronJobs = profile.cronJobs ?? []

  const handleToggleGlobal = async (enabled: boolean) => {
    setCronGlobalEnabled(enabled)
    try {
      if (enabled) {
        await sceneCronManager.refreshCurrentMode()
        toast.success('已启用场景定时任务')
      } else {
        await sceneCronManager.pauseAllSceneCronJobs()
        toast.success('已暂停场景定时任务')
      }
    } catch (err) {
      logger.system.warn('[SceneModeSettings] Failed to toggle cron global:', err)
      toast.error('操作失败，请查看日志')
    }
  }

  const handleToggleJob = async (jobId: string, enabled: boolean) => {
    const key = `${currentSceneMode}:${jobId}`
    setCronOverride(key, { enabled })
    setRefreshing(true)
    try {
      await sceneCronManager.refreshCurrentMode()
    } catch (err) {
      logger.system.warn('[SceneModeSettings] Failed to refresh cron:', err)
    } finally {
      setRefreshing(false)
    }
  }

  const handleScheduleChange = async (jobId: string, schedule: string) => {
    if (schedule === 'custom') {
      toast.info('自定义频率请联系开发者配置')
      return
    }
    const key = `${currentSceneMode}:${jobId}`
    setCronOverride(key, { schedule })
    setRefreshing(true)
    try {
      await sceneCronManager.refreshCurrentMode()
      toast.success('频率已更新')
    } catch (err) {
      logger.system.warn('[SceneModeSettings] Failed to update schedule:', err)
    } finally {
      setRefreshing(false)
    }
  }

  const handleResetJob = async (jobId: string) => {
    const key = `${currentSceneMode}:${jobId}`
    resetCronOverride(key)
    setRefreshing(true)
    try {
      await sceneCronManager.refreshCurrentMode()
      toast.success('已恢复默认配置')
    } catch (err) {
      logger.system.warn('[SceneModeSettings] Failed to reset cron:', err)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-accent" />
          <h3 className="text-sm font-medium text-text">定时任务管理</h3>
        </div>
        <button
          onClick={() => void handleToggleGlobal(!cronGlobalEnabled)}
          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
            cronGlobalEnabled ? 'bg-accent' : 'bg-border'
          }`}
          aria-label={cronGlobalEnabled ? '关闭定时任务' : '开启定时任务'}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              cronGlobalEnabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {!cronGlobalEnabled && (
        <div className="text-xs text-text-muted mb-2">全局已关闭，所有定时任务暂停</div>
      )}

      {cronGlobalEnabled && (
        <div className="space-y-2">
          <div className="text-xs text-text-muted mb-1">
            当前模式：{profile.displayNameZh}（{cronJobs.length} 个任务）
          </div>
          {cronJobs.map((job) => {
            const overrideKey = `${currentSceneMode}:${job.id}`
            const override = cronOverrides[overrideKey]
            const isEnabled = override ? override.enabled : job.enabled
            const schedule = override?.schedule ?? job.schedule
            const isOverridden = !!override

            return (
              <div
                key={job.id}
                className="flex items-center gap-2 p-2 rounded border border-border bg-bg-hover/30"
              >
                <button
                  onClick={() => void handleToggleJob(job.id, !isEnabled)}
                  className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${
                    isEnabled ? 'bg-accent' : 'bg-border'
                  }`}
                  aria-label={isEnabled ? '关闭' : '开启'}
                >
                  <div
                    className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                      isEnabled ? 'translate-x-4' : 'translate-x-0.5'
                    }`}
                  />
                </button>

                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-text truncate">{job.name}</div>
                  <code className="text-xs text-text-muted">{schedule}</code>
                </div>

                <select
                  value={
                    CRON_FREQUENCY_OPTIONS.some(o => o.value === schedule)
                      ? schedule
                      : 'custom'
                  }
                  onChange={(e) => void handleScheduleChange(job.id, e.target.value)}
                  className="text-xs bg-bg-hover text-text rounded px-1.5 py-1 border border-border flex-shrink-0"
                  style={{ maxWidth: '100px' }}
                >
                  {CRON_FREQUENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                {isOverridden && (
                  <button
                    onClick={() => void handleResetJob(job.id)}
                    className="text-xs text-text-muted hover:text-text flex-shrink-0"
                    title="恢复默认"
                  >
                    重置
                  </button>
                )}
              </div>
            )
          })}
          {refreshing && (
            <div className="text-xs text-text-muted text-center">刷新中...</div>
          )}
        </div>
      )}
    </div>
  )
}

/** AI 智能主动模式卡片 */
function SmartProactiveCard() {
  const { smartProactiveEnabled, setSmartProactiveEnabled, canTriggerSmartProactive } =
    useSceneModeStore()

  const handleToggle = (enabled: boolean) => {
    setSmartProactiveEnabled(enabled)
    if (enabled) {
      toast.success('已开启 AI 智能主动模式')
    } else {
      toast.success('已关闭 AI 智能主动模式')
    }
  }

  const canTrigger = canTriggerSmartProactive()

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1">
          <Sparkles className="w-4 h-4 text-accent flex-shrink-0" />
          <div className="min-w-0">
            <h3 className="text-sm font-medium text-text">AI 智能主动模式</h3>
            <p className="text-xs text-text-muted mt-0.5">
              AI 根据当前模式和时段主动发起关怀提醒，每2小时最多1次
            </p>
          </div>
        </div>
        <button
          onClick={() => handleToggle(!smartProactiveEnabled)}
          className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
            smartProactiveEnabled ? 'bg-accent' : 'bg-border'
          }`}
          aria-label={smartProactiveEnabled ? '关闭智能主动模式' : '开启智能主动模式'}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              smartProactiveEnabled ? 'translate-x-5' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {smartProactiveEnabled && (
        <div className="mt-2 text-xs text-text-muted">
          状态：{canTrigger ? '可触发' : '冷却中（2小时限制）'}
        </div>
      )}
    </div>
  )
}

/** 场景模式设置面板主组件 */
export function SceneModeSettingsPanel() {
  const { currentSceneMode, setSceneMode, modeUsageStats, autoSwitchEnabled, setAutoSwitchEnabled } =
    useSceneModeStore()

  const profiles = useMemo(() => sceneModeRegistry.getAllProfiles(), [])

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <Zap className="w-5 h-5 text-accent" />
        <h2 className="text-base font-semibold text-text">场景模式</h2>
      </div>

      {/* 三模式卡片 */}
      <div className="space-y-2">
        {profiles.map((profile) => (
          <ModeProfileCard
            key={profile.id}
            profile={profile}
            isCurrent={currentSceneMode === profile.id}
            onSelect={() => void setSceneMode(profile.id)}
          />
        ))}
      </div>

      {/* 自动切换开关 */}
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-accent" />
            <div>
              <h3 className="text-sm font-medium text-text">时间自动切换</h3>
              <p className="text-xs text-text-muted mt-0.5">
                工作日 9-18 点自动切工作模式，晚间 19-23 点自动切生活模式
              </p>
            </div>
          </div>
          <button
            onClick={() => setAutoSwitchEnabled(!autoSwitchEnabled)}
            className={`relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
              autoSwitchEnabled ? 'bg-accent' : 'bg-border'
            }`}
            aria-label={autoSwitchEnabled ? '关闭自动切换' : '开启自动切换'}
          >
            <div
              className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                autoSwitchEnabled ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>

      {/* Cron 任务管理 */}
      <CronManagerCard />

      {/* AI 智能主动模式 */}
      <SmartProactiveCard />

      {/* 使用统计 */}
      <UsageStatsCard stats={modeUsageStats} />

      {/* 数据迁移 */}
      <DataMigrationCard />
    </div>
  )
}

export default SceneModeSettingsPanel
