import type { TabProps } from '../types'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_MONO_CLASS } from '../shared'

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
      <Section title={language === 'zh' ? '工具名称' : 'Tool Name'}>
        <input
          type="text"
          value={data.toolName || ''}
          onChange={(e) => onChange('toolName', e.target.value)}
          placeholder={language === 'zh' ? '工具标识' : 'Tool identifier'}
          className={INPUT_CLASS}
        />
      </Section>
      <Section title={language === 'zh' ? '工具参数' : 'Tool Arguments'}>
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
      <Section title={language === 'zh' ? 'MCP 服务器' : 'MCP Server'}>
        <input
          type="text"
          value={data.mcpServerId || ''}
          onChange={(e) => onChange('mcpServerId', e.target.value)}
          placeholder={language === 'zh' ? '服务器 ID' : 'Server ID'}
          className={INPUT_CLASS}
        />
      </Section>
      <Section title={language === 'zh' ? 'MCP 工具' : 'MCP Tool'}>
        <input
          type="text"
          value={data.mcpToolName || ''}
          onChange={(e) => onChange('mcpToolName', e.target.value)}
          placeholder={language === 'zh' ? '工具名' : 'Tool name'}
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}

function CodeRunnerSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={language === 'zh' ? '编程语言' : 'Language'}>
        <select
          value={data.codeLanguage || 'javascript'}
          onChange={(e) => onChange('codeLanguage', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="javascript">JavaScript</option>
          <option value="python">Python</option>
        </select>
      </Section>
      <Section title={language === 'zh' ? '代码' : 'Code'}>
        <textarea
          value={data.codeSnippet || ''}
          onChange={(e) => onChange('codeSnippet', e.target.value)}
          rows={8}
          className={TEXTAREA_MONO_CLASS}
        />
      </Section>
      <Section title={language === 'zh' ? '输入变量' : 'Input Variables'}>
        <input
          type="text"
          value={(data.codeInputVars || []).join(', ')}
          onChange={(e) => onChange('codeInputVars', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder={language === 'zh' ? '变量名, 逗号分隔' : 'Var names, comma separated'}
          className={INPUT_CLASS}
        />
      </Section>
      <Section title={language === 'zh' ? '输出变量' : 'Output Variables'}>
        <input
          type="text"
          value={(data.codeOutputVars || []).join(', ')}
          onChange={(e) => onChange('codeOutputVars', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder={language === 'zh' ? '变量名, 逗号分隔' : 'Var names, comma separated'}
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}

function AgentToolsSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={language === 'zh' ? '绑定工具' : 'Bound Tools'}>
        <input
          type="text"
          value={(data.boundTools || []).join(', ')}
          onChange={(e) => onChange('boundTools', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder={language === 'zh' ? '工具名, 逗号分隔' : 'Tool names, comma separated'}
          className={INPUT_CLASS}
        />
        <p className="mt-1 text-[10px] text-[var(--text-muted)]">
          {language === 'zh' ? '为该智能体独立绑定工具，覆盖全局配置' : 'Bind tools for this agent, overriding global config'}
        </p>
      </Section>

      <Section title={language === 'zh' ? 'MCP 服务器' : 'MCP Servers'}>
        <input
          type="text"
          value={(data.boundMcpServers || []).join(', ')}
          onChange={(e) => onChange('boundMcpServers', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder={language === 'zh' ? 'MCP 服务ID, 逗号分隔' : 'MCP server IDs, comma separated'}
          className={INPUT_CLASS}
        />
      </Section>

      <Section title={language === 'zh' ? 'MCP 工具' : 'MCP Tools'}>
        <input
          type="text"
          value={(data.boundMcpTools || []).join(', ')}
          onChange={(e) => onChange('boundMcpTools', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
          placeholder={language === 'zh' ? 'MCP 工具名, 逗号分隔' : 'MCP tool names, comma separated'}
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}
