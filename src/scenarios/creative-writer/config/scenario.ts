/**
 * 创意写作场景配置
 *
 * 从 src/shared/config/scenarios/creativeWriterScenario.ts 迁移，
 * 并扩展创意写作场景的完整定义。
 */

import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
} from '@shared/protocols/scenario'
import { CREATIVE_WRITER_WELCOME_SUGGESTIONS, CREATIVE_WRITER_WELCOME_TITLE } from './welcome'
import { buildScenarioIdentity } from '../../scenarioBrandIdentity'

const CREATIVE_WRITER_IDENTITY: ScenarioIdentity = {
  systemPrompt: buildScenarioIdentity('Creative Writer', 'focused on creative writing and content creation') + `

**Example for Creative Writer scenario:**
- **Creative Writing**: Generate and refine stories, articles, scripts, poetry
- **Editing**: Structural editing, developmental feedback, style refinement
- **Content Strategy**: Outlines, character profiles, world-building documents
- **Research**: Web search, gather information for factual accuracy
- **Optimization**: Adapt content for different platforms and audiences
- **Data**: If MCP database tools are connected, access reference data
- **Coding**: If needed, write and edit code for content tools`,

  securityRules: `## Security Rules
- Respect copyright: never reproduce substantial portions of copyrighted works
- Flag potentially harmful or misleading content
- Respect user privacy: don't store or share personal information from drafts
- Acknowledge AI-generated content when appropriate`,

  conventions: `## Creative Writing Conventions
- Match the requested style, tone, and voice precisely
- Maintain consistency in characters, settings, and timelines
- Show rather than tell: use vivid, sensory language
- Vary sentence structure and rhythm for readability
- Respect genre conventions while offering creative twists
- Provide constructive feedback that preserves the author's voice
- Use active voice by default, passive voice intentionally`,

  workflow: `## Workflow

### Writing Flow
1. **Understand**: Clarify the writing goal, audience, style, and format
2. **Plan**: Create outlines, character sheets, or content structures
3. **Draft**: Generate initial content based on the plan
4. **Refine**: Edit for clarity, style, consistency, and impact
5. **Polish**: Final review for grammar, flow, and formatting

### Agent Behavior
- Keep working until the writing task is COMPLETE
- If you need context, USE TOOLS to research
- Offer alternatives when creative choices are ambiguous
- Respect the user's creative vision and preferences`,

  outputFormat: `## Output Format
- Present creative content in clearly formatted sections
- Use markdown for structure (headings, lists, emphasis)
- Include word counts for longer pieces
- Provide brief rationale for significant creative choices
- Offer revision suggestions separately from the main content`,

  toolGuidelines: `## Tool Usage Guidelines
- Use web_search for research and fact-checking
- Use read_url to access reference materials
- Use write_file to save drafts and documents
- Use read_file to review and edit existing content
- Use run_command for word counting and text processing`,
}

const CREATIVE_WRITER_CAPABILITIES: ScenarioCapabilities = {
  toolPacks: ['code'],
  modes: [
    {
      id: 'chat',
      label: 'Quick',
      labelZh: '快速',
      icon: 'Zap',
      description: 'Suitable for most situations',
      descriptionZh: '适用于大部分情况',
      toolPolicy: { enabled: true, requireApproval: false },
    },
    {
      id: 'agent',
      label: 'Think',
      labelZh: '思考',
      icon: 'Brain',
      description: 'Excels at harder problems',
      descriptionZh: '擅长解决更难的问题',
      toolPolicy: { enabled: true, requireApproval: true },
    },
  ],
  contextTypes: [
    { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
    { type: 'Folder', label: 'Folder', labelZh: '文件夹', priority: 2 },
    { type: 'Web', label: 'Web', labelZh: '网页', priority: 3 },
  ],
  outputFormats: ['markdown', 'text', 'html', 'docx'],
}

const CREATIVE_WRITER_UI: ScenarioUI = {
  layout: 'editor-centric',
  panels: [
    { id: 'editor', component: 'Editor', region: 'primary', defaultVisible: true, resizable: true },
    { id: 'outline', component: 'WritingOutline', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 200, maxWidth: 400 },
    { id: 'chat', component: 'ChatPanel', region: 'auxiliary', defaultVisible: true, resizable: true, minWidth: 300, maxWidth: 800 },
  ],
  sidebarItems: [
    { id: 'explorer', icon: 'Files', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
    { id: 'outline', icon: 'ListTree', label: 'Outline', labelZh: '大纲', component: 'OutlineView', position: 1 },
    { id: 'characters', icon: 'Users', label: 'Characters', labelZh: '角色', component: 'CharacterView', position: 2 },
    { id: 'research', icon: 'Search', label: 'Research', labelZh: '研究', component: 'ResearchView', position: 3 },
    { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 4 },
    { id: 'history', icon: 'History', label: 'Versions', labelZh: '版本', component: 'VersionHistoryView', position: 5 },
  ],
  statusBarItems: [
    { id: 'word-count', component: 'WordCountIndicator', position: 'left', order: 0 },
  ],
  welcomeComponent: 'WritingWelcomePage',
  welcomeSuggestions: CREATIVE_WRITER_WELCOME_SUGGESTIONS,
  welcomeTitle: CREATIVE_WRITER_WELCOME_TITLE,
}

const CREATIVE_WRITER_DATA_SOURCES: ScenarioDataSources = {
  workspace: true,
  customSources: [],
}

export const creativeWriterScenario: ScenarioPlugin = {
  id: 'creative-writer',
  name: 'Creative Writer',
  nameZh: '创意写作',
  icon: 'PenTool',
  description: 'Fiction, copywriting, content creation, and editorial assistance',
  descriptionZh: '小说、文案、内容创作和编辑辅助',
  version: '1.0.0',
  author: 'awee',
  category: 'creative',
  tags: ['writing', 'creative', 'fiction', 'copywriting', 'content'],
  isBuiltin: true,
  source: 'builtin',
  requiresWorkspace: false,

  identity: CREATIVE_WRITER_IDENTITY,
  capabilities: CREATIVE_WRITER_CAPABILITIES,
  ui: CREATIVE_WRITER_UI,
  dataSources: CREATIVE_WRITER_DATA_SOURCES,
}

export default creativeWriterScenario
