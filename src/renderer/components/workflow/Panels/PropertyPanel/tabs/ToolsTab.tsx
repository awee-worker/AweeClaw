import { useEffect, useState } from 'react'
import type { TabProps } from '../types'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_MONO_CLASS } from '../shared'
import { t, type Language } from '@renderer/i18n'
import { skillService } from '@intelligence/runtime/skillRepository'
import { toolManager } from '@intelligence/toolkit/providers/ToolCoordinator'
import type { SkillItem } from '@intelligence/runtime/skillRepository'
import { skillDisplayName, useMcpServers, useMcpTools } from '@renderer/components/workflow/Canvas/nodes/useNodeOptions'

export function ToolsTab({ nodeType, data, onChange, language }: TabProps) {
  switch (nodeType) {
    case 'tool_call':
      return <ToolCallSection data={data} onChange={onChange} language={language} />
    case 'skill':
      return <SkillSection data={data} onChange={onChange} language={language} />
    case 'mcp_service':
      return <McpServiceSection data={data} onChange={onChange} language={language} />
    case 'code_runner':
      return <CodeRunnerSection data={data} onChange={onChange} language={language} />
    default:
      return <AgentToolsSection data={data} onChange={onChange} language={language} />
  }
}

function ToolCallSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const [tools, setTools] = useState<string[] | null>(null)

  // 工具清单来自本地注册表（含插件工具）。
  // 失败时保留手填入口——编辑器不能因为注册表没就绪就用不了。
  useEffect(() => {
    let alive = true
    try {
      const names = toolManager.getAllToolDefinitions().map(d => d.name).sort()
      if (alive) setTools(names)
    } catch {
      if (alive) setTools([])
    }
    return () => { alive = false }
  }, [])

  const listId = 'wf-tool-options'

  return (
    <>
      <Section title={t('wf.toolname', language as Language)}>
        <input
          type="text"
          list={listId}
          value={data.toolName || ''}
          onChange={(e) => onChange('toolName', e.target.value)}
          placeholder={t('wf.toolidentifier', language as Language)}
          className={INPUT_CLASS}
        />
        <datalist id={listId}>
          {(tools ?? []).map(name => <option key={name} value={name} />)}
        </datalist>
        <p className="mt-1 text-[10px] text-text-muted">
          {tools === null
            ? (language === 'zh' ? '正在读取本地工具…' : 'Loading local tools…')
            : tools.length === 0
              ? (language === 'zh' ? '未读取到工具，可直接手填工具名' : 'No tools found — type the tool name manually')
              : (language === 'zh' ? `可选 ${tools.length} 个本地工具（含插件工具）` : `${tools.length} local tools available (plugins included)`)}
        </p>
      </Section>
      <Section title={t('wf.toolarguments', language as Language)}>
        <textarea
          value={data.toolArgs ? JSON.stringify(data.toolArgs, null, 2) : '{}'}
          onChange={(e) => {
            try {
              onChange('toolArgs', JSON.parse(e.target.value))
            } catch { /* ignore parse errors while typing */ }
          }}
          rows={5}
          className={TEXTAREA_MONO_CLASS}
        />
      </Section>
    </>
  )
}

/** 技能节点：从本地技能目录里选一个已安装技能 */
function SkillSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const [skills, setSkills] = useState<SkillItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    skillService.getSkills()
      .then(list => { if (alive) setSkills(list) })
      .catch((err: unknown) => {
        if (!alive) return
        setSkills([])
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => { alive = false }
  }, [])

  const installed = (skills ?? []).filter(s => s.enabled)
  const selected = installed.find(s => s.name === data.skillName)

  return (
    <>
      <Section title={language === 'zh' ? '技能' : 'Skill'}>
        {skills === null ? (
          <p className="text-[11px] text-text-muted">{language === 'zh' ? '正在读取已安装技能…' : 'Loading skills…'}</p>
        ) : error ? (
          <p className="text-[11px] text-red-400">
            {language === 'zh' ? `读取技能失败：${error}` : `Failed to load skills: ${error}`}
          </p>
        ) : installed.length === 0 ? (
          <p className="text-[11px] text-text-muted">
            {language === 'zh'
              ? '当前没有已安装技能，请先到「插件与技能市场」安装。'
              : 'No skills installed. Install one from the Skill & Plugin Market first.'}
          </p>
        ) : (
          <>
            <select
              value={data.skillName || ''}
              onChange={(e) => onChange('skillName', e.target.value)}
              className={SELECT_CLASS}
            >
              <option value="">{language === 'zh' ? '— 选择技能 —' : '— Select a skill —'}</option>
              {installed.map(s => (
                <option key={s.name} value={s.name}>{skillDisplayName(s, language === 'en' ? 'en' : 'zh')}</option>
              ))}
            </select>
            {data.skillName && !selected && (
              <p className="mt-1 text-[10px] text-amber-400">
                {language === 'zh'
                  ? `技能「${data.skillName}」不在当前已安装列表中，运行时会报错。`
                  : `Skill "${data.skillName}" is not in the installed list; the run will fail.`}
              </p>
            )}
            {selected?.description && (
              <p className="mt-1 text-[10px] text-text-muted line-clamp-3">{selected.description}</p>
            )}
          </>
        )}
      </Section>

      <Section title={language === 'zh' ? '补充输入（可选，JSON）' : 'Extra input (optional, JSON)'}>
        <textarea
          value={data.skillArgs ? JSON.stringify(data.skillArgs, null, 2) : '{}'}
          onChange={(e) => {
            try {
              onChange('skillArgs', JSON.parse(e.target.value))
            } catch { /* ignore parse errors while typing */ }
          }}
          rows={4}
          className={TEXTAREA_MONO_CLASS}
        />
        <p className="mt-1 text-[10px] text-text-muted">
          {language === 'zh'
            ? '会拼接到技能正文尾部，一并交给下游节点。'
            : 'Appended to the skill body and passed downstream.'}
        </p>
      </Section>
    </>
  )
}

function McpServiceSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const servers = useMcpServers()
  const serverId = data.mcpServerId || ''
  const tools = useMcpTools(serverId)

  return (
    <>
      <Section title={t('wf.mcpserver', language as Language)}>
        {servers.length === 0 ? (
          <p className="text-[11px] text-text-muted">
            {language === 'zh' ? '没有已配置的 MCP 服务器，请先在设置中添加' : 'No MCP servers configured. Add one in Settings first.'}
          </p>
        ) : (
          <select
            value={serverId}
            onChange={(e) => {
              onChange('mcpServerId', e.target.value)
              if (e.target.value !== serverId) onChange('mcpToolName', '')
            }}
            className={SELECT_CLASS}
          >
            <option value="">{language === 'zh' ? '— 选择服务器 —' : '— Select a server —'}</option>
            {servers.map((o) => (
              <option key={o.value} value={o.value}>{o.label}{o.hint ? `（${o.hint}）` : ''}</option>
            ))}
          </select>
        )}
      </Section>
      <Section title={t('wf.mcptool', language as Language)}>
        <select
          value={data.mcpToolName || ''}
          onChange={(e) => onChange('mcpToolName', e.target.value)}
          disabled={!serverId}
          className={SELECT_CLASS}
        >
          <option value="">
            {language === 'zh'
              ? (serverId ? '— 选择工具 —' : '请先选择服务器')
              : (serverId ? '— Select a tool —' : 'Select a server first')}
          </option>
          {tools.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {serverId && tools.length === 0 && (
          <p className="mt-1 text-[10px] text-text-muted">
            {language === 'zh' ? '该服务器尚未上报工具（可能未连接）' : 'This server has not reported any tools (maybe disconnected)'}
          </p>
        )}
      </Section>
    </>
  )
}

function CodeRunnerSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={t('wf.language', language as Language)}>
        <select
          value={data.codeLanguage || 'javascript'}
          onChange={(e) => onChange('codeLanguage', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
        </select>
      </Section>
      <Section title={t('wf.code', language as Language)}>
        <textarea
          value={data.codeSnippet || ''}
          onChange={(e) => onChange('codeSnippet', e.target.value)}
          rows={8}
          className={TEXTAREA_MONO_CLASS}
        />
      </Section>
      <Section title={t('wf.inputvariables', language as Language)}>
        <input
          type="text"
          value={(data.codeInputVars || []).join(', ')}
          onChange={(e) => onChange('codeInputVars', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder={t('wf.varnamescommaseparated', language as Language)}
          className={INPUT_CLASS}
        />
      </Section>
      <Section title={t('wf.outputvariables', language as Language)}>
        <input
          type="text"
          value={(data.codeOutputVars || []).join(', ')}
          onChange={(e) => onChange('codeOutputVars', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder={t('wf.varnamescommaseparated2', language as Language)}
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}

function AgentToolsSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={t('wf.boundtools', language as Language)}>
        <input
          type="text"
          value={(data.boundTools || []).join(', ')}
          onChange={(e) => onChange('boundTools', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder={t('wf.toolnamescommaseparated', language as Language)}
          className={INPUT_CLASS}
        />
        <p className="mt-1 text-[10px] text-text-muted">
          {t('wf.bindtoolsforthisagent', language as Language)}
        </p>
      </Section>

      <Section title={t('wf.mcpservers', language as Language)}>
        <input
          type="text"
          value={(data.boundMcpServers || []).join(', ')}
          onChange={(e) => onChange('boundMcpServers', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder={t('wf.mcpserveridscommaseparated', language as Language)}
          className={INPUT_CLASS}
        />
      </Section>

      <Section title={t('wf.mcptools', language as Language)}>
        <input
          type="text"
          value={(data.boundMcpTools || []).join(', ')}
          onChange={(e) => onChange('boundMcpTools', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder={t('wf.mcptoolnamescommaseparated', language as Language)}
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}
