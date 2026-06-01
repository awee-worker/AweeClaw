import type { TabProps } from '../types'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_CLASS } from '../shared'
import { t, type Language } from '@renderer/i18n'

export function HttpRequestSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={t('wf.httpmethod', language as Language)}>
        <select
          value={data.httpMethod || 'GET'}
          onChange={(e) => onChange('httpMethod', e.target.value)}
          className={SELECT_CLASS}
        >
          {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map(m => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Section>
      <Section title="URL">
        <input
          type="text"
          value={data.httpUrl || ''}
          onChange={(e) => onChange('httpUrl', e.target.value)}
          placeholder="https://api.example.com/endpoint"
          className={INPUT_CLASS}
        />
      </Section>
      <Section title={t('wf.headers', language as Language)}>
        <textarea
          value={data.httpHeaders ? Object.entries(data.httpHeaders).map(([k, v]) => `${k}: ${v}`).join('\n') : ''}
          onChange={(e) => {
            const headers: Record<string, string> = {}
            e.target.value.split('\n').filter(Boolean).forEach(line => {
              const [key, ...rest] = line.split(':')
              if (key) headers[key.trim()] = rest.join(':').trim()
            })
            onChange('httpHeaders', headers)
          }}
          placeholder="Content-Type: application/json"
          rows={3}
          className={TEXTAREA_CLASS + ' font-mono'}
        />
      </Section>
      <Section title="Body">
        <textarea
          value={data.httpBody || ''}
          onChange={(e) => onChange('httpBody', e.target.value)}
          placeholder='{"key": "value"}'
          rows={4}
          className={TEXTAREA_CLASS + ' font-mono'}
        />
      </Section>
    </>
  )
}

export function TextOutputSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <Section title={t('wf.textcontent', language as Language)}>
      <textarea
        value={data.textContent || ''}
        onChange={(e) => onChange('textContent', e.target.value)}
        rows={4}
        className={TEXTAREA_CLASS}
      />
    </Section>
  )
}

export function NotificationSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={t('wf.channel', language as Language)}>
        <select
          value={data.notificationChannel || 'system'}
          onChange={(e) => onChange('notificationChannel', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="system">{t('wf.system', language as Language)}</option>
          <option value="email">{t('wf.email', language as Language)}</option>
          <option value="webhook">Webhook</option>
        </select>
      </Section>
      <Section title={t('wf.template', language as Language)}>
        <textarea
          value={data.notificationTemplate || ''}
          onChange={(e) => onChange('notificationTemplate', e.target.value)}
          rows={3}
          className={TEXTAREA_CLASS}
        />
      </Section>
    </>
  )
}
