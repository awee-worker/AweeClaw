import { useState } from 'react'

const DRUG_CATEGORIES = [
  { id: 'prescription', label: '处方药', icon: '💊' },
  { id: 'otc', label: '非处方药', icon: '🧴' },
  { id: 'supplement', label: '保健品', icon: '🌿' },
  { id: 'controlled', label: '管制药品', icon: '⚠️' },
]

const COMMON_DRUGS = [
  '阿司匹林', '布洛芬', '对乙酰氨基酚', '阿莫西林',
  '头孢', '奥美拉唑', '二甲双胍', '阿托伐他汀',
  '氨氯地平', '氯雷他定',
]

export function DrugInfoPanel() {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const filteredDrugs = searchQuery.trim()
    ? COMMON_DRUGS.filter(d => d.includes(searchQuery.trim()))
    : COMMON_DRUGS

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
        <span>💊</span>
        <span>药物信息</span>
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
        ⚠️ 药物信息仅供参考，用药请遵医嘱。不可自行调整用药方案。
      </div>

      <div style={{ marginBottom: '12px' }}>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="搜索药物名称..."
          style={{
            width: '100%',
            padding: '8px 10px',
            borderRadius: '6px',
            border: '1px solid rgba(var(--border), 0.2)',
            background: 'rgba(var(--background-tertiary), 0.5)',
            color: 'rgb(var(--text-primary))',
            fontSize: '12px',
            outline: 'none',
            boxSizing: 'border-box',
          }}
        />
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', marginBottom: '6px' }}>药物分类</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {DRUG_CATEGORIES.map(cat => (
            <button
              key={cat.id}
              onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
              style={{
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid',
                borderColor: selectedCategory === cat.id ? 'rgb(var(--accent))' : 'rgba(var(--border), 0.2)',
                background: selectedCategory === cat.id ? 'rgba(var(--accent), 0.1)' : 'transparent',
                color: selectedCategory === cat.id ? 'rgb(var(--accent))' : 'rgb(var(--text-secondary))',
                cursor: 'pointer',
                fontSize: '10px',
                display: 'flex',
                alignItems: 'center',
                gap: '3px',
              }}
            >
              <span>{cat.icon}</span>
              <span>{cat.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ fontSize: '11px', color: 'rgb(var(--text-muted))', marginBottom: '6px' }}>常见药物</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {filteredDrugs.map(drug => (
            <div
              key={drug}
              style={{
                padding: '8px 10px',
                borderRadius: '6px',
                border: '1px solid rgba(var(--border), 0.1)',
                background: 'rgba(var(--background-tertiary), 0.3)',
                fontSize: '11px',
                color: 'rgb(var(--text-secondary))',
                cursor: 'pointer',
                transition: 'background 0.2s',
              }}
            >
              💊 {drug}
            </div>
          ))}
        </div>
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
        💡 在聊天中输入药物名称，使用 drug_lookup 工具查询详细信息
      </div>
    </div>
  )
}
