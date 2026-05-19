import { useState, useCallback, useEffect } from 'react'
import { BarChart3, RefreshCw, ChevronDown, Clock, TrendingUp, BookOpen, Target } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton } from '@/renderer/components/ui'
import { TopicFilter } from './TopicFilter'

interface ProgressRecord {
  id: string
  subject_id: string
  topic: string
  status: string
  comprehension_score: number
  time_spent_minutes: number
  study_count: number
  last_accessed_at: string
  weak_areas: string
  notes: string
}

interface ReviewItem {
  id: string
  topic: string
  subject_id: string
  next_review_at: string
  interval_days: number
  review_count: number
  source_type: string
  status: string
}

const STATUS_CONFIG: Record<string, { zh: string; en: string; color: string; bg: string }> = {
  not_started: { zh: '未开始', en: 'Not Started', color: 'text-text-muted', bg: 'bg-surface-hover' },
  in_progress: { zh: '进行中', en: 'In Progress', color: 'text-blue-400', bg: 'bg-blue-500/10' },
  completed: { zh: '已完成', en: 'Completed', color: 'text-green-400', bg: 'bg-green-500/10' },
  review: { zh: '复习中', en: 'Reviewing', color: 'text-amber-400', bg: 'bg-amber-500/10' },
  mastered: { zh: '已掌握', en: 'Mastered', color: 'text-purple-400', bg: 'bg-purple-500/10' },
}

export function ProgressPanel() {
  const language = useStore(s => s.language)

  const [progressList, setProgressList] = useState<ProgressRecord[]>([])
  const [reviews, setReviews] = useState<ReviewItem[]>([])
  const [filterSubjectId, setFilterSubjectId] = useState('')
  const [filterTopicId, setFilterTopicId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'progress' | 'review'>('progress')

  const getDb = useCallback(async () => {
    const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
    return scenarioDatabaseManager
  }, [])

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const db = await getDb()
      const [progressResult, reviewResult] = await Promise.all([
        db.executeSql('education', 'SELECT * FROM learning_progress ORDER BY updated_at DESC'),
        db.executeSql('education', "SELECT * FROM review_schedule WHERE status = 'pending' ORDER BY next_review_at"),
      ])
      if (progressResult.success && progressResult.rows) {
        setProgressList(progressResult.rows as unknown as ProgressRecord[])
      }
      if (reviewResult.success && reviewResult.rows) {
        setReviews(reviewResult.rows as unknown as ReviewItem[])
      }
    } catch {
      setProgressList([])
      setReviews([])
    }
    setLoading(false)
  }, [getDb])

  useEffect(() => { loadData() }, [loadData])

  const totalStudyTime = progressList.reduce((sum, p) => sum + p.time_spent_minutes, 0)
  const masteredCount = progressList.filter(p => p.status === 'mastered').length
  const inProgressCount = progressList.filter(p => p.status === 'in_progress').length
  const avgScore = progressList.length > 0
    ? Math.round(progressList.reduce((sum, p) => sum + p.comprehension_score, 0) / progressList.length)
    : 0

  const formatDate = (dateStr: string) => {
    if (!dateStr) return ''
    try {
      const d = new Date(dateStr)
      return d.toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' })
    } catch {
      return dateStr
    }
  }

  const isOverdue = (dateStr: string) => {
    if (!dateStr) return false
    return new Date(dateStr) < new Date()
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '学习进度' : 'PROGRESS'}
        </span>
        <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadData} title={language === 'zh' ? '刷新' : 'Refresh'}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </ActionButton>
      </div>

      <div className="px-3 py-1.5 border-b border-border/20">
        <TopicFilter
          selectedSubjectId={filterSubjectId}
          selectedTopicId={filterTopicId}
          onSubjectChange={setFilterSubjectId}
          onTopicChange={setFilterTopicId}
        />
      </div>

      <div className="px-3 py-2 border-b border-border/20">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
            <div>
              <div className="text-[10px] text-text-muted">{language === 'zh' ? '已掌握' : 'Mastered'}</div>
              <div className="text-sm font-semibold text-emerald-400">{masteredCount}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-blue-500/5 border border-blue-500/10">
            <BookOpen className="w-3.5 h-3.5 text-blue-400" />
            <div>
              <div className="text-[10px] text-text-muted">{language === 'zh' ? '进行中' : 'Active'}</div>
              <div className="text-sm font-semibold text-blue-400">{inProgressCount}</div>
            </div>
          </div>
          <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-purple-500/5 border border-purple-500/10">
            <Target className="w-3.5 h-3.5 text-purple-400" />
            <div>
              <div className="text-[10px] text-text-muted">{language === 'zh' ? '平均分' : 'Avg Score'}</div>
              <div className="text-sm font-semibold text-purple-400">{avgScore}%</div>
            </div>
          </div>
          <div className="flex items-center gap-2 py-1.5 px-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <div>
              <div className="text-[10px] text-text-muted">{language === 'zh' ? '学习时长' : 'Time'}</div>
              <div className="text-sm font-semibold text-amber-400">{totalStudyTime > 60 ? `${Math.round(totalStudyTime / 60)}h` : `${totalStudyTime}m`}</div>
            </div>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-3">
          <div className="relative w-12 h-12 flex-shrink-0">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="3" className="text-border/20" />
              <circle
                cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" strokeLinecap="round"
                stroke={avgScore >= 80 ? '#10b981' : avgScore >= 50 ? '#f59e0b' : '#3b82f6'}
                strokeDasharray={`${avgScore * 0.974} 97.4`}
                className="transition-all duration-700"
              />
            </svg>
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[9px] font-bold text-text-primary">{avgScore}%</span>
            </div>
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-text-muted">{language === 'zh' ? '总体掌握率' : 'Overall Mastery'}</span>
              <span className="text-[10px] text-emerald-400">{progressList.length > 0 ? Math.round((masteredCount / progressList.length) * 100) : 0}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-border/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-500"
                style={{ width: `${progressList.length > 0 ? Math.round((masteredCount / progressList.length) * 100) : 0}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[9px] text-text-muted">
              <span>{language === 'zh' ? `已掌握 ${masteredCount}` : `Mastered ${masteredCount}`}</span>
              <span>{language === 'zh' ? `总计 ${progressList.length}` : `Total ${progressList.length}`}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="flex border-b border-border/30">
        <button
          className={`flex-1 py-2 text-xs font-medium transition-colors ${activeTab === 'progress' ? 'text-accent border-b-2 border-accent' : 'text-text-muted hover:text-text-secondary'}`}
          onClick={() => setActiveTab('progress')}
        >
          <BarChart3 className="w-3 h-3 inline mr-1" />
          {language === 'zh' ? '进度' : 'Progress'}
        </button>
        <button
          className={`flex-1 py-2 text-xs font-medium transition-colors ${activeTab === 'review' ? 'text-accent border-b-2 border-accent' : 'text-text-muted hover:text-text-secondary'}`}
          onClick={() => setActiveTab('review')}
        >
          <Clock className="w-3 h-3 inline mr-1" />
          {language === 'zh' ? '待复习' : 'Review'}
          {reviews.length > 0 && (
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent">{reviews.length}</span>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === 'progress' && (
          <>
            {progressList.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
                <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
                  <BarChart3 className="w-6 h-6 opacity-40" />
                </div>
                <p className="text-sm text-text-secondary">{language === 'zh' ? '暂无学习记录' : 'No progress yet'}</p>
                <p className="text-xs mt-1 opacity-60">{language === 'zh' ? '开始学习后自动记录' : 'Auto-recorded after studying'}</p>
              </div>
            )}

            {progressList
              .filter(p => !filterSubjectId || p.subject_id === filterSubjectId)
              .map((progress) => {
              const statusCfg = STATUS_CONFIG[progress.status] || STATUS_CONFIG.not_started
              const isExpanded = expandedId === progress.id
              return (
                <div key={progress.id} className="border-b border-border/15">
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-hover/60 transition-colors text-left"
                    onClick={() => setExpandedId(isExpanded ? null : progress.id)}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${statusCfg.bg}`}>
                      <BarChart3 className={`w-4 h-4 ${statusCfg.color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-text-primary truncate">{progress.topic}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-xs ${statusCfg.color}`}>{statusCfg[language === 'zh' ? 'zh' : 'en']}</span>
                        <span className="text-text-muted/40">·</span>
                        <span className="text-xs text-text-muted">{progress.comprehension_score}%</span>
                      </div>
                    </div>
                    <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
                      <ChevronDown className="w-3.5 h-3.5 text-text-muted/60" />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 animate-fade-in">
                      <div className="rounded-xl border border-border/15 overflow-hidden">
                        <div className="p-3 space-y-2 bg-background/30">
                          <div className="flex justify-between text-xs">
                            <span className="text-text-muted">{language === 'zh' ? '理解程度' : 'Comprehension'}</span>
                            <span className="font-medium text-text-primary">{progress.comprehension_score}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-border/20 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${progress.comprehension_score >= 80 ? 'bg-green-500' : progress.comprehension_score >= 60 ? 'bg-amber-500' : 'bg-red-500'}`}
                              style={{ width: `${progress.comprehension_score}%` }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-text-muted">
                            <span>{language === 'zh' ? `学习 ${progress.study_count} 次` : `${progress.study_count} sessions`}</span>
                            <span>{language === 'zh' ? `${progress.time_spent_minutes} 分钟` : `${progress.time_spent_minutes} min`}</span>
                          </div>
                          {progress.weak_areas && (
                            <div className="pt-1">
                              <span className="text-[10px] text-text-muted">{language === 'zh' ? '薄弱环节' : 'Weak Areas'}:</span>
                              <div className="flex flex-wrap gap-1 mt-1">
                                {progress.weak_areas.split(',').map((area, i) => (
                                  <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                                    {area.trim()}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}

        {activeTab === 'review' && (
          <>
            {reviews.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
                <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
                  <Clock className="w-6 h-6 opacity-40" />
                </div>
                <p className="text-sm text-text-secondary">{language === 'zh' ? '暂无待复习内容' : 'No reviews pending'}</p>
                <p className="text-xs mt-1 opacity-60">{language === 'zh' ? '学习后系统会自动安排复习' : 'Reviews scheduled automatically'}</p>
              </div>
            )}

            {reviews
              .filter(r => !filterSubjectId || r.subject_id === filterSubjectId)
              .map((review) => {
              const overdue = isOverdue(review.next_review_at)
              return (
                <div key={review.id} className="border-b border-border/15 px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${overdue ? 'bg-red-400' : 'bg-amber-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-text-primary truncate">{review.topic}</div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`text-xs ${overdue ? 'text-red-400' : 'text-text-muted'}`}>
                          {overdue
                            ? (language === 'zh' ? '已逾期' : 'Overdue')
                            : formatDate(review.next_review_at)
                          }
                        </span>
                        <span className="text-text-muted/40">·</span>
                        <span className="text-xs text-text-muted">
                          {language === 'zh' ? `${review.interval_days}天后` : `${review.interval_days}d interval`}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}
