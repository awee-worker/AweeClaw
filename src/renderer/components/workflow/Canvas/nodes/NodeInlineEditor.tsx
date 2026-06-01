import { useCallback, useState, useMemo, useEffect, useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Zap, Brain, GraduationCap, Cloud, Variable, ChevronRight } from 'lucide-react'
import { useNodes, useEdges } from '@xyflow/react'
import type { WorkflowNodeTypeV2 } from '@shared/protocols/workflowV2'
import type { NodeData } from './NodeShared'
import { emitUpdate } from './NodeShared'
import type { ReactNode } from 'react'
import { useStore } from '@store'
import { BUILTIN_AGENT_ROLES } from '@shared/protocols/workflow'
import { BUILTIN_PROVIDERS } from '@shared/configuration/aiProviders'
import { backendApi, getServerUrl } from '@services/backendApi'
import { getNodeLabel } from '../../shared/nodeTypes'
import { t, type Language } from '@renderer/i18n'

interface InlineEditorProps {
  nodeId: string
  nodeType: WorkflowNodeTypeV2
  data: NodeData
  language?: 'en' | 'zh'
}

const INPUT_CLASS =
  'nodrag no-wheel w-full h-7 px-2 text-[11px] rounded-md border border-gray-200 bg-white text-gray-700 placeholder:text-gray-350 focus:outline-none focus:ring-1.5 focus:ring-blue-400/30 focus:border-blue-400 transition-all'

const TEXTAREA_CLASS =
  'nodrag no-wheel w-full px-2 py-1.5 text-[11px] rounded-md border border-gray-200 bg-white text-gray-700 placeholder:text-gray-350 focus:outline-none focus:ring-1.5 focus:ring-blue-400/30 focus:border-blue-400 transition-all resize-none'

const SELECT_CLASS =
  'nodrag no-wheel w-full h-7 px-2 text-[11px] rounded-md border border-gray-200 bg-white text-gray-700 focus:outline-none focus:ring-1.5 focus:ring-blue-400/30 focus:border-blue-400 transition-all'

const NODE_LABELS: Record<string, { en: string; zh: string }> = {
  systemPrompt: { en: 'System Prompt', zh: '系统提示词' },
  chatMode: { en: 'Chat Mode', zh: '对话模式' },
  temperature: { en: 'Temperature', zh: '温度' },
  role: { en: 'Role', zh: '角色' },
  model: { en: 'Model', zh: '模型' },
  boundTools: { en: 'Bound Tools', zh: '绑定工具' },
  collaborationMode: { en: 'Collaboration Mode', zh: '协作模式' },
  maxRounds: { en: 'Max Rounds', zh: '最大轮次' },
  consensusCondition: { en: 'Consensus', zh: '共识条件' },
  groupRoles: { en: 'Group Roles', zh: '角色组' },
  subWorkflowId: { en: 'Sub Workflow ID', zh: '子工作流ID' },
  inputMapping: { en: 'Input Mapping', zh: '输入映射' },
  outputMapping: { en: 'Output Mapping', zh: '输出映射' },
  addMapping: { en: '+ Add Mapping', zh: '+ 添加映射' },
  inputType: { en: 'Input Type', zh: '输入类型' },
  inputLabel: { en: 'Question / Label', zh: '问题 / 标签' },
  inputPlaceholder: { en: 'Placeholder', zh: '占位提示' },
  required: { en: 'Required', zh: '必填' },
  options: { en: 'Options', zh: '选项' },
  addOption: { en: '+ Add Option', zh: '+ 添加选项' },
  fileConfig: { en: 'File Settings', zh: '文件设置' },
  allowMultiple: { en: 'Allow Multiple', zh: '允许多文件' },
  allowedTypes: { en: 'Allowed Types', zh: '允许类型' },
  maxSize: { en: 'Max Size (MB)', zh: '最大大小(MB)' },
  outputVar: { en: 'Output Variable', zh: '输出变量名' },
  optionLabel: { en: 'Option Label', zh: '选项标签' },
  optionValue: { en: 'Value', zh: '值' },
  approvalTitle: { en: 'Approval Title', zh: '审批标题' },
  approvalDescription: { en: 'Description', zh: '审批说明' },
  approvers: { en: 'Approvers', zh: '审批人' },
  addApprover: { en: '+ Add Approver', zh: '+ 添加审批人' },
  timeoutMs: { en: 'Timeout (ms)', zh: '超时(毫秒)' },
  autoAction: { en: 'On Timeout', zh: '超时动作' },
  formTitle: { en: 'Form Title', zh: '表单标题' },
  formFields: { en: 'Form Fields', zh: '表单字段' },
  addField: { en: '+ Add Field', zh: '+ 添加字段' },
  fieldName: { en: 'Field Name', zh: '字段名' },
  fieldType: { en: 'Type', zh: '类型' },
  conditions: { en: 'Conditions', zh: '条件' },
  addCondition: { en: '+ Add Condition', zh: '+ 添加条件' },
  switchVariable: { en: 'Switch Variable', zh: '判断变量' },
  switchCases: { en: 'Switch Cases', zh: '分支' },
  addCase: { en: '+ Add Case', zh: '+ 添加分支' },
  loopType: { en: 'Loop Type', zh: '循环类型' },
  loopData: { en: 'Loop Data', zh: '循环数据' },
  loopVariable: { en: 'Loop Variable', zh: '循环变量' },
  max: { en: 'Max', zh: '最大' },
  collectionVar: { en: 'Collection Var', zh: '收集变量' },
  strategy: { en: 'Strategy', zh: '策略' },
  all: { en: 'All (parallel)', zh: '全部(并行)' },
  any: { en: 'Any (first wins)', zh: '任一(先到先得)' },
  count: { en: 'Count', zh: '并行数' },
  waitAll: { en: 'Wait All', zh: '等待全部' },
  waitAny: { en: 'Wait Any', zh: '等待任一' },
  toolName: { en: 'Tool Name', zh: '工具名称' },
  toolArgs: { en: 'Arguments', zh: '参数' },
  mcpServer: { en: 'MCP Server', zh: 'MCP服务器' },
  mcpTool: { en: 'MCP Tool', zh: 'MCP工具' },
  language: { en: 'Language', zh: '语言' },
  code: { en: 'Code', zh: '代码' },
  inputVars: { en: 'Input Variables', zh: '输入变量' },
  outputVars: { en: 'Output Variables', zh: '输出变量' },
  method: { en: 'Method', zh: '请求方式' },
  url: { en: 'URL', zh: 'URL' },
  headers: { en: 'Headers', zh: '请求头' },
  body: { en: 'Body', zh: '请求体' },
  auth: { en: 'Auth', zh: '认证' },
  none: { en: 'None', zh: '无' },
  bearer: { en: 'Bearer', zh: 'Bearer' },
  basic: { en: 'Basic', zh: 'Basic' },
  apiKey: { en: 'API Key', zh: 'API Key' },
  token: { en: 'Token', zh: '令牌' },
  user: { en: 'User', zh: '用户名' },
  pass: { en: 'Password', zh: '密码' },
  keyHeader: { en: 'Header', zh: 'Header' },
  keyValue: { en: 'Value', zh: '值' },
  variableName: { en: 'Variable Name', zh: '变量名' },
  variableValue: { en: 'Value / Expression', zh: '值/表达式' },
  varType: { en: 'Type', zh: '类型' },
  expression: { en: 'Expression', zh: '表达式' },
  knowledgeBase: { en: 'Knowledge Base', zh: '知识库' },
  queryContent: { en: 'Query Content', zh: '查询内容' },
  topK: { en: 'Top K', zh: 'Top K' },
  threshold: { en: 'Threshold', zh: '阈值' },
  delayMs: { en: 'Delay (ms)', zh: '延迟(毫秒)' },
  path: { en: 'Path', zh: '路径' },
  eventType: { en: 'Event Type', zh: '事件类型' },
  eventTimeout: { en: 'Timeout (ms)', zh: '超时(毫秒)' },
  textContent: { en: 'Text Content', zh: '文本内容' },
  filePath: { en: 'File Path', zh: '文件路径' },
  outputFormat: { en: 'Output Format', zh: '输出格式' },
  encoding: { en: 'Encoding', zh: '编码' },
  channel: { en: 'Channel', zh: '渠道' },
  template: { en: 'Template', zh: '模板' },
  recipients: { en: 'Recipients', zh: '接收人' },
  addRecipient: { en: '+ Add Recipient', zh: '+ 添加接收人' },
  forEach: { en: 'For Each', zh: '遍历数组' },
  while: { en: 'While', zh: '条件循环' },
  times: { en: 'Times', zh: '固定次数' },
  // file output
  fileFormat: { en: 'File Format', zh: '文件格式' },
}

const INPUT_TYPES: Record<string, { en: string; zh: string }> = {
  text: { en: 'Text', zh: '文本' },
  multiline: { en: 'Multiline', zh: '多行文本' },
  number: { en: 'Number', zh: '数字' },
  select: { en: 'Select', zh: '选择' },
  confirm: { en: 'Confirm', zh: '确认' },
  file: { en: 'File', zh: '文件' },
}

const COLLAB_MODES: Record<string, { en: string; zh: string }> = {
  sequential: { en: 'Sequential', zh: '顺序' },
  voting: { en: 'Voting', zh: '投票' },
  debate: { en: 'Debate', zh: '辩论' },
}

const LANGUAGES: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  bash: 'Bash',
  go: 'Go',
}

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'] as const

const NOTIFICATION_CHANNELS: Record<string, { en: string; zh: string }> = {
  system: { en: 'System', zh: '系统' },
  email: { en: 'Email', zh: '邮件' },
  webhook: { en: 'Webhook', zh: 'Webhook' },
}

function nodeT(key: string, lang: 'en' | 'zh' = 'zh'): string {
  return NODE_LABELS[key]?.[lang] || NODE_LABELS[key]?.en || key
}

function FieldLabel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <label className={`block text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5 ${className}`}>
      {children}
    </label>
  )
}

const NODE_OUTPUT_VARIABLES: Record<string, Array<{ key: string; label: { en: string; zh: string } }>> = {
  start: [{ key: 'output', label: { en: 'Output', zh: '输出' } }],
  agent_task: [
    { key: 'output', label: { en: 'Reply', zh: '回复' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  agent_group: [
    { key: 'output', label: { en: 'Result', zh: '结果' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  sub_workflow: [
    { key: 'output', label: { en: 'Result', zh: '结果' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  user_input: [
    { key: 'output', label: { en: 'Input', zh: '输入' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  user_approval: [
    { key: 'output', label: { en: 'Decision', zh: '审批结果' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  form_collector: [
    { key: 'output', label: { en: 'Form Data', zh: '表单数据' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  tool_call: [
    { key: 'output', label: { en: 'Result', zh: '结果' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  mcp_service: [
    { key: 'output', label: { en: 'Result', zh: '结果' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  code_runner: [
    { key: 'output', label: { en: 'Result', zh: '结果' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  http_request: [
    { key: 'output', label: { en: 'Response', zh: '响应' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  data_transform: [
    { key: 'output', label: { en: 'Transformed', zh: '转换结果' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  knowledge_query: [
    { key: 'output', label: { en: 'Query Result', zh: '查询结果' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
  variable_set: [{ key: 'output', label: { en: 'Value', zh: '值' } }],
  loop: [
    { key: 'output', label: { en: 'Loop Result', zh: '循环结果' } },
    { key: 'outputVar', label: { en: 'Output Var', zh: '输出变量' } },
  ],
}

function VariableInserter({
  nodeId,
  language,
  onInsert,
}: {
  nodeId: string
  language: 'en' | 'zh'
  onInsert: (variable: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const l = language

  const rfNodes = useNodes()
  const rfEdges = useEdges()

  const upstreamNodes = useMemo(() => {
    const incomingEdges = rfEdges.filter((e) => e.target === nodeId)
    const visited = new Set<string>()
    const result: Array<{ id: string; type: string; label: string; variables: Array<{ key: string; label: string }> }> = []

    const traverse = (id: string) => {
      if (visited.has(id)) return
      visited.add(id)
      const node = rfNodes.find((n) => n.id === id)
      if (!node) return
      const nodeType = (node.data as Record<string, unknown>)?.nodeType as string || node.type || ''
      const nodeLabel = ((node.data as Record<string, unknown>)?.label as string) || getNodeLabel(nodeType as WorkflowNodeTypeV2, l)
      const vars = NODE_OUTPUT_VARIABLES[nodeType] || [{ key: 'output', label: { en: 'Output', zh: '输出' } }]
      result.push({
        id: node.id,
        type: nodeType,
        label: nodeLabel,
        variables: vars.map((v) => ({ key: v.key, label: l === 'zh' ? v.label.zh : v.label.en })),
      })
      const parentEdges = rfEdges.filter((e) => e.target === id)
      for (const edge of parentEdges) {
        traverse(edge.source)
      }
    }

    for (const edge of incomingEdges) {
      traverse(edge.source)
    }

    return result
  }, [rfNodes, rfEdges, nodeId, l])

  useEffect(() => {
    if (!isOpen) return
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setHoveredNodeId(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  if (upstreamNodes.length === 0) return null

  const hoveredNode = upstreamNodes.find((n) => n.id === hoveredNodeId)

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="nodrag no-wheel inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] text-purple-500 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100 transition-colors"
      >
        <Variable className="w-2.5 h-2.5" />
        {l === 'zh' ? '插入变量' : 'Insert Var'}
      </button>

      {isOpen && (
        <div className="nodrag no-wheel absolute left-0 top-full mt-1 z-50 min-w-[180px] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-1.5 border-b border-gray-100">
            <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
              {l === 'zh' ? '上游节点' : 'Upstream Nodes'}
            </span>
          </div>
          <div className="flex">
            <div className="min-w-[140px] max-h-[180px] overflow-y-auto border-r border-gray-100">
              {upstreamNodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  className="w-full text-left px-2.5 py-1.5 text-[10px] hover:bg-purple-50 transition-colors flex items-center justify-between gap-1"
                  style={{ color: hoveredNodeId === node.id ? '#7c3aed' : '#374151' }}
                  onMouseEnter={() => setHoveredNodeId(node.id)}
                  onClick={() => {
                    const varName = node.variables[0]
                    if (varName) {
                      onInsert(`{{${node.label}.${varName.key}}}`)
                    }
                    setIsOpen(false)
                    setHoveredNodeId(null)
                  }}
                >
                  <span className="truncate">{node.label}</span>
                  <ChevronRight className="w-2.5 h-2.5 text-gray-300 flex-shrink-0" />
                </button>
              ))}
            </div>

            {hoveredNode && hoveredNode.variables.length > 1 && (
              <div className="min-w-[120px] max-h-[180px] overflow-y-auto">
                <div className="p-1.5 border-b border-gray-50">
                  <span className="text-[8px] text-gray-400">{hoveredNode.label}</span>
                </div>
                {hoveredNode.variables.map((v) => (
                  <button
                    key={v.key}
                    type="button"
                    className="w-full text-left px-2.5 py-1.5 text-[10px] text-gray-600 hover:bg-purple-50 hover:text-purple-600 transition-colors"
                    onClick={() => {
                      onInsert(`{{${hoveredNode.label}.${v.key}}}`)
                      setIsOpen(false)
                      setHoveredNodeId(null)
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function AgentTaskEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const l = language
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )

  const { providerConfigs, llmConfig, cloudMode, isAuthenticated } = useStore(
    useShallow(s => ({
      providerConfigs: s.providerConfigs,
      llmConfig: s.llmConfig,
      cloudMode: s.cloudMode,
      isAuthenticated: s.isAuthenticated,
    })),
  )

  const [cloudModels, setCloudModels] = useState<Array<{ id: string; label: string }>>([])

  useEffect(() => {
    if (cloudMode !== 'cloud' || !isAuthenticated) {
      setCloudModels([])
      return
    }
    const serverUrl = getServerUrl()
    if (!serverUrl) return
    backendApi
      .get<Array<{ provider: string; models: string[] }>>('/api/v1/llm/models')
      .then((data) => {
        const flat: Array<{ id: string; label: string }> = []
        for (const item of data) {
          for (const modelId of item.models) {
            flat.push({
              id: modelId,
              label: `${item.provider} · ${modelId.split('/').pop() || modelId}`,
            })
          }
        }
        setCloudModels(flat)
      })
      .catch(() => setCloudModels([]))
  }, [cloudMode, isAuthenticated])

  const chatMode = (data.chatMode as string) || 'agent'
  const roleId = (data.roleId as string) || ''
  const isCustomRole = roleId === 'custom'
  const [tempVal, setTempVal] = useState(() => (data.temperature as number) ?? 0.7)

  const handleTempChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value)
      setTempVal(v)
      onChange('temperature', v)
    },
    [onChange],
  )

  const selectedRole = useMemo(() => BUILTIN_AGENT_ROLES.find(r => r.id === roleId) || null, [roleId])

  const isCloud = cloudMode === 'cloud' && isAuthenticated

  const availableModels = useMemo(() => {
    if (isCloud && cloudModels.length > 0) {
      return cloudModels
    }

    const models: Array<{ id: string; label: string }> = []
    const seen = new Set<string>()

    for (const [providerId, provider] of Object.entries(BUILTIN_PROVIDERS)) {
      const config = providerConfigs[providerId]
      const hasKey = !!config?.apiKey
      const isCurrent = llmConfig.provider === providerId && !!llmConfig.apiKey
      if (!hasKey && !isCurrent) continue

      const customModels = config?.customModels || []
      const allModelIds = [...provider.models]

      for (const id of customModels) {
        if (!allModelIds.includes(id)) allModelIds.push(id)
      }

      for (const id of allModelIds) {
        const key = `${providerId}::${id}`
        if (!seen.has(key)) {
          seen.add(key)
          models.push({
            id,
            label: `${provider.displayName} · ${id.split('/').pop() || id}`,
          })
        }
      }
    }

    for (const [providerId, config] of Object.entries(providerConfigs)) {
      if (!providerId.startsWith('custom-')) continue
      if (!config?.apiKey) continue
      const modelIds = config.customModels || []
      const providerName = config.displayName || providerId
      for (const id of modelIds) {
        const key = `${providerId}::${id}`
        if (!seen.has(key)) {
          seen.add(key)
          models.push({
            id,
            label: `${providerName} · ${id.split('/').pop() || id}`,
          })
        }
      }
    }

    return models
  }, [providerConfigs, llmConfig, isCloud, cloudModels])

  return (
    <div className="space-y-2.5">
      {/* Chat Mode */}
      <div>
        <FieldLabel>{nodeT('chatMode', l)}</FieldLabel>
        <div className="flex gap-0.5">
          {([
            { id: 'chat', icon: Zap, labelZh: '快速', labelEn: 'Quick', color: 'text-blue-400' },
            { id: 'agent', icon: Brain, labelZh: '思考', labelEn: 'Think', color: 'text-accent' },
            { id: 'plan', icon: GraduationCap, labelZh: '专家', labelEn: 'Expert', color: 'text-purple-400' },
          ] as const).map(m => (
            <button
              key={m.id}
              onClick={() => onChange('chatMode', m.id)}
              className={`nodrag flex-1 flex items-center justify-center gap-1 px-1 py-1.5 text-[10px] font-medium rounded-md border transition-all ${
                chatMode === m.id
                  ? 'bg-purple-50 border-purple-300 text-purple-700 shadow-sm'
                  : 'bg-white border-gray-150 text-gray-400 hover:border-gray-300 hover:text-gray-500'
              }`}
              title={l === 'zh' ? m.labelZh : m.labelEn}
            >
              <m.icon className={`w-3 h-3 ${m.color}`} />
              <span>{l === 'zh' ? m.labelZh : m.labelEn}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Role */}
      <div>
        <FieldLabel>{nodeT('role', l)}</FieldLabel>
        <select
          value={roleId}
          onChange={(e) => {
            const val = e.target.value
            onChange('roleId', val)
            if (val === 'custom') {
              onChange('roleName', '')
            } else {
              const role = BUILTIN_AGENT_ROLES.find(r => r.id === val)
              if (role) {
                const sp = l === 'zh' ? (role.systemPromptZh || role.systemPrompt) : role.systemPrompt
                onChange('systemPrompt', sp)
                if (role.temperature != null) {
                  setTempVal(role.temperature)
                  onChange('temperature', role.temperature)
                }
              }
            }
          }}
          className={SELECT_CLASS}
        >
          <option value="">{l === 'zh' ? '-- 选择角色 --' : '-- Select Role --'}</option>
          {BUILTIN_AGENT_ROLES.map(role => (
            <option key={role.id} value={role.id}>
              {l === 'zh' ? role.nameZh : role.name}
            </option>
          ))}
        </select>
        {selectedRole && !isCustomRole && (
          <p className="mt-1 text-[9px] text-gray-400 leading-tight">
            {l === 'zh' ? selectedRole.descriptionZh : selectedRole.description}
          </p>
        )}
      </div>

      {isCustomRole && (
        <div>
          <FieldLabel>{l === 'zh' ? '自定义角色名' : 'Custom Role Name'}</FieldLabel>
          <input
            type="text"
            value={(data.roleName as string) || ''}
            onChange={(e) => onChange('roleName', e.target.value)}
            placeholder={l === 'zh' ? '输入角色名称...' : 'Enter role name...'}
            className={INPUT_CLASS}
          />
        </div>
      )}

      {/* Model */}
      <div>
        <div className="flex items-center gap-1.5">
          <FieldLabel className="!mb-0">{nodeT('model', l)}</FieldLabel>
          {isCloud && <Cloud className="w-2.5 h-2.5 text-accent" />}
        </div>
        <select
          value={(data.modelId as string) || ''}
          onChange={(e) => onChange('modelId', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{l === 'zh' ? '跟随全局设置' : 'Follow Global'}</option>
          {availableModels.map(m => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Temperature slider */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <FieldLabel className="!mb-0">{nodeT('temperature', l)}</FieldLabel>
          <span className="text-[10px] font-mono font-semibold text-gray-500">{tempVal.toFixed(1)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-gray-350 w-5 text-right">0</span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.05"
            value={tempVal}
            onChange={handleTempChange}
            className="nodrag no-wheel flex-1 h-1.5 appearance-none bg-gray-200 rounded-full cursor-pointer
              accent-purple-500
              [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
              [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-500 [&::-webkit-slider-thumb]:shadow-sm
              [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:active:cursor-grabbing
              [&::-webkit-slider-thumb]:transition-shadow [&::-webkit-slider-thumb]:hover:shadow-md"
          />
          <span className="text-[9px] text-gray-350 w-5">2</span>
        </div>
      </div>

      {/* System Prompt */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <FieldLabel className="!mb-0">{nodeT('systemPrompt', l)}</FieldLabel>
          <VariableInserter
            nodeId={nodeId}
            language={l}
            onInsert={(variable) => {
              const current = (data.systemPrompt as string) || ''
              onChange('systemPrompt', current + variable)
            }}
          />
        </div>
        <textarea
          value={(data.systemPrompt as string) || ''}
          onChange={(e) => onChange('systemPrompt', e.target.value)}
          placeholder={l === 'zh' ? '系统提示词...\n使用 {{节点名.变量名}} 插入上游输出' : 'System prompt...\nUse {{node.variable}} to insert upstream output'}
          rows={3}
          className={TEXTAREA_CLASS}
        />
      </div>

      {/* User Prompt */}
      <div>
        <div className="flex items-center justify-between mb-0.5">
          <FieldLabel className="!mb-0">{l === 'zh' ? '用户提示词' : 'User Prompt'}</FieldLabel>
          <VariableInserter
            nodeId={nodeId}
            language={l}
            onInsert={(variable) => {
              const current = (data.userPrompt as string) || ''
              onChange('userPrompt', current + variable)
            }}
          />
        </div>
        <textarea
          value={(data.userPrompt as string) || ''}
          onChange={(e) => onChange('userPrompt', e.target.value)}
          placeholder={l === 'zh' ? '用户提示词...\n使用 {{节点名.变量名}} 插入上游输出' : 'User prompt...\nUse {{node.variable}} to insert upstream output'}
          rows={3}
          className={TEXTAREA_CLASS}
        />
      </div>

      {/* Variable helper */}
      <div className="p-1.5 bg-gray-50 rounded-md border border-gray-100">
        <p className="text-[9px] text-gray-400 leading-relaxed">
          {l === 'zh'
            ? '💡 变量语法: {{节点名称.变量名}}，如 {{用户输入.output}}'
            : '💡 Variable syntax: {{node_name.variable}}, e.g. {{User Input.output}}'
          }
        </p>
      </div>

      {/* Output Variable */}
      <div>
        <FieldLabel>{nodeT('outputVar', l)}</FieldLabel>
        <input
          type="text"
          value={(data.outputVar as string) || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="agent_result"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

function AgentGroupEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <div className="flex-1">
          <FieldLabel>{nodeT('collaborationMode', language)}</FieldLabel>
          <select value={(data.collaborationMode as string) || 'sequential'} onChange={(e) => onChange('collaborationMode', e.target.value)} className={SELECT_CLASS}>
            {Object.entries(COLLAB_MODES).map(([value, labels]) => (
              <option key={value} value={value}>{labels[language] || labels.en}</option>
            ))}
          </select>
        </div>
        <div className="w-20">
          <FieldLabel>{nodeT('maxRounds', language)}</FieldLabel>
          <input type="number" value={data.maxRounds as number || 3} onChange={(e) => onChange('maxRounds', parseInt(e.target.value) || 3)} min={1} max={10} className={INPUT_CLASS} />
        </div>
      </div>
      <div>
        <FieldLabel>{nodeT('consensusCondition', language)}</FieldLabel>
        <input
          type="text"
          value={(data.consensusCondition as string) || ''}
          onChange={(e) => onChange('consensusCondition', e.target.value)}
          placeholder={t('wf.egagree2', language as Language)}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <FieldLabel>{nodeT('outputVar', language)}</FieldLabel>
        <input
          type="text"
          value={(data.outputVar as string) || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="group_result"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

function SubWorkflowEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const inputMapping = (data.inputMapping as Record<string, string>) || {}
  const inputEntries = Object.entries(inputMapping)

  const addMapping = useCallback(
    (key: 'inputMapping' | 'outputMapping', current: Record<string, string>) => {
      onChange(key, { ...current, '': '' })
    },
    [onChange],
  )

  const updateMapping = useCallback(
    (key: 'inputMapping' | 'outputMapping', current: Record<string, string>, oldKey: string, newKey: string, val: string) => {
      const { [oldKey]: _, ...rest } = current
      onChange(key, { ...rest, [newKey]: val })
    },
    [onChange],
  )

  const removeMapping = useCallback(
    (key: 'inputMapping' | 'outputMapping', current: Record<string, string>, rmKey: string) => {
      const { [rmKey]: _, ...rest } = current
      onChange(key, rest)
    },
    [onChange],
  )

  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('subWorkflowId', language)}</FieldLabel>
        <input type="text" value={(data.subWorkflowId as string) || ''} onChange={(e) => onChange('subWorkflowId', e.target.value)} placeholder={t('wf.selectsubworkflow', language as Language)} className={INPUT_CLASS} />
      </div>
      <div>
        <FieldLabel>
          {nodeT('inputMapping', language)} ({inputEntries.length})
        </FieldLabel>
        <div className="nodrag no-wheel space-y-1 max-h-[100px] overflow-y-auto">
          {inputEntries.map(([k, v]) => (
            <div key={k} className="flex items-center gap-1">
              <input
                type="text"
                value={k}
                onChange={(e) => updateMapping('inputMapping', inputMapping, k, e.target.value, v)}
                placeholder="from"
                className={`${INPUT_CLASS} w-24 h-6 text-[10px]`}
              />
              <span className="text-[10px] text-gray-350">→</span>
              <input
                type="text"
                value={v}
                onChange={(e) => updateMapping('inputMapping', inputMapping, k, k, e.target.value)}
                placeholder="to"
                className={`${INPUT_CLASS} flex-1 h-6 text-[10px]`}
              />
              <button
                onClick={() => removeMapping('inputMapping', inputMapping, k)}
                className="w-5 h-5 flex items-center justify-center rounded text-gray-350 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => addMapping('inputMapping', inputMapping)}
          className="mt-1 text-[10px] text-blue-500 hover:text-blue-600 font-medium transition-colors"
        >
          {nodeT('addMapping', language)}
        </button>
      </div>
      <div>
        <FieldLabel>{nodeT('outputVar', language)}</FieldLabel>
        <input
          type="text"
          value={(data.outputVar as string) || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="sub_workflow_result"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

function UserInputEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )

  const inputType = (data.inputType as string) || 'text'
  const inputLabel = (data.inputLabel as string) || ''
  const inputPlaceholder = (data.inputPlaceholder as string) || ''
  const required = !!(data.required as boolean)
  const inputOptions = (data.inputOptions as Array<{ label: string; value: string }>) || []
  const allowMultipleFiles = !!(data.allowMultipleFiles as boolean)
  const allowedFileTypes = (data.allowedFileTypes as string[]) || []
  const maxFileSize = (data.maxFileSize as number) || 10
  const outputVar = (data.outputVar as string) || ''

  const COMMON_FILE_TYPES = [
    { label: 'Images', value: 'image/*' },
    { label: 'PDF', value: 'application/pdf' },
    { label: 'Word', value: '.doc,.docx' },
    { label: 'Excel', value: '.xls,.xlsx' },
    { label: 'Text', value: 'text/*' },
    { label: 'ZIP', value: '.zip,.tar,.gz' },
    { label: 'JSON', value: 'application/json' },
    { label: 'CSV', value: 'text/csv' },
  ]

  const hasFileType = (t: string) => allowedFileTypes.includes(t)

  const toggleFileType = useCallback(
    (t: string) => {
      const next = hasFileType(t)
        ? allowedFileTypes.filter((f) => f !== t)
        : [...allowedFileTypes, t]
      onChange('allowedFileTypes', next)
    },
    [allowedFileTypes, onChange, hasFileType],
  )

  const addOption = useCallback(() => {
    onChange('inputOptions', [...inputOptions, { label: '', value: '' }])
  }, [inputOptions, onChange])

  const updateOption = useCallback(
    (idx: number, field: 'label' | 'value', val: string) => {
      const updated = inputOptions.map((o, i) =>
        i === idx ? { ...o, [field]: val } : o,
      )
      onChange('inputOptions', updated)
    },
    [inputOptions, onChange],
  )

  const removeOption = useCallback(
    (idx: number) => {
      onChange('inputOptions', inputOptions.filter((_, i) => i !== idx))
    },
    [inputOptions, onChange],
  )

  return (
    <div className="space-y-2.5 px-3 pb-3">
      <div>
        <FieldLabel>{nodeT('inputType', language)}</FieldLabel>
        <div className="grid grid-cols-3 gap-1">
          {(['text', 'multiline', 'number', 'select', 'confirm', 'file'] as const).map((tpe) => (
            <button
              key={tpe}
              onClick={() => onChange('inputType', tpe)}
              className={`px-1 py-1 text-[10px] font-medium rounded border transition-all ${
                inputType === tpe
                  ? 'bg-rose-50 border-rose-300 text-rose-700'
                  : 'bg-white border-gray-150 text-gray-400 hover:border-gray-300'
              }`}
            >
              {INPUT_TYPES[tpe]?.[language] || tpe}
            </button>
          ))}
        </div>
      </div>

      <div>
        <FieldLabel>{nodeT('inputLabel', language)}</FieldLabel>
        <input
          type="text"
          value={inputLabel}
          onChange={(e) => onChange('inputLabel', e.target.value)}
          placeholder={t('wf.egenteryourname', language as Language)}
          className={INPUT_CLASS}
        />
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <FieldLabel>{nodeT('inputPlaceholder', language)}</FieldLabel>
          <input
            type="text"
            value={inputPlaceholder}
            onChange={(e) => onChange('inputPlaceholder', e.target.value)}
            placeholder={t('wf.placeholdertext', language as Language)}
            className={INPUT_CLASS}
          />
        </div>
        <div className="w-16">
          <FieldLabel>{nodeT('required', language)}</FieldLabel>
          <button
            onClick={() => onChange('required', !required)}
            className={`w-full h-7 text-[10px] font-medium rounded-md border transition-all ${
              required
                ? 'bg-rose-50 border-rose-300 text-rose-700'
                : 'bg-white border-gray-150 text-gray-350 hover:border-gray-300'
            }`}
          >
            {required ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {inputType === 'select' && (
        <div>
          <FieldLabel>
            {nodeT('options', language)} ({inputOptions.length})
          </FieldLabel>
          <div className="nodrag no-wheel space-y-1 max-h-[140px] overflow-y-auto">
            {inputOptions.map((opt, i) => (
              <div key={i} className="flex items-center gap-1">
                <input
                  type="text"
                  value={opt.value}
                  onChange={(e) => updateOption(i, 'value', e.target.value)}
                  placeholder={nodeT('optionValue', language)}
                  className={`${INPUT_CLASS} w-[60px]`}
                />
                <input
                  type="text"
                  value={opt.label}
                  onChange={(e) => updateOption(i, 'label', e.target.value)}
                  placeholder={nodeT('optionLabel', language)}
                  className={`${INPUT_CLASS} flex-1`}
                />
                <button
                  onClick={() => removeOption(i)}
                  className="w-5 h-5 flex items-center justify-center rounded text-gray-350 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
                  title={t('wf.remove', language as Language)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={addOption}
            className="mt-1 text-[10px] text-blue-500 hover:text-blue-600 font-medium transition-colors"
          >
            + {nodeT('addOption', language)}
          </button>
        </div>
      )}

      {inputType === 'file' && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <FieldLabel>{nodeT('fileConfig', language)}</FieldLabel>
            <button
              onClick={() => onChange('allowMultipleFiles', !allowMultipleFiles)}
              className={`text-[10px] px-1.5 py-0.5 rounded border transition-all ${
                allowMultipleFiles
                  ? 'bg-blue-50 border-blue-200 text-blue-700'
                  : 'bg-white border-gray-150 text-gray-400'
              }`}
            >
              {nodeT('allowMultiple', language)}
            </button>
          </div>

          <div>
            <div className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1">
              {nodeT('allowedTypes', language)}
            </div>
            <div className="flex flex-wrap gap-1">
              {COMMON_FILE_TYPES.map((ft) => (
                <button
                  key={ft.value}
                  onClick={() => toggleFileType(ft.value)}
                  className={`px-1.5 py-0.5 text-[10px] rounded border transition-all ${
                    hasFileType(ft.value)
                      ? 'bg-blue-50 border-blue-200 text-blue-700'
                      : 'bg-white border-gray-150 text-gray-400 hover:border-gray-300'
                  }`}
                  title={ft.value}
                >
                  {ft.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
              {nodeT('maxSize', language)}
            </span>
            <input
              type="number"
              value={maxFileSize}
              onChange={(e) =>
                onChange('maxFileSize', Math.max(1, parseInt(e.target.value) || 10))
              }
              min={1}
              max={500}
              className={`${INPUT_CLASS} w-20 h-6`}
            />
          </div>
        </div>
      )}

      <div>
        <FieldLabel>{nodeT('outputVar', language)}</FieldLabel>
        <input
          type="text"
          value={outputVar}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder={t('wf.egusername', language as Language)}
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

function UserApprovalEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const approvalTitle = (data.approvalTitle as string) || (data.approvalTitleZh as string) || ''
  const approvalDescription = (data.approvalDescription as string) || (data.approvalDescriptionZh as string) || ''
  const approverList = (data.approverList as string[]) || []
  const autoAction = (data.approvalAutoAction as string) || 'pause'

  const addApprover = useCallback(() => {
    onChange('approverList', [...approverList, ''])
  }, [approverList, onChange])

  const updateApprover = useCallback(
    (idx: number, val: string) => {
      const updated = approverList.map((a, i) => (i === idx ? val : a))
      onChange('approverList', updated)
    },
    [approverList, onChange],
  )

  const removeApprover = useCallback(
    (idx: number) => {
      onChange('approverList', approverList.filter((_, i) => i !== idx))
    },
    [approverList, onChange],
  )

  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('approvalTitle', language)}</FieldLabel>
        <input
          type="text"
          value={approvalTitle}
          onChange={(e) => onChange('approvalTitle', e.target.value)}
          placeholder={t('wf.egleaveapproval', language as Language)}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <FieldLabel>{nodeT('approvalDescription', language)}</FieldLabel>
        <input
          type="text"
          value={approvalDescription}
          onChange={(e) => onChange('approvalDescription', e.target.value)}
          placeholder={t('wf.description', language as Language)}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <FieldLabel>
          {nodeT('approvers', language)} ({approverList.length})
        </FieldLabel>
        <div className="nodrag no-wheel space-y-1 max-h-[100px] overflow-y-auto">
          {approverList.map((approver, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="text"
                value={approver}
                onChange={(e) => updateApprover(i, e.target.value)}
                placeholder={t('wf.approveridname', language as Language)}
                className={`${INPUT_CLASS} flex-1`}
              />
              <button
                onClick={() => removeApprover(i)}
                className="w-5 h-5 flex items-center justify-center rounded text-gray-350 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addApprover}
          className="mt-1 text-[10px] text-blue-500 hover:text-blue-600 font-medium transition-colors"
        >
          {nodeT('addApprover', language)}
        </button>
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <FieldLabel>{nodeT('timeoutMs', language)}</FieldLabel>
          <input
            type="number"
            value={data.approvalTimeout as number || 3600000}
            onChange={(e) => onChange('approvalTimeout', parseInt(e.target.value) || 3600000)}
            min={1000}
            step={1000}
            className={INPUT_CLASS}
          />
        </div>
        <div className="flex-1">
          <FieldLabel>{nodeT('autoAction', language)}</FieldLabel>
          <select
            value={autoAction}
            onChange={(e) => onChange('approvalAutoAction', e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="pause">{t('wf.pause', language as Language)}</option>
            <option value="approve">{t('wf.autoapprove', language as Language)}</option>
            <option value="reject">{t('wf.autoreject', language as Language)}</option>
          </select>
        </div>
      </div>
      <div>
        <FieldLabel>{nodeT('outputVar', language)}</FieldLabel>
        <input
          type="text"
          value={(data.outputVar as string) || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="approval_result"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

function FormCollectorEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const formTitle = (data.formTitle as string) || (data.formTitleZh as string) || ''
  const fields = (data.formFields as unknown as Array<Record<string, unknown>>) || []

  const addField = useCallback(() => {
    onChange('formFields', [
      ...fields,
      { name: `field${fields.length + 1}`, label: `Field ${fields.length + 1}`, type: 'text', required: false },
    ])
  }, [fields, onChange])

  const updateField = useCallback(
    (idx: number, key: string, val: unknown) => {
      const updated = fields.map((f, i) => (i === idx ? { ...f, [key]: val } : f))
      onChange('formFields', updated)
    },
    [fields, onChange],
  )

  const removeField = useCallback(
    (idx: number) => {
      onChange('formFields', fields.filter((_, i) => i !== idx))
    },
    [fields, onChange],
  )

  const updateFieldOptions = useCallback(
    (idx: number, opts: Array<{ label: string; value: string }>) => {
      const updated = fields.map((f, i) => (i === idx ? { ...f, options: opts } : f))
      onChange('formFields', updated)
    },
    [fields, onChange],
  )

  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('formTitle', language)}</FieldLabel>
        <input
          type="text"
          value={formTitle}
          onChange={(e) => onChange('formTitle', e.target.value)}
          placeholder={t('wf.egcustomerinfoform', language as Language)}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <FieldLabel>
          {nodeT('formFields', language)} ({fields.length})
        </FieldLabel>
        <div className="nodrag no-wheel space-y-2 max-h-[260px] overflow-y-auto">
          {fields.map((f, i) => {
            const fieldType = (f.type as string) || 'text'
            const fieldOptions = (f.options as Array<{ label: string; value: string }>) || []
            const isRequired = !!(f.required as boolean)
            return (
              <div key={i} className="border border-gray-150 rounded-lg p-2 space-y-1.5 bg-gray-50/50">
                <div className="flex items-center gap-1">
                  <input
                    type="text"
                    value={(f.name as string) || ''}
                    onChange={(e) => updateField(i, 'name', e.target.value)}
                    placeholder={nodeT('fieldName', language)}
                    className={`${INPUT_CLASS} flex-1 h-6 text-[10px]`}
                  />
                  <select
                    value={fieldType}
                    onChange={(e) => updateField(i, 'type', e.target.value)}
                    className={`${SELECT_CLASS} w-[80px] h-6 text-[10px]`}
                  >
                    <option value="text">{t('wf.text', language as Language)}</option>
                    <option value="textarea">{t('wf.textarea', language as Language)}</option>
                    <option value="number">{t('wf.number', language as Language)}</option>
                    <option value="select">{t('wf.select', language as Language)}</option>
                    <option value="checkbox">{t('wf.checkbox', language as Language)}</option>
                  </select>
                  <button
                    onClick={() => updateField(i, 'required', !isRequired)}
                    className={`px-1 h-6 text-[9px] rounded border transition-all flex-shrink-0 ${
                      isRequired ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-gray-150 text-gray-350'
                    }`}
                    title={nodeT('required', language)}
                  >
                    *
                  </button>
                  <button
                    onClick={() => removeField(i)}
                    className="w-5 h-5 flex items-center justify-center rounded text-gray-350 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
                  >
                    ×
                  </button>
                </div>
                <input
                  type="text"
                  value={(f.label as string) || ''}
                  onChange={(e) => updateField(i, 'label', e.target.value)}
                  placeholder={t('wf.displaylabel', language as Language)}
                  className={`${INPUT_CLASS} h-6 text-[10px]`}
                />
                {fieldType === 'select' && (
                  <div className="space-y-1 pl-1 border-l-2 border-blue-200">
                    {fieldOptions.map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-1">
                        <input
                          type="text"
                          value={opt.value}
                          onChange={(e) => {
                            const updated = fieldOptions.map((o, j) => (j === oi ? { ...o, value: e.target.value } : o))
                            updateFieldOptions(i, updated)
                          }}
                          placeholder="val"
                          className={`${INPUT_CLASS} w-14 h-5 text-[9px]`}
                        />
                        <input
                          type="text"
                          value={opt.label}
                          onChange={(e) => {
                            const updated = fieldOptions.map((o, j) => (j === oi ? { ...o, label: e.target.value } : o))
                            updateFieldOptions(i, updated)
                          }}
                          placeholder="label"
                          className={`${INPUT_CLASS} flex-1 h-5 text-[9px]`}
                        />
                        <button
                          onClick={() => updateFieldOptions(i, fieldOptions.filter((_, j) => j !== oi))}
                          className="text-[9px] text-gray-350 hover:text-red-500"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() =>
                        updateFieldOptions(i, [...fieldOptions, { label: '', value: '' }])
                      }
                      className="text-[9px] text-blue-500 hover:text-blue-600"
                    >
                      + opt
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
        <button
          onClick={addField}
          className="mt-1.5 text-[10px] text-blue-500 hover:text-blue-600 font-medium transition-colors"
        >
          {nodeT('addField', language)}
        </button>
      </div>
      <div>
        <FieldLabel>{nodeT('outputVar', language)}</FieldLabel>
        <input
          type="text"
          value={(data.outputVar as string) || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="form_data"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

function ConditionEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const conditions = (data.conditions as unknown as Array<Record<string, unknown>>) || []

  const addCondition = useCallback(() => {
    onChange('conditions', [...conditions, { id: `cond-${Date.now()}`, variable: '', operator: 'equals', value: '', targetHandle: `branch_${conditions.length}` }])
  }, [conditions, onChange])

  const updateCondition = useCallback(
    (idx: number, key: string, val: unknown) => {
      const updated = conditions.map((c, i) => (i === idx ? { ...c, [key]: val } : c))
      onChange('conditions', updated)
    },
    [conditions, onChange],
  )

  const removeCondition = useCallback(
    (idx: number) => {
      onChange('conditions', conditions.filter((_, i) => i !== idx))
    },
    [conditions, onChange],
  )

  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>
          {nodeT('conditions', language)} ({conditions.length})
        </FieldLabel>
        <div className="nodrag no-wheel space-y-1.5 max-h-[200px] overflow-y-auto">
          {conditions.map((c, i) => (
            <div key={i} className="border border-gray-150 rounded-lg p-2 space-y-1 bg-gray-50/50">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-gray-400 w-5 text-right">{i + 1}</span>
                <input
                  type="text"
                  value={(c.variable as string) || ''}
                  onChange={(e) => updateCondition(i, 'variable', e.target.value)}
                  placeholder="var"
                  className={`${INPUT_CLASS} flex-1 h-6 text-[10px]`}
                />
                <select
                  value={(c.operator as string) || 'equals'}
                  onChange={(e) => updateCondition(i, 'operator', e.target.value)}
                  className={`${SELECT_CLASS} w-[72px] h-6 text-[10px]`}
                >
                  <option value="equals">==</option>
                  <option value="not_equals">!=</option>
                  <option value="contains">{t('wf.has', language as Language)}</option>
                  <option value="greater_than">&gt;</option>
                  <option value="less_than">&lt;</option>
                  <option value="is_empty">{t('wf.nil', language as Language)}</option>
                </select>
                <input
                  type="text"
                  value={(c.value as string) || ''}
                  onChange={(e) => updateCondition(i, 'value', e.target.value)}
                  placeholder="value"
                  className={`${INPUT_CLASS} flex-1 h-6 text-[10px]`}
                />
                <input
                  type="text"
                  value={(c.targetHandle as string) || `branch_${i}`}
                  onChange={(e) => updateCondition(i, 'targetHandle', e.target.value)}
                  placeholder="handle"
                  className={`${INPUT_CLASS} w-16 h-6 text-[9px]`}
                />
                <button
                  onClick={() => removeCondition(i)}
                  className="w-5 h-5 flex items-center justify-center rounded text-gray-350 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
                >
                  ×
                </button>
              </div>
            </div>
          ))}
        </div>
        <button
          onClick={addCondition}
          className="mt-1.5 text-[10px] text-blue-500 hover:text-blue-600 font-medium transition-colors"
        >
          {nodeT('addCondition', language)}
        </button>
      </div>
    </div>
  )
}

function SwitchCaseEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const cases = (data.switchCases as unknown as Array<Record<string, unknown>>) || []

  const addCase = useCallback(() => {
    onChange('switchCases', [...cases, { id: `case-${Date.now()}`, label: `Case ${cases.length + 1}`, condition: '', targetHandle: `case_${cases.length}` }])
  }, [cases, onChange])

  const updateCase = useCallback(
    (idx: number, key: string, val: unknown) => {
      const updated = cases.map((c, i) => (i === idx ? { ...c, [key]: val } : c))
      onChange('switchCases', updated)
    },
    [cases, onChange],
  )

  const removeCase = useCallback(
    (idx: number) => {
      onChange('switchCases', cases.filter((_, i) => i !== idx))
    },
    [cases, onChange],
  )

  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('switchVariable', language)}</FieldLabel>
        <input
          type="text"
          value={(data.switchVariable as string) || ''}
          onChange={(e) => onChange('switchVariable', e.target.value)}
          placeholder={t('wf.eg', language as Language)}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <FieldLabel>
          {nodeT('switchCases', language)} ({cases.length})
        </FieldLabel>
        <div className="nodrag no-wheel space-y-1 max-h-[180px] overflow-y-auto">
          {cases.map((c, i) => (
            <div key={i} className="flex items-center gap-1">
              <span className="text-[10px] text-gray-400 w-4 text-right">{i + 1}</span>
              <input
                type="text"
                value={(c.label as string) || ''}
                onChange={(e) => updateCase(i, 'label', e.target.value)}
                placeholder="label"
                className={`${INPUT_CLASS} w-20 h-6 text-[10px]`}
              />
              <input
                type="text"
                value={(c.condition as string) || ''}
                onChange={(e) => updateCase(i, 'condition', e.target.value)}
                placeholder="value"
                className={`${INPUT_CLASS} flex-1 h-6 text-[10px]`}
              />
              <button
                onClick={() => removeCase(i)}
                className="w-5 h-5 flex items-center justify-center rounded text-gray-350 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addCase}
          className="mt-1 text-[10px] text-blue-500 hover:text-blue-600 font-medium transition-colors"
        >
          {nodeT('addCase', language)}
        </button>
      </div>
    </div>
  )
}

function LoopEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const loopType = (data.loopType as string) || 'for_each'
  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('loopType', language)}</FieldLabel>
        <div className="flex gap-0.5">
          {(['for_each', 'while', 'times'] as const).map((lt) => (
            <button
              key={lt}
              onClick={() => onChange('loopType', lt)}
              className={`flex-1 px-1.5 py-1 text-[10px] font-medium rounded border transition-all ${
                loopType === lt
                  ? 'bg-purple-50 border-purple-300 text-purple-700'
                  : 'bg-white border-gray-150 text-gray-400 hover:border-gray-300'
              }`}
            >
              {language === 'zh'
                ? { for_each: '遍历', while: '条件', times: '次数' }[lt]
                : { for_each: 'For Each', while: 'While', times: 'Times' }[lt]}
            </button>
          ))}
        </div>
      </div>
      {loopType === 'for_each' && (
        <>
          <div>
            <FieldLabel>{nodeT('loopData', language)}</FieldLabel>
            <input
              type="text"
              value={(data.loopMode as string) || ''}
              onChange={(e) => onChange('loopMode', e.target.value)}
              placeholder={t('wf.eg2', language as Language)}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <FieldLabel>{nodeT('loopVariable', language)}</FieldLabel>
            <input
              type="text"
              value={(data.loopVariable as string) || 'item'}
              onChange={(e) => onChange('loopVariable', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </>
      )}
      {loopType === 'while' && (
        <div>
          <FieldLabel>{nodeT('conditions', language)}</FieldLabel>
          <input
            type="text"
            value={(data.loopMode as string) || ''}
            onChange={(e) => onChange('loopMode', e.target.value)}
            placeholder={t('wf.eg3', language as Language)}
            className={INPUT_CLASS}
          />
        </div>
      )}
      {loopType === 'times' && (
        <div className="flex gap-2">
          <div className="flex-1">
            <FieldLabel>{nodeT('max', language)}</FieldLabel>
            <input
              type="number"
              value={data.loopMaxIterations as number || 10}
              onChange={(e) => onChange('loopMaxIterations', parseInt(e.target.value) || 10)}
              min={1} max={1000}
              className={INPUT_CLASS}
            />
          </div>
          <div className="flex-1">
            <FieldLabel>{nodeT('loopVariable', language)}</FieldLabel>
            <input
              type="text"
              value={(data.loopVariable as string) || 'index'}
              onChange={(e) => onChange('loopVariable', e.target.value)}
              className={INPUT_CLASS}
            />
          </div>
        </div>
      )}
      <div>
        <FieldLabel>{nodeT('collectionVar', language)}</FieldLabel>
        <input
          type="text"
          value={(data.outputVar as string) || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="loop_results"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

function ParallelEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const strategy = (data.parallelStrategy as string) || 'all'
  return (
    <div className="space-y-2">
      <div>
        <FieldLabel>{nodeT('strategy', language)}</FieldLabel>
        <select value={strategy} onChange={(e) => onChange('parallelStrategy', e.target.value)} className={SELECT_CLASS}>
          <option value="all">{nodeT('all', language)}</option>
          <option value="any">{nodeT('any', language)}</option>
          <option value="count">{nodeT('count', language)}</option>
        </select>
      </div>
      {strategy === 'count' && (
        <div>
          <FieldLabel>{nodeT('count', language)}</FieldLabel>
          <input
            type="number"
            value={data.parallelCount as number || 2}
            onChange={(e) => onChange('parallelCount', parseInt(e.target.value) || 2)}
            min={1}
            className={INPUT_CLASS}
          />
        </div>
      )}
    </div>
  )
}

function MergeEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const strategy = (data.mergeStrategy as string) || 'all'
  return (
    <div className="space-y-2">
      <div>
        <FieldLabel>{nodeT('strategy', language)}</FieldLabel>
        <select value={strategy} onChange={(e) => onChange('mergeStrategy', e.target.value)} className={SELECT_CLASS}>
          <option value="all">{nodeT('waitAll', language)}</option>
          <option value="any">{nodeT('waitAny', language)}</option>
          <option value="count">{nodeT('count', language)}</option>
        </select>
      </div>
      {strategy === 'count' && (
        <div>
          <FieldLabel>{nodeT('count', language)}</FieldLabel>
          <input
            type="number"
            value={data.mergeCount as number || 2}
            onChange={(e) => onChange('mergeCount', parseInt(e.target.value) || 2)}
            min={1}
            className={INPUT_CLASS}
          />
        </div>
      )}
    </div>
  )
}

function ToolCallEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const toolArgs = (data.toolArgs as Record<string, unknown>) || {}

  const argEntries = Object.entries(toolArgs)

  const updateArg = useCallback(
    (_idx: number, key: string, val: unknown) => {
      const updated = { ...toolArgs, [key]: val }
      onChange('toolArgs', updated)
    },
    [toolArgs, onChange],
  )

  const removeArg = useCallback(
    (key: string) => {
      const { [key]: _, ...rest } = toolArgs
      onChange('toolArgs', rest)
    },
    [toolArgs, onChange],
  )

  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('toolName', language)}</FieldLabel>
        <input
          type="text"
          value={(data.toolName as string) || ''}
          onChange={(e) => onChange('toolName', e.target.value)}
          placeholder={t('wf.selecttool', language as Language)}
          className={INPUT_CLASS}
        />
      </div>
      <div>
        <FieldLabel>
          {nodeT('toolArgs', language)} ({argEntries.length})
        </FieldLabel>
        <div className="nodrag no-wheel space-y-1 max-h-[120px] overflow-y-auto">
          {argEntries.map(([key, val]) => (
            <div key={key} className="flex items-center gap-1">
              <input
                type="text"
                value={key}
                onChange={(e) => {
                  const { [key]: old, ...rest } = toolArgs
                  onChange('toolArgs', { ...rest, [e.target.value]: old })
                }}
                placeholder="key"
                className={`${INPUT_CLASS} w-24 h-6 text-[10px]`}
              />
              <input
                type="text"
                value={String(val ?? '')}
                onChange={(e) => updateArg(0, key, e.target.value)}
                placeholder="value"
                className={`${INPUT_CLASS} flex-1 h-6 text-[10px]`}
              />
              <button
                onClick={() => removeArg(key)}
                className="w-5 h-5 flex items-center justify-center rounded text-gray-350 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => onChange('toolArgs', { ...toolArgs, [`arg${argEntries.length + 1}`]: '' })}
          className="mt-1 text-[10px] text-blue-500 hover:text-blue-600 font-medium transition-colors"
        >
          + arg
        </button>
      </div>
      <div>
        <FieldLabel>{nodeT('outputVar', language)}</FieldLabel>
        <input
          type="text"
          value={(data.outputVar as string) || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="tool_result"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

function McpServiceEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('mcpServer', language)}</FieldLabel>
        <input type="text" value={(data.mcpServerId as string) || ''} onChange={(e) => onChange('mcpServerId', e.target.value)} placeholder={t('wf.selectmcpserver', language as Language)} className={INPUT_CLASS} />
      </div>
      <div>
        <FieldLabel>{nodeT('mcpTool', language)}</FieldLabel>
        <input type="text" value={(data.mcpToolName as string) || ''} onChange={(e) => onChange('mcpToolName', e.target.value)} placeholder={t('wf.toolname', language as Language)} className={INPUT_CLASS} />
      </div>
      <div>
        <FieldLabel>{nodeT('outputVar', language)}</FieldLabel>
        <input type="text" value={(data.outputVar as string) || ''} onChange={(e) => onChange('outputVar', e.target.value)} placeholder="mcp_result" className={INPUT_CLASS} />
      </div>
    </div>
  )
}

function CodeRunnerEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const inputVars = (data.inputVars as unknown as Array<Record<string, unknown>>) || []

  const addInput = useCallback(() => {
    onChange('inputVars', [...inputVars, { name: '', type: 'string' }])
  }, [inputVars, onChange])

  const updateInput = useCallback(
    (idx: number, key: string, val: unknown) => {
      const updated = inputVars.map((v, i) => (i === idx ? { ...v, [key]: val } : v))
      onChange('inputVars', updated)
    },
    [inputVars, onChange],
  )

  const removeInput = useCallback(
    (idx: number) => {
      onChange('inputVars', inputVars.filter((_, i) => i !== idx))
    },
    [inputVars, onChange],
  )

  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('language', language)}</FieldLabel>
        <select
          value={(data.codeLanguage as string) || 'javascript'}
          onChange={(e) => onChange('codeLanguage', e.target.value)}
          className={SELECT_CLASS}
        >
          {Object.entries(LANGUAGES).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      <div>
        <FieldLabel>
          {nodeT('inputVars', language)} ({inputVars.length})
        </FieldLabel>
        <div className="nodrag no-wheel space-y-1 max-h-[100px] overflow-y-auto">
          {inputVars.map((v, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="text"
                value={(v.name as string) || ''}
                onChange={(e) => updateInput(i, 'name', e.target.value)}
                placeholder={t('wf.name', language as Language)}
                className={`${INPUT_CLASS} flex-1 h-6 text-[10px]`}
              />
              <select
                value={(v.type as string) || 'string'}
                onChange={(e) => updateInput(i, 'type', e.target.value)}
                className={`${SELECT_CLASS} w-[70px] h-6 text-[10px]`}
              >
                <option value="string">string</option>
                <option value="number">number</option>
                <option value="object">object</option>
                <option value="array">array</option>
              </select>
              <button
                onClick={() => removeInput(i)}
                className="w-5 h-5 flex items-center justify-center rounded text-gray-350 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addInput}
          className="mt-1 text-[10px] text-blue-500 hover:text-blue-600 font-medium transition-colors"
        >
          + var
        </button>
      </div>
      <div>
        <FieldLabel>{nodeT('code', language)}</FieldLabel>
        <textarea
          value={(data.codeSnippet as string) || ''}
          onChange={(e) => onChange('codeSnippet', e.target.value)}
          placeholder={t('wf.accessinputvarsviainputvarsnreturn', language as Language)}
          rows={5}
          className={`${TEXTAREA_CLASS} font-mono text-[10px]`}
          spellCheck={false}
        />
      </div>
      <div>
        <FieldLabel>{nodeT('outputVar', language)}</FieldLabel>
        <input
          type="text"
          value={(data.outputVar as string) || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="code_result"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

function HttpRequestEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const headers = (data.httpHeaders as Record<string, string>) || {}
  const headerEntries = Object.entries(headers)
  const auth = data.httpAuth as Record<string, unknown> | undefined
  const authType = (auth?.type as string) || 'none'

  const updateHeader = useCallback(
    (key: string, val: string, oldKey?: string) => {
      if (oldKey && oldKey !== key) {
        const { [oldKey]: _, ...rest } = headers
        onChange('httpHeaders', { ...rest, [key]: val })
      } else {
        onChange('httpHeaders', { ...headers, [key]: val })
      }
    },
    [headers, onChange],
  )

  const removeHeader = useCallback(
    (key: string) => {
      const { [key]: _, ...rest } = headers
      onChange('httpHeaders', rest)
    },
    [headers, onChange],
  )

  const updateAuth = useCallback(
    (key: string, value: unknown) => {
      onChange('httpAuth', { ...auth, [key]: value })
    },
    [auth, onChange],
  )

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <div className="w-24">
          <FieldLabel>{nodeT('method', language)}</FieldLabel>
          <select
            value={(data.httpMethod as string) || 'GET'}
            onChange={(e) => onChange('httpMethod', e.target.value)}
            className={SELECT_CLASS}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
        </div>
        <div className="flex-1">
          <FieldLabel>{nodeT('url', language)}</FieldLabel>
          <input
            type="text"
            value={(data.httpUrl as string) || ''}
            onChange={(e) => onChange('httpUrl', e.target.value)}
            placeholder="https://..."
            className={INPUT_CLASS}
          />
        </div>
      </div>
      <div>
        <FieldLabel>
          {nodeT('headers', language)} ({headerEntries.length})
        </FieldLabel>
        <div className="nodrag no-wheel space-y-1 max-h-[100px] overflow-y-auto">
          {headerEntries.map(([key, val]) => (
            <div key={key} className="flex items-center gap-1">
              <input
                type="text"
                value={key}
                onChange={(e) => updateHeader(e.target.value, val, key)}
                placeholder="key"
                className={`${INPUT_CLASS} w-24 h-6 text-[10px]`}
              />
              <input
                type="text"
                value={val}
                onChange={(e) => updateHeader(key, e.target.value)}
                placeholder="value"
                className={`${INPUT_CLASS} flex-1 h-6 text-[10px]`}
              />
              <button
                onClick={() => removeHeader(key)}
                className="w-5 h-5 flex items-center justify-center rounded text-gray-350 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={() => onChange('httpHeaders', { ...headers, '': '' })}
          className="mt-1 text-[10px] text-blue-500 hover:text-blue-600 font-medium transition-colors"
        >
          + header
        </button>
      </div>
      <div>
        <FieldLabel>{nodeT('auth', language)}</FieldLabel>
        <select
            value={authType}
            onChange={(e) => updateAuth('type', e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="none">{nodeT('none', language)}</option>
            <option value="bearer">{nodeT('bearer', language)}</option>
            <option value="basic">{nodeT('basic', language)}</option>
            <option value="api-key">{nodeT('apiKey', language)}</option>
          </select>
          {authType === 'bearer' && (
            <input
              type="text"
              value={(auth?.token as string) || ''}
              onChange={(e) => updateAuth('token', e.target.value)}
              placeholder={nodeT('token', language)}
              className={`${INPUT_CLASS} mt-1`}
            />
          )}
          {authType === 'basic' && (
            <div className="flex gap-1 mt-1">
              <input
                type="text"
                value={(auth?.user as string) || ''}
                onChange={(e) => updateAuth('user', e.target.value)}
                placeholder={nodeT('user', language)}
                className={`${INPUT_CLASS} flex-1`}
              />
              <input
                type="text"
                value={(auth?.pass as string) || ''}
                onChange={(e) => updateAuth('pass', e.target.value)}
                placeholder={nodeT('pass', language)}
                className={`${INPUT_CLASS} flex-1`}
              />
            </div>
          )}
          {authType === 'api-key' && (
            <div className="flex gap-1 mt-1">
              <input
                type="text"
                value={(auth?.headerName as string) || ''}
                onChange={(e) => updateAuth('headerName', e.target.value)}
                placeholder={nodeT('keyHeader', language)}
                className={`${INPUT_CLASS} flex-1`}
              />
              <input
                type="text"
                value={(auth?.headerValue as string) || ''}
                onChange={(e) => updateAuth('headerValue', e.target.value)}
                placeholder={nodeT('keyValue', language)}
                className={`${INPUT_CLASS} flex-1`}
              />
            </div>
          )}
      </div>
      <div>
        <FieldLabel>{nodeT('body', language)}</FieldLabel>
        <textarea
          value={(data.httpBody as string) || ''}
          onChange={(e) => onChange('httpBody', e.target.value)}
          placeholder='{"key": "value"}'
          rows={2}
          className={`${TEXTAREA_CLASS} font-mono text-[10px]`}
        />
      </div>
      <div>
        <FieldLabel>{nodeT('outputVar', language)}</FieldLabel>
        <input
          type="text"
          value={(data.outputVar as string) || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="http_result"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

function VariableSetEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <div className="flex-1">
          <FieldLabel>{nodeT('variableName', language)}</FieldLabel>
          <input type="text" value={(data.variableName as string) || ''} onChange={(e) => onChange('variableName', e.target.value)} placeholder="myVariable" className={INPUT_CLASS} />
        </div>
        <div className="w-24">
          <FieldLabel>{nodeT('varType', language)}</FieldLabel>
          <select
            value={(data.variableType as string) || 'string'}
            onChange={(e) => onChange('variableType', e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="object">object</option>
          </select>
        </div>
      </div>
      <div>
        <FieldLabel>{nodeT('variableValue', language)}</FieldLabel>
        <input type="text" value={(data.variableValue as string) || ''} onChange={(e) => onChange('variableValue', e.target.value)} placeholder={t('wf.valueor', language as Language)} className={INPUT_CLASS} />
      </div>
    </div>
  )
}

function DataTransformEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('expression', language)}</FieldLabel>
        <textarea
          value={(data.transformExpression as string) || ''}
          onChange={(e) => onChange('transformExpression', e.target.value)}
          placeholder="data.map(item => ...)"
          rows={3}
          className={`${TEXTAREA_CLASS} font-mono text-[10px]`}
        />
      </div>
      <div>
        <FieldLabel>{nodeT('outputVar', language)}</FieldLabel>
        <input
          type="text"
          value={(data.outputVar as string) || ''}
          onChange={(e) => onChange('outputVar', e.target.value)}
          placeholder="transformed_data"
          className={INPUT_CLASS}
        />
      </div>
    </div>
  )
}

function KnowledgeQueryEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('knowledgeBase', language)}</FieldLabel>
        <input type="text" value={(data.knowledgeBaseId as string) || ''} onChange={(e) => onChange('knowledgeBaseId', e.target.value)} placeholder={t('wf.selectknowledgebase', language as Language)} className={INPUT_CLASS} />
      </div>
      <div>
        <FieldLabel>{nodeT('queryContent', language)}</FieldLabel>
        <input type="text" value={(data.queryContent as string) || (data.queryContentZh as string) || ''} onChange={(e) => onChange('queryContent', e.target.value)} placeholder={t('wf.querywith', language as Language)} className={INPUT_CLASS} />
      </div>
      <div className="flex gap-2">
        <div className="w-20">
          <FieldLabel>{nodeT('topK', language)}</FieldLabel>
          <input type="number" value={data.topK as number || 5} onChange={(e) => onChange('topK', parseInt(e.target.value) || 5)} min={1} max={20} className={INPUT_CLASS} />
        </div>
        <div className="flex-1">
          <FieldLabel>{nodeT('threshold', language)}</FieldLabel>
          <input type="number" value={data.similarityThreshold as number || 0.7} onChange={(e) => onChange('similarityThreshold', parseFloat(e.target.value) || 0.7)} min={0} max={1} step={0.05} className={INPUT_CLASS} />
        </div>
      </div>
      <div>
        <FieldLabel>{nodeT('outputVar', language)}</FieldLabel>
        <input type="text" value={(data.outputVar as string) || ''} onChange={(e) => onChange('outputVar', e.target.value)} placeholder="knowledge_result" className={INPUT_CLASS} />
      </div>
    </div>
  )
}

function DelayEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  return (
    <div>
      <FieldLabel>{nodeT('delayMs', language)}</FieldLabel>
      <input
        type="number"
        value={data.delayMs as number || 1000}
        onChange={(e) => onChange('delayMs', parseInt(e.target.value) || 0)}
        min={0}
        step={100}
        className={INPUT_CLASS}
      />
      <p className="text-[9px] text-gray-350 mt-0.5">
        {t('wf.unitms1000ms1s', language as Language)}
      </p>
    </div>
  )
}

function WebhookTriggerEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  return (
    <div className="flex gap-2">
      <div className="w-24">
        <FieldLabel>{nodeT('method', language)}</FieldLabel>
        <select value={(data.webhookMethod as string) || 'POST'} onChange={(e) => onChange('webhookMethod', e.target.value)} className={SELECT_CLASS}>
          {['POST', 'GET'].map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </div>
      <div className="flex-1">
        <FieldLabel>{nodeT('path', language)}</FieldLabel>
        <input type="text" value={(data.webhookPath as string) || '/webhook/my-trigger'} onChange={(e) => onChange('webhookPath', e.target.value)} placeholder="/webhook/..." className={INPUT_CLASS} />
      </div>
    </div>
  )
}

function EventWaitEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  return (
    <div className="space-y-2">
      <div>
        <FieldLabel>{nodeT('eventType', language)}</FieldLabel>
        <input type="text" value={(data.eventType as string) || ''} onChange={(e) => onChange('eventType', e.target.value)} placeholder="event.name" className={INPUT_CLASS} />
      </div>
      <div>
        <FieldLabel>{nodeT('eventTimeout', language)}</FieldLabel>
        <input type="number" value={data.eventTimeout as number || 0} onChange={(e) => onChange('eventTimeout', parseInt(e.target.value) || 0)} min={0} step={1000} className={INPUT_CLASS} />
      </div>
    </div>
  )
}

function TextOutputEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('textContent', language)}</FieldLabel>
        <textarea
          value={(data.textContent as string) || ''}
          onChange={(e) => onChange('textContent', e.target.value)}
          placeholder={t('wf.outputtextcontent', language as Language)}
          rows={3}
          className={TEXTAREA_CLASS}
        />
      </div>
      <div>
        <FieldLabel>{nodeT('outputFormat', language)}</FieldLabel>
        <select
          value={(data.outputFormat as string) || 'text'}
          onChange={(e) => onChange('outputFormat', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="text">Plain Text</option>
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
          <option value="json">JSON</option>
        </select>
      </div>
    </div>
  )
}

function FileOutputEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('filePath', language)}</FieldLabel>
        <input type="text" value={(data.filePath as string) || ''} onChange={(e) => onChange('filePath', e.target.value)} placeholder="/path/to/output.txt" className={INPUT_CLASS} />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <FieldLabel>{nodeT('fileFormat', language)}</FieldLabel>
          <select
            value={(data.fileFormat as string) || 'txt'}
            onChange={(e) => onChange('fileFormat', e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="txt">TXT</option>
            <option value="json">JSON</option>
            <option value="csv">CSV</option>
            <option value="xlsx">XLSX</option>
            <option value="pdf">PDF</option>
            <option value="md">Markdown</option>
          </select>
        </div>
        <div className="w-24">
          <FieldLabel>{nodeT('encoding', language)}</FieldLabel>
          <select
            value={(data.encoding as string) || 'utf-8'}
            onChange={(e) => onChange('encoding', e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="utf-8">UTF-8</option>
            <option value="gbk">GBK</option>
            <option value="ascii">ASCII</option>
          </select>
        </div>
      </div>
    </div>
  )
}

function NotificationEditor({ nodeId, data, language = 'zh' }: InlineEditorProps) {
  const onChange = useCallback(
    (key: string, value: unknown) => emitUpdate(nodeId, { [key]: value }),
    [nodeId],
  )
  const recipients = (data.recipients as string[]) || []

  const addRecipient = useCallback(() => {
    onChange('recipients', [...recipients, ''])
  }, [recipients, onChange])

  const updateRecipient = useCallback(
    (idx: number, val: string) => {
      const updated = recipients.map((r, i) => (i === idx ? val : r))
      onChange('recipients', updated)
    },
    [recipients, onChange],
  )

  const removeRecipient = useCallback(
    (idx: number) => {
      onChange('recipients', recipients.filter((_, i) => i !== idx))
    },
    [recipients, onChange],
  )

  return (
    <div className="space-y-2.5">
      <div>
        <FieldLabel>{nodeT('channel', language)}</FieldLabel>
        <select value={(data.notificationChannel as string) || 'system'} onChange={(e) => onChange('notificationChannel', e.target.value)} className={SELECT_CLASS}>
          {Object.entries(NOTIFICATION_CHANNELS).map(([value, labels]) => (
            <option key={value} value={value}>{labels[language] || labels.en}</option>
          ))}
        </select>
      </div>
      <div>
        <FieldLabel>{nodeT('template', language)}</FieldLabel>
        <textarea
          value={(data.notificationTemplate as string) || ''}
          onChange={(e) => onChange('notificationTemplate', e.target.value)}
          placeholder={t('wf.messagetemplatesupports', language as Language)}
          rows={2}
          className={TEXTAREA_CLASS}
        />
      </div>
      <div>
        <FieldLabel>
          {nodeT('recipients', language)} ({recipients.length})
        </FieldLabel>
        <div className="nodrag no-wheel space-y-1 max-h-[100px] overflow-y-auto">
          {recipients.map((r, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                type="text"
                value={r}
                onChange={(e) => updateRecipient(i, e.target.value)}
                placeholder={t('wf.recipientidemail', language as Language)}
                className={`${INPUT_CLASS} flex-1 h-6 text-[10px]`}
              />
              <button
                onClick={() => removeRecipient(i)}
                className="w-5 h-5 flex items-center justify-center rounded text-gray-350 hover:text-red-500 hover:bg-red-50 flex-shrink-0"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <button
          onClick={addRecipient}
          className="mt-1 text-[10px] text-blue-500 hover:text-blue-600 font-medium transition-colors"
        >
          {nodeT('addRecipient', language)}
        </button>
      </div>
    </div>
  )
}

const editorMap: Partial<Record<WorkflowNodeTypeV2, React.ComponentType<InlineEditorProps>>> = {
  agent_task: AgentTaskEditor,
  agent_group: AgentGroupEditor,
  sub_workflow: SubWorkflowEditor,
  user_input: UserInputEditor,
  user_approval: UserApprovalEditor,
  form_collector: FormCollectorEditor,
  condition: ConditionEditor,
  switch_case: SwitchCaseEditor,
  loop: LoopEditor,
  parallel: ParallelEditor,
  merge: MergeEditor,
  tool_call: ToolCallEditor,
  mcp_service: McpServiceEditor,
  code_runner: CodeRunnerEditor,
  http_request: HttpRequestEditor,
  variable_set: VariableSetEditor,
  data_transform: DataTransformEditor,
  knowledge_query: KnowledgeQueryEditor,
  delay: DelayEditor,
  webhook_trigger: WebhookTriggerEditor,
  event_wait: EventWaitEditor,
  text_output: TextOutputEditor,
  file_output: FileOutputEditor,
  notification: NotificationEditor,
}

export function NodeInlineEditor({ nodeType, nodeId, data, language: languageProp }: InlineEditorProps) {
  const storeLanguage = useStore(s => s.language) as 'en' | 'zh'
  const language = languageProp ?? storeLanguage ?? 'zh'
  const EditorComponent = editorMap[nodeType]
  if (!EditorComponent) return null
  return (
    <div className="px-3 pb-2.5">
      <div className="border-t border-gray-100 pt-2">
        <EditorComponent nodeId={nodeId} nodeType={nodeType} data={data} language={language} />
      </div>
    </div>
  )
}