import type { TabProps } from '../types'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS } from '../shared'
import { t, type Language } from '@renderer/i18n'

export function DelaySection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <Section title={t('wf.delay', language as Language)}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          value={data.delayMs || 1000}
          onChange={(e) => onChange('delayMs', Number(e.target.value))}
          min={0}
          className={INPUT_CLASS}
        />
        <span className="text-[10px] text-[var(--text-muted)]">ms</span>
      </div>
    </Section>
  )
}

export function LoopSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={t('wf.maxiterations', language as Language)}>
        <input
          type="number"
          value={data.loopMaxIterations || 10}
          onChange={(e) => onChange('loopMaxIterations', Number(e.target.value))}
          min={1}
          className={INPUT_CLASS}
        />
      </Section>
      <Section title={t('wf.loopvariable', language as Language)}>
        <input
          type="text"
          value={data.loopVariable || ''}
          onChange={(e) => onChange('loopVariable', e.target.value)}
          placeholder="loopItem"
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}

export function ParallelSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <Section title={t('wf.parallelstrategy', language as Language)}>
      <select
        value={data.parallelStrategy || 'all'}
        onChange={(e) => onChange('parallelStrategy', e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="all">{t('wf.allcomplete', language as Language)}</option>
        <option value="any">{t('wf.anycomplete', language as Language)}</option>
        <option value="count">{t('wf.countbased', language as Language)}</option>
      </select>
    </Section>
  )
}

export function MergeSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <Section title={t('wf.mergestrategy', language as Language)}>
      <select
        value={data.mergeStrategy || 'all'}
        onChange={(e) => onChange('mergeStrategy', e.target.value)}
        className={SELECT_CLASS}
      >
        <option value="all">{t('wf.waitall', language as Language)}</option>
        <option value="any">{t('wf.waitany', language as Language)}</option>
      </select>
    </Section>
  )
}
