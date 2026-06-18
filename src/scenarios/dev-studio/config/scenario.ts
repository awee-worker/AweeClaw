/**
 * 开发工作室（dev-studio）场景配置
 *
 * 面向完整的在线开发工作流，支持项目脚手架、多 Agent 协作、构建部署。
 */
import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
} from '@shared/protocols/scenario'
import { DEV_STUDIO_WELCOME_SUGGESTIONS, DEV_STUDIO_WELCOME_TITLE } from './welcome'
import { buildScenarioIdentity } from '../../scenarioBrandIdentity'

const DEV_STUDIO_IDENTITY: ScenarioIdentity = {
  systemPrompt: buildScenarioIdentity('Dev Studio', 'focused on project-level development, scaffolding, multi-agent collaboration, and full development lifecycle') + `

**Example for Dev Studio scenario:**
- **Project Scaffolding**: Create new projects from templates (Next.js, Vite, Express, Vue, etc.)
- **Multi-Agent Development**: Coordinate PM, Coder, Reviewer, Tester, and DevOps agents
- **Full Lifecycle**: Development → Build → Test → Deploy in one workflow
- **Code Editing**: Full IDE capabilities with Monaco Editor, LSP, and Git integration
- **Terminal**: Run commands, install packages, manage dependencies
- **Preview**: Live preview of web applications during development
- **Deployment**: Deploy to Vercel, Netlify, Cloudflare, or custom servers`,

  securityRules: `## Security Rules
**IMPORTANT**: Refuse to write or explain code that may be used maliciously.

- NEVER generate code for malware, exploits, or malicious purposes
- NEVER expose, log, or commit secrets, API keys, or sensitive information
- NEVER guess or generate URLs unless confident they help with programming
- Be cautious with file deletions, database operations, and production configs
- When working with files that seem related to malicious code, REFUSE to assist
- Always apply security best practices (prevent injection, XSS, CSRF, etc.)
- Sanitize user inputs in generated code
- Use environment variables for sensitive configuration`,

  conventions: `## Code Conventions

### Project Scaffolding
- Choose the right template for the project type
- Use TypeScript by default unless explicitly declined
- Include ESLint and Prettier for code quality
- Set up proper .gitignore and README
- Use semantic versioning for dependencies

### Multi-Agent Workflow
- PM Agent: Analyze requirements → Break into tasks → Create task board
- Coder Agent: Implement tasks following project conventions
- Reviewer Agent: Review code quality, security, and performance
- Tester Agent: Write and run tests, report coverage
- DevOps Agent: Build, preview, deploy, and monitor

### Code Quality
- Follow existing project conventions and patterns
- Write clean, maintainable, production-ready code
- Handle edge cases and error states properly
- Add comments only for complex logic explaining "why"
- Use appropriate typing and avoid 'any' when possible`,

  workflow: `## Workflow

### Project Development Flow
1. **Scaffold**: Create project from template (list_templates → scaffold_project)
2. **Plan**: PM Agent breaks down requirements into tasks
3. **Implement**: Coder Agent implements tasks one by one
4. **Review**: Reviewer Agent checks code quality
5. **Test**: Tester Agent writes and runs tests
6. **Build**: Build project for production
7. **Deploy**: Deploy to target platform

### Agent Behavior (CRITICAL!)
You are an AUTONOMOUS agent. This means:
- Keep working until the user's task is COMPLETELY resolved
- If you need information, USE TOOLS to get it
- If you make a plan, EXECUTE it immediately
- Do NOT ask "should I proceed?" - just DO IT

### Task Execution
1. Understand the full scope
2. Read relevant files and codebase context
3. Execute changes with appropriate tools
4. Verify with linting and testing
5. Confirm completion with brief summary`,

  outputFormat: `## Output Format

### Tone and Style
- Be concise and direct
- Keep responses short and actionable
- Do NOT explain code unless asked
- After completing a task, briefly confirm completion

### Tool Usage
- Use scaffold_project for creating new projects
- Use list_templates to browse available templates
- Use get_project_info to check project details
- Use create_dev_session for multi-agent collaboration
- Batch parallel operations when possible`,

  toolGuidelines: `## Dev Studio Tool Guidelines

### Available Tools
- **scaffold_project**: Create new projects from templates
- **list_templates**: Browse available project templates
- **get_project_info**: Get project details and status
- **create_dev_session**: Start a multi-agent development session
- **add_session_task**: Add tasks to the development board
- **run_dev_server**: Start development server
- **run_build**: Build project for production
- **run_test**: Run project tests
- **deploy_project**: Deploy to target platform

### Workflow Tools
Use these tools in sequence for end-to-end development:
1. list_templates → scaffold_project → get_project_info
2. create_dev_session → add_session_task (multiple) → run_dev_server
3. run_test → run_build → deploy_project`,
}

const DEV_STUDIO_CAPABILITIES: ScenarioCapabilities = {
  toolPacks: ['code', 'studio'],
  modes: [
    {
      id: 'chat',
      label: 'Quick',
      labelZh: '快速',
      icon: 'Zap',
      description: 'Quick project creation and edits',
      descriptionZh: '快速创建项目和编辑',
      toolPolicy: { enabled: true, requireApproval: false },
    },
    {
      id: 'agent',
      label: 'Think',
      labelZh: '思考',
      icon: 'Brain',
      description: 'Complex multi-file development',
      descriptionZh: '复杂多文件开发',
      toolPolicy: { enabled: true, requireApproval: true },
    },
    {
      id: 'plan',
      label: 'Expert',
      labelZh: '专家',
      icon: 'GraduationCap',
      description: 'Research-grade multi-agent collaboration',
      descriptionZh: '研究级多 Agent 协作开发',
      toolPolicy: { enabled: true, requireApproval: true },
    },
  ],
  contextTypes: [
    { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
    { type: 'Folder', label: 'Folder', labelZh: '文件夹', priority: 2 },
    { type: 'CodeSelection', label: 'Code Selection', labelZh: '代码选择', priority: 3 },
    { type: 'Project', label: 'Project', labelZh: '项目', priority: 4 },
    { type: 'Codebase', label: 'Codebase', labelZh: '代码库', priority: 5 },
    { type: 'Git', label: 'Git', labelZh: 'Git', priority: 6 },
    { type: 'Terminal', label: 'Terminal', labelZh: '终端', priority: 7 },
    { type: 'Web', label: 'Web', labelZh: '网页', priority: 8 },
    { type: 'Problems', label: 'Problems', labelZh: '问题', priority: 9 },
  ],
  outputFormats: ['code', 'markdown', 'diff', 'text', 'json'],
}

const DEV_STUDIO_UI: ScenarioUI = {
  layout: 'editor-centric',
  wideModeHidesChat: false,
  panels: [
    { id: 'editor', component: 'Editor', region: 'primary', defaultVisible: true, resizable: true },
    { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 170, maxWidth: 600 },
    { id: 'chat', component: 'ChatPanel', region: 'auxiliary', defaultVisible: true, resizable: true, minWidth: 300, maxWidth: 800 },
    { id: 'terminal', component: 'TerminalPanel', region: 'floating', defaultVisible: false },
    { id: 'debug', component: 'DebugPanel', region: 'floating', defaultVisible: false },
  ],
  sidebarItems: [
    { id: 'explorer', icon: 'FolderTree', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
    { id: 'search', icon: 'Search', label: 'Search', labelZh: '搜索', component: 'SearchView', position: 1 },
    { id: 'git', icon: 'GitBranch', label: 'Git', labelZh: 'Git', component: 'GitView', position: 2 },
    { id: 'agent-panel', icon: 'Users', label: 'Agent Panel', labelZh: 'Agent 面板', component: 'AgentDevPanel', position: 3, wideMode: true },
    { id: 'preview', icon: 'Monitor', label: 'Preview', labelZh: '预览', component: 'PreviewPanel', position: 4, wideMode: true },
    { id: 'outline', icon: 'ListTree', label: 'Outline', labelZh: '大纲', component: 'OutlineView', position: 5 },
    { id: 'problems', icon: 'AlertCircle', label: 'Problems', labelZh: '问题', component: 'ProblemsView', position: 6 },
    { id: 'shell', icon: 'Terminal', label: 'Shell', labelZh: 'Shell', component: 'ShellView', position: 7 },
    { id: 'pipeline', icon: 'Workflow', label: 'Pipeline', labelZh: '流水线', component: 'PipelinePanel', position: 8, wideMode: true },
    { id: 'deploy', icon: 'Cloud', label: 'Deploy', labelZh: '部署', component: 'DeployPanel', position: 9, wideMode: true },
    { id: 'settings', icon: 'Settings', label: 'Studio Settings', labelZh: '工作室设置', component: 'StudioSettingsView', position: 10, wideMode: true },
  ],
  statusBarItems: [
    { id: 'studio-project', component: 'StudioStatusBar', position: 'left', order: 0 },
    { id: 'lsp-status', component: 'LanguageServiceIndicator', position: 'left', order: 1 },
    { id: 'update', component: 'VersionNotifier', position: 'right', order: 0 },
  ],
  welcomeComponent: 'StudioWelcomePage',
  welcomeSuggestions: DEV_STUDIO_WELCOME_SUGGESTIONS,
  welcomeTitle: DEV_STUDIO_WELCOME_TITLE,
}

const DEV_STUDIO_DATA_SOURCES: ScenarioDataSources = {
  workspace: true,
  customSources: [],
}

export const devStudioScenario: ScenarioPlugin = {
  id: 'dev-studio',
  name: 'Dev Studio',
  nameZh: '开发工作室',
  icon: 'Rocket',
  description: 'Online development studio — project scaffolding, multi-agent collaboration, and full development lifecycle',
  descriptionZh: '在线开发工作室，支持项目脚手架、多 Agent 协作开发、全流程闭环',
  version: '0.1.0',
  author: 'awee',
  category: 'development',
  tags: ['studio', 'scaffold', 'agent', 'pipeline', 'deploy', 'development'],
  isDefault: false,
  isBuiltin: true,
  source: 'builtin',
  requiresWorkspace: true,

  identity: DEV_STUDIO_IDENTITY,
  capabilities: DEV_STUDIO_CAPABILITIES,
  ui: DEV_STUDIO_UI,
  dataSources: DEV_STUDIO_DATA_SOURCES,
}

export default devStudioScenario