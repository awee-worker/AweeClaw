import type { TabProps } from '../types'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_CLASS } from '../shared'
import { t, type Language } from '@renderer/i18n'

export function UserInputSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={t('wf.inputtype', language as Language)}>
        <select
          value={data.inputType || 'text'}
          onChange={(e) => onChange('inputType', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="text">{t('wf.text', language as Language)}</option>
          <option value="number">{t('wf.number', language as Language)}</option>
          <option value="select">{t('wf.select', language as Language)}</option>
          <option value="multiline">{t('wf.multiline', language as Language)}</option>
        </select>
      </Section>
      {data.inputType === 'select' && (
        <Section title={t('wf.options', language as Language)}>
          <textarea
            value={(data.inputOptions || []).map(o => `${o.label}:${o.value}`).join('\n')}
            onChange={(e) => {
              const options = e.target.value.split('\n').filter(Boolean).map(line => {
                const [label, value] = line.split(':')
                return { label: label.trim(), value: (value || label).trim() }
              })
              onChange('inputOptions', options)
            }}
            placeholder={t('wf.labelvalueoneperline', language as Language)}
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
      <Section title={t('wf.approvaltimeout', language as Language)}>
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
      <Section title={t('wf.autoaction', language as Language)}>
        <select
          value={data.approvalAutoAction || 'pause'}
          onChange={(e) => onChange('approvalAutoAction', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="pause">{t('wf.pause', language as Language)}</option>
          <option value="approve">{t('wf.autoapprove', language as Language)}</option>
          <option value="reject">{t('wf.autoreject', language as Language)}</option>
        </select>
      </Section>
    </>
  )
}
