import { useState, useCallback, useEffect } from 'react'
import { BookOpen, Plus, RefreshCw, ChevronRight, Trash2, Calculator, Zap, FlaskConical, Globe, Code2, Clock, Leaf, Sparkles, Network, PenLine, Layers, AlertCircle, Calendar } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton, OverlayDialog } from '@/renderer/components/ui'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'

interface SubjectRecord {
  id: string
  name: string
  name_en: string
  category: string
  icon: string
  color: string
  difficulty: string
  description: string
  tags: string
  sort_order: number
  status: string
}

interface SubjectStats {
  topicCount: number
  topicMastered: number
  quizCount: number
  flashcardCount: number
  mistakeCount: number
  planCount: number
}

const CATEGORY_CONFIG: Record<string, { zh: string; en: string; color: string; bg: string; border: string }> = {
  science: { zh: '理科', en: 'Science', color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  language: { zh: '语言', en: 'Language', color: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  humanities: { zh: '人文', en: 'Humanities', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  technology: { zh: '技术', en: 'Technology', color: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  general: { zh: '通用', en: 'General', color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
}

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  BookOpen, Calculator, Zap, FlaskConical, Globe, Code2, Clock, Leaf, Sparkles,
}

const DIFFICULTY_LABELS: Record<string, { zh: string; en: string; color: string }> = {
  beginner: { zh: '入门', en: 'Beginner', color: 'text-green-400' },
  intermediate: { zh: '中级', en: 'Intermediate', color: 'text-yellow-400' },
  advanced: { zh: '高级', en: 'Advanced', color: 'text-red-400' },
  expert: { zh: '专家', en: 'Expert', color: 'text-purple-400' },
}

const EMPTY_FORM = {
  name: '',
  name_en: '',
  category: 'general',
  icon: 'BookOpen',
  color: '#10B981',
  difficulty: 'beginner',
  description: '',
  tags: '',
}

export function SubjectPanel() {
  const language = useStore(s => s.language)
  const llmConfig = useStore(s => s.llmConfig)
  const workspacePath = useStore(s => s.workspacePath)

  const [subjects, setSubjects] = useState<SubjectRecord[]>([])
  const [statsMap, setStatsMap] = useState<Record<string, SubjectStats>>({})
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

  const loadSubjects = useCallback(async () => {
    setLoading(true)
    try {
      const db = await getDb()
      const result = await db.executeSql('education', 'SELECT * FROM subjects ORDER BY sort_order, name')
      if (result.success && result.rows) {
        setSubjects(result.rows as unknown as SubjectRecord[])

        const newStats: Record<string, SubjectStats> = {}
        for (const row of result.rows) {
          const subj = row as unknown as SubjectRecord
          try {
            const [topicRes, quizRes, cardRes, mistakeRes, planRes] = await Promise.all([
              db.executeSql('education', `SELECT COUNT(*) as total, SUM(CASE WHEN mastery_level >= 80 THEN 1 ELSE 0 END) as mastered FROM topics WHERE subject_id = '${subj.id}' AND status = 'active'`),
              db.executeSql('education', `SELECT COUNT(*) as total FROM quizzes WHERE subject_id = '${subj.id}'`),
              db.executeSql('education', `SELECT COUNT(*) as total FROM flashcards WHERE subject_id = '${subj.id}'`),
              db.executeSql('education', `SELECT COUNT(*) as total FROM mistakes WHERE subject_id = '${subj.id}' AND mastered = 0`),
              db.executeSql('education', `SELECT COUNT(*) as total FROM study_plans WHERE subject_id = '${subj.id}' AND status = 'active'`),
            ])
            newStats[subj.id] = {
              topicCount: (topicRes.rows?.[0] as Record<string, unknown>)?.total as number || 0,
              topicMastered: (topicRes.rows?.[0] as Record<string, unknown>)?.mastered as number || 0,
              quizCount: (quizRes.rows?.[0] as Record<string, unknown>)?.total as number || 0,
              flashcardCount: (cardRes.rows?.[0] as Record<string, unknown>)?.total as number || 0,
              mistakeCount: (mistakeRes.rows?.[0] as Record<string, unknown>)?.total as number || 0,
              planCount: (planRes.rows?.[0] as Record<string, unknown>)?.total as number || 0,
            }
          } catch {
            newStats[subj.id] = { topicCount: 0, topicMastered: 0, quizCount: 0, flashcardCount: 0, mistakeCount: 0, planCount: 0 }
          }
        }
        setStatsMap(newStats)
      }
    } catch {
      setSubjects([])
    }
    setLoading(false)
  }, [getDb])

  useEffect(() => { loadSubjects() }, [loadSubjects])

  const handleAdd = useCallback(async () => {
    if (!addForm.name.trim()) return
    setSaving(true)
    try {
      const db = await getDb()
      const id = `subj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const sql = `INSERT INTO subjects (id, name, name_en, category, icon, color, difficulty, description, tags, sort_order, status) VALUES ('${id}', '${esc(addForm.name.trim())}', '${esc(addForm.name_en.trim())}', '${addForm.category}', '${addForm.icon}', '${addForm.color}', '${addForm.difficulty}', '${esc(addForm.description)}', '${esc(addForm.tags)}', ${subjects.length}, 'active')`
      await db.executeSql('education', sql)
      setShowAddModal(false)
      const subjectName = addForm.name.trim()
      const subjectId = id
      setAddForm({ ...EMPTY_FORM })
      await loadSubjects()

      try {
        const agentConfig = getAgentConfig()
        const prompt = language === 'zh'
          ? `我刚创建了学科「${subjectName}」(ID: ${subjectId})，请为它生成完整的知识点大纲，使用 topic_manage 工具的 bulk_create 操作批量创建知识点。要求：
1. 按层级组织，最多3层深度
2. 每个知识点包含 title、title_en、description、difficulty、estimated_minutes 字段
3. 确保覆盖该学科的核心知识体系
4. 难度从 beginner 到 advanced 递进
5. subject_id 使用: ${subjectId}`
          : `I just created subject "${subjectName}" (ID: ${subjectId}). Please generate a complete knowledge point outline using the topic_manage tool's bulk_create action. Requirements:
1. Organize hierarchically with max 3 levels depth
2. Each topic includes title, title_en, description, difficulty, estimated_minutes fields
3. Cover the core knowledge system of this subject
4. Difficulty progresses from beginner to advanced
5. Use subject_id: ${subjectId}`
        await Agent.send(
          prompt,
          { ...llmConfig, contextLimit: agentConfig.maxContextTokens },
          workspacePath,
          'agent',
        )
      } catch {}
    } catch {}
    setSaving(false)
  }, [addForm, subjects.length, getDb, esc, loadSubjects, language, llmConfig, workspacePath])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const db = await getDb()
      await db.executeSql('education', `DELETE FROM subjects WHERE id='${id}'`)
      if (expandedId === id) setExpandedId(null)
      await loadSubjects()
    } catch {}
  }, [getDb, loadSubjects, expandedId])

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

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '学科管理' : 'SUBJECTS'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadSubjects} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </ActionButton>
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddModal(true)} title={language === 'zh' ? '添加学科' : 'Add Subject'}>
            <Plus className="w-3 h-3" />
          </ActionButton>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {subjects.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
            <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
              <BookOpen className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-text-secondary">{language === 'zh' ? '暂无学科' : 'No subjects yet'}</p>
            <p className="text-xs mt-1 opacity-60">{language === 'zh' ? '点击 + 添加学科' : 'Click + to add a subject'}</p>
          </div>
        )}

        {subjects.map((subject) => {
          const cat = CATEGORY_CONFIG[subject.category] || CATEGORY_CONFIG.general
          const diff = DIFFICULTY_LABELS[subject.difficulty] || DIFFICULTY_LABELS.beginner
          const IconComp = ICON_MAP[subject.icon] || BookOpen
          const isExpanded = expandedId === subject.id
          const stats = statsMap[subject.id] || { topicCount: 0, topicMastered: 0, quizCount: 0, flashcardCount: 0, mistakeCount: 0, planCount: 0 }
          const masteryPercent = stats.topicCount > 0 ? Math.round((stats.topicMastered / stats.topicCount) * 100) : 0

          return (
            <div key={subject.id} className="border-b border-border/15 last:border-b-0">
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-hover/60 transition-colors text-left"
                onClick={() => setExpandedId(isExpanded ? null : subject.id)}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${cat.bg} border ${cat.border}`}>
                  <IconComp className={`w-4 h-4 ${cat.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{subject.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-xs ${cat.color}`}>{cat[language === 'zh' ? 'zh' : 'en']}</span>
                    <span className="text-text-muted/40">·</span>
                    <span className={`text-xs ${diff.color}`}>{diff[language === 'zh' ? 'zh' : 'en']}</span>
                    {stats.topicCount > 0 && (
                      <>
                        <span className="text-text-muted/40">·</span>
                        <span className="text-xs text-text-muted">{stats.topicCount}{language === 'zh' ? '知识点' : 'topics'}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {stats.topicCount > 0 && (
                    <div className="w-8 h-1.5 rounded-full bg-border/20 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${masteryPercent >= 80 ? 'bg-green-500' : masteryPercent >= 50 ? 'bg-amber-500' : 'bg-blue-500'}`}
                        style={{ width: `${masteryPercent}%` }}
                      />
                    </div>
                  )}
                  <ChevronRight className={`w-3.5 h-3.5 text-text-muted/60 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`} />
                </div>
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 animate-fade-in">
                  <div className={`rounded-xl border ${cat.border} overflow-hidden`}>
                    <div className={`px-3 py-2.5 ${cat.bg}/50 flex items-center gap-2 border-b ${cat.border}`}>
                      <IconComp className={`w-4 h-4 ${cat.color}`} />
                      <span className="text-sm font-medium text-text-primary">{subject.name}</span>
                      {subject.name_en && <span className="text-xs text-text-muted ml-1">{subject.name_en}</span>}
                    </div>

                    <div className="p-3 space-y-3 bg-background/30">
                      {subject.description && (
                        <p className="text-xs text-text-secondary leading-relaxed">{subject.description}</p>
                      )}

                      <div className="grid grid-cols-3 gap-1.5">
                        <div className="flex flex-col items-center py-1.5 px-1 rounded-lg bg-emerald-500/5 border border-emerald-500/10">
                          <Network className="w-3 h-3 text-emerald-400 mb-0.5" />
                          <span className="text-xs font-semibold text-emerald-400">{stats.topicMastered}/{stats.topicCount}</span>
                          <span className="text-[9px] text-text-muted">{language === 'zh' ? '知识点' : 'Topics'}</span>
                        </div>
                        <div className="flex flex-col items-center py-1.5 px-1 rounded-lg bg-blue-500/5 border border-blue-500/10">
                          <PenLine className="w-3 h-3 text-blue-400 mb-0.5" />
                          <span className="text-xs font-semibold text-blue-400">{stats.quizCount}</span>
                          <span className="text-[9px] text-text-muted">{language === 'zh' ? '测验' : 'Quizzes'}</span>
                        </div>
                        <div className="flex flex-col items-center py-1.5 px-1 rounded-lg bg-purple-500/5 border border-purple-500/10">
                          <Layers className="w-3 h-3 text-purple-400 mb-0.5" />
                          <span className="text-xs font-semibold text-purple-400">{stats.flashcardCount}</span>
                          <span className="text-[9px] text-text-muted">{language === 'zh' ? '卡片' : 'Cards'}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <div className="flex justify-between mb-0.5">
                            <span className="text-[10px] text-text-muted">{language === 'zh' ? '掌握进度' : 'Mastery'}</span>
                            <span className="text-[10px] font-medium text-emerald-400">{masteryPercent}%</span>
                          </div>
                          <div className="h-1.5 rounded-full bg-border/20 overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-300 ${masteryPercent >= 80 ? 'bg-green-500' : masteryPercent >= 50 ? 'bg-amber-500' : 'bg-blue-500'}`}
                              style={{ width: `${masteryPercent}%` }}
                            />
                          </div>
                        </div>
                        {stats.mistakeCount > 0 && (
                          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-red-500/5 border border-red-500/10">
                            <AlertCircle className="w-3 h-3 text-red-400" />
                            <span className="text-[10px] text-red-400">{stats.mistakeCount}{language === 'zh' ? '错题' : 'mistakes'}</span>
                          </div>
                        )}
                      </div>

                      <div className="space-y-1">
                        <span className="text-[10px] font-medium text-text-muted uppercase tracking-wider">{language === 'zh' ? '快捷操作' : 'Quick Actions'}</span>
                        <div className="grid grid-cols-2 gap-1">
                          <ActionButton
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px] gap-1 justify-start"
                            onClick={() => sendToChat(language === 'zh' ? `请讲解学科「${subject.name}」的核心知识点` : `Explain the core topics of "${subject.name}"`)}
                          >
                            <Network className="w-3 h-3 text-emerald-400" />
                            {language === 'zh' ? '讲解知识点' : 'Explain Topics'}
                          </ActionButton>
                          <ActionButton
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px] gap-1 justify-start"
                            onClick={() => sendToChat(language === 'zh' ? `请为学科「${subject.name}」生成一套测验题` : `Generate a quiz for "${subject.name}"`)}
                          >
                            <PenLine className="w-3 h-3 text-blue-400" />
                            {language === 'zh' ? '生成测验' : 'Create Quiz'}
                          </ActionButton>
                          <ActionButton
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px] gap-1 justify-start"
                            onClick={() => sendToChat(language === 'zh' ? `请为学科「${subject.name}」制定学习计划` : `Create a study plan for "${subject.name}"`)}
                          >
                            <Calendar className="w-3 h-3 text-amber-400" />
                            {language === 'zh' ? '学习计划' : 'Study Plan'}
                          </ActionButton>
                          <ActionButton
                            variant="ghost"
                            size="sm"
                            className="h-7 text-[11px] gap-1 justify-start"
                            onClick={() => sendToChat(language === 'zh' ? `请为学科「${subject.name}」生成练习题` : `Generate practice problems for "${subject.name}"`)}
                          >
                            <Sparkles className="w-3 h-3 text-purple-400" />
                            {language === 'zh' ? '练习题' : 'Practice'}
                          </ActionButton>
                        </div>
                      </div>

                      {subject.tags && (
                        <div className="flex flex-wrap gap-1">
                          {subject.tags.split(',').map((tag, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover/50 text-text-muted border border-border/10">
                              {tag.trim()}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-1">
                        <ActionButton
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          onClick={() => handleDelete(subject.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                          {language === 'zh' ? '删除' : 'Delete'}
                        </ActionButton>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {subjects.length > 0 && (
        <div className="px-3 py-2 border-t border-border/30">
          <ActionButton variant="ghost" size="sm" className="h-7 w-full text-xs gap-1.5" onClick={() => setShowAddModal(true)}>
            <Plus className="w-3 h-3" />
            {language === 'zh' ? '添加学科' : 'Add Subject'}
          </ActionButton>
        </div>
      )}

      <OverlayDialog
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}
        title={language === 'zh' ? '添加学科' : 'Add Subject'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '学科名称' : 'Subject Name'} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={addForm.name}
              onChange={e => setAddForm({ ...addForm, name: e.target.value })}
              placeholder={language === 'zh' ? '如 高等数学' : 'e.g. Calculus'}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '英文名称' : 'English Name'}
            </label>
            <input
              type="text"
              value={addForm.name_en}
              onChange={e => setAddForm({ ...addForm, name_en: e.target.value })}
              placeholder="e.g. Calculus"
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '分类' : 'Category'}
            </label>
            <div className="flex gap-2 flex-wrap">
              {Object.entries(CATEGORY_CONFIG).map(([key, cfg]) => (
                <button
                  key={key}
                  onClick={() => setAddForm({ ...addForm, category: key })}
                  className={`text-xs py-1.5 px-3 rounded-lg border transition-colors ${addForm.category === key ? `${cfg.bg} ${cfg.color} ${cfg.border}` : 'text-text-muted hover:text-text-primary hover:bg-surface-hover border-border/30'}`}
                >
                  {cfg[language === 'zh' ? 'zh' : 'en']}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '难度' : 'Difficulty'}
            </label>
            <div className="flex gap-2">
              {Object.entries(DIFFICULTY_LABELS).map(([key, cfg]) => (
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

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '描述' : 'Description'}
            </label>
            <textarea
              value={addForm.description}
              onChange={e => setAddForm({ ...addForm, description: e.target.value })}
              placeholder={language === 'zh' ? '学科简介' : 'Subject description'}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '标签（逗号分隔）' : 'Tags (comma separated)'}
            </label>
            <input
              type="text"
              value={addForm.tags}
              onChange={e => setAddForm({ ...addForm, tags: e.target.value })}
              placeholder={language === 'zh' ? '如 代数,微积分,几何' : 'e.g. algebra,calculus,geometry'}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <ActionButton variant="ghost" size="sm" className="h-9 flex-1 text-sm" onClick={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}>
              {language === 'zh' ? '取消' : 'Cancel'}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" className="h-9 flex-1 text-sm" onClick={handleAdd} disabled={!addForm.name.trim() || saving}>
              {saving ? (language === 'zh' ? '保存中...' : 'Saving...') : (language === 'zh' ? '保存' : 'Save')}
            </ActionButton>
          </div>
        </div>
      </OverlayDialog>
    </div>
  )
}
