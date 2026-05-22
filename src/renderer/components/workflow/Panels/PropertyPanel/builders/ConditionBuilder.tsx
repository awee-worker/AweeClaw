import type { WorkflowNodeData, ConditionRule } from '@shared/protocols/workflowV2'
import type { ConditionOperator } from '@shared/protocols/workflow'
import { Section } from '../Section'
import { CONDITION_OPERATORS } from '../shared'

interface ConditionBuilderProps {
  data: WorkflowNodeData
  onChange: (field: string, value: unknown) => void
  language: 'en' | 'zh'
}

export function ConditionBuilder({ data, onChange, language }: ConditionBuilderProps) {
  const conditions = data.conditions || []

  const addCondition = () => {
    const newRule: ConditionRule = {
      id: `cond-${Date.now()}`,
      variable: '',
      operator: 'eq',
      value: '',
      targetHandle: conditions.length === 0 ? 'then' : 'else',
    }
    onChange('conditions', [...conditions, newRule])
  }

  const updateCondition = (index: number, updates: Partial<ConditionRule>) => {
    const updated = conditions.map((c, i) => i === index ? { ...c, ...updates } : c)
    onChange('conditions', updated)
  }

  const removeCondition = (index: number) => {
    onChange('conditions', conditions.filter((_, i) => i !== index))
  }

  return (
    <Section title={language === 'zh' ? '条件规则' : 'Condition Rules'}>
      <div className="space-y-2">
        {conditions.map((cond, index) => (
          <div key={cond.id} className="p-2 rounded-md border border-[var(--border)] bg-[var(--background)]/50 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
                cond.targetHandle === 'then'
                  ? 'bg-green-500/10 text-green-500'
                  : 'bg-red-500/10 text-red-500'
              }`}>
                {cond.targetHandle === 'then'
                  ? (language === 'zh' ? '真分支' : 'True')
                  : (language === 'zh' ? '假分支' : 'False')}
              </span>
              <button
                onClick={() => removeCondition(index)}
                className="text-[10px] text-[var(--text-muted)] hover:text-red-400"
              >
                ✕
              </button>
            </div>
            <input
              type="text"
              value={cond.variable}
              onChange={(e) => updateCondition(index, { variable: e.target.value })}
              placeholder={language === 'zh' ? '变量名' : 'Variable'}
              className="w-full px-2 py-1 text-[11px] rounded border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            />
            <select
              value={cond.operator}
              onChange={(e) => updateCondition(index, { operator: e.target.value as ConditionOperator })}
              className="w-full px-2 py-1 text-[11px] rounded border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            >
              {CONDITION_OPERATORS.map(op => (
                <option key={op.value} value={op.value}>
                  {language === 'zh' ? op.label.zh : op.label.en}
                </option>
              ))}
            </select>
            {!['is_truthy', 'is_falsy'].includes(cond.operator) && (
              <input
                type="text"
                value={String(cond.value ?? '')}
                onChange={(e) => updateCondition(index, { value: e.target.value })}
                placeholder={language === 'zh' ? '比较值' : 'Value'}
                className="w-full px-2 py-1 text-[11px] rounded border border-[var(--border)] bg-[var(--background)] text-[var(--text-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              />
            )}
          </div>
        ))}
        <button
          onClick={addCondition}
          className="w-full py-1.5 text-[11px] text-[var(--accent)] border border-dashed border-[var(--accent)]/30 rounded-md hover:bg-[var(--accent)]/5 transition-colors"
        >
          + {language === 'zh' ? '添加条件' : 'Add Condition'}
        </button>
      </div>
    </Section>
  )
}
