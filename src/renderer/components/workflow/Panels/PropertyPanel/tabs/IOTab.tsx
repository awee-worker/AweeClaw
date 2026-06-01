import type { TabProps } from '../types'
import { Section, HelpTip } from '../Section'
import { INPUT_CLASS, TEXTAREA_MONO_CLASS } from '../shared'
import { t, type Language } from '@renderer/i18n'

export function IOTab({ nodeType, data, onChange, language }: TabProps) {
  return (
    <>
      <Section
        title={t('wf.inputvariables', language as Language)}
        tip={t('wf.getdatafromupstreamor', language as Language)}
      >
        <textarea
          value={data.inputVars ? Object.entries(data.inputVars).map(([k, v]) => `${k}: ${v}`).join('\n') : ''}
          onChange={(e) => {
            const vars: Record<string, string> = {}
            e.target.value.split('\n').filter(Boolean).forEach(line => {
              const [key, ...rest] = line.split(':')
              if (key) vars[key.trim()] = rest.join(':').trim()
            })
            onChange('inputVars', vars)
          }}
          placeholder={t('wf.varnameexpressiononeperlinenegnname', language as Language)}
          rows={3}
          className={TEXTAREA_MONO_CLASS}
        />
        <HelpTip>
          {t('wf.usetoreferenceothernodes', language as Language)}
        </HelpTip>
      </Section>

      <Section
        title={t('wf.outputvariable', language as Language)}
        tip={t('wf.variablenametosavethis', language as Language)}
      >
        <input
          type="text"
          value={data.outputVar || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="result"
          className={INPUT_CLASS}
        />
        <p className="mt-1 text-[10px] text-gray-400">
          {t('wf.laternodescanreferencethis', language as Language)}
        </p>
      </Section>

      {/* Sub-workflow specific mapping */}
      {nodeType === 'sub_workflow' && (
        <Section
          title={t('wf.outputmapping', language as Language)}
          tip={t('wf.mapsubworkflowoutputstocurrent', language as Language)}
        >
          <textarea
            value={data.outputMapping ? Object.entries(data.outputMapping).map(([k, v]) => `${k}: ${v}`).join('\n') : ''}
            onChange={(e) => {
              const mapping: Record<string, string> = {}
              e.target.value.split('\n').filter(Boolean).forEach(line => {
                const [key, ...rest] = line.split(':')
                if (key) mapping[key.trim()] = rest.join(':').trim()
              })
              onChange('outputMapping', mapping)
            }}
            placeholder={t('wf.suboutputcurrentvar', language as Language)}
            rows={3}
            className={TEXTAREA_MONO_CLASS}
          />
        </Section>
      )}
    </>
  )
}