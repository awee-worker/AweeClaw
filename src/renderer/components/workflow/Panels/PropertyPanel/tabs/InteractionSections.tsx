import type { TabProps } from '../types'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_CLASS } from '../shared'

export function UserInputSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={language === 'zh' ? '输入类型' : 'Input Type'}>
        <select
          value={data.inputType || 'text'}
          onChange={(e) => onChange('inputType', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="text">{language === 'zh' ? '文本' : 'Text'}</option>
          <option value="number">{language === 'zh' ? '数字' : 'Number'}</option>
          <option value="select">{language === 'zh' ? '选择' : 'Select'}</option>
          <option value="multiline">{language === 'zh' ? '多行文本' : 'Multiline'}</option>
        </select>
      </Section>
      {data.inputType === 'select' && (
        <Section title={language === 'zh' ? '选项' : 'Options'}>
          <textarea
            value={(data.inputOptions || []).map(o => `${o.label}:${o.value}`).join('\n')}
            onChange={(e) => {
              const options = e.target.value.split('\n').filter(Boolean).map(line => {
                const [label, value] = line.split(':')
                return { label: label.trim(), value: (value || label).trim() }
              })
              onChange('inputOptions', options)
            }}
            placeholder={language === 'zh' ? '标签:值（每行一个）' : 'Label:Value (one per line)'}
            rows={3}
            className={TEXTAREA_CLASS}
          />
        </Section>
      )}
    </>
  )
}

export function UserApprovalSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={language === 'zh' ? '超时时间' : 'Approval Timeout'}>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={data.approvalTimeout || 0}
            onChange={(e) => onChange('approvalTimeout', Number(e.target.value))}
            min={0}
            className={INPUT_CLASS}
          />
          <span className="text-[10px] text-[var(--text-muted)]">ms</span>
        </div>
      </Section>
      <Section title={language === 'zh' ? '超时动作' : 'Auto Action'}>
        <select
          value={data.approvalAutoAction || 'pause'}
          onChange={(e) => onChange('approvalAutoAction', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="pause">{language === 'zh' ? '暂停等待' : 'Pause'}</option>
          <option value="approve">{language === 'zh' ? '自动批准' : 'Auto Approve'}</option>
          <option value="reject">{language === 'zh' ? '自动拒绝' : 'Auto Reject'}</option>
        </select>
      </Section>
    </>
  )
}
