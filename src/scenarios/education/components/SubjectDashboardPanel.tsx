import { useState, useCallback, useEffect } from 'react'
import { LayoutDashboard, RefreshCw, BookOpen, Network, PenLine, Layers, AlertCircle, Calendar, Clock, TrendingUp, Target, Zap } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton } from '@/renderer/components/ui'

interface SubjectInfo {
  id: string
  name: string
  name_en: string
  category: string
  difficulty: string
  description: string
}

interface DashboardData {
  subject: SubjectInfo
  topics: { total: number; mastered: number; in_progress: number; avg_mastery: number }
  quizzes: { total: number; published: number }
  results: { total: number; passed: number; avg_score: number }
  flashcards: { total: number; due: number }
  mistakes: { total: number; unmastered: number }
  activePlans: Array<Record<string, unknown>>
  progress: { total_minutes: number; avg_score: number }
  dueReviews: Array<Record<string, unknown>>
  recentResults: Array<Record<string, unknown>>
}

interface SubjectOption {
  id: string
  name: string
}

export function SubjectDashboardPanel() {
  const language = useStore(s => s.language)

  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [selectedSubject, setSelectedSubject] = useState<string>('')
  const [dashboard, setDashboard] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(false)

  const getDb = useCallback(async () => {
    const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
    return scenarioDatabaseManager
  }, [])

  const loadSubjects = useCallback(async () => {
    try {
      const db = await getDb()
      const result = await db.executeSql('education', 'SELECT id, name FROM subjects WHERE status = "active" ORDER BY sort_order, name')
      if (result.success && result.rows) {
        setSubjects(result.rows as unknown as SubjectOption[])
        if (!selectedSubject && result.rows.length > 0) {
          setSelectedSubject((result.rows[0] as Record<string, unknown>).id as string)
        }
      }
    } catch {}
  }, [getDb, selectedSubject])

  const loadDashboard = useCallback(async () => {
    if (!selectedSubject) return
    setLoading(true)
    try {
      const db = await getDb()

      const subjectResult = await db.executeSql('education', `SELECT * FROM subjects WHERE id = '${selectedSubject}'`)
      if (!subjectResult.rows?.length) { setDashboard(null); setLoading(false); return }
      const subject = subjectResult.rows[0] as unknown as SubjectInfo

      const topicStats = await db.executeSql('education', `SELECT COUNT(*) as total, SUM(CASE WHEN mastery_level >= 80 THEN 1 ELSE 0 END) as mastered, SUM(CASE WHEN mastery_level > 0 AND mastery_level < 80 THEN 1 ELSE 0 END) as in_progress, AVG(mastery_level) as avg_mastery FROM topics WHERE subject_id = '${selectedSubject}' AND status = 'active'`)
      const quizStats = await db.executeSql('education', `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as published FROM quizzes WHERE subject_id = '${selectedSubject}'`)
      const resultStats = await db.executeSql('education', `SELECT COUNT(*) as total, SUM(CASE WHEN passed = 1 THEN 1 ELSE 0 END) as passed, AVG(percentage) as avg_score FROM quiz_results WHERE quiz_id IN (SELECT id FROM quizzes WHERE subject_id = '${selectedSubject}')`)
      const cardStats = await db.executeSql('education', `SELECT COUNT(*) as total, SUM(CASE WHEN next_review_at <= datetime('now') AND status != 'mastered' THEN 1 ELSE 0 END) as due FROM flashcards WHERE subject_id = '${selectedSubject}'`)
      const mistakeStats = await db.executeSql('education', `SELECT COUNT(*) as total, SUM(CASE WHEN mastered = 0 THEN 1 ELSE 0 END) as unmastered FROM mistakes WHERE subject_id = '${selectedSubject}'`)
      const planStats = await db.executeSql('education', `SELECT * FROM study_plans WHERE subject_id = '${selectedSubject}' AND status = 'active' ORDER BY created_at DESC LIMIT 5`)
      const progressStats = await db.executeSql('education', `SELECT SUM(time_spent_minutes) as total_minutes, AVG(comprehension_score) as avg_score FROM learning_progress WHERE subject_id = '${selectedSubject}'`)
      const dueReviews = await db.executeSql('education', `SELECT * FROM review_schedule WHERE subject_id = '${selectedSubject}' AND next_review_at <= datetime('now') AND status = 'pending' ORDER BY next_review_at LIMIT 10`)

      setDashboard({
        subject,
        topics: topicStats.rows?.[0] as DashboardData['topics'] || { total: 0, mastered: 0, in_progress: 0, avg_mastery: 0 },
        quizzes: quizStats.rows?.[0] as DashboardData['quizzes'] || { total: 0, published: 0 },
        results: resultStats.rows?.[0] as DashboardData['results'] || { total: 0, passed: 0, avg_score: 0 },
        flashcards: cardStats.rows?.[0] as DashboardData['flashcards'] || { total: 0, due: 0 },
        mistakes: mistakeStats.rows?.[0] as DashboardData['mistakes'] || { total: 0, unmastered: 0 },
        activePlans: (planStats.rows || []) as Array<Record<string, unknown>>,
        progress: progressStats.rows?.[0] as DashboardData['progress'] || { total_minutes: 0, avg_score: 0 },
        dueReviews: (dueReviews.rows || []) as Array<Record<string, unknown>>,
        recentResults: [],
      })
    } catch {
      setDashboard(null)
    }
    setLoading(false)
  }, [getDb, selectedSubject])

  useEffect(() => { loadSubjects() }, [loadSubjects])
  useEffect(() => { if (selectedSubject) loadDashboard() }, [selectedSubject, loadDashboard])

  const topicMasteryPercent = dashboard && (dashboard.topics?.total ?? 0) > 0
    ? Math.round(((dashboard.topics.mastered || 0) / dashboard.topics.total!) * 100)
    : 0
  const quizPassRate = dashboard && (dashboard.results?.total ?? 0) > 0
    ? Math.round(((dashboard.results.passed || 0) / dashboard.results.total!) * 100)
    : 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '学科仪表盘' : 'DASHBOARD'}
        </span>
        <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadDashboard} title={language === 'zh' ? '刷新' : 'Refresh'}>
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
        </ActionButton>
      </div>

      <div className="px-3 py-2 border-b border-border/20">
        <select
          value={selectedSubject}
          onChange={e => setSelectedSubject(e.target.value)}
          className="w-full h-7 px-2.5 text-xs bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
        >
          <option value="">{language === 'zh' ? '选择学科' : 'Select Subject'}</option>
          {subjects.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 overflow-y-auto">
        {!selectedSubject && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
            <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
              <LayoutDashboard className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-text-secondary">{language === 'zh' ? '选择学科查看仪表盘' : 'Select a subject to view dashboard'}</p>
          </div>
        )}

        {selectedSubject && !dashboard && !loading && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
            <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
              <LayoutDashboard className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-text-secondary">{language === 'zh' ? '暂无数据' : 'No data available'}</p>
          </div>
        )}

        {dashboard && (
          <div className="p-3 space-y-3">
            <div className="text-sm font-medium text-text-primary px-1">
              {dashboard.subject.name}
              {dashboard.subject.name_en && <span className="text-xs text-text-muted ml-2">{dashboard.subject.name_en}</span>}
            </div>

            {dashboard.subject.description && (
              <p className="text-xs text-text-secondary px-1 leading-relaxed">{dashboard.subject.description}</p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-2 py-2 px-2.5 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                <Network className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <div>
                  <div className="text-[10px] text-text-muted">{language === 'zh' ? '知识点掌握' : 'Topics'}</div>
                  <div className="text-sm font-semibold text-emerald-400">{topicMasteryPercent}%</div>
                  <div className="text-[9px] text-text-muted">{dashboard.topics.mastered || 0}/{dashboard.topics.total || 0}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 py-2 px-2.5 rounded-lg bg-blue-500/5 border border-blue-500/10">
                <PenLine className="w-4 h-4 text-blue-400 flex-shrink-0" />
                <div>
                  <div className="text-[10px] text-text-muted">{language === 'zh' ? '测验通过率' : 'Quiz Pass'}</div>
                  <div className="text-sm font-semibold text-blue-400">{quizPassRate}%</div>
                  <div className="text-[9px] text-text-muted">{dashboard.results.passed || 0}/{dashboard.results.total || 0}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 py-2 px-2.5 rounded-lg bg-purple-500/5 border border-purple-500/10">
                <Layers className="w-4 h-4 text-purple-400 flex-shrink-0" />
                <div>
                  <div className="text-[10px] text-text-muted">{language === 'zh' ? '待复习卡片' : 'Cards Due'}</div>
                  <div className="text-sm font-semibold text-purple-400">{dashboard.flashcards.due || 0}</div>
                  <div className="text-[9px] text-text-muted">{language === 'zh' ? `共${dashboard.flashcards.total || 0}张` : `${dashboard.flashcards.total || 0} total`}</div>
                </div>
              </div>
              <div className="flex items-center gap-2 py-2 px-2.5 rounded-lg bg-red-500/5 border border-red-500/10">
                <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                <div>
                  <div className="text-[10px] text-text-muted">{language === 'zh' ? '未掌握错题' : 'Mistakes'}</div>
                  <div className="text-sm font-semibold text-red-400">{dashboard.mistakes.unmastered || 0}</div>
                  <div className="text-[9px] text-text-muted">{language === 'zh' ? `共${dashboard.mistakes.total || 0}题` : `${dashboard.mistakes.total || 0} total`}</div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 px-1">
                <TrendingUp className="w-3 h-3 text-accent" />
                <span className="text-xs font-medium text-text-secondary">{language === 'zh' ? '学习概览' : 'Overview'}</span>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-hover/30">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-3 h-3 text-amber-400" />
                    <span className="text-xs text-text-secondary">{language === 'zh' ? '学习时长' : 'Study Time'}</span>
                  </div>
                  <span className="text-xs font-medium text-text-primary">
                    {dashboard.progress.total_minutes > 60
                      ? `${Math.round((dashboard.progress.total_minutes || 0) / 60)}h`
                      : `${dashboard.progress.total_minutes || 0}m`}
                  </span>
                </div>

                <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-hover/30">
                  <div className="flex items-center gap-1.5">
                    <Target className="w-3 h-3 text-purple-400" />
                    <span className="text-xs text-text-secondary">{language === 'zh' ? '平均理解度' : 'Avg Comprehension'}</span>
                  </div>
                  <span className="text-xs font-medium text-text-primary">{Math.round(dashboard.progress.avg_score || 0)}%</span>
                </div>

                <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-hover/30">
                  <div className="flex items-center gap-1.5">
                    <BookOpen className="w-3 h-3 text-emerald-400" />
                    <span className="text-xs text-text-secondary">{language === 'zh' ? '知识点掌握度' : 'Topic Mastery'}</span>
                  </div>
                  <span className="text-xs font-medium text-text-primary">{Math.round(dashboard.topics.avg_mastery || 0)}%</span>
                </div>

                <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-hover/30">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3 h-3 text-blue-400" />
                    <span className="text-xs text-text-secondary">{language === 'zh' ? '活跃计划' : 'Active Plans'}</span>
                  </div>
                  <span className="text-xs font-medium text-text-primary">{dashboard.activePlans.length}</span>
                </div>
              </div>
            </div>

            {dashboard.dueReviews.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 px-1">
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span className="text-xs font-medium text-text-secondary">{language === 'zh' ? '待复习' : 'Due Reviews'}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">{dashboard.dueReviews.length}</span>
                </div>
                <div className="space-y-1">
                  {dashboard.dueReviews.slice(0, 5).map((review, i) => (
                    <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                      <span className="text-xs text-text-primary truncate flex-1">{String(review.topic || '')}</span>
                      <span className="text-[10px] text-text-muted">{String(review.source_type || '')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center gap-1.5 px-1">
                <span className="text-xs font-medium text-text-secondary">{language === 'zh' ? '知识点掌握进度' : 'Topic Mastery Progress'}</span>
              </div>
              <div className="px-1">
                <div className="flex justify-between mb-1">
                  <span className="text-[10px] text-text-muted">{language === 'zh' ? '掌握率' : 'Mastery'}</span>
                  <span className="text-[10px] font-medium text-emerald-400">{topicMasteryPercent}%</span>
                </div>
                <div className="h-2 rounded-full bg-border/20 overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-500" style={{ width: `${topicMasteryPercent}%` }} />
                </div>
                <div className="flex justify-between mt-1 text-[9px] text-text-muted">
                  <span>{language === 'zh' ? `已掌握: ${dashboard.topics.mastered || 0}` : `Mastered: ${dashboard.topics.mastered || 0}`}</span>
                  <span>{language === 'zh' ? `学习中: ${dashboard.topics.in_progress || 0}` : `Learning: ${dashboard.topics.in_progress || 0}`}</span>
                  <span>{language === 'zh' ? `未开始: ${(dashboard.topics.total || 0) - (dashboard.topics.mastered || 0) - (dashboard.topics.in_progress || 0)}` : `New: ${(dashboard.topics.total || 0) - (dashboard.topics.mastered || 0) - (dashboard.topics.in_progress || 0)}`}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
