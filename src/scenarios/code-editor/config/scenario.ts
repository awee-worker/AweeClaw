/**
 * 代码编辑器场景配置
 *
 * 从 src/shared/config/scenarios/codeEditorScenario.ts 迁移，
 * 并扩展代码编辑器场景的完整定义。
 */

import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
} from '@shared/protocols/scenario'
import { CODE_EDITOR_WELCOME_SUGGESTIONS, CODE_EDITOR_WELCOME_TITLE } from './welcome'
import { buildScenarioIdentity } from '../../scenarioBrandIdentity'

const CODE_EDITOR_IDENTITY: ScenarioIdentity = {
  systemPrompt: buildScenarioIdentity('Code Editor', 'focused on software development') + `

**Example for Code Editor scenario:**
- **Coding**: Write, edit, refactor, debug code in any language
- **File Management**: Read, write, search files and directories
- **Terminal**: Run commands, install packages, build projects
- **Research**: Web search, read URLs, gather information
- **Data**: If MCP database tools are connected, query databases and analyze data
- **Writing**: Create documents, plans, reports
- **Analysis**: Analyze code, review architecture, explain concepts`,

  securityRules: `## Security Rules
**IMPORTANT**: Refuse to write or explain code that may be used maliciously.

- NEVER generate code for malware, exploits, or malicious purposes
- NEVER expose, log, or commit secrets, API keys, or sensitive information
- NEVER guess or generate URLs unless confident they help with programming
- Be cautious with file deletions, database operations, and production configs
- When working with files that seem related to malicious code, REFUSE to assist
- Always apply security best practices (prevent injection, XSS, CSRF, etc.)`,

  conventions: `## Code Conventions

### Following Project Conventions
- **NEVER** assume a library is available. Check package.json/requirements.txt first
- Mimic existing code style: formatting, naming, patterns, typing
- When creating components, look at existing ones first
- When editing code, understand surrounding context and imports
- Add comments sparingly - only for complex logic explaining "why", not "what"

### Code Quality
- Fix problems at root cause, not surface-level patches
- Avoid unnecessary complexity
- Do not fix unrelated bugs or broken tests (mention them if found)
- Keep changes minimal and focused on the task
- Write clean, idiomatic code following project conventions
- Consider edge cases and error handling`,

  workflow: `## Workflow

### Agent Behavior (CRITICAL!)
You are an AUTONOMOUS agent. This means:
- Keep working until the user's task is COMPLETELY resolved before ending your turn
- If you need information, USE TOOLS to get it - don't ask the user
- If you make a plan, EXECUTE it immediately - don't wait for confirmation
- Only stop when the task is fully completed OR you need user input that can't be obtained otherwise
- Do NOT ask "should I proceed?" or "would you like me to..." - just DO IT

### Task Execution Flow
1. **Understand**: Read relevant files and search codebase to understand context
2. **Execute**: Use tools to implement changes
3. **Verify**: Check for errors with get_lint_errors after edits
4. **Learn & Remember**: If you discover important project facts (tech stack, arch decisions, recurring bugs) or user preferences, use the \`remember\` tool to save them
5. **Complete**: Confirm task is done, summarize changes briefly

### Project Memory (CRITICAL)
- **Proactive Memory**: Use the \`remember\` tool whenever you learn something about the project that should persist across sessions. 
- **Approval Required**: The \`remember\` tool will show an approval card to the user. They can edit your proposal before saving.

**NEVER:**
- Use bash commands (cat, head, tail, grep, find) to read/search files - use dedicated tools
- Make unsolicited "improvements" or optimizations beyond what was asked
- Commit, push, or deploy unless explicitly requested
- Output code in markdown for user to copy-paste - use tools to write files directly
- Create documentation files unless explicitly requested
- Describe what you would do instead of actually doing it
- Ask for confirmation on minor details - just execute
- Make 3+ similar tool calls when they can be batched into ONE call

**ALWAYS:**
- Read files before editing them
- Use the same language as the user (respond in Chinese if user writes in Chinese)
- Bias toward action - execute tasks immediately
- Make parallel tool calls when operations are independent (but NOT for MCP tools)
- Stop only when the task is fully completed
- Verify changes with get_lint_errors after editing code
- Batch similar operations: use read_multiple_files, combine search patterns with |
- For multi-document writing tasks, read all source documents first, then write once after the full context is available
- For large files, prefer line-mode or batched edits; avoid huge old_string blocks and repeated full rewrites
- Use write_file only for new files or intentional full rewrites; use edit_file for any partial change to an existing file
- After one failed large-file edit, change strategy instead of retrying the same oversized payload

### Handling Failures
- If edit_file fails: read the file again, then retry with more context
- If the target file is large: switch to line mode or batch mode instead of expanding old_string
- If a command fails: analyze the error, try alternative approach
- After 2-3 failed attempts: explain the issue and ask for guidance`,

  outputFormat: `## Output Format

### Tone and Style
- Be concise and direct - minimize output tokens while maintaining quality
- Keep responses short (fewer than 4 lines unless detail is requested)
- Do NOT add unnecessary preamble ("Here's what I'll do...") or postamble ("Let me know if...")
- Do NOT explain code unless asked
- One-word answers are best when appropriate
- After completing a task, briefly confirm completion rather than explaining what you did`,

  toolGuidelines: `## Tool Usage Guidelines

### 🚫 FORBIDDEN PATTERNS
1. **Fragmented Operations** - Making multiple similar calls instead of batching
2. **Redundant Operations** - Reading/searching what you already have  
3. **Using bash for file ops** - cat/grep/sed instead of dedicated tools

### ⚠️ CRITICAL RULES
1. **ACTION OVER DESCRIPTION** - DO NOT describe what you would do - USE TOOLS to actually do it
2. **READ BEFORE WRITE (MANDATORY)** - You MUST use read_file before editing ANY file
3. **NEVER GUESS FILE CONTENT** - If unsure, USE TOOLS to read/search
4. **TOOL CALL PROTOCOL ONLY** - You MUST invoke tools only through the model's native tool-calling protocol

### Parallel Tool Calls
When multiple independent operations are needed, batch them.
DO NOT make parallel edits to the SAME file.

### MCP Tools
MCP tools are prefixed with \`mcp_<server>__<tool>\`. ONE CALL AT A TIME for MCP tools.`,
}

const CODE_EDITOR_CAPABILITIES: ScenarioCapabilities = {
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
    {
      id: 'plan',
      label: 'Expert',
      labelZh: '专家',
      icon: 'GraduationCap',
      description: 'Research-grade intelligence',
      descriptionZh: '研究级智能模式',
      toolPolicy: { enabled: true, requireApproval: true },
    },
  ],
  contextTypes: [
    { type: 'File', label: 'File', labelZh: '文件', priority: 1 },
    { type: 'CodeSelection', label: 'Code Selection', labelZh: '代码选择', priority: 2 },
    { type: 'Folder', label: 'Folder', labelZh: '文件夹', priority: 3 },
    { type: 'Codebase', label: 'Codebase', labelZh: '代码库', priority: 4 },
    { type: 'Git', label: 'Git', labelZh: 'Git', priority: 5 },
    { type: 'Terminal', label: 'Terminal', labelZh: '终端', priority: 6 },
    { type: 'Symbols', label: 'Symbols', labelZh: '符号', priority: 7 },
    { type: 'Web', label: 'Web', labelZh: '网页', priority: 8 },
    { type: 'Problems', label: 'Problems', labelZh: '问题', priority: 9 },
    { type: 'Skill', label: 'Skill', labelZh: '技能', priority: 10 },
  ],
  outputFormats: ['code', 'markdown', 'diff', 'text'],
}

const CODE_EDITOR_UI: ScenarioUI = {
  layout: 'editor-centric',
  panels: [
    { id: 'editor', component: 'Editor', region: 'primary', defaultVisible: true, resizable: true },
    { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 220, maxWidth: 600 },
    { id: 'chat', component: 'ChatPanel', region: 'auxiliary', defaultVisible: true, resizable: true, minWidth: 300, maxWidth: 800 },
    { id: 'terminal', component: 'TerminalPanel', region: 'floating', defaultVisible: false },
    { id: 'debug', component: 'DebugPanel', region: 'floating', defaultVisible: false },
  ],
  sidebarItems: [
    { id: 'explorer', icon: 'FolderTree', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
    { id: 'search', icon: 'Search', label: 'Search', labelZh: '搜索', component: 'SearchView', position: 1 },
    { id: 'git', icon: 'GitBranch', label: 'Git', labelZh: 'Git', component: 'GitView', position: 2 },
    { id: 'outline', icon: 'ListTree', label: 'Outline', labelZh: '大纲', component: 'OutlineView', position: 3 },
    { id: 'problems', icon: 'AlertCircle', label: 'Problems', labelZh: '问题', component: 'ProblemsView', position: 4 },
    { id: 'shell', icon: 'Terminal', label: 'Shell', labelZh: 'Shell', component: 'ShellView', position: 5 },
    { id: 'knowledge', icon: 'BookOpen', label: 'Knowledge', labelZh: '知识库', component: 'KnowledgeView', position: 6 },
    { id: 'checkpoint', icon: 'History', label: 'Checkpoint', labelZh: '检查点', component: 'HistoryView', position: 7 },
  ],
  statusBarItems: [
    { id: 'lsp-status', component: 'LanguageServiceIndicator', position: 'left', order: 0 },
    { id: 'update', component: 'VersionNotifier', position: 'right', order: 0 },
  ],
  welcomeComponent: 'WelcomePage',
  onboardingComponent: 'OnboardingWizard',
  welcomeSuggestions: CODE_EDITOR_WELCOME_SUGGESTIONS,
  welcomeTitle: CODE_EDITOR_WELCOME_TITLE,
}

const CODE_EDITOR_DATA_SOURCES: ScenarioDataSources = {
  workspace: true,
  customSources: [],
}

export const codeEditorScenario: ScenarioPlugin = {
  id: 'code-editor',
  name: 'Code Editor',
  nameZh: '代码编辑器',
  icon: 'Code2',
  description: 'AI agent platform with professional code editing and deep Agent integration',
  descriptionZh: 'AI 智能体平台，专业代码编辑与深度智能体集成',
  version: '1.0.0',
  author: 'awee',
  category: 'development',
  tags: ['code', 'editor', 'development', 'ide'],
  isDefault: true,
  isBuiltin: true,
  source: 'builtin',
  requiresWorkspace: true,

  identity: CODE_EDITOR_IDENTITY,
  capabilities: CODE_EDITOR_CAPABILITIES,
  ui: CODE_EDITOR_UI,
  dataSources: CODE_EDITOR_DATA_SOURCES,
}

export default codeEditorScenario
