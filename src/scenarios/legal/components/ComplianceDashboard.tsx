import { useState } from 'react'
import type { ComplianceStatus } from '../providerTypes'

const STATUS_ICONS: Record<ComplianceStatus, string> = {
  compliant: '✅',
  partial: '⚠️',
  'non-compliant': '❌',
  unknown: '❓',
}

const FRAMEWORKS = [
  { id: 'gdpr', name: 'GDPR', nameZh: '欧盟通用数据保护条例', region: 'EU' },
  { id: 'pipl', name: 'PIPL', nameZh: '个人信息保护法', region: 'CN' },
  { id: 'sox', name: 'SOX', nameZh: '萨班斯法案', region: 'US' },
  { id: 'hipaa', name: 'HIPAA', nameZh: '健康保险流通与责任法案', region: 'US' },
  { id: 'ccpa', name: 'CCPA', nameZh: '加州消费者隐私法', region: 'US' },
  { id: 'iso27001', name: 'ISO 27001', nameZh: '信息安全管理体系', region: 'Global' },
  { id: 'labor_law_cn', name: '劳动法', nameZh: '中华人民共和国劳动法', region: 'CN' },
  { id: 'company_law_cn', name: '公司法', nameZh: '中华人民共和国公司法', region: 'CN' },
]

export function ComplianceDashboard() {
  const [selectedFramework, setSelectedFramework] = useState<string | null>(null)

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
        <span>🛡️</span>
        <span>合规仪表板</span>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', marginBottom: '6px' }}>选择合规框架</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {FRAMEWORKS.map(fw => (
            <button
              key={fw.id}
              onClick={() => setSelectedFramework(fw.id === selectedFramework ? null : fw.id)}
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid',
                borderColor: selectedFramework === fw.id ? 'rgb(var(--accent))' : 'rgba(var(--border), 0.2)',
                background: selectedFramework === fw.id ? 'rgba(var(--accent), 0.1)' : 'transparent',
                color: selectedFramework === fw.id ? 'rgb(var(--accent))' : 'rgb(var(--text-secondary))',
                cursor: 'pointer',
                fontSize: '10px',
                fontWeight: 500,
              }}
            >
              {fw.name}
            </button>
          ))}
        </div>
      </div>

      {selectedFramework && (
        <FrameworkDetail framework={FRAMEWORKS.find(f => f.id === selectedFramework)!} />
      )}

      {!selectedFramework && (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'rgb(var(--text-muted))',
          fontSize: '12px',
        }}>
          选择一个合规框架开始检查
        </div>
      )}
    </div>
  )
}

function FrameworkDetail({ framework }: { framework: typeof FRAMEWORKS[number] }) {
  return (
    <div style={{
      padding: '12px',
      borderRadius: '8px',
      background: 'rgba(var(--background-tertiary), 0.5)',
      border: '1px solid rgba(var(--border), 0.15)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: 600, color: 'rgb(var(--text-primary))' }}>
            {framework.name}
          </div>
          <div style={{ fontSize: '10px', color: 'rgb(var(--text-muted))' }}>
            {framework.nameZh} · {framework.region}
          </div>
        </div>
        <span style={{
          padding: '2px 6px',
          borderRadius: '4px',
          background: 'rgba(var(--accent), 0.1)',
          color: 'rgb(var(--accent))',
          fontSize: '10px',
          fontWeight: 500,
        }}>
          {STATUS_ICONS.unknown} 开始检查
        </span>
      </div>
      <div style={{ fontSize: '11px', color: 'rgb(var(--text-secondary))', lineHeight: 1.5 }}>
        在聊天中描述需要检查的业务实践或文档，选择此框架进行合规性分析。
      </div>
    </div>
  )
}
