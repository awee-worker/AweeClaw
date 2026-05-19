import { useState, useCallback, useEffect } from 'react'
import { PenLine, Plus, RefreshCw, ChevronDown, Trash2, CheckCircle2, Clock, FileText } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton, OverlayDialog } from '@/renderer/components/ui'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { TopicFilter } from './TopicFilter'

interface QuizRecord {
  id: string
  subject_id: string
  title: string
  description: string
  difficulty: string
  question_types: string
  question_count: number
  time_limit: number
  passing_score: number
  status: string
  created_at: string
}

interface SubjectOption {
  id: string
  name: string
}

const DIFFICULTY_CONFIG: Record<string, { zh: string; en: string; color: string; bg: string }> = {
  beginner: { zh: '入门', en: 'Beginner', color: 'text-green-400', bg: 'bg-green-500/10' },
  intermediate: { zh: '中级', en: 'Intermediate', color: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  advanced: { zh: '高级', en: 'Advanced', color: 'text-red-400', bg: 'bg-red-500/10' },
  expert: { zh: '专家', en: 'Expert', color: 'text-purple-400', bg: 'bg-purple-500/10' },
}

const STATUS_CONFIG: Record<string, { zh: string; en: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  draft: { zh: '草稿', en: 'Draft', color: 'text-text-muted', icon: FileText },
  published: { zh: '已发布', en: 'Published', color: 'text-blue-400', icon: CheckCircle2 },
  completed: { zh: '已完成', en: 'Completed', color: 'text-green-400', icon: CheckCircle2 },
}

const EMPTY_FORM = {
  subject_id: '',
  title: '',
  description: '',
  difficulty: 'intermediate',
  question_types: 'multiple_choice',
  question_count: 5,
  time_limit: 0,
  passing_score: 60,
}

interface QuizResultRecord {
  id: string
  quiz_id: string
  score: number
  percentage: number
  passed: number
  time_spent: number
  answers: string
  topic_scores: string
  created_at: string
}

function QuizResultSummary({ quizId, language }: { quizId: string; language: string }) {
  const [results, setResults] = useState<QuizResultRecord[]>([])
  const [topicBreakdown, setTopicBreakdown] = useState<Array<{ topic: string; score: number; count: number }>>([])

  const getDb = useCallback(async () => {
    const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
    return scenarioDatabaseManager
  }, [])

  useEffect(() => {
    const loadResults = async () => {
      try {
        const db = await getDb()
        const result = await db.executeSql('education', `SELECT * FROM quiz_results WHERE quiz_id = '${quizId}' ORDER BY created_at DESC`)
        if (result.success && result.rows) {
          setResults(result.rows as unknown as QuizResultRecord[])
        }
        const topicRes = await db.executeSql('education', `SELECT t.title as topic, AVG(qr.percentage) as score, COUNT(qr.id) as count FROM quiz_results qr JOIN topics t ON t.subject_id = (SELECT subject_id FROM quizzes WHERE id = '${quizId}') GROUP BY t.id ORDER BY score ASC LIMIT 5`)
        if (topicRes.success && topicRes.rows) {
          setTopicBreakdown(topicRes.rows as unknown as Array<{ topic: string; score: number; count: number }>)
        }
      } catch {}
    }
    loadResults()
  }, [getDb, quizId])

  if (results.length === 0) return null

  const avgScore = Math.round(results.reduce((s, r) => s + r.percentage, 0) / results.length)
  const passRate = Math.round((results.filter(r => r.passed).length / results.length) * 100)
  const bestScore = Math.max(...results.map(r => r.percentage))

  return (
    <div className="px-3 py-2 border-t border-border/10">
      <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
        {language === 'zh' ? '测验结果' : 'Results'}
      </div>
      <div className="grid grid-cols-3 gap-1.5 mb-2">
        <div className="text-center py-1 rounded bg-blue-500/5">
          <div className="text-xs font-semibold text-blue-400">{avgScore}%</div>
          <div className="text-[9px] text-text-muted">{language === 'zh' ? '平均分' : 'Avg'}</div>
        </div>
        <div className="text-center py-1 rounded bg-emerald-500/5">
          <div className="text-xs font-semibold text-emerald-400">{passRate}%</div>
          <div className="text-[9px] text-text-muted">{language === 'zh' ? '通过率' : 'Pass'}</div>
        </div>
        <div className="text-center py-1 rounded bg-amber-500/5">
          <div className="text-xs font-semibold text-amber-400">{bestScore}%</div>
          <div className="text-[9px] text-text-muted">{language === 'zh' ? '最高分' : 'Best'}</div>
        </div>
      </div>
      <div className="text-[10px] text-text-muted mb-1">
        {language === 'zh' ? `共 ${results.length} 次作答` : `${results.length} attempts`}
      </div>
      {topicBreakdown.length > 0 && (
        <div className="mt-1.5">
          <div className="text-[10px] font-medium text-text-muted mb-1">
            {language === 'zh' ? '薄弱知识点' : 'Weak Topics'}
          </div>
          {topicBreakdown.slice(0, 3).map((item, idx) => (
            <div key={idx} className="flex items-center gap-1.5 mb-1">
              <span className="text-[10px] text-text-secondary truncate flex-1">{item.topic}</span>
              <div className="w-16 h-1 rounded-full bg-border/20 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${item.score}%`,
                    backgroundColor: item.score >= 80 ? '#10b981' : item.score >= 50 ? '#f59e0b' : '#ef4444',
                  }}
                />
              </div>
              <span className="text-[9px] text-text-muted w-7 text-right">{Math.round(item.score)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function QuizCenterPanel() {
  const language = useStore(s => s.language)
  const llmConfig = useStore(s => s.llmConfig)
  const workspacePath = useStore(s => s.workspacePath)

  const [quizzes, setQuizzes] = useState<QuizRecord[]>([])
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [filterSubjectId, setFilterSubjectId] = useState('')
  const [filterTopicId, setFilterTopicId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)

  const getDb = useCallback(async () => {
    const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
    return scenarioDatabaseManager
  }, [])

  const esc = useCallback((v: string) => v.replace(/'/g, "''"), [])

  const sendToChat = useCallback(async (prompt: string) => {
    try {
      const agentConfig = getAgentConfig()
      await Agent.send(
        prompt,
        { ...llmConfig, contextLimit: agentConfig.maxContextTokens },
        workspacePath,
        'agent',
      )
    } catch {}
  }, [llmConfig, workspacePath])

  const loadSubjects = useCallback(async () => {
    try {
      const db = await getDb()
      const result = await db.executeSql('education', 'SELECT id, name FROM subjects WHERE status = "active" ORDER BY sort_order, name')
      if (result.success && result.rows) {
        setSubjects(result.rows as unknown as SubjectOption[])
      }
    } catch {}
  }, [getDb])

  const loadQuizzes = useCallback(async () => {
    setLoading(true)
    try {
      const db = await getDb()
      const result = await db.executeSql('education', 'SELECT * FROM quizzes ORDER BY created_at DESC')
      if (result.success && result.rows) {
        setQuizzes(result.rows as unknown as QuizRecord[])
      }
    } catch {
      setQuizzes([])
    }
    setLoading(false)
  }, [getDb])

  useEffect(() => { loadSubjects(); loadQuizzes() }, [loadSubjects, loadQuizzes])

  const handleCreate = useCallback(async () => {
    if (!addForm.title.trim()) return
    setSaving(true)
    try {
      const db = await getDb()
      const id = `quiz_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const sql = `INSERT INTO quizzes (id, subject_id, title, description, difficulty, question_types, question_count, time_limit, passing_score, status) VALUES ('${id}', '${addForm.subject_id || 'general'}', '${esc(addForm.title.trim())}', '${esc(addForm.description)}', '${addForm.difficulty}', '${addForm.question_types}', ${addForm.question_count}, ${addForm.time_limit}, ${addForm.passing_score}, 'draft')`
      await db.executeSql('education', sql)
      setShowAddModal(false)
      setAddForm({ ...EMPTY_FORM })
      await loadQuizzes()
    } catch {}
    setSaving(false)
  }, [addForm, getDb, esc, loadQuizzes])

  const handleGenerateQuiz = useCallback((quiz: QuizRecord) => {
    const prompt = language === 'zh'
      ? `请为「${quiz.title}」生成测验题目，难度：${quiz.difficulty}，题目数量：${quiz.question_count}，题型：${quiz.question_types}`
      : `Generate quiz questions for "${quiz.title}", difficulty: ${quiz.difficulty}, count: ${quiz.question_count}, types: ${quiz.question_types}`
    sendToChat(prompt)
  }, [language, sendToChat])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const db = await getDb()
      await db.executeSql('education', `DELETE FROM quizzes WHERE id='${id}'`)
      if (expandedId === id) setExpandedId(null)
      await loadQuizzes()
    } catch {}
  }, [getDb, loadQuizzes, expandedId])

  const getSubjectName = useCallback((subjectId: string) => {
    const s = subjects.find(s => s.id === subjectId)
    return s ? s.name : (subjectId || (language === 'zh' ? '通用' : 'General'))
  }, [subjects, language])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '测验中心' : 'QUIZZES'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadQuizzes} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </ActionButton>
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddModal(true)} title={language === 'zh' ? '创建测验' : 'Create Quiz'}>
            <Plus className="w-3 h-3" />
          </ActionButton>
        </div>
      </div>

      <div className="px-3 py-1.5 border-b border-border/20">
        <TopicFilter
          selectedSubjectId={filterSubjectId}
          selectedTopicId={filterTopicId}
          onSubjectChange={setFilterSubjectId}
          onTopicChange={setFilterTopicId}
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {quizzes.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
            <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
              <PenLine className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-text-secondary">{language === 'zh' ? '暂无测验' : 'No quizzes yet'}</p>
            <p className="text-xs mt-1 opacity-60">{language === 'zh' ? '点击 + 创建测验' : 'Click + to create a quiz'}</p>
          </div>
        )}

        {quizzes
          .filter(q => !filterSubjectId || q.subject_id === filterSubjectId)
          .map((quiz) => {
          const diff = DIFFICULTY_CONFIG[quiz.difficulty] || DIFFICULTY_CONFIG.intermediate
          const statusCfg = STATUS_CONFIG[quiz.status] || STATUS_CONFIG.draft
          const StatusIcon = statusCfg.icon
          const isExpanded = expandedId === quiz.id
          return (
            <div key={quiz.id} className="border-b border-border/15 last:border-b-0">
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-hover/60 transition-colors text-left"
                onClick={() => setExpandedId(isExpanded ? null : quiz.id)}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${diff.bg}`}>
                  <PenLine className={`w-4 h-4 ${diff.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{quiz.title}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <StatusIcon className={`w-3 h-3 ${statusCfg.color}`} />
                    <span className={`text-xs ${statusCfg.color}`}>{statusCfg[language === 'zh' ? 'zh' : 'en']}</span>
                    <span className="text-text-muted/40">·</span>
                    <span className="text-xs text-text-muted">{quiz.question_count}{language === 'zh' ? '题' : 'Q'}</span>
                    <span className="text-text-muted/40">·</span>
                    <span className={`text-xs ${diff.color}`}>{diff[language === 'zh' ? 'zh' : 'en']}</span>
                  </div>
                </div>
                <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
                  <ChevronDown className="w-3.5 h-3.5 text-text-muted/60" />
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 animate-fade-in">
                  <div className={`rounded-xl border ${diff.bg.replace('/10', '/20')} overflow-hidden`}>
                    <div className="px-3 py-2.5 bg-background/30">
                      {quiz.description && (
                        <p className="text-xs text-text-secondary mb-2">{quiz.description}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-text-muted">
                        <span>{getSubjectName(quiz.subject_id)}</span>
                        <span>{language === 'zh' ? `及格分: ${quiz.passing_score}%` : `Pass: ${quiz.passing_score}%`}</span>
                        {quiz.time_limit > 0 && (
                          <span className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {quiz.time_limit}{language === 'zh' ? '分钟' : 'min'}
                          </span>
                        )}
                      </div>
                    </div>
                    <QuizResultSummary quizId={quiz.id} language={language} />
                    <div className="px-3 py-2 border-t border-border/10 flex items-center gap-2">
                      <ActionButton
                        variant="secondary"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        onClick={() => handleGenerateQuiz(quiz)}
                      >
                        <PenLine className="w-3 h-3" />
                        {language === 'zh' ? '生成题目' : 'Generate'}
                      </ActionButton>
                      <ActionButton
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => handleDelete(quiz.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                        {language === 'zh' ? '删除' : 'Delete'}
                      </ActionButton>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {quizzes.length > 0 && (
        <div className="px-3 py-2 border-t border-border/30">
          <ActionButton variant="ghost" size="sm" className="h-7 w-full text-xs gap-1.5" onClick={() => setShowAddModal(true)}>
            <Plus className="w-3 h-3" />
            {language === 'zh' ? '创建测验' : 'Create Quiz'}
          </ActionButton>
        </div>
      )}

      <OverlayDialog
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}
        title={language === 'zh' ? '创建测验' : 'Create Quiz'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '测验标题' : 'Quiz Title'} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={addForm.title}
              onChange={e => setAddForm({ ...addForm, title: e.target.value })}
              placeholder={language === 'zh' ? '如 第三章微积分测验' : 'e.g. Chapter 3 Calculus Quiz'}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '学科' : 'Subject'}
            </label>
            <select
              value={addForm.subject_id}
              onChange={e => setAddForm({ ...addForm, subject_id: e.target.value })}
              className="w-full h-8 px-2.5 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
            >
              <option value="general">{language === 'zh' ? '通用' : 'General'}</option>
              {subjects.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '难度' : 'Difficulty'}
            </label>
            <div className="flex gap-2">
              {Object.entries(DIFFICULTY_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setAddForm({ ...addForm, difficulty: key })}
                  className={`text-xs py-1.5 px-3 rounded-lg border transition-colors ${addForm.difficulty === key ? `${cfg.color} border-current/30 bg-current/10` : 'text-text-muted hover:text-text-primary hover:bg-surface-hover border-border/30'}`}
                >
                  {cfg[language === 'zh' ? 'zh' : 'en']}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                {language === 'zh' ? '题目数量' : 'Questions'}
              </label>
              <input
                type="number"
                min={1}
                max={20}
                value={addForm.question_count}
                onChange={e => setAddForm({ ...addForm, question_count: Number(e.target.value) || 5 })}
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                {language === 'zh' ? '及格分 (%)' : 'Pass Score'}
              </label>
              <input
                type="number"
                min={0}
                max={100}
                value={addForm.passing_score}
                onChange={e => setAddForm({ ...addForm, passing_score: Number(e.target.value) || 60 })}
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '时间限制（分钟，0为不限时）' : 'Time Limit (min, 0=no limit)'}
            </label>
            <input
              type="number"
              min={0}
              value={addForm.time_limit}
              onChange={e => setAddForm({ ...addForm, time_limit: Number(e.target.value) || 0 })}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '描述' : 'Description'}
            </label>
            <textarea
              value={addForm.description}
              onChange={e => setAddForm({ ...addForm, description: e.target.value })}
              placeholder={language === 'zh' ? '测验说明' : 'Quiz description'}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <ActionButton variant="ghost" size="sm" className="h-9 flex-1 text-sm" onClick={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}>
              {language === 'zh' ? '取消' : 'Cancel'}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" className="h-9 flex-1 text-sm" onClick={handleCreate} disabled={!addForm.title.trim() || saving}>
              {saving ? (language === 'zh' ? '保存中...' : 'Saving...') : (language === 'zh' ? '创建' : 'Create')}
            </ActionButton>
          </div>
        </div>
      </OverlayDialog>
    </div>
  )
}
