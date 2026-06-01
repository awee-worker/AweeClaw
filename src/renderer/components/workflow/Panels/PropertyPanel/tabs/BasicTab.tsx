import type { TabProps } from '../types'
import type { FormFieldDefinition } from '@shared/protocols/workflowV2'
import { Section } from '../Section'
import { INPUT_CLASS, SELECT_CLASS, TEXTAREA_CLASS, TEXTAREA_MONO_CLASS } from '../shared'
import { ConditionBuilder } from '../builders/ConditionBuilder'
import { SwitchCaseBuilder } from '../builders/SwitchCaseBuilder'
import { DelaySection, LoopSection, ParallelSection, MergeSection } from './FlowSections'
import { UserInputSection, UserApprovalSection } from './InteractionSections'
import { HttpRequestSection, TextOutputSection, NotificationSection } from './OutputSections'
import { t, type Language } from '@renderer/i18n'

export function BasicTab({ nodeType, data, onChange, language }: TabProps) {
  return (
    <>
      <Section
        title={t('wf.description', language as Language)}
        tip={t('wf.brieflydescribewhatthisnode', language as Language)}
      >
        <textarea
          value={data.description || ''}
          onChange={(e) => onChange('description', e.target.value)}
          placeholder={t('wf.egcallaitoanalyze', language as Language)}
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
        title={t('wf.selectrole', language as Language)}
        tip={t('wf.chooseanairoleto', language as Language)}
      >
        <select
          value={data.roleId || ''}
          onChange={(e) => onChange('roleId', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t('wf.selectarole', language as Language)}</option>
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
        title={t('wf.chatmode', language as Language)}
        tip={t('wf.agentmodecanusetools', language as Language)}
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
              {{ chat: t('wf.chat', language as Language), agent: 'Agent', plan: t('wf.plan', language as Language) }[mode]}
            </button>
          ))}
        </div>
      </Section>

      <Section
        title={t('wf.temperature', language as Language)}
        tip={t('wf.0precise1morecreative', language as Language)}
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
        title={t('wf.systemprompt', language as Language)}
        tip={t('wf.optionalextrainstructionsappendedto', language as Language)}
        collapsible
      >
        <textarea
          value={data.systemPrompt || ''}
          onChange={(e) => onChange('systemPrompt', e.target.value)}
          placeholder={t('wf.egpleaseanswerina', language as Language)}
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
        title={t('wf.collaborationmode', language as Language)}
        tip={t('wf.sequentialdebateorvotingmode', language as Language)}
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
              {{ sequential: t('wf.seq', language as Language), debate: t('wf.debate', language as Language), voting: t('wf.vote', language as Language) }[mode]}
            </button>
          ))}
        </div>
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

      <Section
        title={t('wf.participants', language as Language)}
        tip={t('wf.selectairolestoparticipate', language as Language)}
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
      title={t('wf.setvariable', language as Language)}
      tip={t('wf.setavariablereferenceas', language as Language)}
    >
      <div className="space-y-2">
        <div>
          <label className="text-[10px] font-medium text-gray-400 mb-0.5 block">
            {t('wf.variablename', language as Language)}
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
            {t('wf.variablevalue', language as Language)}
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
            placeholder={t('wf.valueorexpressioneg', language as Language)}
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
      title={t('wf.transformexpression', language as Language)}
      tip={t('wf.javascriptexpressiondatatheinput', language as Language)}
    >
      <textarea
        value={data.transformExpression || ''}
        onChange={(e) => onChange('transformExpression', e.target.value)}
        placeholder={t('wf.datamapitemitemname', language as Language)}
        rows={4}
        className={TEXTAREA_MONO_CLASS}
      />
      <p className="mt-1 text-[10px] text-gray-400">
        {t('wf.inputavailableviadataresult', language as Language)}
      </p>
    </Section>
  )
}

/* ===== Form Collector Basic (moved from Advanced) ===== */

function FormCollectorBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  const fields: FormFieldDefinition[] = data.formFields || []

  const addField = () => {
    const newField: FormFieldDefinition = { name: `field${fields.length + 1}`, label: `${t('wf.field', language as Language)} ${fields.length + 1}`, type: 'text', required: false }
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
      title={t('wf.formfields', language as Language)}
      tip={t('wf.defineformfieldsusersneed', language as Language)}
    >
      <div className="space-y-2">
        {fields.map((field, idx) => (
          <div key={idx} className="flex items-center gap-1.5 p-2 rounded-lg bg-gray-50 border border-gray-100">
            <input
              type="text"
              value={field.name}
              onChange={(e) => updateField(idx, 'name', e.target.value)}
              placeholder={t('wf.fieldkey', language as Language)}
              className="w-24 px-1.5 py-1 text-[11px] rounded border border-gray-200 bg-white"
            />
            <input
              type="text"
              value={field.label}
              onChange={(e) => updateField(idx, 'label', e.target.value)}
              placeholder={t('wf.label', language as Language)}
              className="flex-1 px-1.5 py-1 text-[11px] rounded border border-gray-200 bg-white"
            />
            <select
              value={field.type}
              onChange={(e) => updateField(idx, 'type', e.target.value)}
              className="w-20 px-1 py-1 text-[11px] rounded border border-gray-200 bg-white"
            >
              <option value="text">{t('wf.text', language as Language)}</option>
              <option value="number">{t('wf.num', language as Language)}</option>
              <option value="select">{t('wf.select', language as Language)}</option>
              <option value="checkbox">{t('wf.chk', language as Language)}</option>
              <option value="textarea">{t('wf.area', language as Language)}</option>
            </select>
            <label className="flex items-center gap-0.5 text-[10px] text-gray-400">
              <input
                type="checkbox"
                checked={field.required || false}
                onChange={(e) => updateField(idx, 'required', e.target.checked)}
                className="rounded"
              />
              {t('wf.req', language as Language)}
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
          + {t('wf.addfield', language as Language)}
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
        title={t('wf.toolname', language as Language)}
        tip={t('wf.builtintoolidentifiertocall', language as Language)}
      >
        <input
          type="text"
          value={data.toolName || ''}
          onChange={(e) => onChange('toolName', e.target.value)}
          placeholder={t('wf.egreadfilesearchcode', language as Language)}
          className={INPUT_CLASS}
        />
      </Section>
      <Section
        title={t('wf.toolargumentsjson', language as Language)}
        tip={t('wf.passargumentsinjsonformat', language as Language)}
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
        title={t('wf.mcpserver', language as Language)}
        tip={t('wf.mcpprotocolserveridentifier', language as Language)}
      >
        <input
          type="text"
          value={data.mcpServerId || ''}
          onChange={(e) => onChange('mcpServerId', e.target.value)}
          placeholder={t('wf.serverid', language as Language)}
          className={INPUT_CLASS}
        />
      </Section>
      <Section
        title={t('wf.toolname2', language as Language)}
        tip={t('wf.toolnameprovidedbythis', language as Language)}
      >
        <input
          type="text"
          value={data.mcpToolName || ''}
          onChange={(e) => onChange('mcpToolName', e.target.value)}
          placeholder={t('wf.toolname3', language as Language)}
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
      <Section title={t('wf.language', language as Language)}>
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
        title={t('wf.code', language as Language)}
        tip={t('wf.inputvarsviainputuse', language as Language)}
      >
        <textarea
          value={data.codeSnippet || ''}
          onChange={(e) => onChange('codeSnippet', e.target.value)}
          rows={8}
          className={TEXTAREA_MONO_CLASS}
          spellCheck={false}
        />
      </Section>
      <Section title={t('wf.inputvariables', language as Language)} collapsible>
        <input
          type="text"
          value={(data.codeInputVars || []).join(', ')}
          onChange={(e) => onChange('codeInputVars', e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean))}
          placeholder={t('wf.varnamescommaseparated', language as Language)}
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
        title={t('wf.knowledgebase', language as Language)}
        tip={t('wf.selectknowledgebasetoquery', language as Language)}
      >
        <input
          type="text"
          value={data.knowledgeBaseId || ''}
          onChange={(e) => onChange('knowledgeBaseId', e.target.value)}
          placeholder={t('wf.kbnameorid', language as Language)}
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
        <Section title={t('wf.threshold', language as Language)}>
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
      title={t('wf.filepath', language as Language)}
      tip={t('wf.filepathtowriteoutput', language as Language)}
    >
      <input
        type="text"
        value={data.filePath || ''}
        onChange={(e) => onChange('filePath', e.target.value)}
        placeholder={t('wf.outputresulttxt', language as Language)}
        className={INPUT_CLASS}
      />
    </Section>
  )
}

/* ===== Webhook Trigger Basic ===== */

function WebhookTriggerBasicSection({ data, onChange, language }: Omit<TabProps, 'nodeType'>) {
  return (
    <>
      <Section title={t('wf.method', language as Language)}>
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
        title={t('wf.path', language as Language)}
        tip={t('wf.webhookendpointpath', language as Language)}
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
        title={t('wf.eventtype', language as Language)}
        tip={t('wf.eventnametowaitfor', language as Language)}
      >
        <input
          type="text"
          value={data.eventType || ''}
          onChange={(e) => onChange('eventType', e.target.value)}
          placeholder={t('wf.egfileuploaded', language as Language)}
          className={INPUT_CLASS}
        />
      </Section>
      <Section
        title={t('wf.timeoutms', language as Language)}
        tip={t('wf.0meansnevertimeout', language as Language)}
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
      title={t('wf.subworkflow', language as Language)}
      tip={t('wf.enterworkflowidtocall', language as Language)}
    >
      <input
        type="text"
        value={data.subWorkflowId || ''}
        onChange={(e) => onChange('subWorkflowId', e.target.value)}
        placeholder={t('wf.workflowid', language as Language)}
        className={INPUT_CLASS}
      />
      <p className="mt-1 text-[10px] text-gray-400">
        {t('wf.subworkflowrunsindependentlyresultvia', language as Language)}
      </p>
    </Section>
  )
}