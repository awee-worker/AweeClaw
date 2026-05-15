import { useState } from 'react'
import type { SymptomSeverity } from '../providerTypes'

const BODY_REGIONS = [
  { id: 'head', label: '头部', icon: '🧠' },
  { id: 'chest', label: '胸部', icon: '🫁' },
  { id: 'abdomen', label: '腹部', icon: '🫀' },
  { id: 'limbs', label: '四肢', icon: '🦴' },
  { id: 'skin', label: '皮肤', icon: '🩹' },
  { id: 'general', label: '全身', icon: '🧍' },
]

const SEVERITY_OPTIONS: Array<{ id: SymptomSeverity; label: string; color: string }> = [
  { id: 'mild', label: '轻微', color: '#22c55e' },
  { id: 'moderate', label: '中等', color: '#eab308' },
  { id: 'severe', label: '严重', color: '#ef4444' },
  { id: 'critical', label: '危急', color: '#7c3aed' },
]

export function SymptomCheckerPanel() {
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null)
  const [selectedSeverity, setSelectedSeverity] = useState<SymptomSeverity>('moderate')
  const [symptoms, _setSymptoms] = useState<string[]>([])

  const toggleRegion = (id: string) => {
    setSelectedRegion(selectedRegion === id ? null : id)
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
        <span>🩺</span>
        <span>症状分析</span>
      </div>

      <div style={{
        padding: '8px 10px',
        borderRadius: '6px',
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid rgba(239, 68, 68, 0.15)',
        marginBottom: '12px',
        fontSize: '10px',
        color: 'rgb(var(--text-secondary))',
        lineHeight: 1.5,
      }}>
        ⚠️ 本工具仅供参考，不构成医疗诊断。如有紧急情况请立即就医。
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', marginBottom: '6px' }}>身体部位</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px' }}>
          {BODY_REGIONS.map(region => (
            <button
              key={region.id}
              onClick={() => toggleRegion(region.id)}
              style={{
                padding: '6px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: selectedRegion === region.id ? 'rgb(var(--accent))' : 'rgba(var(--border), 0.2)',
                background: selectedRegion === region.id ? 'rgba(var(--accent), 0.1)' : 'transparent',
                color: selectedRegion === region.id ? 'rgb(var(--accent))' : 'rgb(var(--text-secondary))',
                cursor: 'pointer',
                fontSize: '10px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '2px',
              }}
            >
              <span style={{ fontSize: '16px' }}>{region.icon}</span>
              <span>{region.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', marginBottom: '6px' }}>严重程度</div>
        <div style={{ display: 'flex', gap: '4px' }}>
          {SEVERITY_OPTIONS.map(opt => (
            <button
              key={opt.id}
              onClick={() => setSelectedSeverity(opt.id)}
              style={{
                flex: 1,
                padding: '6px',
                borderRadius: '6px',
                border: '1px solid',
                borderColor: selectedSeverity === opt.id ? opt.color : 'rgba(var(--border), 0.2)',
                background: selectedSeverity === opt.id ? `${opt.color}15` : 'transparent',
                color: selectedSeverity === opt.id ? opt.color : 'rgb(var(--text-secondary))',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 500,
                textAlign: 'center',
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', marginBottom: '6px' }}>已选症状</div>
        <div style={{
          minHeight: '36px',
          padding: '6px',
          borderRadius: '6px',
          border: '1px solid rgba(var(--border), 0.15)',
          background: 'rgba(var(--background-tertiary), 0.3)',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '4px',
        }}>
          {symptoms.length === 0 ? (
            <span style={{ fontSize: '10px', color: 'rgb(var(--text-muted))' }}>在聊天中描述症状开始分析</span>
          ) : (
            symptoms.map(s => (
              <span key={s} style={{
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(var(--accent), 0.1)',
                color: 'rgb(var(--accent))',
                fontSize: '10px',
              }}>
                {s}
              </span>
            ))
          )}
        </div>
      </div>

      <div style={{
        marginTop: 'auto',
        padding: '10px',
        borderRadius: '8px',
        background: 'rgba(var(--background-tertiary), 0.5)',
        border: '1px solid rgba(var(--border), 0.15)',
        fontSize: '11px',
        color: 'rgb(var(--text-secondary))',
        lineHeight: 1.6,
      }}>
        💡 在聊天中描述您的症状，例如："我头痛3天了，伴有轻微发热"，AI 将使用 symptom_analysis 工具进行分析。
      </div>
    </div>
  )
}
