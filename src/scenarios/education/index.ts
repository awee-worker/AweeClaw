import type {
  ScenarioModule,
  ScenarioModuleContext,
  ScenarioManifest,
  ScenarioHealthCheck,
  ScenarioDependency,
} from '@shared/protocols/scenario-arch'
import type { ScenarioPlugin } from '@shared/protocols/scenario'
import { EDUCATION_WELCOME_SUGGESTIONS, EDUCATION_WELCOME_TITLE } from './config/welcome'
import { buildScenarioIdentity } from '../scenarioBrandIdentity'
import EDUCATION_TOOLS from './tools/definitions'
import { educationComponents } from './components'

const SCENARIO_ID = 'education'
const SCENARIO_VERSION = '1.0.0'

const EDUCATION_MANIFEST: ScenarioManifest = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,
  name: 'Education Assistant',
  nameZh: '教育助手',
  description: 'AI-powered learning, tutoring, and knowledge exploration',
  descriptionZh: 'AI 驱动的学习、辅导和知识探索',
  author: 'awee',
  icon: 'GraduationCap',
  category: 'education',
  tags: ['education', 'learning', 'tutoring', 'quiz'],
  minAppVersion: '1.7.0',
  entryPoint: './index.ts',
  dependencies: [],
  permissions: ['filesystem:read', 'filesystem:write'],
}

const EDUCATION_PLUGIN: ScenarioPlugin = {
  id: SCENARIO_ID,
  name: 'Education Assistant',
  nameZh: '教育助手',
  icon: 'GraduationCap',
  description: 'AI-powered learning, tutoring, and knowledge exploration',
  descriptionZh: 'AI 驱动的学习、辅导和知识探索',
  version: SCENARIO_VERSION,
  author: 'awee',
  category: 'education',
  tags: ['education', 'learning', 'tutoring', 'quiz'],
  isBuiltin: true,
  source: 'builtin',
  requiresWorkspace: false,

  identity: {
    systemPrompt: buildScenarioIdentity('Education Assistant', 'focused on learning and knowledge transfer') + `

**Core Education Capabilities:**
- **Topic Explanation**: Break down complex topics into digestible explanations
- **Adaptive Tutoring**: Adjust teaching style to learner's level and progress
- **Quiz Generation**: Create assessments with varying difficulty levels
- **Study Planning**: Design structured learning paths with milestones
- **Concept Mapping**: Visualize relationships between concepts
- **Practice Problems**: Generate exercises with step-by-step solutions
- **Progress Tracking**: Monitor learning progress with spaced repetition`,

    securityRules: `## Education Scenario Security Rules
- Present information accurately and cite sources when possible
- Acknowledge uncertainty rather than presenting guesses as facts
- Adapt content to be age-appropriate when working with younger learners
- Never encourage academic dishonesty or plagiarism
- Respect diverse learning styles and accessibility needs
- Flag content that may require professional educational guidance`,

    conventions: `## Education Content Conventions
- Use clear, jargon-free language with progressive complexity
- Structure explanations with headings, examples, and summaries
- Include analogies and real-world applications
- Provide multiple representations (verbal, visual, mathematical)
- Use Socratic questioning to guide discovery learning
- Number steps in procedures and solutions
- Include "Key Takeaways" sections for summaries`,

    workflow: `## Education Workflow

### Topic Explanation Flow
1. **Assess**: Determine learner's current understanding level
2. **Explain**: Present core concepts with clear structure
3. **Illustrate**: Provide examples, analogies, and visual aids
4. **Check**: Verify understanding with targeted questions
5. **Deepen**: Expand to related concepts and applications

### Quiz Generation Flow
1. **Scope**: Identify topics and difficulty level
2. **Generate**: Create diverse question types (MC, short answer, essay)
3. **Answer**: Provide correct answers with explanations
4. **Rationale**: Explain why each answer is correct/incorrect
5. **Remediate**: Suggest study areas for missed questions

### Study Planning Flow
1. **Goal**: Understand learning objectives and timeline
2. **Assess**: Evaluate current knowledge and gaps
3. **Plan**: Create structured plan with milestones
4. **Resources**: Recommend learning materials and exercises
5. **Review**: Schedule periodic assessments and adjustments`,

    outputFormat: `## Education Output Format
- Use progressive disclosure: simple → complex
- Include visual structure: headings, bullet points, numbered steps
- Add "💡 Tip" and "⚠️ Common Mistake" callouts
- End sections with "Key Takeaways" summaries
- Quiz format: Question → Options → Answer → Explanation`,

    toolGuidelines: `## Education Tool Usage
- Use topic_explain for structured topic explanations
- Use quiz_generate for creating assessments and quizzes
- Use study_plan for designing learning paths
- Use concept_map for visualizing concept relationships
- Use practice_problems for generating exercises
- Use progress_track for monitoring and reviewing progress
- Save generated materials for future reference`,
  },

  capabilities: {
    toolPacks: ['code', 'knowledge'],
    modes: [
      {
        id: 'chat',
        label: 'Learn',
        labelZh: '学习',
        icon: 'MessageSquare',
        description: 'Interactive learning and Q&A',
        descriptionZh: '互动学习和问答',
        toolPolicy: { enabled: false },
      },
      {
        id: 'agent',
        label: 'Tutor',
        labelZh: '辅导',
        icon: 'GraduationCap',
        description: 'Adaptive tutoring with exercises',
        descriptionZh: '自适应辅导与练习',
        toolPolicy: { enabled: true, requireApproval: false },
      },
      {
        id: 'plan',
        label: 'Curriculum',
        labelZh: '课程',
        icon: 'BookOpen',
        description: 'Structured curriculum and study plans',
        descriptionZh: '结构化课程和学习计划',
        toolPolicy: { enabled: true, requireApproval: false },
      },
    ],
    contextTypes: [
      { type: 'Topic', label: 'Topic', labelZh: '主题', icon: 'BookOpen', priority: 1 },
      { type: 'Quiz', label: 'Quiz', labelZh: '测验', icon: 'PenLine', priority: 2 },
      { type: 'Plan', label: 'Study Plan', labelZh: '学习计划', icon: 'Calendar', priority: 3 },
      { type: 'File', label: 'File', labelZh: '文件', priority: 4 },
    ],
    outputFormats: ['markdown', 'text', 'html'],
  },

  ui: {
    layout: 'focus-centric',
    panels: [
      { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: true, minWidth: 400, maxWidth: 900 },
      { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 220, maxWidth: 500 },
    ],
    sidebarItems: [
      { id: 'knowledge', icon: 'BookOpen', label: 'Courses', labelZh: '课程', component: 'KnowledgeView', position: 0 },
      { id: 'quiz', icon: 'PenLine', label: 'Quiz', labelZh: '测验', component: 'QuizPanel', position: 1 },
      { id: 'study-plan', icon: 'Calendar', label: 'Study Plan', labelZh: '学习计划', component: 'StudyPlanView', position: 2 },
      { id: 'explorer', icon: 'FolderTree', label: 'Materials', labelZh: '资料', component: 'ExplorerView', position: 3 },
      { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 4 },
    ],
    statusBarItems: [],
    welcomeSuggestions: EDUCATION_WELCOME_SUGGESTIONS,
    welcomeTitle: EDUCATION_WELCOME_TITLE,
  },

  dataSources: {
    workspace: true,
    customSources: [],
  },
}

const educationModule: ScenarioModule = {
  id: SCENARIO_ID,
  version: SCENARIO_VERSION,

  getManifest: () => EDUCATION_MANIFEST,
  getPlugin: () => EDUCATION_PLUGIN,
  getTools: () => EDUCATION_TOOLS,
  getComponents: () => educationComponents,

  onInstall: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    log.info(`Installing education scenario: v${context.version}`)

    if (context.workspacePath) {
      try {
        const { api } = await import('@services/electronBridge')
        await api.file.mkdir(`${context.workspacePath}/.education/plans`)
        await api.file.mkdir(`${context.workspacePath}/.education/progress`)
        await api.file.mkdir(`${context.workspacePath}/.education/quiz_results`)
        log.info('Created education workspace directories')
      } catch (err) {
        log.warn(`Failed to create education directories: ${err}`)
      }
    }
  },

  onActivate: async (context: ScenarioModuleContext) => {
    const log = context.getLogger()
    const health = context.getHealthReporter()
    log.info(`Activating education scenario: v${context.version}`)

    health.reportCheck('tools', 'healthy', `${EDUCATION_TOOLS.length} education tools available`)
    health.reportCheck('components', 'healthy', '2 education components registered')

    context.publishData('scenario:activated', {
      scenarioId: context.scenarioId,
      version: context.version,
      capabilities: ['topic_explain', 'quiz_generate', 'study_plan', 'concept_map', 'practice_problems', 'progress_track'],
    })
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    context.publishData('scenario:deactivated', { scenarioId: context.scenarioId })
  },

  onUninstall: async (context: ScenarioModuleContext) => {
    context.getLogger().info(`Uninstalling education scenario`)
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    return [
      { name: 'tools', status: 'healthy', message: `${EDUCATION_TOOLS.length} tools available` },
      { name: 'components', status: 'healthy', message: '2 components registered' },
    ]
  },

  getDependencies: (): ScenarioDependency[] => [],
}

export default educationModule
