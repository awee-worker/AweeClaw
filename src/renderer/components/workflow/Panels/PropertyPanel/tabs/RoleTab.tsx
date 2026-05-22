import type { TabProps } from '../types'
import { BUILTIN_AGENT_ROLES } from '@shared/protocols/workflow'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_CLASS } from '../shared'

export function RoleTab({ nodeType, data, onChange, language }: TabProps) {
  if (nodeType === 'agent_group') {
    return <AgentGroupRoleSection data={data} onChange={onChange} language={language} />
  }

  return <AgentTaskRoleSection data={data} onChange={onChange} language={language} />
}

function AgentGroupRoleSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={language === 'zh' ? '协作模式' : 'Collaboration Mode'}>
        <select
          value={data.collaborationMode || 'sequential'}
          onChange={(e) => onChange('collaborationMode', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="sequential">{language === 'zh' ? '顺序执行' : 'Sequential'}</option>
          <option value="debate">{language === 'zh' ? '辩论模式' : 'Debate'}</option>
          <option value="voting">{language === 'zh' ? '投票模式' : 'Voting'}</option>
        </select>
      </Section>
      <Section title={language === 'zh' ? '最大轮次' : 'Max Rounds'}>
        <input
          type="number"
          value={data.maxRounds || 3}
          onChange={(e) => onChange('maxRounds', Number(e.target.value))}
          min={1}
          max={20}
          className={INPUT_CLASS}
        />
      </Section>
      <Section title={language === 'zh' ? '参与角色' : 'Participating Roles'}>
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
      <Section title={language === 'zh' ? '角色' : 'Role'}>
        <select
          value={data.roleId || ''}
          onChange={(e) => onChange('roleId', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{language === 'zh' ? '选择角色...' : 'Select role...'}</option>
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

      <Section title={language === 'zh' ? '自定义系统提示词' : 'Custom System Prompt'}>
        <textarea
          value={data.systemPrompt || ''}
          onChange={(e) => onChange('systemPrompt', e.target.value)}
          placeholder={language === 'zh' ? '覆盖角色默认提示词...' : 'Override role default prompt...'}
          rows={4}
          className={TEXTAREA_CLASS}
        />
      </Section>

      <Section title={language === 'zh' ? '对话模式' : 'Chat Mode'}>
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

      <Section title={language === 'zh' ? 'Temperature' : 'Temperature'}>
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

      <Section title={language === 'zh' ? '模型' : 'Model'}>
        <input
          type="text"
          value={data.modelId || ''}
          onChange={(e) => onChange('modelId', e.target.value)}
          placeholder={language === 'zh' ? '留空使用默认' : 'Leave empty for default'}
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}
