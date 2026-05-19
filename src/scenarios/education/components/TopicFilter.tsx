import { useState, useCallback, useEffect } from 'react'
import { useStore } from '@store'

interface TopicOption {
  id: string
  title: string
  parent_id: string
}

interface SubjectOption {
  id: string
  name: string
}

interface TopicFilterProps {
  selectedSubjectId: string
  selectedTopicId: string
  onSubjectChange: (subjectId: string) => void
  onTopicChange: (topicId: string) => void
  showSubjectFilter?: boolean
}

export function TopicFilter({
  selectedSubjectId,
  selectedTopicId,
  onSubjectChange,
  onTopicChange,
  showSubjectFilter = true,
}: TopicFilterProps) {
  const language = useStore(s => s.language)
  const [subjects, setSubjects] = useState<SubjectOption[]>([])
  const [topics, setTopics] = useState<TopicOption[]>([])

  const getDb = useCallback(async () => {
    const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
    return scenarioDatabaseManager
  }, [])

  useEffect(() => {
    if (!showSubjectFilter) return
    const loadSubjects = async () => {
      try {
        const db = await getDb()
        const result = await db.executeSql('education', 'SELECT id, name FROM subjects WHERE status = "active" ORDER BY sort_order, name')
        if (result.success && result.rows) {
          setSubjects(result.rows as unknown as SubjectOption[])
        }
      } catch {}
    }
    loadSubjects()
  }, [getDb, showSubjectFilter])

  useEffect(() => {
    if (!selectedSubjectId) { setTopics([]); return }
    const loadTopics = async () => {
      try {
        const db = await getDb()
        const result = await db.executeSql('education', `SELECT id, title, parent_id FROM topics WHERE subject_id = '${selectedSubjectId}' AND status = 'active' ORDER BY sort_order, title`)
        if (result.success && result.rows) {
          setTopics(result.rows as unknown as TopicOption[])
        }
      } catch { setTopics([]) }
    }
    loadTopics()
  }, [getDb, selectedSubjectId])

  return (
    <div className="flex items-center gap-1.5">
      {showSubjectFilter && (
        <select
          value={selectedSubjectId}
          onChange={e => { onSubjectChange(e.target.value); onTopicChange('') }}
          className="h-6 px-1.5 text-[11px] bg-background border border-border/40 rounded-md focus:outline-none focus:border-accent/50 text-text-primary max-w-[100px]"
        >
          <option value="">{language === 'zh' ? '全部学科' : 'All'}</option>
          {subjects.map(s => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      )}
      {selectedSubjectId && topics.length > 0 && (
        <select
          value={selectedTopicId}
          onChange={e => onTopicChange(e.target.value)}
          className="h-6 px-1.5 text-[11px] bg-background border border-border/40 rounded-md focus:outline-none focus:border-accent/50 text-text-primary max-w-[120px]"
        >
          <option value="">{language === 'zh' ? '全部知识点' : 'All Topics'}</option>
          {topics.map(t => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
        </select>
      )}
    </div>
  )
}
