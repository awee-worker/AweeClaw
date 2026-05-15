import { useState } from 'react'
import type { StudyMilestone, ProgressStatus } from '../providerTypes'

const STATUS_ICONS: Record<ProgressStatus, string> = {
  not_started: '⬜',
  in_progress: '🔵',
  completed: '✅',
  review: '🔄',
  mastered: '🏆',
}

const DEFAULT_MILESTONES: StudyMilestone[] = [
  { id: 'm1', title: '基础概念', titleZh: '基础概念', topicIds: [], estimatedDays: 7, order: 1, status: 'not_started' },
  { id: 'm2', title: '核心原理', titleZh: '核心原理', topicIds: [], estimatedDays: 10, order: 2, status: 'not_started' },
  { id: 'm3', title: '实践应用', titleZh: '实践应用', topicIds: [], estimatedDays: 7, order: 3, status: 'not_started' },
  { id: 'm4', title: '综合评估', titleZh: '综合评估', topicIds: [], estimatedDays: 3, order: 4, status: 'not_started' },
]

export function StudyPlanView() {
  const [milestones] = useState<StudyMilestone[]>(DEFAULT_MILESTONES)
  const [activeMilestone, setActiveMilestone] = useState<string | null>(null)

  const completedCount = milestones.filter(m => m.status === 'completed' || m.status === 'mastered').length
  const totalDays = milestones.reduce((sum, m) => sum + m.estimatedDays, 0)
  const progressPercent = Math.round((completedCount / milestones.length) * 100)

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
        <span>📋</span>
        <span>学习计划</span>
      </div>

      <div style={{
        padding: '12px',
        borderRadius: '8px',
        background: 'rgba(var(--background-tertiary), 0.5)',
        border: '1px solid rgba(var(--border), 0.15)',
        marginBottom: '12px',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
          <span style={{ fontSize: '11px', color: 'rgb(var(--text-secondary))' }}>总体进度</span>
          <span style={{ fontSize: '11px', fontWeight: 600, color: 'rgb(var(--accent))' }}>{progressPercent}%</span>
        </div>
        <div style={{
          height: '6px',
          borderRadius: '3px',
          background: 'rgba(var(--border), 0.2)',
          overflow: 'hidden',
        }}>
          <div style={{
            height: '100%',
            width: `${progressPercent}%`,
            borderRadius: '3px',
            background: 'rgb(var(--accent))',
            transition: 'width 0.3s ease',
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px', fontSize: '9px', color: 'rgb(var(--text-muted))' }}>
          <span>{completedCount}/{milestones.length} 里程碑</span>
          <span>预计 {totalDays} 天</span>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {milestones.map((milestone, idx) => (
          <div
            key={milestone.id}
            onClick={() => setActiveMilestone(activeMilestone === milestone.id ? null : milestone.id)}
            style={{
              padding: '10px',
              borderRadius: '8px',
              border: '1px solid',
              borderColor: activeMilestone === milestone.id ? 'rgb(var(--accent))' : 'rgba(var(--border), 0.15)',
              background: activeMilestone === milestone.id ? 'rgba(var(--accent), 0.05)' : 'rgba(var(--background-tertiary), 0.3)',
              marginBottom: '6px',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                border: '2px solid',
                borderColor: milestone.status === 'completed' || milestone.status === 'mastered' ? '#22c55e' : 'rgba(var(--border), 0.3)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
                background: milestone.status === 'completed' || milestone.status === 'mastered' ? '#22c55e20' : 'transparent',
                color: milestone.status === 'completed' || milestone.status === 'mastered' ? '#22c55e' : 'rgb(var(--text-muted))',
                flexShrink: 0,
              }}>
                {milestone.status === 'completed' || milestone.status === 'mastered' ? '✓' : idx + 1}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: '12px', fontWeight: 500, color: 'rgb(var(--text-primary))' }}>
                  {milestone.titleZh}
                </div>
                <div style={{ fontSize: '10px', color: 'rgb(var(--text-muted))' }}>
                  {STATUS_ICONS[milestone.status]} {milestone.estimatedDays} 天
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div style={{
        marginTop: '8px',
        padding: '8px',
        borderRadius: '6px',
        background: 'rgba(var(--accent), 0.05)',
        border: '1px solid rgba(var(--accent), 0.15)',
        fontSize: '10px',
        color: 'rgb(var(--text-secondary))',
        textAlign: 'center',
      }}>
        💡 在聊天中使用 study_plan 工具创建个性化学习计划
      </div>
    </div>
  )
}
