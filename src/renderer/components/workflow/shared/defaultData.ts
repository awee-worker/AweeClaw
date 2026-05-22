import type { WorkflowNodeTypeV2, WorkflowNodeData, WorkflowNodeV2, WorkflowEdgeV2 } from '@shared/protocols/workflowV2'
import { NODE_TYPE_LABELS } from '@shared/protocols/workflowV2'

function generateNodeId(): string {
  return `node-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export function createDefaultNodeData(type: WorkflowNodeTypeV2): WorkflowNodeData {
  switch (type) {
    case 'agent_task':
      return {
        roleId: '',
        systemPrompt: '',
        chatMode: 'agent',
        temperature: 0.7,
        boundTools: [],
        boundMcpServers: [],
        boundMcpTools: [],
        description: '请帮我分析用户请求并给出专业回答',
        outputVar: 'agentReply',
        timeout: 120000,
      }
    case 'agent_group':
      return {
        groupRoles: [],
        collaborationMode: 'sequential',
        maxRounds: 3,
        description: '多个专家角色协作讨论并达成一致',
        outputVar: 'groupResult',
        timeout: 300000,
      }
    case 'sub_workflow':
      return {
        subWorkflowId: '',
        inputMapping: {},
        outputMapping: {},
        description: '调用另一个已发布的工作流',
        outputVar: 'subResult',
      }
    case 'user_input':
      return {
        inputType: 'text',
        description: '请用户输入必要的信息',
        outputVar: 'userInput',
      }
    case 'user_approval':
      return {
        approvalTimeout: 3600000,
        approvalAutoAction: 'pause',
        description: '等待负责人审批后继续执行',
        outputVar: 'approval',
      }
    case 'form_collector':
      return {
        formFields: [],
        description: '收集结构化表单数据',
        outputVar: 'formData',
      }
    case 'condition':
      return {
        conditions: [],
        description: '根据条件决定下一步走向',
      }
    case 'switch_case':
      return {
        switchCases: [],
        description: '根据变量值路由到不同分支',
      }
    case 'loop':
      return {
        loopMaxIterations: 10,
        loopVariable: 'item',
        description: '遍历列表中的每一项',
        outputVar: 'loopResult',
      }
    case 'parallel':
      return {
        parallelStrategy: 'all',
        description: '同时执行多个任务并行处理',
      }
    case 'merge':
      return {
        mergeStrategy: 'all',
        description: '等待所有并行分支完成后合并结果',
      }
    case 'tool_call':
      return {
        toolName: '',
        toolArgs: {},
        description: '调用系统内置工具完成特定操作',
        outputVar: 'toolResult',
      }
    case 'mcp_service':
      return {
        mcpServerId: '',
        mcpToolName: '',
        description: '调用 MCP 服务器提供的远程工具',
        outputVar: 'mcpResult',
        timeout: 60000,
      }
    case 'code_runner':
      return {
        codeLanguage: 'javascript',
        codeSnippet: `// 从 inputVars 中获取输入数据
// 使用 return 返回结果

const input = $input || {};
// 在此编写你的处理逻辑
const result = input;
return result;`,
        codeInputVars: [],
        codeOutputVars: [],
        description: '执行自定义 JavaScript 或 Python 代码',
        outputVar: 'codeResult',
        timeout: 30000,
      }
    case 'http_request':
      return {
        httpMethod: 'GET',
        httpUrl: 'https://api.example.com/data',
        httpHeaders: { 'Content-Type': 'application/json' },
        httpBody: '',
        httpAuth: { type: 'none' },
        description: '向外部 API 发送 HTTP 请求获取数据',
        outputVar: 'httpResponse',
        timeout: 30000,
      }
    case 'variable_set':
      return {
        variableName: 'myVariable',
        variableValue: '',
        description: '设置一个工作流变量供后续节点使用',
      }
    case 'data_transform':
      return {
        transformExpression: 'data.map(item => ({ name: item.name, count: item.value }))',
        description: '对数据进行格式转换或筛选处理',
        outputVar: 'transformed',
      }
    case 'knowledge_query':
      return {
        knowledgeBaseId: '',
        topK: 5,
        similarityThreshold: 0.7,
        description: '从知识库中检索最相关的文档片段',
        outputVar: 'queryResult',
      }
    case 'delay':
      return {
        delayMs: 1000,
        description: '暂停一段时间后继续执行',
      }
    case 'webhook_trigger':
      return {
        webhookMethod: 'POST',
        webhookPath: '/webhook/my-trigger',
        description: '通过 Webhook 接收外部事件启动工作流',
      }
    case 'event_wait':
      return {
        eventType: '',
        eventTimeout: 0,
        description: '等待某个特定事件发生后再继续',
      }
    case 'text_output':
      return {
        textContent: '',
        description: '将文本内容输出给用户',
      }
    case 'file_output':
      return {
        filePath: '',
        description: '将结果写入到文件中',
      }
    case 'notification':
      return {
        notificationChannel: 'system',
        notificationTemplate: '',
        description: '向用户推送通知消息',
      }
    default:
      return {
        outputVar: 'result',
      }
  }
}

export function createDefaultNode(type: WorkflowNodeTypeV2, index: number, position?: { x: number; y: number }): WorkflowNodeV2 {
  const labels = NODE_TYPE_LABELS[type]
  const nameZh = labels?.zh || labels?.en || String(type)
  const nameEn = labels?.en || String(type)
  return {
    id: generateNodeId(),
    type,
    name: nameEn,
    nameZh,
    position: position || { x: 250 + index * 50, y: 100 + index * 120 },
    data: {
      ...createDefaultNodeData(type),
      _expanded: true,
    },
  }
}

export function createDefaultEdge(source: string, target: string, options?: Partial<WorkflowEdgeV2>): WorkflowEdgeV2 {
  return {
    id: `edge-${source}-${target}-${Date.now()}`,
    source,
    target,
    type: 'default',
    ...options,
  }
}