import { useState, useCallback, useEffect } from 'react'
import { Calendar, Plus, RefreshCw, ChevronDown, Trash2, CheckCircle2, Clock, Target, Play, BookOpen, PenLine, Sparkles } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton, OverlayDialog } from '@/renderer/components/ui'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'

interface StudyPlanRecord {
  id: string
  subject_id: string
  title: string
  goal: string
  target_date: string
  daily_minutes: number
  current_level: string
  learning_style: string
  status: string
  total_days: number
  completed_days: number
  notes: string
  created_at: string
}

interface MilestoneRecord {
  id: string
  plan_id: string
  title: string
  topic_ids: string
  estimated_days: number
  sort_order: number
  status: string
  quiz_id: string
  notes: string
  started_at: string
  completed_at: string
}

interface TopicOption {
  id: string
  title: string
}

interface SubjectOption {
  id: string
  name: string
}

const STATUS_CONFIG: Record<string, { zh: string; en: string; color: string; icon: React.ComponentType<{ className?: string }> }> = {
  active: { zh: '进行中', en: 'Active', color: 'text-blue-400', icon: Play },
  completed: { zh: '已完成', en: 'Completed', color: 'text-green-400', icon: CheckCircle2 },
  paused: { zh: '已暂停', en: 'Paused', color: 'text-amber-400', icon: Clock },
}

const MILESTONE_STATUS: Record<string, { zh: string; en: string; color: string; dot: string; bg: string }> = {
  not_started: { zh: '未开始', en: 'Not Started', color: 'text-text-muted', dot: 'bg-text-muted/40', bg: 'bg-surface-hover/30' },
  in_progress: { zh: '进行中', en: 'In Progress', color: 'text-blue-400', dot: 'bg-blue-400', bg: 'bg-blue-500/5' },
  completed: { zh: '已完成', en: 'Completed', color: 'text-green-400', dot: 'bg-green-400', bg: 'bg-green-500/5' },
  review: { zh: '复习中', en: 'Reviewing', color: 'text-amber-400', dot: 'bg-amber-400', bg: 'bg-amber-500/5' },
  mastered: { zh: '已掌握', en: 'Mastered', color: 'text-purple-400', dot: 'bg-purple-400', bg: 'bg-purple-500/5' },
}

const LEVEL_CONFIG: Record<string, { zh: string; en: string; color: string }> = {
  beginner: { zh: '入门', en: 'Beginner', color: 'text-green-400' },
  intermediate: { zh: '中级', en: 'Intermediate', color: 'text-yellow-400' },
  advanced: { zh: '高级', en: 'Advanced', color: 'text-red-400' },
}

const EMPTY_FORM = {
  subject_id: '',
  title: '',
  goal: '',
  target_date: '',
  daily_minutes: 60,
  current_level: 'beginner',
  learning_style: 'reading',
}

export function StudyPlanPanel() {
  const language = useStore(s => s.language)
  const llmConfig = useStore(s => s.llmConfig)
  const workspacePath = useStore(s => s.workspacePath)

  const [plans, setPlans] = useState<StudyPlanRecord[]>([])
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [topicMap, setTopicMap] = useState<Record<string, string>>({})
  const [milestones, setMilestones] = useState<Record<string, MilestoneRecord[]>>({})
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

  const loadTopicMap = useCallback(async () => {
    try {
      const db = await getDb()
      const result = await db.executeSql('education', 'SELECT id, title FROM topics WHERE status = "active"')
      if (result.success && result.rows) {
        const map: Record<string, string> = {}
        for (const row of result.rows as unknown as TopicOption[]) {
          map[row.id] = row.title
        }
        setTopicMap(map)
      }
    } catch {}
  }, [getDb])

  const loadPlans = useCallback(async () => {
    setLoading(true)
    try {
      const db = await getDb()
      const result = await db.executeSql('education', 'SELECT * FROM study_plans ORDER BY created_at DESC')
      if (result.success && result.rows) {
        setPlans(result.rows as unknown as StudyPlanRecord[])
      }
    } catch {
      setPlans([])
    }
    setLoading(false)
  }, [getDb])

  const loadMilestones = useCallback(async (planId: string) => {
    try {
      const db = await getDb()
      const result = await db.executeSql('education', `SELECT * FROM plan_milestones WHERE plan_id = '${planId}' ORDER BY sort_order`)
      if (result.success && result.rows) {
        setMilestones(prev => ({ ...prev, [planId]: result.rows as unknown as MilestoneRecord[] }))
      }
    } catch {}
  }, [getDb])

  useEffect(() => { loadSubjects(); loadPlans(); loadTopicMap() }, [loadSubjects, loadPlans, loadTopicMap])

  useEffect(() => {
    if (expandedId) loadMilestones(expandedId)
  }, [expandedId, loadMilestones])

  const handleCreate = useCallback(async () => {
    if (!addForm.title.trim() || !addForm.goal.trim()) return
    setSaving(true)
    try {
      const db = await getDb()
      const id = `plan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const sql = `INSERT INTO study_plans (id, subject_id, title, goal, target_date, daily_minutes, current_level, learning_style, status, total_days, completed_days) VALUES ('${id}', '${addForm.subject_id || 'general'}', '${esc(addForm.title.trim())}', '${esc(addForm.goal.trim())}', '${addForm.target_date}', ${addForm.daily_minutes}, '${addForm.current_level}', '${addForm.learning_style}', 'active', 0, 0)`
      await db.executeSql('education', sql)
      setShowAddModal(false)
      setAddForm({ ...EMPTY_FORM })
      await loadPlans()
    } catch {}
    setSaving(false)
  }, [addForm, getDb, esc, loadPlans])

  const handleStartLearning = useCallback(async (plan: StudyPlanRecord, milestone: MilestoneRecord) => {
    const db = await getDb()
    if (milestone.status === 'not_started') {
      await db.executeSql('education', `UPDATE plan_milestones SET status = 'in_progress', started_at = datetime('now', 'localtime') WHERE id = '${milestone.id}'`)
      await loadMilestones(plan.id)
    }

    const topicIds = milestone.topic_ids ? milestone.topic_ids.split(',').filter(Boolean) : []
    const topicNames = topicIds.map(id => topicMap[id] || id).join('、')

    const prompt = language === 'zh'
      ? `我正在学习计划「${plan.title}」的里程碑「${milestone.title}」阶段。${topicNames ? `本阶段涉及的知识点：${topicNames}。` : ''}请为我详细讲解这些知识点，从基础概念开始，逐步深入，帮我建立完整的理解。讲解过程中请使用 topic_explain 工具来组织内容，并在完成后使用 progress_manage 工具记录学习进度。`
      : `I'm studying the milestone "${milestone.title}" in plan "${plan.title}". ${topicNames ? `Topics for this stage: ${topicNames}.` : ''} Please explain these topics in detail, starting from basics and progressing deeper. Use the topic_explain tool to organize content, and use progress_manage to record my learning progress when done.`
    sendToChat(prompt)
  }, [language, sendToChat, topicMap, loadMilestones, getDb])

  const handleCompleteMilestone = useCallback(async (plan: StudyPlanRecord, milestone: MilestoneRecord) => {
    try {
      const db = await getDb()
      await db.executeSql('education', `UPDATE plan_milestones SET status = 'completed', completed_at = datetime('now', 'localtime') WHERE id = '${milestone.id}'`)

      const topicIds = milestone.topic_ids ? milestone.topic_ids.split(',').filter(Boolean) : []
      for (const tid of topicIds) {
        await db.executeSql('education', `UPDATE topics SET mastery_level = MIN(100, mastery_level + 20), status = CASE WHEN mastery_level + 20 >= 80 THEN 'mastered' ELSE 'in_progress' END, updated_at = datetime('now', 'localtime') WHERE id = '${tid}'`)
        await db.executeSql('education', `INSERT OR REPLACE INTO learning_progress (id, subject_id, topic_id, topic, status, comprehension_score, time_spent_minutes, study_count, updated_at) VALUES ('prog_${tid}', '${plan.subject_id || 'general'}', '${tid}', '${esc(topicMap[tid] || tid)}', 'completed', 80, ${plan.daily_minutes}, COALESCE((SELECT study_count FROM learning_progress WHERE topic_id = '${tid}'), 0) + 1, datetime('now', 'localtime'))`)
      }

      const msResult = await db.executeSql('education', `SELECT * FROM plan_milestones WHERE plan_id = '${plan.id}'`)
      const allMilestones = (msResult.rows || []) as unknown as MilestoneRecord[]
      const completedCount = allMilestones.filter(m => m.status === 'completed' || m.status === 'mastered').length
      const newStatus = completedCount === allMilestones.length ? 'completed' : 'active'
      await db.executeSql('education', `UPDATE study_plans SET status = '${newStatus}', completed_days = ${completedCount}, updated_at = datetime('now', 'localtime') WHERE id = '${plan.id}'`)

      await loadMilestones(plan.id)
      await loadPlans()
    } catch {}
  }, [getDb, esc, topicMap, loadMilestones, loadPlans])

  const handleStartQuiz = useCallback(async (plan: StudyPlanRecord, milestone: MilestoneRecord) => {
    const topicIds = milestone.topic_ids ? milestone.topic_ids.split(',').filter(Boolean) : []
    const topicNames = topicIds.map(id => topicMap[id] || id).join('、')

    const prompt = language === 'zh'
      ? `我正在学习计划「${plan.title}」的里程碑「${milestone.title}」阶段。${topicNames ? `涉及知识点：${topicNames}。` : ''}请使用 quiz_manage 工具为我生成一份测验，检验我对这些知识点的掌握情况。如果测验通过，请使用 study_plan_manage 工具的 update_milestone 操作将里程碑标记为完成。`
      : `I'm at milestone "${milestone.title}" in plan "${plan.title}". ${topicNames ? `Topics: ${topicNames}.` : ''} Please use the quiz_manage tool to generate a quiz to test my understanding. If I pass, use study_plan_manage's update_milestone action to mark the milestone as completed.`
    sendToChat(prompt)
  }, [language, sendToChat, topicMap])

  const handleGenerateFromTopics = useCallback(async (plan: StudyPlanRecord) => {
    if (!plan.subject_id || plan.subject_id === 'general') {
      const prompt = language === 'zh'
        ? `请为学习计划「${plan.title}」生成详细的里程碑安排，目标：${plan.goal}，当前水平：${plan.current_level}，每日学习时间：${plan.daily_minutes}分钟。请使用 study_plan_manage 工具的 add_milestone 操作来创建里程碑。`
        : `Generate detailed milestones for study plan "${plan.title}", goal: ${plan.goal}, current level: ${plan.current_level}, daily study time: ${plan.daily_minutes} minutes. Use study_plan_manage's add_milestone action to create milestones.`
      sendToChat(prompt)
      return
    }

    const prompt = language === 'zh'
      ? `请使用 study_plan_manage 工具的 generate_from_topics 操作，基于学科「${plan.subject_id}」的知识点为学习计划「${plan.title}」自动生成里程碑。目标：${plan.goal}，每日学习时间：${plan.daily_minutes}分钟。`
      : `Use study_plan_manage's generate_from_topics action to auto-generate milestones from topics for subject "${plan.subject_id}" in plan "${plan.title}". Goal: ${plan.goal}, daily study time: ${plan.daily_minutes} minutes.`
    sendToChat(prompt)
  }, [language, sendToChat])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const db = await getDb()
      await db.executeSql('education', `DELETE FROM plan_milestones WHERE plan_id='${id}'`)
      await db.executeSql('education', `DELETE FROM study_plans WHERE id='${id}'`)
      if (expandedId === id) setExpandedId(null)
      await loadPlans()
    } catch {}
  }, [getDb, loadPlans, expandedId])

  const getSubjectName = useCallback((subjectId: string) => {
    const s = subjects.find(s => s.id === subjectId)
    return s ? s.name : (subjectId || (language === 'zh' ? '通用' : 'General'))
  }, [subjects, language])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '学习计划' : 'STUDY PLANS'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadPlans} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </ActionButton>
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddModal(true)} title={language === 'zh' ? '创建计划' : 'Create Plan'}>
            <Plus className="w-3 h-3" />
          </ActionButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {plans.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
            <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
              <Calendar className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-text-secondary">{language === 'zh' ? '暂无学习计划' : 'No study plans yet'}</p>
            <p className="text-xs mt-1 opacity-60">{language === 'zh' ? '点击 + 创建学习计划' : 'Click + to create a plan'}</p>
          </div>
        )}

        {plans.map((plan) => {
          const statusCfg = STATUS_CONFIG[plan.status] || STATUS_CONFIG.active
          const StatusIcon = statusCfg.icon
          const levelCfg = LEVEL_CONFIG[plan.current_level] || LEVEL_CONFIG.beginner
          const isExpanded = expandedId === plan.id
          const planMilestones = milestones[plan.id] || []
          const completedMilestones = planMilestones.filter(m => m.status === 'completed' || m.status === 'mastered').length
          const progressPercent = planMilestones.length > 0 ? Math.round((completedMilestones / planMilestones.length) * 100) : 0

          return (
            <div key={plan.id} className="border-b border-border/15 last:border-b-0">
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-hover/60 transition-colors text-left"
                onClick={() => setExpandedId(isExpanded ? null : plan.id)}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-emerald-500/10">
                  <Calendar className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{plan.title}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <StatusIcon className={`w-3 h-3 ${statusCfg.color}`} />
                    <span className={`text-xs ${statusCfg.color}`}>{statusCfg[language === 'zh' ? 'zh' : 'en']}</span>
                    <span className="text-text-muted/40">·</span>
                    <span className={`text-xs ${levelCfg.color}`}>{levelCfg[language === 'zh' ? 'zh' : 'en']}</span>
                    {planMilestones.length > 0 && (
                      <>
                        <span className="text-text-muted/40">·</span>
                        <span className="text-xs text-emerald-400">{completedMilestones}/{planMilestones.length}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-0' : '-rotate-90'}`}>
                  <ChevronDown className="w-3.5 h-3.5 text-text-muted/60" />
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 animate-fade-in">
                  <div className="rounded-xl border border-emerald-500/20 overflow-hidden">
                    <div className="px-3 py-2.5 bg-emerald-500/5">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Target className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-xs font-medium text-text-secondary">{language === 'zh' ? '目标' : 'Goal'}</span>
                      </div>
                      <p className="text-xs text-text-primary leading-relaxed">{plan.goal}</p>
                      <div className="flex items-center gap-3 mt-2 text-[10px] text-text-muted">
                        <span>{getSubjectName(plan.subject_id)}</span>
                        <span>{plan.daily_minutes}{language === 'zh' ? '分钟/天' : 'min/day'}</span>
                        {plan.target_date && <span>{language === 'zh' ? '截止' : 'Due'}: {plan.target_date}</span>}
                      </div>
                    </div>

                    {planMilestones.length > 0 && (
                      <div className="px-3 py-2 border-t border-border/10">
                        <div className="flex justify-between mb-1.5">
                          <span className="text-[10px] text-text-muted">{language === 'zh' ? '里程碑进度' : 'Milestone Progress'}</span>
                          <span className="text-[10px] font-medium text-emerald-400">{progressPercent}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-border/20 overflow-hidden">
                          <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-green-400 transition-all duration-500" style={{ width: `${progressPercent}%` }} />
                        </div>
                      </div>
                    )}

                    {planMilestones.length > 0 && (
                      <div className="px-3 py-1 border-t border-border/10">
                        <div className="text-[10px] font-medium text-text-muted uppercase tracking-wider mb-1.5">
                          {language === 'zh' ? '学习路径' : 'Learning Path'}
                        </div>
                        <div className="space-y-1.5">
                          {planMilestones.map((m, idx) => {
                            const ms = MILESTONE_STATUS[m.status] || MILESTONE_STATUS.not_started
                            const topicIds = m.topic_ids ? m.topic_ids.split(',').filter(Boolean) : []
                            const topicNames = topicIds.map(id => topicMap[id]).filter(Boolean)
                            const isCompleted = m.status === 'completed' || m.status === 'mastered'
                            const isInProgress = m.status === 'in_progress'
                            const isNotStarted = m.status === 'not_started'

                            return (
                              <div key={m.id} className={`rounded-lg border border-border/15 ${ms.bg} overflow-hidden`}>
                                <div className="flex items-center gap-2 px-2.5 py-2">
                                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center text-[9px] flex-shrink-0 ${isCompleted ? 'border-green-500 bg-green-500/10 text-green-400' : isInProgress ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-border/30 text-text-muted'}`}>
                                    {isCompleted ? '✓' : idx + 1}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-1.5">
                                      <span className="text-xs font-medium text-text-primary">{m.title}</span>
                                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${ms.color} ${ms.bg}`}>{ms[language === 'zh' ? 'zh' : 'en']}</span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-0.5">
                                      <span className="text-[10px] text-text-muted">{m.estimated_days}{language === 'zh' ? '天' : 'd'}</span>
                                      {topicNames.length > 0 && (
                                        <span className="text-[10px] text-text-muted/60 truncate">
                                          · {topicNames.slice(0, 3).join(', ')}{topicNames.length > 3 ? '...' : ''}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                {!isCompleted && (
                                  <div className="px-2.5 pb-2 flex items-center gap-1.5">
                                    {(isNotStarted || isInProgress) && (
                                      <ActionButton
                                        variant="secondary"
                                        size="sm"
                                        className="h-5.5 text-[10px] gap-0.5 px-2"
                                        onClick={() => handleStartLearning(plan, m)}
                                      >
                                        <BookOpen className="w-2.5 h-2.5" />
                                        {isInProgress
                                          ? (language === 'zh' ? '继续学习' : 'Continue')
                                          : (language === 'zh' ? '开始学习' : 'Start')}
                                      </ActionButton>
                                    )}
                                    {isInProgress && (
                                      <>
                                        <ActionButton
                                          variant="ghost"
                                          size="sm"
                                          className="h-5.5 text-[10px] gap-0.5 px-2 text-green-400 hover:text-green-300 hover:bg-green-500/10"
                                          onClick={() => handleCompleteMilestone(plan, m)}
                                        >
                                          <CheckCircle2 className="w-2.5 h-2.5" />
                                          {language === 'zh' ? '标记完成' : 'Done'}
                                        </ActionButton>
                                        <ActionButton
                                          variant="ghost"
                                          size="sm"
                                          className="h-5.5 text-[10px] gap-0.5 px-2 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                                          onClick={() => handleStartQuiz(plan, m)}
                                        >
                                          <PenLine className="w-2.5 h-2.5" />
                                          {language === 'zh' ? '测验' : 'Quiz'}
                                        </ActionButton>
                                      </>
                                    )}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div className="px-3 py-2 border-t border-border/10 flex items-center gap-2">
                      <ActionButton variant="secondary" size="sm" className="h-7 text-xs gap-1" onClick={() => handleGenerateFromTopics(plan)}>
                        <Sparkles className="w-3 h-3" />
                        {planMilestones.length > 0
                          ? (language === 'zh' ? '重新生成' : 'Regenerate')
                          : (language === 'zh' ? '生成里程碑' : 'Generate')}
                      </ActionButton>
                      <ActionButton variant="ghost" size="sm" className="h-7 text-xs gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => handleDelete(plan.id)}>
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

      {plans.length > 0 && (
        <div className="px-3 py-2 border-t border-border/30">
          <ActionButton variant="ghost" size="sm" className="h-7 w-full text-xs gap-1.5" onClick={() => setShowAddModal(true)}>
            <Plus className="w-3 h-3" />
            {language === 'zh' ? '创建计划' : 'Create Plan'}
          </ActionButton>
        </div>
      )}

      <OverlayDialog
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}
        title={language === 'zh' ? '创建学习计划' : 'Create Study Plan'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '计划标题' : 'Plan Title'} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={addForm.title}
              onChange={e => setAddForm({ ...addForm, title: e.target.value })}
              placeholder={language === 'zh' ? '如 Python入门30天计划' : 'e.g. Python 30-day Plan'}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '学习目标' : 'Goal'} <span className="text-red-400">*</span>
            </label>
            <textarea
              value={addForm.goal}
              onChange={e => setAddForm({ ...addForm, goal: e.target.value })}
              placeholder={language === 'zh' ? '如 掌握Python基础语法，能独立编写小程序' : 'e.g. Master Python basics, write programs independently'}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85 resize-none"
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                {language === 'zh' ? '当前水平' : 'Current Level'}
              </label>
              <div className="flex gap-1.5">
                {Object.entries(LEVEL_CONFIG).map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => setAddForm({ ...addForm, current_level: key })}
                    className={`text-[10px] py-1 px-2 rounded border transition-colors ${addForm.current_level === key ? `${cfg.color} border-current/30 bg-current/10` : 'text-text-muted border-border/30'}`}
                  >
                    {cfg[language === 'zh' ? 'zh' : 'en']}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                {language === 'zh' ? '每日时间(分钟)' : 'Daily (min)'}
              </label>
              <input
                type="number"
                min={10}
                max={480}
                value={addForm.daily_minutes}
                onChange={e => setAddForm({ ...addForm, daily_minutes: Number(e.target.value) || 60 })}
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '目标日期' : 'Target Date'}
            </label>
            <input
              type="date"
              value={addForm.target_date}
              onChange={e => setAddForm({ ...addForm, target_date: e.target.value })}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <ActionButton variant="ghost" size="sm" className="h-9 flex-1 text-sm" onClick={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}>
              {language === 'zh' ? '取消' : 'Cancel'}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" className="h-9 flex-1 text-sm" onClick={handleCreate} disabled={!addForm.title.trim() || !addForm.goal.trim() || saving}>
              {saving ? (language === 'zh' ? '保存中...' : 'Saving...') : (language === 'zh' ? '创建' : 'Create')}
            </ActionButton>
          </div>
        </div>
      </OverlayDialog>
    </div>
  )
}
