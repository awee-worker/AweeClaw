import { useState } from 'react'
import type { QuizQuestionType, DifficultyLevel } from '../providerTypes'

const QUESTION_TYPES: Array<{ id: QuizQuestionType; label: string; icon: string }> = [
  { id: 'multiple_choice', label: '选择题', icon: '🔘' },
  { id: 'true_false', label: '判断题', icon: '✅' },
  { id: 'short_answer', label: '简答题', icon: '✏️' },
  { id: 'fill_blank', label: '填空题', icon: '📝' },
]

const DIFFICULTY_LEVELS: Array<{ id: DifficultyLevel; label: string; color: string }> = [
  { id: 'beginner', label: '入门', color: '#22c55e' },
  { id: 'intermediate', label: '中级', color: '#eab308' },
  { id: 'advanced', label: '高级', color: '#ef4444' },
  { id: 'expert', label: '专家', color: '#7c3aed' },
]

export function QuizPanel() {
  const [selectedTypes, setSelectedTypes] = useState<QuizQuestionType[]>(['multiple_choice'])
  const [difficulty, setDifficulty] = useState<DifficultyLevel>('intermediate')
  const [questionCount, setQuestionCount] = useState(5)

  const toggleType = (type: QuizQuestionType) => {
    setSelectedTypes(prev =>
      prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px' }}>
      <div style={{
        fontSize: '13px',
        fontWeight: 600,
        color: 'rgb(var(--text-primary))',
        marginBottom: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
      }}>
        <span>📝</span>
        <span>测验生成器</span>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', marginBottom: '6px' }}>题型选择</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {QUESTION_TYPES.map(qt => (
            <button
              key={qt.id}
              onClick={() => toggleType(qt.id)}
              style={{
                padding: '4px 8px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: selectedTypes.includes(qt.id) ? 'rgb(var(--accent))' : 'rgba(var(--border), 0.2)',
                background: selectedTypes.includes(qt.id) ? 'rgba(var(--accent), 0.1)' : 'transparent',
                color: selectedTypes.includes(qt.id) ? 'rgb(var(--accent))' : 'rgb(var(--text-secondary))',
                cursor: 'pointer',
                fontSize: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              <span>{qt.icon}</span>
              <span>{qt.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', marginBottom: '6px' }}>难度级别</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {DIFFICULTY_LEVELS.map(dl => (
            <button
              key={dl.id}
              onClick={() => setDifficulty(dl.id)}
              style={{
                padding: '4px 10px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: difficulty === dl.id ? dl.color : 'rgba(var(--border), 0.2)',
                background: difficulty === dl.id ? `${dl.color}15` : 'transparent',
                color: difficulty === dl.id ? dl.color : 'rgb(var(--text-secondary))',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 500,
              }}
            >
              {dl.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', marginBottom: '6px' }}>
          题目数量: {questionCount}
        </div>
        <input
          type="range"
          min={1}
          max={20}
          value={questionCount}
          onChange={e => setQuestionCount(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'rgb(var(--accent))' }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'rgb(var(--text-muted))' }}>
          <span>1</span>
          <span>20</span>
        </div>
      </div>

      <div style={{
        padding: '12px',
        borderRadius: '8px',
        background: 'rgba(var(--background-tertiary), 0.5)',
        border: '1px solid rgba(var(--border), 0.15)',
        fontSize: '11px',
        color: 'rgb(var(--text-secondary))',
        lineHeight: 1.6,
      }}>
        💡 在聊天中输入主题，使用 quiz_generate 工具即可生成测验。选择题型和难度后，AI 将自动创建包含答案和解析的完整测验。
      </div>
    </div>
  )
}
