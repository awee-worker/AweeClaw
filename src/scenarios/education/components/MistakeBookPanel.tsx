import { useState, useCallback, useEffect } from 'react'
import { AlertCircle, Plus, RefreshCw, ChevronDown, Trash2, CheckCircle2, XCircle, RotateCcw } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton, OverlayDialog } from '@/renderer/components/ui'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'
import { TopicFilter } from './TopicFilter'

interface MistakeRecord {
  id: string
  subject_id: string
  question: string
  your_answer: string
  correct_answer: string
  explanation: string
  source: string
  source_id: string
  difficulty: string
  review_count: number
  mastered: number
  tags: string
  notes: string
  created_at: string
}

interface SubjectOption {
  id: string
  name: string
}

const DIFFICULTY_CONFIG: Record<string, { zh: string; en: string; color: string }> = {
  beginner: { zh: '入门', en: 'Beginner', color: 'text-green-400' },
  intermediate: { zh: '中级', en: 'Intermediate', color: 'text-yellow-400' },
  advanced: { zh: '高级', en: 'Advanced', color: 'text-red-400' },
  expert: { zh: '专家', en: 'Expert', color: 'text-purple-400' },
}

const EMPTY_FORM = {
  subject_id: '',
  question: '',
  your_answer: '',
  correct_answer: '',
  explanation: '',
  source: '',
  difficulty: 'intermediate',
  tags: '',
  notes: '',
}

export function MistakeBookPanel() {
  const language = useStore(s => s.language)
  const llmConfig = useStore(s => s.llmConfig)
  const workspacePath = useStore(s => s.workspacePath)

  const [mistakes, setMistakes] = useState<MistakeRecord[]>([])
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [filterSubjectId, setFilterSubjectId] = useState('')
  const [filterTopicId, setFilterTopicId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [filterMastered, setFilterMastered] = useState(false)

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

  const loadMistakes = useCallback(async () => {
    setLoading(true)
    try {
      const db = await getDb()
      let sql = 'SELECT * FROM mistakes'
      if (!filterMastered) sql += ' WHERE mastered = 0'
      sql += ' ORDER BY created_at DESC'
      const result = await db.executeSql('education', sql)
      if (result.success && result.rows) {
        setMistakes(result.rows as unknown as MistakeRecord[])
      }
    } catch {
      setMistakes([])
    }
    setLoading(false)
  }, [getDb, filterMastered])

  useEffect(() => { loadSubjects(); loadMistakes() }, [loadSubjects, loadMistakes])

  const handleAdd = useCallback(async () => {
    if (!addForm.question.trim() || !addForm.correct_answer.trim()) return
    setSaving(true)
    try {
      const db = await getDb()
      const id = `mistake_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const sql = `INSERT INTO mistakes (id, subject_id, question, your_answer, correct_answer, explanation, source, difficulty, review_count, mastered, tags, notes) VALUES ('${id}', '${addForm.subject_id || 'general'}', '${esc(addForm.question.trim())}', '${esc(addForm.your_answer)}', '${esc(addForm.correct_answer.trim())}', '${esc(addForm.explanation)}', '${esc(addForm.source)}', '${addForm.difficulty}', 0, 0, '${esc(addForm.tags)}', '${esc(addForm.notes)}')`
      await db.executeSql('education', sql)
      setShowAddModal(false)
      setAddForm({ ...EMPTY_FORM })
      await loadMistakes()
    } catch {}
    setSaving(false)
  }, [addForm, getDb, esc, loadMistakes])

  const handleMarkMastered = useCallback(async (id: string) => {
    try {
      const db = await getDb()
      await db.executeSql('education', `UPDATE mistakes SET mastered = 1, updated_at = datetime('now', 'localtime') WHERE id = '${id}'`)
      await loadMistakes()
    } catch {}
  }, [getDb, loadMistakes])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const db = await getDb()
      await db.executeSql('education', `DELETE FROM mistakes WHERE id='${id}'`)
      if (expandedId === id) setExpandedId(null)
      await loadMistakes()
    } catch {}
  }, [getDb, loadMistakes, expandedId])

  const handleReview = useCallback((mistake: MistakeRecord) => {
    const prompt = language === 'zh'
      ? `请帮我重新讲解这道错题，确保我理解了正确答案：\n题目：${mistake.question}\n正确答案：${mistake.correct_answer}\n${mistake.explanation ? `解析：${mistake.explanation}` : ''}`
      : `Please re-explain this mistake to ensure I understand:\nQuestion: ${mistake.question}\nCorrect Answer: ${mistake.correct_answer}\n${mistake.explanation ? `Explanation: ${mistake.explanation}` : ''}`
    sendToChat(prompt)
  }, [language, sendToChat])

  const unmasteredCount = mistakes.filter(m => !m.mastered).length
  const masteredCount = mistakes.filter(m => m.mastered).length

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '错题本' : 'MISTAKES'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadMistakes} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </ActionButton>
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddModal(true)} title={language === 'zh' ? '添加错题' : 'Add Mistake'}>
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

      <div className="px-3 py-2 border-b border-border/20">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilterMastered(false)}
            className={`text-[10px] py-1 px-2.5 rounded transition-colors ${!filterMastered ? 'bg-red-500/15 text-red-400' : 'text-text-muted hover:text-text-secondary'}`}
          >
            {language === 'zh' ? '未掌握' : 'Active'} ({unmasteredCount})
          </button>
          <button
            onClick={() => setFilterMastered(true)}
            className={`text-[10px] py-1 px-2.5 rounded transition-colors ${filterMastered ? 'bg-green-500/15 text-green-400' : 'text-text-muted hover:text-text-secondary'}`}
          >
            {language === 'zh' ? '已掌握' : 'Mastered'} ({masteredCount})
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {mistakes.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
            <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
              <AlertCircle className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-text-secondary">
              {filterMastered
                ? (language === 'zh' ? '暂无已掌握的错题' : 'No mastered mistakes')
                : (language === 'zh' ? '暂无错题' : 'No mistakes yet')
              }
            </p>
            <p className="text-xs mt-1 opacity-60">
              {filterMastered
                ? (language === 'zh' ? '继续学习，错题掌握后会出现在这里' : 'Mastered mistakes will appear here')
                : (language === 'zh' ? '测验答错的题目会自动收录' : 'Wrong answers are auto-collected')
              }
            </p>
          </div>
        )}

        {mistakes
          .filter(m => !filterSubjectId || m.subject_id === filterSubjectId)
          .map((mistake) => {
          const diff = DIFFICULTY_CONFIG[mistake.difficulty] || DIFFICULTY_CONFIG.intermediate
          const isExpanded = expandedId === mistake.id
          return (
            <div key={mistake.id} className="border-b border-border/15 last:border-b-0">
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-hover/60 transition-colors text-left"
                onClick={() => setExpandedId(isExpanded ? null : mistake.id)}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${mistake.mastered ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                  {mistake.mastered
                    ? <CheckCircle2 className="w-4 h-4 text-green-400" />
                    : <XCircle className="w-4 h-4 text-red-400" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{mistake.question}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-xs ${diff.color}`}>{diff[language === 'zh' ? 'zh' : 'en']}</span>
                    {mistake.source && (
                      <>
                        <span className="text-text-muted/40">·</span>
                        <span className="text-xs text-text-muted">{mistake.source}</span>
                      </>
                    )}
                    {mistake.review_count > 0 && (
                      <>
                        <span className="text-text-muted/40">·</span>
                        <span className="text-xs text-text-muted">{language === 'zh' ? `复习${mistake.review_count}次` : `${mistake.review_count} reviews`}</span>
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
                  <div className={`rounded-xl border ${mistake.mastered ? 'border-green-500/20' : 'border-red-500/20'} overflow-hidden`}>
                    <div className="p-3 space-y-2 bg-background/30">
                      <div>
                        <div className="text-[10px] text-text-muted mb-1">{language === 'zh' ? '题目' : 'Question'}</div>
                        <div className="text-sm text-text-primary">{mistake.question}</div>
                      </div>
                      {mistake.your_answer && (
                        <div className="bg-red-500/5 border border-red-500/10 rounded-lg px-2.5 py-2">
                          <div className="text-[10px] text-red-400 mb-0.5">{language === 'zh' ? '你的答案' : 'Your Answer'}</div>
                          <div className="text-sm text-red-300">{mistake.your_answer}</div>
                        </div>
                      )}
                      <div className="bg-green-500/5 border border-green-500/10 rounded-lg px-2.5 py-2">
                        <div className="text-[10px] text-green-400 mb-0.5">{language === 'zh' ? '正确答案' : 'Correct Answer'}</div>
                        <div className="text-sm text-green-300">{mistake.correct_answer}</div>
                      </div>
                      {mistake.explanation && (
                        <div className="text-xs text-text-secondary leading-relaxed bg-surface-hover/30 rounded-lg px-2.5 py-2">
                          📖 {mistake.explanation}
                        </div>
                      )}
                      {mistake.tags && (
                        <div className="flex flex-wrap gap-1">
                          {mistake.tags.split(',').map((tag, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover/50 text-text-muted border border-border/10">
                              {tag.trim()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2 border-t border-border/10 flex items-center gap-2">
                      {!mistake.mastered && (
                        <>
                          <ActionButton variant="secondary" size="sm" className="h-7 text-xs gap-1" onClick={() => handleReview(mistake)}>
                            <RotateCcw className="w-3 h-3" />
                            {language === 'zh' ? '重新学习' : 'Re-learn'}
                          </ActionButton>
                          <ActionButton variant="ghost" size="sm" className="h-7 text-xs gap-1 text-green-400 hover:text-green-300 hover:bg-green-500/10" onClick={() => handleMarkMastered(mistake.id)}>
                            <CheckCircle2 className="w-3 h-3" />
                            {language === 'zh' ? '已掌握' : 'Mastered'}
                          </ActionButton>
                        </>
                      )}
                      <ActionButton variant="ghost" size="sm" className="h-7 text-xs gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/10" onClick={() => handleDelete(mistake.id)}>
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

      {mistakes.length > 0 && (
        <div className="px-3 py-2 border-t border-border/30">
          <ActionButton variant="ghost" size="sm" className="h-7 w-full text-xs gap-1.5" onClick={() => setShowAddModal(true)}>
            <Plus className="w-3 h-3" />
            {language === 'zh' ? '添加错题' : 'Add Mistake'}
          </ActionButton>
        </div>
      )}

      <OverlayDialog
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}
        title={language === 'zh' ? '添加错题' : 'Add Mistake'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '题目' : 'Question'} <span className="text-red-400">*</span>
            </label>
            <textarea
              value={addForm.question}
              onChange={e => setAddForm({ ...addForm, question: e.target.value })}
              placeholder={language === 'zh' ? '输入题目内容' : 'Enter the question'}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85 resize-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '你的答案' : 'Your Answer'}
            </label>
            <input
              type="text"
              value={addForm.your_answer}
              onChange={e => setAddForm({ ...addForm, your_answer: e.target.value })}
              placeholder={language === 'zh' ? '你当时写的答案' : 'Your original answer'}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '正确答案' : 'Correct Answer'} <span className="text-red-400">*</span>
            </label>
            <textarea
              value={addForm.correct_answer}
              onChange={e => setAddForm({ ...addForm, correct_answer: e.target.value })}
              placeholder={language === 'zh' ? '正确答案' : 'The correct answer'}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '解析' : 'Explanation'}
            </label>
            <textarea
              value={addForm.explanation}
              onChange={e => setAddForm({ ...addForm, explanation: e.target.value })}
              placeholder={language === 'zh' ? '为什么这个答案是对的' : 'Why this answer is correct'}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85 resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
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
              <select
                value={addForm.difficulty}
                onChange={e => setAddForm({ ...addForm, difficulty: e.target.value })}
                className="w-full h-8 px-2.5 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              >
                {Object.entries(DIFFICULTY_CONFIG).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg[language === 'zh' ? 'zh' : 'en']}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <ActionButton variant="ghost" size="sm" className="h-9 flex-1 text-sm" onClick={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}>
              {language === 'zh' ? '取消' : 'Cancel'}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" className="h-9 flex-1 text-sm" onClick={handleAdd} disabled={!addForm.question.trim() || !addForm.correct_answer.trim() || saving}>
              {saving ? (language === 'zh' ? '保存中...' : 'Saving...') : (language === 'zh' ? '添加' : 'Add')}
            </ActionButton>
          </div>
        </div>
      </OverlayDialog>
    </div>
  )
}
