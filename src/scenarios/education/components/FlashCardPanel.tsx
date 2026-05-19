import { useState, useCallback, useEffect } from 'react'
import { Layers, Plus, RefreshCw, ChevronDown, Trash2, RotateCcw, Eye, EyeOff } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton, OverlayDialog } from '@/renderer/components/ui'
import { TopicFilter } from './TopicFilter'

interface FlashcardRecord {
  id: string
  subject_id: string
  front: string
  back: string
  hint: string
  difficulty: string
  tags: string
  review_count: number
  correct_count: number
  next_review_at: string
  interval_days: number
  ease_factor: number
  status: string
}

interface SubjectOption {
  id: string
  name: string
}

const DIFFICULTY_CONFIG: Record<string, { zh: string; en: string; color: string }> = {
  beginner: { zh: '入门', en: 'Beginner', color: 'text-green-400' },
  intermediate: { zh: '中级', en: 'Intermediate', color: 'text-yellow-400' },
  advanced: { zh: '高级', en: 'Advanced', color: 'text-red-400' },
}

const STATUS_CONFIG: Record<string, { zh: string; en: string; color: string }> = {
  new: { zh: '新卡', en: 'New', color: 'text-blue-400' },
  learning: { zh: '学习中', en: 'Learning', color: 'text-amber-400' },
  review: { zh: '复习中', en: 'Reviewing', color: 'text-purple-400' },
  mastered: { zh: '已掌握', en: 'Mastered', color: 'text-green-400' },
}

const EMPTY_FORM = {
  subject_id: '',
  front: '',
  back: '',
  hint: '',
  difficulty: 'intermediate',
  tags: '',
}

export function FlashCardPanel() {
  const language = useStore(s => s.language)

  const [cards, setCards] = useState<FlashcardRecord[]>([])
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [filterSubjectId, setFilterSubjectId] = useState('')
  const [filterTopicId, setFilterTopicId] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showAnswer, setShowAnswer] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [filterStatus, setFilterStatus] = useState<string | null>(null)

  const getDb = useCallback(async () => {
    const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
    return scenarioDatabaseManager
  }, [])

  const esc = useCallback((v: string) => v.replace(/'/g, "''"), [])

  const loadSubjects = useCallback(async () => {
    try {
      const db = await getDb()
      const result = await db.executeSql('education', 'SELECT id, name FROM subjects WHERE status = "active" ORDER BY sort_order, name')
      if (result.success && result.rows) {
        setSubjects(result.rows as unknown as SubjectOption[])
      }
    } catch {}
  }, [getDb])

  const loadCards = useCallback(async () => {
    setLoading(true)
    try {
      const db = await getDb()
      let sql = 'SELECT * FROM flashcards'
      if (filterStatus) sql += ` WHERE status = '${filterStatus}'`
      sql += ' ORDER BY next_review_at, created_at DESC'
      const result = await db.executeSql('education', sql)
      if (result.success && result.rows) {
        setCards(result.rows as unknown as FlashcardRecord[])
      }
    } catch {
      setCards([])
    }
    setLoading(false)
  }, [getDb, filterStatus])

  useEffect(() => { loadSubjects(); loadCards() }, [loadSubjects, loadCards])

  const handleAdd = useCallback(async () => {
    if (!addForm.front.trim() || !addForm.back.trim()) return
    setSaving(true)
    try {
      const db = await getDb()
      const id = `card_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const now = new Date().toISOString()
      const sql = `INSERT INTO flashcards (id, subject_id, front, back, hint, difficulty, tags, review_count, correct_count, next_review_at, interval_days, ease_factor, status) VALUES ('${id}', '${addForm.subject_id || 'general'}', '${esc(addForm.front.trim())}', '${esc(addForm.back.trim())}', '${esc(addForm.hint)}', '${addForm.difficulty}', '${esc(addForm.tags)}', 0, 0, '${now}', 1, 2.5, 'new')`
      await db.executeSql('education', sql)
      setShowAddModal(false)
      setAddForm({ ...EMPTY_FORM })
      await loadCards()
    } catch {}
    setSaving(false)
  }, [addForm, getDb, esc, loadCards])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const db = await getDb()
      await db.executeSql('education', `DELETE FROM flashcards WHERE id='${id}'`)
      if (expandedId === id) setExpandedId(null)
      await loadCards()
    } catch {}
  }, [getDb, loadCards, expandedId])

  const toggleAnswer = useCallback((id: string) => {
    setShowAnswer(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const dueCards = cards.filter(c => c.next_review_at && new Date(c.next_review_at) <= new Date())
  const newCards = cards.filter(c => c.status === 'new')
  const masteredCards = cards.filter(c => c.status === 'mastered')

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '知识卡片' : 'FLASHCARDS'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadCards} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </ActionButton>
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddModal(true)} title={language === 'zh' ? '添加卡片' : 'Add Card'}>
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
        <div className="grid grid-cols-3 gap-1.5">
          <button
            onClick={() => setFilterStatus(null)}
            className={`text-[10px] py-1 rounded transition-colors ${!filterStatus ? 'bg-accent/15 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            {language === 'zh' ? '全部' : 'All'} ({cards.length})
          </button>
          <button
            onClick={() => setFilterStatus('new')}
            className={`text-[10px] py-1 rounded transition-colors ${filterStatus === 'new' ? 'bg-blue-500/15 text-blue-400' : 'text-text-muted hover:text-text-secondary'}`}
          >
            {language === 'zh' ? '待学' : 'New'} ({newCards.length})
          </button>
          <button
            onClick={() => setFilterStatus('mastered')}
            className={`text-[10px] py-1 rounded transition-colors ${filterStatus === 'mastered' ? 'bg-green-500/15 text-green-400' : 'text-text-muted hover:text-text-secondary'}`}
          >
            {language === 'zh' ? '已会' : 'Done'} ({masteredCards.length})
          </button>
        </div>
        {dueCards.length > 0 && (
          <div className="mt-1.5 text-[10px] text-amber-400 flex items-center gap-1">
            <RotateCcw className="w-3 h-3" />
            {language === 'zh' ? `${dueCards.length} 张卡片待复习` : `${dueCards.length} cards due for review`}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {cards.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
            <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
              <Layers className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-text-secondary">{language === 'zh' ? '暂无卡片' : 'No flashcards yet'}</p>
            <p className="text-xs mt-1 opacity-60">{language === 'zh' ? '点击 + 添加知识卡片' : 'Click + to add flashcards'}</p>
          </div>
        )}

        {cards
          .filter(c => !filterSubjectId || c.subject_id === filterSubjectId)
          .map((card) => {
          const diff = DIFFICULTY_CONFIG[card.difficulty] || DIFFICULTY_CONFIG.intermediate
          const statusCfg = STATUS_CONFIG[card.status] || STATUS_CONFIG.new
          const isExpanded = expandedId === card.id
          const isAnswerVisible = showAnswer.has(card.id)
          const accuracy = card.review_count > 0 ? Math.round((card.correct_count / card.review_count) * 100) : 0

          return (
            <div key={card.id} className="border-b border-border/15 last:border-b-0">
              <button
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-surface-hover/60 transition-colors text-left"
                onClick={() => setExpandedId(isExpanded ? null : card.id)}
              >
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-purple-500/10">
                  <Layers className="w-4 h-4 text-purple-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-primary truncate">{card.front}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`text-xs ${statusCfg.color}`}>{statusCfg[language === 'zh' ? 'zh' : 'en']}</span>
                    <span className="text-text-muted/40">·</span>
                    <span className={`text-xs ${diff.color}`}>{diff[language === 'zh' ? 'zh' : 'en']}</span>
                    {card.review_count > 0 && (
                      <>
                        <span className="text-text-muted/40">·</span>
                        <span className="text-xs text-text-muted">{accuracy}%</span>
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
                  <div className="rounded-xl border border-purple-500/20 overflow-hidden">
                    <div className="p-3 space-y-2 bg-background/30">
                      <div>
                        <div className="text-[10px] text-text-muted mb-1">{language === 'zh' ? '正面（问题）' : 'Front (Question)'}</div>
                        <div className="text-sm text-text-primary">{card.front}</div>
                      </div>
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] text-text-muted">{language === 'zh' ? '背面（答案）' : 'Back (Answer)'}</span>
                          <button
                            onClick={() => toggleAnswer(card.id)}
                            className="text-[10px] text-accent hover:text-accent/80 flex items-center gap-0.5"
                          >
                            {isAnswerVisible ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                            {isAnswerVisible ? (language === 'zh' ? '隐藏' : 'Hide') : (language === 'zh' ? '显示' : 'Show')}
                          </button>
                        </div>
                        {isAnswerVisible ? (
                          <div className="text-sm text-text-primary bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-2.5 py-2">
                            {card.back}
                          </div>
                        ) : (
                          <div className="text-sm text-text-muted/40 bg-surface-hover/30 rounded-lg px-2.5 py-2 text-center">
                            {language === 'zh' ? '点击"显示"查看答案' : 'Click "Show" to reveal'}
                          </div>
                        )}
                      </div>
                      {card.hint && isAnswerVisible && (
                        <div className="text-xs text-amber-400 bg-amber-500/5 border border-amber-500/10 rounded-lg px-2.5 py-1.5">
                          💡 {card.hint}
                        </div>
                      )}
                      {card.tags && (
                        <div className="flex flex-wrap gap-1">
                          {card.tags.split(',').map((tag, i) => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover/50 text-text-muted border border-border/10">
                              {tag.trim()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="px-3 py-2 border-t border-border/10 flex items-center gap-2">
                      <ActionButton
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs gap-1 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        onClick={() => handleDelete(card.id)}
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

      {cards.length > 0 && (
        <div className="px-3 py-2 border-t border-border/30">
          <ActionButton variant="ghost" size="sm" className="h-7 w-full text-xs gap-1.5" onClick={() => setShowAddModal(true)}>
            <Plus className="w-3 h-3" />
            {language === 'zh' ? '添加卡片' : 'Add Card'}
          </ActionButton>
        </div>
      )}

      <OverlayDialog
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}
        title={language === 'zh' ? '添加知识卡片' : 'Add Flashcard'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '正面（问题）' : 'Front (Question)'} <span className="text-red-400">*</span>
            </label>
            <textarea
              value={addForm.front}
              onChange={e => setAddForm({ ...addForm, front: e.target.value })}
              placeholder={language === 'zh' ? '如 什么是闭包？' : 'e.g. What is a closure?'}
              rows={2}
              className="w-full px-3 py-2 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85 resize-none"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '背面（答案）' : 'Back (Answer)'} <span className="text-red-400">*</span>
            </label>
            <textarea
              value={addForm.back}
              onChange={e => setAddForm({ ...addForm, back: e.target.value })}
              placeholder={language === 'zh' ? '如 闭包是指函数与其词法环境的组合...' : 'e.g. A closure is the combination of a function...'}
              rows={3}
              className="w-full px-3 py-2 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85 resize-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '提示' : 'Hint'}
            </label>
            <input
              type="text"
              value={addForm.hint}
              onChange={e => setAddForm({ ...addForm, hint: e.target.value })}
              placeholder={language === 'zh' ? '可选提示信息' : 'Optional hint'}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
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

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '标签（逗号分隔）' : 'Tags (comma separated)'}
            </label>
            <input
              type="text"
              value={addForm.tags}
              onChange={e => setAddForm({ ...addForm, tags: e.target.value })}
              placeholder={language === 'zh' ? '如 JS,闭包,函数' : 'e.g. JS,closure,function'}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <ActionButton variant="ghost" size="sm" className="h-9 flex-1 text-sm" onClick={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}>
              {language === 'zh' ? '取消' : 'Cancel'}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" className="h-9 flex-1 text-sm" onClick={handleAdd} disabled={!addForm.front.trim() || !addForm.back.trim() || saving}>
              {saving ? (language === 'zh' ? '保存中...' : 'Saving...') : (language === 'zh' ? '添加' : 'Add')}
            </ActionButton>
          </div>
        </div>
      </OverlayDialog>
    </div>
  )
}
