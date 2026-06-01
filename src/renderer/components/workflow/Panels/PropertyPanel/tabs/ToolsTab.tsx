import type { TabProps } from '../types'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_MONO_CLASS } from '../shared'
import { t, type Language } from '@renderer/i18n'

export function ToolsTab({ nodeType, data, onChange, language }: TabProps) {
  switch (nodeType) {
    case 'tool_call':
      return <ToolCallSection data={data} onChange={onChange} language={language} />
    case 'mcp_service':
      return <McpServiceSection data={data} onChange={onChange} language={language} />
    case 'code_runner':
      return <CodeRunnerSection data={data} onChange={onChange} language={language} />
    default:
      return <AgentToolsSection data={data} onChange={onChange} language={language} />
  }
}

function ToolCallSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={t('wf.toolname', language as Language)}>
        <input
          type="text"
          value={data.toolName || ''}
          onChange={(e) => onChange('toolName', e.target.value)}
          placeholder={t('wf.toolidentifier', language as Language)}
          className={INPUT_CLASS}
        />
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

function McpServiceSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={t('wf.mcpserver', language as Language)}>
        <input
          type="text"
          value={data.mcpServerId || ''}
          onChange={(e) => onChange('mcpServerId', e.target.value)}
          placeholder={t('wf.serverid', language as Language)}
          className={INPUT_CLASS}
        />
      </Section>
      <Section title={t('wf.mcptool', language as Language)}>
        <input
          type="text"
          value={data.mcpToolName || ''}
          onChange={(e) => onChange('mcpToolName', e.target.value)}
          placeholder={t('wf.toolname2', language as Language)}
          className={INPUT_CLASS}
        />
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
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
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
