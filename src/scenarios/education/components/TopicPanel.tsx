import { useState, useCallback, useEffect } from 'react'
import { Network, Plus, RefreshCw, ChevronDown, ChevronRight, Trash2, Sparkles, Clock, Target } from 'lucide-react'
import { useStore } from '@store'
import { ActionButton, OverlayDialog } from '@/renderer/components/ui'
import { Agent } from '@intelligence/engine'
import { getAgentConfig } from '@intelligence/utils/intelligenceConfig'

interface TopicRecord {
  id: string
  subject_id: string
  title: string
  title_en: string
  description: string
  difficulty: string
  parent_id: string
  sort_order: number
  status: string
  mastery_level: number
  estimated_minutes: number
  prerequisites: string
  tags: string
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

const STATUS_CONFIG: Record<string, { zh: string; en: string; color: string; dot: string }> = {
  active: { zh: '未学习', en: 'New', color: 'text-text-muted', dot: 'bg-text-muted/40' },
  in_progress: { zh: '学习中', en: 'Learning', color: 'text-blue-400', dot: 'bg-blue-400' },
  mastered: { zh: '已掌握', en: 'Mastered', color: 'text-green-400', dot: 'bg-green-400' },
}

const EMPTY_FORM = {
  subject_id: '',
  title: '',
  title_en: '',
  description: '',
  difficulty: 'intermediate',
  parent_id: '',
  estimated_minutes: 30,
  tags: '',
}

export function TopicPanel() {
  const language = useStore(s => s.language)
  const llmConfig = useStore(s => s.llmConfig)
  const workspacePath = useStore(s => s.workspacePath)

  const [topics, setTopics] = useState<TopicRecord[]>([])
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [selectedSubject, setSelectedSubject] = useState<string>('')
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
        if (!selectedSubject && result.rows.length > 0) {
          setSelectedSubject((result.rows[0] as Record<string, unknown>).id as string)
        }
      }
    } catch {}
  }, [getDb, selectedSubject])

  const loadTopics = useCallback(async () => {
    if (!selectedSubject) return
    setLoading(true)
    try {
      const db = await getDb()
      const result = await db.executeSql('education', `SELECT * FROM topics WHERE subject_id = '${selectedSubject}' AND status = 'active' ORDER BY sort_order, title`)
      if (result.success && result.rows) {
        setTopics(result.rows as unknown as TopicRecord[])
      }
    } catch {
      setTopics([])
    }
    setLoading(false)
  }, [getDb, selectedSubject])

  useEffect(() => { loadSubjects() }, [loadSubjects])
  useEffect(() => { if (selectedSubject) loadTopics() }, [selectedSubject, loadTopics])

  const toggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const buildTopicTree = useCallback((topicList: TopicRecord[], parentId: string = ''): (TopicRecord & { children: TopicRecord[] })[] => {
    return topicList
      .filter(t => t.parent_id === parentId)
      .map(t => ({ ...t, children: buildTopicTree(topicList, t.id) }))
  }, [])

  const handleAdd = useCallback(async () => {
    if (!addForm.title.trim() || !addForm.subject_id) return
    setSaving(true)
    try {
      const db = await getDb()
      const id = `topic_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const sql = `INSERT INTO topics (id, subject_id, title, title_en, description, difficulty, parent_id, sort_order, status, mastery_level, estimated_minutes, tags) VALUES ('${id}', '${addForm.subject_id}', '${esc(addForm.title.trim())}', '${esc(addForm.title_en.trim())}', '${esc(addForm.description)}', '${addForm.difficulty}', '${addForm.parent_id}', ${topics.length}, 'active', 0, ${addForm.estimated_minutes}, '${esc(addForm.tags)}')`
      await db.executeSql('education', sql)
      setShowAddModal(false)
      setAddForm({ ...EMPTY_FORM })
      await loadTopics()
    } catch {}
    setSaving(false)
  }, [addForm, topics.length, getDb, esc, loadTopics])

  const handleDelete = useCallback(async (id: string) => {
    try {
      const db = await getDb()
      await db.executeSql('education', `DELETE FROM topics WHERE id='${id}'`)
      await loadTopics()
    } catch {}
  }, [getDb, loadTopics])

  const handleGenerateOutline = useCallback(() => {
    if (!selectedSubject) return
    const subjectName = subjects.find(s => s.id === selectedSubject)?.name || ''
    const prompt = language === 'zh'
      ? `请为学科「${subjectName}」生成结构化的知识点大纲，并使用 topic_manage 工具的 bulk_create 操作批量创建知识点。每个知识点包含 title、title_en、description、difficulty、estimated_minutes 字段。按层级组织，最多3层深度，确保覆盖核心知识体系。`
      : `Generate a structured knowledge point outline for subject "${subjectName}" and use the topic_manage tool's bulk_create action to batch create topics. Each topic should include title, title_en, description, difficulty, estimated_minutes fields. Organize hierarchically with max 3 levels depth.`
    sendToChat(prompt)
  }, [selectedSubject, subjects, language, sendToChat])

  const handleExplainTopic = useCallback((topic: TopicRecord) => {
    const prompt = language === 'zh'
      ? `请详细讲解知识点「${topic.title}」，难度：${topic.difficulty}，${topic.description ? `背景：${topic.description}` : ''}`
      : `Explain the topic "${topic.title}" in detail, difficulty: ${topic.difficulty}${topic.description ? `, context: ${topic.description}` : ''}`
    sendToChat(prompt)
  }, [language, sendToChat])

  const renderTopicNode = (topic: TopicRecord & { children: TopicRecord[] }, depth: number = 0) => {
    const isExpanded = expandedIds.has(topic.id)
    const hasChildren = topic.children.length > 0
    const diff = DIFFICULTY_CONFIG[topic.difficulty] || DIFFICULTY_CONFIG.intermediate
    const statusCfg = STATUS_CONFIG[topic.status] || STATUS_CONFIG.active
    const masteryPercent = Math.round(topic.mastery_level || 0)

    return (
      <div key={topic.id}>
        <div
          className={`flex items-center gap-2 px-3 py-2 hover:bg-surface-hover/60 transition-colors cursor-pointer ${depth > 0 ? 'border-l-2 border-accent/20 ml-4' : ''}`}
          style={{ paddingLeft: `${12 + depth * 16}px` }}
        >
          <button
            className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${hasChildren ? '' : 'invisible'}`}
            onClick={() => toggleExpand(topic.id)}
          >
            {hasChildren && (
              isExpanded
                ? <ChevronDown className="w-3 h-3 text-text-muted/60" />
                : <ChevronRight className="w-3 h-3 text-text-muted/60" />
            )}
          </button>

          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusCfg.dot}`} />

          <div className="flex-1 min-w-0" onClick={() => toggleExpand(topic.id)}>
            <div className="text-sm text-text-primary truncate">{topic.title}</div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-[10px] ${diff.color}`}>{diff[language === 'zh' ? 'zh' : 'en']}</span>
              <span className="text-text-muted/40">·</span>
              <span className="text-[10px] text-text-muted">{masteryPercent}%</span>
              <span className="text-text-muted/40">·</span>
              <span className="text-[10px] text-text-muted flex items-center gap-0.5">
                <Clock className="w-2.5 h-2.5" />
                {topic.estimated_minutes}{language === 'zh' ? '分钟' : 'min'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-0.5 flex-shrink-0">
            <div className="w-12 h-1.5 rounded-full bg-border/20 overflow-hidden mr-1">
              <div
                className={`h-full rounded-full transition-all duration-300 ${masteryPercent >= 80 ? 'bg-green-500' : masteryPercent >= 50 ? 'bg-amber-500' : masteryPercent > 0 ? 'bg-blue-500' : 'bg-transparent'}`}
                style={{ width: `${masteryPercent}%` }}
              />
            </div>
            <ActionButton
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={() => handleExplainTopic(topic)}
              title={language === 'zh' ? '讲解' : 'Explain'}
            >
              <Target className="w-2.5 h-2.5 text-accent/70" />
            </ActionButton>
            <ActionButton
              variant="ghost"
              size="sm"
              className="h-5 w-5 p-0"
              onClick={() => handleDelete(topic.id)}
              title={language === 'zh' ? '删除' : 'Delete'}
            >
              <Trash2 className="w-2.5 h-2.5 text-red-400/70" />
            </ActionButton>
          </div>
        </div>

        {isExpanded && hasChildren && (
          <div className="animate-fade-in">
            {topic.children.map(child => renderTopicNode(child as TopicRecord & { children: TopicRecord[] }, depth + 1))}
          </div>
        )}

        {isExpanded && !hasChildren && topic.description && (
          <div className="px-3 pb-2 animate-fade-in" style={{ paddingLeft: `${28 + depth * 16}px` }}>
            <div className="text-xs text-text-secondary bg-surface-hover/30 rounded-lg px-2.5 py-1.5">
              {topic.description}
            </div>
          </div>
        )}
      </div>
    )
  }

  const topicTree = buildTopicTree(topics)
  const totalTopics = topics.length
  const masteredTopics = topics.filter(t => t.mastery_level >= 80).length
  const inProgressTopics = topics.filter(t => t.mastery_level > 0 && t.mastery_level < 80).length
  const avgMastery = totalTopics > 0 ? Math.round(topics.reduce((sum, t) => sum + (t.mastery_level || 0), 0) / totalTopics) : 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/30">
        <span className="text-xs font-medium text-text-muted uppercase tracking-wider">
          {language === 'zh' ? '知识点' : 'TOPICS'}
        </span>
        <div className="flex items-center gap-1">
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={loadTopics} title={language === 'zh' ? '刷新' : 'Refresh'}>
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          </ActionButton>
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleGenerateOutline} title={language === 'zh' ? 'AI生成大纲' : 'AI Outline'} disabled={!selectedSubject}>
            <Sparkles className="w-3 h-3" />
          </ActionButton>
          <ActionButton variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowAddModal(true)} title={language === 'zh' ? '添加知识点' : 'Add Topic'}>
            <Plus className="w-3 h-3" />
          </ActionButton>
        </div>
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

      {selectedSubject && totalTopics > 0 && (
        <div className="px-3 py-2 border-b border-border/20">
          <div className="grid grid-cols-3 gap-1.5">
            <div className="flex items-center gap-1.5 py-1 px-2 rounded-lg bg-green-500/5 border border-green-500/10">
              <div className="text-[10px] text-text-muted">{language === 'zh' ? '已掌握' : 'Done'}</div>
              <div className="text-xs font-semibold text-green-400">{masteredTopics}</div>
            </div>
            <div className="flex items-center gap-1.5 py-1 px-2 rounded-lg bg-blue-500/5 border border-blue-500/10">
              <div className="text-[10px] text-text-muted">{language === 'zh' ? '进行中' : 'Active'}</div>
              <div className="text-xs font-semibold text-blue-400">{inProgressTopics}</div>
            </div>
            <div className="flex items-center gap-1.5 py-1 px-2 rounded-lg bg-purple-500/5 border border-purple-500/10">
              <div className="text-[10px] text-text-muted">{language === 'zh' ? '掌握度' : 'Avg'}</div>
              <div className="text-xs font-semibold text-purple-400">{avgMastery}%</div>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {!selectedSubject && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
            <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
              <Network className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-text-secondary">{language === 'zh' ? '请先选择学科' : 'Select a subject first'}</p>
          </div>
        )}

        {selectedSubject && topicTree.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-10 px-4 text-text-muted">
            <div className="w-12 h-12 rounded-xl bg-surface-hover/50 flex items-center justify-center mb-3">
              <Network className="w-6 h-6 opacity-40" />
            </div>
            <p className="text-sm text-text-secondary">{language === 'zh' ? '暂无知识点' : 'No topics yet'}</p>
            <p className="text-xs mt-1 opacity-60">{language === 'zh' ? '点击 ✨ AI生成知识点大纲' : 'Click ✨ to generate outline'}</p>
          </div>
        )}

        {topicTree.map(topic => renderTopicNode(topic as TopicRecord & { children: TopicRecord[] }))}
      </div>

      {selectedSubject && topicTree.length > 0 && (
        <div className="px-3 py-2 border-t border-border/30">
          <ActionButton variant="ghost" size="sm" className="h-7 w-full text-xs gap-1.5" onClick={() => setShowAddModal(true)}>
            <Plus className="w-3 h-3" />
            {language === 'zh' ? '添加知识点' : 'Add Topic'}
          </ActionButton>
        </div>
      )}

      <OverlayDialog
        isOpen={showAddModal}
        onClose={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}
        title={language === 'zh' ? '添加知识点' : 'Add Topic'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '知识点名称' : 'Topic Title'} <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={addForm.title}
              onChange={e => setAddForm({ ...addForm, title: e.target.value })}
              placeholder={language === 'zh' ? '如 微积分基本定理' : 'e.g. Fundamental Theorem of Calculus'}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '英文名称' : 'English Title'}
            </label>
            <input
              type="text"
              value={addForm.title_en}
              onChange={e => setAddForm({ ...addForm, title_en: e.target.value })}
              placeholder="e.g. Fundamental Theorem of Calculus"
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '学科' : 'Subject'}
            </label>
            <select
              value={addForm.subject_id || selectedSubject}
              onChange={e => setAddForm({ ...addForm, subject_id: e.target.value })}
              className="w-full h-8 px-2.5 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
            >
              <option value="">{language === 'zh' ? '选择学科' : 'Select Subject'}</option>
              {subjects.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '父知识点' : 'Parent Topic'}
            </label>
            <select
              value={addForm.parent_id}
              onChange={e => setAddForm({ ...addForm, parent_id: e.target.value })}
              className="w-full h-8 px-2.5 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
            >
              <option value="">{language === 'zh' ? '无（顶级知识点）' : 'None (top-level)'}</option>
              {topics.map(t => (
                <option key={t.id} value={t.id}>{t.title}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                {language === 'zh' ? '难度' : 'Difficulty'}
              </label>
              <div className="flex gap-1.5">
                {Object.entries(DIFFICULTY_CONFIG).map(([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => setAddForm({ ...addForm, difficulty: key })}
                    className={`text-[10px] py-1 px-2 rounded border transition-colors ${addForm.difficulty === key ? `${cfg.color} border-current/30 bg-current/10` : 'text-text-muted border-border/30'}`}
                  >
                    {cfg[language === 'zh' ? 'zh' : 'en']}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                {language === 'zh' ? '预计时长(分钟)' : 'Est. Minutes'}
              </label>
              <input
                type="number"
                min={5}
                max={480}
                value={addForm.estimated_minutes}
                onChange={e => setAddForm({ ...addForm, estimated_minutes: Number(e.target.value) || 30 })}
                className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {language === 'zh' ? '描述' : 'Description'}
            </label>
            <textarea
              value={addForm.description}
              onChange={e => setAddForm({ ...addForm, description: e.target.value })}
              placeholder={language === 'zh' ? '知识点简介' : 'Topic description'}
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
              placeholder={language === 'zh' ? '如 核心概念,必考' : 'e.g. core,exam-required'}
              className="w-full h-8 px-3 text-sm bg-background border border-border/50 rounded-lg focus:outline-none focus:border-accent/50 text-text-primary placeholder:text-text-muted/85"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <ActionButton variant="ghost" size="sm" className="h-9 flex-1 text-sm" onClick={() => { setShowAddModal(false); setAddForm({ ...EMPTY_FORM }) }}>
              {language === 'zh' ? '取消' : 'Cancel'}
            </ActionButton>
            <ActionButton variant="secondary" size="sm" className="h-9 flex-1 text-sm" onClick={handleAdd} disabled={!addForm.title.trim() || saving}>
              {saving ? (language === 'zh' ? '保存中...' : 'Saving...') : (language === 'zh' ? '添加' : 'Add')}
            </ActionButton>
          </div>
        </div>
      </OverlayDialog>
    </div>
  )
}
