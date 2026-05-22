import type { TabProps } from '../types'
import type { FormFieldDefinition } from '@shared/protocols/workflowV2'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_CLASS, TEXTAREA_MONO_CLASS } from '../shared'
import { ConditionBuilder } from '../builders/ConditionBuilder'
import { SwitchCaseBuilder } from '../builders/SwitchCaseBuilder'
import { DelaySection, LoopSection, ParallelSection, MergeSection } from './FlowSections'
import { UserInputSection, UserApprovalSection } from './InteractionSections'
import { HttpRequestSection, TextOutputSection, NotificationSection } from './OutputSections'

export function BasicTab({ nodeType, data, onChange, language }: TabProps) {
  return (
    <>
      <Section
        title={language === 'zh' ? '节点描述' : 'Description'}
        tip={language === 'zh' ? '简单描述这个节点做什么' : 'Briefly describe what this node does'}
      >
        <textarea
          value={data.description || ''}
          onChange={(e) => onChange('description', e.target.value)}
          placeholder={language === 'zh' ? '例如：调用AI分析用户输入并生成回复' : 'e.g. Call AI to analyze user input and generate reply'}
          rows={2}
          className={TEXTAREA_CLASS}
        />
      </Section>

      {/* === Agent Task: Role quick-view in Basic === */}
      {nodeType === 'agent_task' && <AgentTaskBasicSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'agent_group' && <AgentGroupBasicSection data={data} onChange={onChange} language={language} />}

      {/* === Flow control nodes === */}
      {nodeType === 'delay' && <DelaySection data={data} onChange={onChange} language={language} />}
      {nodeType === 'condition' && <ConditionBuilder data={data} onChange={onChange} language={language} />}
      {nodeType === 'switch_case' && <SwitchCaseBuilder data={data} onChange={onChange} language={language} />}
      {nodeType === 'loop' && <LoopSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'parallel' && <ParallelSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'merge' && <MergeSection data={data} onChange={onChange} language={language} />}

      {/* === Interaction nodes === */}
      {nodeType === 'user_input' && <UserInputSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'user_approval' && <UserApprovalSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'form_collector' && <FormCollectorBasicSection data={data} onChange={onChange} language={language} />}

      {/* === Tool nodes === */}
      {nodeType === 'tool_call' && <ToolCallBasicSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'mcp_service' && <McpServiceBasicSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'code_runner' && <CodeRunnerBasicSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'http_request' && <HttpRequestSection data={data} onChange={onChange} language={language} />}

      {/* === Data nodes === */}
      {nodeType === 'variable_set' && <VariableSetBasicSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'data_transform' && <DataTransformBasicSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'knowledge_query' && <KnowledgeQueryBasicSection data={data} onChange={onChange} language={language} />}

      {/* === Output nodes === */}
      {nodeType === 'text_output' && <TextOutputSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'file_output' && <FileOutputBasicSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'notification' && <NotificationSection data={data} onChange={onChange} language={language} />}

      {/* === Control nodes === */}
      {nodeType === 'webhook_trigger' && <WebhookTriggerBasicSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'event_wait' && <EventWaitBasicSection data={data} onChange={onChange} language={language} />}
      {nodeType === 'sub_workflow' && <SubWorkflowBasicSection data={data} onChange={onChange} language={language} />}
    </>
  )
}

/* ===== Agent Task Basic ===== */

function AgentTaskBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const { BUILTIN_AGENT_ROLES } = require('@shared/protocols/workflow') as {
    BUILTIN_AGENT_ROLES: Array<{ id: string; name: string; nameZh: string; description: string; descriptionZh: string }>
  }

  return (
    <>
      <Section
        title={language === 'zh' ? '选择角色' : 'Select Role'}
        tip={language === 'zh' ? '选择一个AI角色来执行此任务' : 'Choose an AI role to perform this task'}
      >
        <select
          value={data.roleId || ''}
          onChange={(e) => onChange('roleId', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{language === 'zh' ? '选择角色...' : 'Select a role...'}</option>
          {BUILTIN_AGENT_ROLES.filter(r => r.id !== 'custom').map(role => (
            <option key={role.id} value={role.id}>
              {language === 'zh' ? role.nameZh : role.name}
            </option>
          ))}
        </select>
        {data.roleId && (() => {
          const role = BUILTIN_AGENT_ROLES.find(r => r.id === data.roleId)
          return role ? (
            <p className="mt-1.5 text-[10px] leading-relaxed text-blue-600 bg-blue-50 rounded-lg px-2.5 py-1.5">
              {language === 'zh' ? role.descriptionZh : role.description}
            </p>
          ) : null
        })()}
      </Section>

      <Section
        title={language === 'zh' ? '对话模式' : 'Chat Mode'}
        tip={language === 'zh' ? 'Agent模式可以调用工具，Chat模式仅对话' : 'Agent mode can use tools, Chat mode is text-only'}
      >
        <div className="flex gap-1.5">
          {(['chat', 'agent', 'plan'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => onChange('chatMode', mode)}
              className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
                (data.chatMode || 'agent') === mode
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white border-gray-150 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {{ chat: language === 'zh' ? '对话' : 'Chat', agent: 'Agent', plan: language === 'zh' ? '规划' : 'Plan' }[mode]}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title={language === 'zh' ? '创意度' : 'Temperature'}
        tip={language === 'zh' ? '0=精确执行, 1=更有创意' : '0=precise, 1=more creative'}
      >
        <div className="flex items-center gap-2">
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={data.temperature ?? 0.7}
            onChange={(e) => onChange('temperature', parseFloat(e.target.value))}
            className="flex-1 h-1.5 accent-blue-500 cursor-pointer"
          />
          <span className="text-[11px] font-mono font-medium text-gray-500 w-7 text-right">
            {data.temperature ?? 0.7}
          </span>
        </div>
      </Section>

      <Section
        title={language === 'zh' ? '系统提示词' : 'System Prompt'}
        tip={language === 'zh' ? '可选的额外指令，会追加到角色默认提示词之后' : 'Optional extra instructions, appended to role default prompt'}
        collapsible
      >
        <textarea
          value={data.systemPrompt || ''}
          onChange={(e) => onChange('systemPrompt', e.target.value)}
          placeholder={language === 'zh' ? '例如：请用友好、专业的语气回答...' : 'e.g. Please answer in a friendly, professional tone...'}
          rows={3}
          className={TEXTAREA_CLASS}
        />
      </Section>
    </>
  )
}

/* ===== Agent Group Basic ===== */

function AgentGroupBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const { BUILTIN_AGENT_ROLES } = require('@shared/protocols/workflow') as {
    BUILTIN_AGENT_ROLES: Array<{ id: string; name: string; nameZh: string }>
  }

  return (
    <>
      <Section
        title={language === 'zh' ? '协作模式' : 'Collaboration Mode'}
        tip={language === 'zh' ? '顺序：逐个发言；辩论：各自表达后讨论；投票：各自给出结论后投票' : 'Sequential, debate, or voting mode'}
      >
        <div className="flex gap-1.5">
          {(['sequential', 'debate', 'voting'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => onChange('collaborationMode', mode)}
              className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
                (data.collaborationMode || 'sequential') === mode
                  ? 'bg-purple-50 border-purple-300 text-purple-700'
                  : 'bg-white border-gray-150 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {{ sequential: language === 'zh' ? '顺序' : 'Seq', debate: language === 'zh' ? '辩论' : 'Debate', voting: language === 'zh' ? '投票' : 'Vote' }[mode]}
            </button>
          ))}
        </div>
      </Section>

      <Section title={language === 'zh' ? '最大讨论轮次' : 'Max Rounds'}>
        <input
          type="number"
          value={data.maxRounds || 3}
          onChange={(e) => onChange('maxRounds', Number(e.target.value))}
          min={1}
          max={20}
          className={INPUT_CLASS}
        />
      </Section>

      <Section
        title={language === 'zh' ? '参与角色' : 'Participants'}
        tip={language === 'zh' ? '勾选参与协作的AI角色' : 'Select AI roles to participate'}
      >
        <div className="space-y-0.5 max-h-40 overflow-y-auto">
          {BUILTIN_AGENT_ROLES.filter(r => r.id !== 'custom').map(role => {
            const isSelected = (data.groupRoles || []).some(r2 => r2.id === role.id)
            return (
              <label
                key={role.id}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer transition-colors ${
                  isSelected ? 'bg-purple-50 border border-purple-200' : 'hover:bg-gray-50 border border-transparent'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={(e) => {
                    const current = data.groupRoles || []
                    onChange('groupRoles', e.target.checked ? [...current, role] : current.filter(r2 => r2.id !== role.id))
                  }}
                  className="rounded accent-purple-500"
                />
                <span className="text-xs">{language === 'zh' ? role.nameZh : role.name}</span>
              </label>
            )
          })}
        </div>
      </Section>
    </>
  )
}

/* ===== Variable Set Basic (moved from Advanced) ===== */

function VariableSetBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <Section
      title={language === 'zh' ? '设置变量' : 'Set Variable'}
      tip={language === 'zh' ? '设置一个工作流变量，后续节点可通过 {{变量名}} 引用' : 'Set a variable, reference as {{name}} in later nodes'}
    >
      <div className="space-y-2">
        <div>
          <label className="text-[10px] font-medium text-gray-400 mb-0.5 block">
            {language === 'zh' ? '变量名' : 'Variable Name'}
          </label>
          <input
            type="text"
            value={data.variableName || ''}
            onChange={(e) => onChange('variableName', e.target.value)}
            placeholder="myVariable"
            className={INPUT_CLASS}
          />
        </div>
        <div>
          <label className="text-[10px] font-medium text-gray-400 mb-0.5 block">
            {language === 'zh' ? '变量值' : 'Variable Value'}
          </label>
          <input
            type="text"
            value={typeof data.variableValue === 'string' ? data.variableValue : JSON.stringify(data.variableValue || '')}
            onChange={(e) => {
              const val = e.target.value
              try {
                onChange('variableValue', JSON.parse(val))
              } catch {
                onChange('variableValue', val)
              }
            }}
            placeholder={language === 'zh' ? '值或表达式，如：{{agentReply}}' : 'Value or expression, e.g. {{agentReply}}'}
            className={INPUT_CLASS}
          />
        </div>
      </div>
    </Section>
  )
}

/* ===== Data Transform Basic (moved from Advanced) ===== */

function DataTransformBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <Section
      title={language === 'zh' ? '转换表达式' : 'Transform Expression'}
      tip={language === 'zh' ? 'JavaScript表达式，data为输入数据' : 'JavaScript expression, data=the input'}
    >
      <textarea
        value={data.transformExpression || ''}
        onChange={(e) => onChange('transformExpression', e.target.value)}
        placeholder={language === 'zh' ? 'data.map(item => item.name)' : 'data.map(item => item.name)'}
        rows={4}
        className={TEXTAREA_MONO_CLASS}
      />
      <p className="mt-1 text-[10px] text-gray-400">
        {language === 'zh' ? '💡 输入数据通过 data 变量访问，结果由 return 或表达式返回' : '💡 Input available via data, result returned by expression'}
      </p>
    </Section>
  )
}

/* ===== Form Collector Basic (moved from Advanced) ===== */

function FormCollectorBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const fields: FormFieldDefinition[] = data.formFields || []

  const addField = () => {
    const newField: FormFieldDefinition = { name: `field${fields.length + 1}`, label: `${language === 'zh' ? '字段' : 'Field'} ${fields.length + 1}`, type: 'text', required: false }
    onChange('formFields', [...fields, newField])
  }

  const removeField = (index: number) => {
    onChange('formFields', fields.filter((_, i) => i !== index))
  }

  const updateField = (index: number, key: string, value: unknown) => {
    const updated = fields.map((f, i) => i === index ? { ...f, [key]: value } : f)
    onChange('formFields', updated)
  }

  return (
    <Section
      title={language === 'zh' ? '表单字段' : 'Form Fields'}
      tip={language === 'zh' ? '定义需要用户填写的表单项' : 'Define form fields users need to fill'}
    >
      <div className="space-y-2">
        {fields.map((field, idx) => (
          <div key={idx} className="flex items-center gap-1.5 p-2 rounded-lg bg-gray-50 border border-gray-100">
            <input
              type="text"
              value={field.name}
              onChange={(e) => updateField(idx, 'name', e.target.value)}
              placeholder={language === 'zh' ? '字段标识' : 'Field key'}
              className="w-24 px-1.5 py-1 text-[11px] rounded border border-gray-200 bg-white"
            />
            <input
              type="text"
              value={field.label}
              onChange={(e) => updateField(idx, 'label', e.target.value)}
              placeholder={language === 'zh' ? '显示名' : 'Label'}
              className="flex-1 px-1.5 py-1 text-[11px] rounded border border-gray-200 bg-white"
            />
            <select
              value={field.type}
              onChange={(e) => updateField(idx, 'type', e.target.value)}
              className="w-20 px-1 py-1 text-[11px] rounded border border-gray-200 bg-white"
            >
              <option value="text">{language === 'zh' ? '文本' : 'Text'}</option>
              <option value="number">{language === 'zh' ? '数字' : 'Num'}</option>
              <option value="select">{language === 'zh' ? '选择' : 'Select'}</option>
              <option value="checkbox">{language === 'zh' ? '勾选' : 'Chk'}</option>
              <option value="textarea">{language === 'zh' ? '长文' : 'Area'}</option>
            </select>
            <label className="flex items-center gap-0.5 text-[10px] text-gray-400">
              <input
                type="checkbox"
                checked={field.required || false}
                onChange={(e) => updateField(idx, 'required', e.target.checked)}
                className="rounded"
              />
              {language === 'zh' ? '必填' : 'Req'}
            </label>
            <button
              onClick={() => removeField(idx)}
              className="p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-400 transition-colors"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        ))}
        <button
          onClick={addField}
          className="w-full py-1.5 text-[11px] font-medium text-blue-500 hover:text-blue-600 border border-dashed border-blue-200 hover:border-blue-300 rounded-lg bg-blue-50/50 hover:bg-blue-50 transition-colors"
        >
          + {language === 'zh' ? '添加字段' : 'Add Field'}
        </button>
      </div>
    </Section>
  )
}

/* ===== Tool Call Basic ===== */

function ToolCallBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section
        title={language === 'zh' ? '工具名称' : 'Tool Name'}
        tip={language === 'zh' ? '要调用的内置工具标识' : 'Built-in tool identifier to call'}
      >
        <input
          type="text"
          value={data.toolName || ''}
          onChange={(e) => onChange('toolName', e.target.value)}
          placeholder={language === 'zh' ? '如：read_file, search_code' : 'e.g. read_file, search_code'}
          className={INPUT_CLASS}
        />
      </Section>
      <Section
        title={language === 'zh' ? '工具参数(JSON)' : 'Tool Arguments (JSON)'}
        tip={language === 'zh' ? '以JSON格式传入参数' : 'Pass arguments in JSON format'}
      >
        <textarea
          value={data.toolArgs ? JSON.stringify(data.toolArgs, null, 2) : '{}'}
          onChange={(e) => {
            try { onChange('toolArgs', JSON.parse(e.target.value)) }
            catch { /* ignore */ }
          }}
          rows={5}
          className={TEXTAREA_MONO_CLASS}
        />
      </Section>
    </>
  )
}

/* ===== MCP Service Basic ===== */

function McpServiceBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section
        title={language === 'zh' ? 'MCP 服务器' : 'MCP Server'}
        tip={language === 'zh' ? 'MCP协议服务器的标识' : 'MCP protocol server identifier'}
      >
        <input
          type="text"
          value={data.mcpServerId || ''}
          onChange={(e) => onChange('mcpServerId', e.target.value)}
          placeholder={language === 'zh' ? '服务器 ID' : 'Server ID'}
          className={INPUT_CLASS}
        />
      </Section>
      <Section
        title={language === 'zh' ? '工具名称' : 'Tool Name'}
        tip={language === 'zh' ? '该MCP服务器提供的工具名' : 'Tool name provided by this MCP server'}
      >
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

/* ===== Code Runner Basic ===== */

function CodeRunnerBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={language === 'zh' ? '编程语言' : 'Language'}>
        <div className="flex gap-1.5">
          {(['javascript', 'python'] as const).map(lang => (
            <button
              key={lang}
              onClick={() => onChange('codeLanguage', lang)}
              className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-lg border transition-all ${
                (data.codeLanguage || 'javascript') === lang
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                  : 'bg-white border-gray-150 text-gray-500 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {lang === 'javascript' ? 'JavaScript' : 'Python'}
            </button>
          ))}
        </div>
      </Section>
      <Section
        title={language === 'zh' ? '代码' : 'Code'}
        tip={language === 'zh' ? '输入变量通过 $input 访问，使用 return 返回结果' : 'Input vars via $input, use return for output'}
      >
        <textarea
          value={data.codeSnippet || ''}
          onChange={(e) => onChange('codeSnippet', e.target.value)}
          rows={8}
          className={TEXTAREA_MONO_CLASS}
          spellCheck={false}
        />
      </Section>
      <Section title={language === 'zh' ? '输入变量' : 'Input Variables'} collapsible>
        <input
          type="text"
          value={(data.codeInputVars || []).join(', ')}
          onChange={(e) => onChange('codeInputVars', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
          placeholder={language === 'zh' ? '变量名, 逗号分隔' : 'Var names, comma separated'}
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}

/* ===== Knowledge Query Basic ===== */

function KnowledgeQueryBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section
        title={language === 'zh' ? '知识库' : 'Knowledge Base'}
        tip={language === 'zh' ? '选择要查询的知识库' : 'Select knowledge base to query'}
      >
        <input
          type="text"
          value={data.knowledgeBaseId || ''}
          onChange={(e) => onChange('knowledgeBaseId', e.target.value)}
          placeholder={language === 'zh' ? '知识库名称或ID' : 'KB name or ID'}
          className={INPUT_CLASS}
        />
      </Section>
      <div className="grid grid-cols-2 gap-2">
        <Section title="Top K">
          <input
            type="number"
            value={data.topK || 5}
            onChange={(e) => onChange('topK', Number(e.target.value))}
            min={1}
            max={50}
            className={INPUT_CLASS}
          />
        </Section>
        <Section title={language === 'zh' ? '相似度阈值' : 'Threshold'}>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={data.similarityThreshold ?? 0.7}
              onChange={(e) => onChange('similarityThreshold', parseFloat(e.target.value))}
              className="flex-1 h-1.5 accent-cyan-500"
            />
            <span className="text-[11px] font-mono text-gray-500 w-7">{data.similarityThreshold ?? 0.7}</span>
          </div>
        </Section>
      </div>
    </>
  )
}

/* ===== File Output Basic ===== */

function FileOutputBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <Section
      title={language === 'zh' ? '文件路径' : 'File Path'}
      tip={language === 'zh' ? '输出结果写入的文件路径' : 'File path to write output to'}
    >
      <input
        type="text"
        value={data.filePath || ''}
        onChange={(e) => onChange('filePath', e.target.value)}
        placeholder={language === 'zh' ? '/output/result.txt' : '/output/result.txt'}
        className={INPUT_CLASS}
      />
    </Section>
  )
}

/* ===== Webhook Trigger Basic ===== */

function WebhookTriggerBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={language === 'zh' ? '请求方法' : 'Method'}>
        <div className="flex gap-1">
          {(['GET', 'POST'] as const).map(m => (
            <button
              key={m}
              onClick={() => onChange('webhookMethod', m)}
              className={`px-3 py-1 text-[11px] font-medium rounded-lg border transition-all ${
                (data.webhookMethod || 'POST') === m
                  ? 'bg-red-50 border-red-300 text-red-700'
                  : 'bg-white border-gray-150 text-gray-500'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </Section>
      <Section
        title={language === 'zh' ? '路径' : 'Path'}
        tip={language === 'zh' ? 'Webhook接收路径' : 'Webhook endpoint path'}
      >
        <div className="flex items-center rounded-lg border border-gray-200 bg-gray-50 overflow-hidden">
          <span className="px-2 py-1.5 text-[10px] text-gray-400 bg-gray-100 border-r border-gray-200">
            /api/webhook
          </span>
          <input
            type="text"
            value={data.webhookPath || ''}
            onChange={(e) => onChange('webhookPath', e.target.value)}
            placeholder="/my-trigger"
            className="flex-1 px-2 py-1.5 text-xs bg-transparent outline-none"
          />
        </div>
      </Section>
    </>
  )
}

/* ===== Event Wait Basic ===== */

function EventWaitBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section
        title={language === 'zh' ? '事件类型' : 'Event Type'}
        tip={language === 'zh' ? '要等待的事件名称' : 'Event name to wait for'}
      >
        <input
          type="text"
          value={data.eventType || ''}
          onChange={(e) => onChange('eventType', e.target.value)}
          placeholder={language === 'zh' ? '例如：file.uploaded' : 'e.g. file.uploaded'}
          className={INPUT_CLASS}
        />
      </Section>
      <Section
        title={language === 'zh' ? '超时时间(毫秒)' : 'Timeout (ms)'}
        tip={language === 'zh' ? '0表示永不超时' : '0 means never timeout'}
      >
        <input
          type="number"
          value={data.eventTimeout || 0}
          onChange={(e) => onChange('eventTimeout', Number(e.target.value))}
          min={0}
          className={INPUT_CLASS}
        />
      </Section>
    </>
  )
}

/* ===== Sub Workflow Basic ===== */

function SubWorkflowBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <Section
      title={language === 'zh' ? '子工作流' : 'Sub Workflow'}
      tip={language === 'zh' ? '输入要调用的工作流ID' : 'Enter workflow ID to call'}
    >
      <input
        type="text"
        value={data.subWorkflowId || ''}
        onChange={(e) => onChange('subWorkflowId', e.target.value)}
        placeholder={language === 'zh' ? '工作流 ID...' : 'Workflow ID...'}
        className={INPUT_CLASS}
      />
      <p className="mt-1 text-[10px] text-gray-400">
        {language === 'zh' ? '💡 子工作流将独立执行，结果通过 {{subResult}} 返回' : '💡 Sub-workflow runs independently, result via {{subResult}}'}
      </p>
    </Section>
  )
}