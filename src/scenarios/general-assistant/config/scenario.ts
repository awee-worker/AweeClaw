/**
 * 通用助手场景配置
 *
 * 从 src/shared/config/scenarios/generalAssistantScenario.ts 迁移，
 * 并扩展通用助手场景的完整定义。
 */

import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
} from '@shared/types/scenario'
import { GENERAL_ASSISTANT_WELCOME_SUGGESTIONS, GENERAL_ASSISTANT_WELCOME_TITLE } from './welcome'
import { buildScenarioIdentity } from '../../scenarioBrandIdentity'

const GENERAL_ASSISTANT_IDENTITY: ScenarioIdentity = {
  systemPrompt: buildScenarioIdentity('General Assistant', 'versatile AI for any task') + `

**Example for General Assistant scenario:**
- **Q&A**: Answer questions on any topic with accuracy and depth
- **Research**: Web search, read URLs, gather and synthesize information
- **Writing**: Create documents, outlines, emails, reports, creative content
- **Planning**: Break down complex tasks, create project plans, decision analysis
- **Analysis**: Analyze information, provide summaries, pros/cons comparisons
- **Data**: If MCP database tools are connected, query databases and analyze data
- **Coding**: If needed, write and edit code, run terminal commands`,

  securityRules: `## Security Rules
- Provide accurate information; acknowledge uncertainty
- Never generate harmful, illegal, or unethical content
- Respect privacy: don't share or store personal information
- Flag potential misinformation or unverified claims
- Be transparent about AI limitations`,

  conventions: `## General Conventions
- Be concise but thorough
- Adapt communication style to the user's needs
- Provide sources when making factual claims
- Offer multiple perspectives on complex topics
- Structure responses for readability
- Ask clarifying questions when the request is ambiguous`,

  workflow: `## Workflow

### Task Flow
1. **Understand**: Clarify the user's goal and constraints
2. **Research**: Gather relevant information using available tools
3. **Execute**: Complete the task using appropriate methods
4. **Verify**: Review the result for accuracy and completeness
5. **Deliver**: Present the result clearly

### Agent Behavior
- Keep working until the task is COMPLETE
- If you need information, USE TOOLS to find it
- Break complex tasks into manageable steps
- Provide progress updates for long-running tasks`,

  outputFormat: `## Output Format
- Use clear headings and structure
- Include bullet points for lists
- Provide summaries for long content
- Use tables for comparisons
- Keep responses focused and relevant`,

  toolGuidelines: `## Tool Usage Guidelines
- Use web_search for research and fact-checking
- Use read_url to access web content
- Use write_file to save documents
- Use read_file to review existing content
- Use run_command for calculations and processing
- Use todo_write for task tracking`,
}

const GENERAL_ASSISTANT_CAPABILITIES: ScenarioCapabilities = {
  toolPacks: ['code'],
  modes: [
    {
      id: 'chat',
      label: 'Chat',
      labelZh: '对话',
      icon: 'MessageSquare',
      description: 'Quick Q&A and conversation',
      descriptionZh: '快速问答和对话',
      toolPolicy: { enabled: false },
    },
    {
      id: 'agent',
      label: 'Agent',
      labelZh: '智能体',
      icon: 'Sparkles',
      description: 'Autonomous task execution with tools',
      descriptionZh: '自主任务执行，工具调用',
      toolPolicy: { enabled: true, requireApproval: false },
    },
  ],
  contextTypes: [
    { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
    { type: 'Folder', label: 'Folder', labelZh: '文件夹', priority: 2 },
    { type: 'Web', label: 'Web', labelZh: '网页', priority: 3 },
    { type: 'Terminal', label: 'Terminal', labelZh: '终端', priority: 4 },
  ],
  outputFormats: ['markdown', 'text', 'code', 'html'],
}

const GENERAL_ASSISTANT_UI: ScenarioUI = {
  layout: 'chat-centric',
  panels: [
    { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: false },
    { id: 'terminal', component: 'TerminalPanel', region: 'floating', defaultVisible: false },
  ],
  sidebarItems: [
    { id: 'explorer', icon: 'Files', label: 'Explorer', labelZh: '资源管理器', component: 'ExplorerView', position: 0 },
    { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 1 },
    { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 2 },
  ],
  statusBarItems: [],
  welcomeComponent: 'GeneralWelcomePage',
  welcomeSuggestions: GENERAL_ASSISTANT_WELCOME_SUGGESTIONS,
  welcomeTitle: GENERAL_ASSISTANT_WELCOME_TITLE,
}

const GENERAL_ASSISTANT_DATA_SOURCES: ScenarioDataSources = {
  workspace: false,
  customSources: [
    {
      id: 'web',
      type: 'api',
      label: 'Web Search',
      labelZh: '网页搜索',
      config: { provider: 'builtin' },
    },
  ],
}

export const generalAssistantScenario: ScenarioPlugin = {
  id: 'general-assistant',
  name: 'General Assistant',
  nameZh: '通用助手',
  icon: 'Sparkles',
  description: 'Versatile AI assistant for any task - Q&A, research, planning, and more',
  descriptionZh: '通用 AI 助手，适用于任何任务 - 问答、研究、规划等',
  version: '1.0.0',
  author: 'awee',
  category: 'productivity',
  tags: ['general', 'assistant', 'q&a', 'research', 'planning'],
  isDefault: true,
  isBuiltin: true,
  source: 'builtin',
  requiresWorkspace: false,

  identity: GENERAL_ASSISTANT_IDENTITY,
  capabilities: GENERAL_ASSISTANT_CAPABILITIES,
  ui: GENERAL_ASSISTANT_UI,
  dataSources: GENERAL_ASSISTANT_DATA_SOURCES,
}

export default generalAssistantScenario
