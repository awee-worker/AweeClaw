import { useState } from 'react'
import type { ContractRiskLevel, ComplianceStatus } from '../providerTypes'

const RISK_COLORS: Record<ContractRiskLevel, string> = {
  low: '#22c55e',
  medium: '#eab308',
  high: '#ef4444',
  critical: '#7c3aed',
}

const COMPLIANCE_COLORS: Record<ComplianceStatus, string> = {
  compliant: '#22c55e',
  partial: '#eab308',
  'non-compliant': '#ef4444',
  unknown: '#94a3b8',
}

export function ContractReviewPanel() {
  const [activeTab, setActiveTab] = useState<'overview' | 'clauses' | 'issues' | 'compliance'>('overview')

  const tabs = [
    { id: 'overview' as const, label: '概览', icon: '📊' },
    { id: 'clauses' as const, label: '条款', icon: '📋' },
    { id: 'issues' as const, label: '问题', icon: '⚠️' },
    { id: 'compliance' as const, label: '合规', icon: '🛡️' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: '12px' }}>
      <div style={{ display: 'flex', gap: '4px', marginBottom: '12px', borderBottom: '1px solid rgba(var(--border), 0.2)', paddingBottom: '8px' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '6px 12px',
              borderRadius: '6px',
              border: 'none',
              background: activeTab === tab.id ? 'rgba(var(--accent), 0.1)' : 'transparent',
              color: activeTab === tab.id ? 'rgb(var(--accent))' : 'rgb(var(--text-muted))',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'clauses' && <ClausesTab />}
        {activeTab === 'issues' && <IssuesTab />}
        {activeTab === 'compliance' && <ComplianceTab />}
      </div>
    </div>
  )
}

function OverviewTab() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <RiskGauge level="medium" score={65} />
      <div style={{
        padding: '12px',
        borderRadius: '8px',
        background: 'rgba(var(--background-tertiary), 0.5)',
        border: '1px solid rgba(var(--border), 0.15)',
      }}>
        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '6px', color: 'rgb(var(--text-primary))' }}>
          审查摘要
        </div>
        <div style={{ fontSize: '11px', color: 'rgb(var(--text-secondary))', lineHeight: 1.6 }}>
          上传合同文件或粘贴合同文本，AI 将自动进行结构化审查，包括条款风险评级、合规性检查和修改建议。
        </div>
      </div>
      <QuickActions />
    </div>
  )
}

function RiskGauge({ level, score }: { level: ContractRiskLevel; score: number }) {
  return (
    <div style={{
      padding: '16px',
      borderRadius: '8px',
      background: 'rgba(var(--background-tertiary), 0.5)',
      border: '1px solid rgba(var(--border), 0.15)',
      textAlign: 'center',
    }}>
      <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', marginBottom: '8px' }}>整体风险等级</div>
      <div style={{
        width: '80px',
        height: '80px',
        borderRadius: '50%',
        border: `3px solid ${RISK_COLORS[level]}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        margin: '0 auto 8px',
        fontSize: '24px',
        fontWeight: 700,
        color: RISK_COLORS[level],
      }}>
        {score}
      </div>
      <div style={{ fontSize: '12px', fontWeight: 600, color: RISK_COLORS[level], textTransform: 'uppercase' }}>
        {level}
      </div>
    </div>
  )
}

function QuickActions() {
  const actions = [
    { icon: '📄', label: '上传合同', prompt: '请上传合同文件进行审查' },
    { icon: '🔍', label: '风险扫描', prompt: '对当前合同进行全面风险扫描' },
    { icon: '🛡️', label: '合规检查', prompt: '检查合同是否符合适用法规', color: COMPLIANCE_COLORS.unknown },
    { icon: '📝', label: '生成修改建议', prompt: '为发现的问题生成修改建议' },
  ]

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
      {actions.map(action => (
        <button
          key={action.label}
          style={{
            padding: '10px',
            borderRadius: '8px',
            border: '1px solid rgba(var(--border), 0.15)',
            background: 'rgba(var(--background-tertiary), 0.3)',
            cursor: 'pointer',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '4px',
            fontSize: '11px',
            color: action.color || 'rgb(var(--text-secondary))',
          }}
        >
          <span style={{ fontSize: '18px' }}>{action.icon}</span>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  )
}

function ClausesTab() {
  return (
    <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', textAlign: 'center', padding: '24px' }}>
      条款分析将在合同审查完成后显示
    </div>
  )
}

function IssuesTab() {
  return (
    <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', textAlign: 'center', padding: '24px' }}>
      问题列表将在合同审查完成后显示
    </div>
  )
}

function ComplianceTab() {
  return (
    <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', textAlign: 'center', padding: '24px' }}>
      合规检查结果将在审查完成后显示
    </div>
  )
}
