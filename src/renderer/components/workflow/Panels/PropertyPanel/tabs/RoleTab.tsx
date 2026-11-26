import { useEffect, useState } from 'react'
import type { TabProps } from '../types'
import { BUILTIN_AGENT_ROLES } from '@shared/protocols/workflow'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_CLASS } from '../shared'
import { t, type Language } from '@renderer/i18n'
import { listAgents, listSquads, type AgentCatalogItem, type SquadCatalogItem } from '../../../api/agentCatalog'

/**
 * 智能体节点属性。
 *
 * 引入「引用来源」是为了解决一个具体问题：以前智能体配置是内联存在节点里的，
 * 同一个智能体被复制到多个节点后各存一份，改一处不会同步。
 * 现在可以改为引用独立实体（AgentDefinition）或编队（AgentSquad），
 * 改一次全局生效。
 *
 * 内置角色（inline）保留为默认，因为它不依赖后端、离线可用，
 * 也保证历史工作流打开后看到的界面与以前一致。
 */

type RefMode = 'inline' | 'definition' | 'squad'

function currentMode(data: TabProps['data']): RefMode {
  const ref = data.agentRef
  if (ref?.kind === 'definition') return 'definition'
  if (ref?.kind === 'squad') return 'squad'
  return 'inline'
}

export function RoleTab({ nodeType, data, onChange, language }: TabProps) {
  if (nodeType === 'agent_group') {
    return <AgentGroupRoleSection data={data} onChange={onChange} language={language} />
  }

  return <AgentTaskRoleSection data={data} onChange={onChange} language={language} />
}

/** 引用来源切换：三个选项共用，避免两个面板各写一遍 */
function RefSourcePicker({
  data,
  onChange,
  allowSquad,
}: {
  data: TabProps['data']
  onChange: TabProps['onChange']
  allowSquad: boolean
}) {
  const mode = currentMode(data)
  const [agents, setAgents] = useState<AgentCatalogItem[]>([])
  const [squads, setSquads] = useState<SquadCatalogItem[]>([])
  const [loaded, setLoaded] = useState(false)

  // 进入引用模式才拉目录：inline 用户不必付出一次无用请求
  useEffect(() => {
    if (mode === 'inline' || loaded) return
    let cancelled = false
    void Promise.all([listAgents(), allowSquad ? listSquads() : Promise.resolve([])]).then(
      ([a, s]) => {
        if (cancelled) return
        setAgents(a)
        setSquads(s)
        setLoaded(true)
      },
    )
    return () => {
      cancelled = true
    }
  }, [mode, allowSquad, loaded])

  const switchMode = (next: RefMode) => {
    if (next === 'inline') {
      // 切回内联：清掉引用，但保留原有内联字段，用户可继续用
      onChange('agentRef', undefined)
      return
    }
    if (next === 'definition') {
      onChange('agentRef', { kind: 'definition', agentId: '' })
      return
    }
    onChange('agentRef', { kind: 'squad', squadId: '' })
  }

  return (
    <Section title="引用来源" tip="引用独立智能体后，修改智能体会同步到所有引用它的节点">
      <div className="flex gap-1.5 mb-2">
        {([
          ['inline', '内置角色'],
          ['definition', '智能体'],
          ...(allowSquad ? [['squad', '编队'] as const] : []),
        ] as Array<[RefMode, string]>).map(([value, label]) => (
          <button
            key={value}
            onClick={() => switchMode(value)}
            className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
              mode === value
                ? 'bg-accent/10 border-accent/40 text-accent'
                : 'bg-background-secondary border-border text-text-secondary hover:border-border-active hover:bg-surface'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === 'definition' && (
        <>
          <select
            value={data.agentRef?.kind === 'definition' ? (data.agentRef.agentId ?? '') : ''}
            onChange={(e) => onChange('agentRef', { kind: 'definition', agentId: e.target.value })}
            className={SELECT_CLASS}
          >
            <option value="">选择智能体…</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.displayName || a.name}
              </option>
            ))}
          </select>
          {loaded && agents.length === 0 && (
            <p className="mt-1 text-[10px] text-text-muted">
              还没有已保存的智能体。可先在智能体管理页创建，或继续使用内置角色。
            </p>
          )}
        </>
      )}

      {mode === 'squad' && (
        <>
          <select
            value={data.agentRef?.kind === 'squad' ? (data.agentRef.squadId ?? '') : ''}
            onChange={(e) => onChange('agentRef', { kind: 'squad', squadId: e.target.value })}
            className={SELECT_CLASS}
          >
            <option value="">选择编队…</option>
            {squads.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName || s.name}
                {s.memberIds ? `（${s.memberIds.length} 人）` : ''}
              </option>
            ))}
          </select>
          {loaded && squads.length === 0 && (
            <p className="mt-1 text-[10px] text-text-muted">
              还没有编队。可在智能体管理页把多个智能体组合成编队后在此引用。
            </p>
          )}
        </>
      )}

      {mode !== 'inline' && (
        <p className="mt-1 text-[10px] text-text-muted">
          引用模式下，下方「自定义系统提示」等内联设置会被忽略。
        </p>
      )}
    </Section>
  )
}

function AgentGroupRoleSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const isSquadRef = data.agentRef?.kind === 'squad'

  return (
    <>
      <RefSourcePicker data={data} onChange={onChange} allowSquad />

      <Section title={t('wf.collaborationmode', language as Language)}>
        <select
          value={data.collaborationMode || 'sequential'}
          onChange={(e) => onChange('collaborationMode', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="sequential">{t('wf.sequential', language as Language)}</option>
          <option value="parallel">并行</option>
          <option value="debate">{t('wf.debate', language as Language)}</option>
          <option value="voting">{t('wf.voting', language as Language)}</option>
        </select>
        <p className="mt-1 text-[10px] text-text-muted">
          这里控制「组内成员」怎么跑；跨节点的串行/并行由画布连线和 parallel、merge 节点决定。
        </p>
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

      {/* 引用编队时成员由编队定义，勾选内置角色没有意义，隐藏以免误解 */}
      {!isSquadRef && (
        <Section title={t('wf.participatingroles', language as Language)}>
          <div className="space-y-1">
            {BUILTIN_AGENT_ROLES.filter((r) => r.id !== 'custom').map((role) => {
              const isSelected = (data.groupRoles || []).some((r2) => r2.id === role.id)
              return (
                <label
                  key={role.id}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-border/30 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={(e) => {
                      const current = data.groupRoles || []
                      if (e.target.checked) {
                        onChange('groupRoles', [...current, role])
                      } else {
                        onChange('groupRoles', current.filter((r2) => r2.id !== role.id))
                      }
                    }}
                    className="rounded border-border"
                  />
                  <span className="text-xs text-text-primary">
                    {language === 'zh' ? role.nameZh : role.name}
                  </span>
                </label>
              )
            })}
          </div>
        </Section>
      )}
    </>
  )
}

function AgentTaskRoleSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const isExternalRef = currentMode(data) !== 'inline'

  return (
    <>
      <RefSourcePicker data={data} onChange={onChange} allowSquad={false} />

      {/* 引用外部智能体时，角色/提示词都来自实体，隐藏内联项避免双份配置打架 */}
      {!isExternalRef && (
        <>
          <Section title={t('wf.role', language as Language)}>
            <select
              value={data.roleId || ''}
              onChange={(e) => onChange('roleId', e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">{t('wf.selectrole', language as Language)}</option>
              {BUILTIN_AGENT_ROLES.map((role) => (
                <option key={role.id} value={role.id}>
                  {language === 'zh' ? role.nameZh : role.name}
                </option>
              ))}
            </select>
            {data.roleId &&
              (() => {
                const role = BUILTIN_AGENT_ROLES.find((r) => r.id === data.roleId)
                if (!role) return null
                return (
                  <p className="mt-1 text-[10px] text-text-muted">
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
        </>
      )}

      <Section
        title={t('wf.chatmode', language as Language)}
        tip={t('wf.agentmodecanusetools', language as Language)}
      >
        <div className="flex gap-1.5">
          {(['chat', 'agent', 'expert'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => onChange('chatMode', mode)}
              className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
                (data.chatMode || 'agent') === mode
                  ? 'bg-accent/10 border-accent/40 text-accent'
                  : 'bg-background-secondary border-border text-text-secondary hover:border-border-active hover:bg-surface'
              }`}
            >
              {{ chat: t('wf.chat', language as Language), agent: 'Agent', expert: t('wf.expert', language as Language) }[mode]}
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
          <span className="text-[10px] text-text-muted w-6 text-right">{data.temperature ?? 0.7}</span>
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
