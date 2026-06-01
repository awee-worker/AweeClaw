import type { WorkflowNodeData, SwitchCase } from '@shared/protocols/workflowV2'
import { Section } from '../Section'
import { t, type Language } from '@renderer/i18n'

interface SwitchCaseBuilderProps {
  data: WorkflowNodeData
  onChange: (field: string, value: unknown) => void
  language: 'en' | 'zh'
}

export function SwitchCaseBuilder({ data, onChange, language }: SwitchCaseBuilderProps) {
  const cases = data.switchCases || []

  const addCase = () => {
    const newCase: SwitchCase = {
      id: `case-${Date.now()}`,
      label: `Case ${cases.length + 1}`,
      condition: '',
      targetHandle: `case-${cases.length}`,
    }
    onChange('switchCases', [...cases, newCase])
  }

  const updateCase = (index: number, updates: Record<string, unknown>) => {
    const updated = cases.map((c, i) => i === index ? { ...c, ...updates } : c)
    onChange('switchCases', updated)
  }

  const removeCase = (index: number) => {
    onChange('switchCases', cases.filter((_, i) => i !== index))
  }

  return (
    <Section title={t('wf.switchcases', language as Language)}>
      <div className="space-y-2">
        {cases.map((sc, index) => (
          <div key={sc.id} className="p-2 rounded-md border border-[var(--border)] bg-[var(--background)]/50 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-medium text-[var(--accent)]">
                #{index + 1}
              </span>
              <button
                onClick={() => removeCase(index)}
                className="text-[10px] text-[var(--text-muted)] hover:text-red-400"
              >
                ✕
              </button>
            </div>
            <input
              type="text"
              value={sc.label}
              onChange={(e) => updateCase(index, { label: e.target.value })}
              placeholder={t('wf.caselabel', language as Language)}
              className="w-full px-2 py-1 text-[11px] rounded border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
            <input
              type="text"
              value={sc.condition}
              onChange={(e) => updateCase(index, { condition: e.target.value })}
              placeholder={t('wf.conditionexpression', language as Language)}
              className="w-full px-2 py-1 text-[11px] rounded border border-[var(--border)] bg-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)] font-mono"
            />
          </div>
        ))}
        <button
          onClick={addCase}
          className="w-full py-1.5 text-[11px] text-[var(--accent)] border border-dashed border-[var(--accent)]/30 rounded-md hover:bg-[var(--accent)]/5 transition-colors"
        >
          + {t('wf.addcase', language as Language)}
        </button>
      </div>
    </Section>
  )
}
