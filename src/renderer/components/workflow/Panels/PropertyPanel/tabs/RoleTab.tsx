import type { TabProps } from '../types'
import { BUILTIN_AGENT_ROLES } from '@shared/protocols/workflow'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_CLASS } from '../shared'
import { t, type Language } from '@renderer/i18n'

export function RoleTab({ nodeType, data, onChange, language }: TabProps) {
  if (nodeType === 'agent_group') {
    return <AgentGroupRoleSection data={data} onChange={onChange} language={language} />
  }

  return <AgentTaskRoleSection data={data} onChange={onChange} language={language} />
}

function AgentGroupRoleSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={t('wf.collaborationmode', language as Language)}>
        <select
          value={data.collaborationMode || 'sequential'}
          onChange={(e) => onChange('collaborationMode', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="sequential">{t('wf.sequential', language as Language)}</option>
          <option value="debate">{t('wf.debate', language as Language)}</option>
          <option value="voting">{t('wf.voting', language as Language)}</option>
        </select>
      </Section>
      <Section title={t('wf.maxrounds', language as Language)}>
        <input
          type="number"
          value={data.maxRounds || 3}
          onChange={(e) => onChange('maxRounds', Number(e.target.value))}
          min={1}
          max={20}
          className={INPUT_CLASS}
        />
      </Section>
      <Section title={t('wf.participatingroles', language as Language)}>
        <div className="space-y-1">
          {BUILTIN_AGENT_ROLES.filter(r => r.id !== 'custom').map(role => {
            const isSelected = (data.groupRoles || []).some(r2 => r2.id === role.id)
            return (
              <label key={role.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[var(--border)]/30 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => {
                    const current = data.groupRoles || []
                    if (e.target.checked) {
                      onChange('groupRoles', [...current, role])
                    } else {
                      onChange('groupRoles', current.filter(r2 => r2.id !== role.id))
                    }
                  }}
                  className="rounded border-[var(--border)]"
                />
                <span className="text-xs text-[var(--text-primary)]">
                  {language === 'zh' ? role.nameZh : role.name}
                </span>
              </label>
            )
          })}
        </div>
      </Section>
    </>
  )
}

function AgentTaskRoleSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={t('wf.role', language as Language)}>
        <select
          value={data.roleId || ''}
          onChange={(e) => onChange('roleId', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t('wf.selectrole', language as Language)}</option>
          {BUILTIN_AGENT_ROLES.map(role => (
            <option key={role.id} value={role.id}>
              {language === 'zh' ? role.nameZh : role.name}
            </option>
          ))}
        </select>
        {data.roleId && (() => {
          const role = BUILTIN_AGENT_ROLES.find(r => r.id === data.roleId)
          if (!role) return null
          return (
            <p className="mt-1 text-[10px] text-[var(--text-muted)]">
              {language === 'zh' ? role.descriptionZh : role.description}
            </p>
          )
        })()}
      </Section>

      <Section title={t('wf.customsystemprompt', language as Language)}>
        <textarea
          value={data.systemPrompt || ''}
          onChange={(e) => onChange('systemPrompt', e.target.value)}
          placeholder={t('wf.overrideroledefaultprompt', language as Language)}
          rows={4}
          className={TEXTAREA_CLASS}
        />
      </Section>

      <Section title={t('wf.chatmode', language as Language)}>
        <div className="flex gap-1">
          {(['chat', 'agent', 'plan'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => onChange('chatMode', mode)}
              className={`flex-1 px-2 py-1.5 text-[10px] font-medium rounded-md transition-colors ${
                data.chatMode === mode
                  ? 'bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/30'
                  : 'bg-[var(--background)] text-[var(--text-muted)] border border-[var(--border)] hover:border-[var(--accent)]/30'
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </Section>

      <Section title={t('wf.temperature', language as Language)}>
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={2}
            step={0.1}
            value={data.temperature ?? 0.7}
            onChange={(e) => onChange('temperature', Number(e.target.value))}
            className="flex-1"
          />
          <span className="text-[10px] text-[var(--text-muted)] w-6 text-right">{data.temperature ?? 0.7}</span>
        </div>
      </Section>

      <Section title={t('wf.model', language as Language)}>
        <input
          type="text"
          value={data.modelId || ''}
          onChange={(e) => onChange('modelId', e.target.value)}
          placeholder={t('wf.leaveemptyfordefault', language as Language)}
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}
