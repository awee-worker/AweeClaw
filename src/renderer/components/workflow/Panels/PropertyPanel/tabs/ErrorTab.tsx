import type { WorkflowNodeData } from '@shared/protocols/workflowV2'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS } from '../shared'
import { t, type Language } from '@renderer/i18n'

interface ErrorTabProps {
  data: WorkflowNodeData
  onChange: (field: string, value: unknown) => void
  language: 'en' | 'zh'
}

export function ErrorTab({ data, onChange, language }: ErrorTabProps) {
  const onError = data.onError

  return (
    <>
      <Section title={t('wf.errorhandlingstrategy', language as Language)}>
        <select
          value={onError?.action || 'abort'}
          onChange={(e) => onChange('onError', { ...onError, action: e.target.value })}
          className={SELECT_CLASS}
        >
          <option value="abort">{t('wf.abortworkflow', language as Language)}</option>
          <option value="skip">{t('wf.skipcontinue', language as Language)}</option>
          <option value="retry">{t('wf.retry', language as Language)}</option>
          <option value="goto">{t('wf.gotonode', language as Language)}</option>
        </select>
      </Section>

      {onError?.action === 'retry' && (
        <>
          <Section title={t('wf.maxretries', language as Language)}>
            <input
              type="number"
              value={onError.maxRetries || 3}
              onChange={(e) => onChange('onError', { ...onError, maxRetries: Number(e.target.value) })}
              min={1}
              max={10}
              className={INPUT_CLASS}
            />
          </Section>
          <Section title={t('wf.retrydelay', language as Language)}>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={onError.retryDelayMs || 1000}
                onChange={(e) => onChange('onError', { ...onError, retryDelayMs: Number(e.target.value) })}
                min={0}
                className={INPUT_CLASS}
              />
              <span className="text-[10px] text-[var(--text-muted)]">ms</span>
            </div>
          </Section>
        </>
      )}

      {onError?.action === 'goto' && (
        <Section title={t('wf.targetnodeid', language as Language)}>
          <input
            type="text"
            value={onError.gotoNodeId || ''}
            onChange={(e) => onChange('onError', { ...onError, gotoNodeId: e.target.value })}
            placeholder={t('wf.nodeid', language as Language)}
            className={INPUT_CLASS}
          />
        </Section>
      )}

      <Section title={t('wf.fallbackoutput', language as Language)}>
        <input
          type="text"
          value={onError?.fallbackOutput != null ? String(onError.fallbackOutput) : ''}
          onChange={(e) => onChange('onError', { ...onError, fallbackOutput: e.target.value || undefined })}
          placeholder={t('wf.defaultoutputonfailure', language as Language)}
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}
