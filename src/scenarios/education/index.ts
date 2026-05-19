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
import { INSTALL_SCRIPTS, UNINSTALL_SCRIPTS } from './db/scripts'

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
- Use subject_manage to organize courses and subjects
- Use topic_explain for structured topic explanations with adaptive difficulty
- Use quiz_manage for creating assessments, adding questions, and recording results
- Use study_plan_manage for designing learning paths with milestones
- Use practice_problems for generating exercises with progressive hints
- Use progress_manage for monitoring comprehension and scheduling reviews
- Use flashcard_manage for creating and reviewing knowledge cards (SM-2 spaced repetition)
- Use mistake_manage for tracking wrong answers and marking them as mastered
- Always save generated materials for future reference`,
  },

  capabilities: {
    toolPacks: ['education'],
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
      { type: 'Topic', label: 'Topic', labelZh: '主题', icon: 'BookOpen', priority: 1 },
      { type: 'Quiz', label: 'Quiz', labelZh: '测验', icon: 'PenLine', priority: 2 },
      { type: 'Plan', label: 'Study Plan', labelZh: '学习计划', icon: 'Calendar', priority: 3 },
      { type: 'File', label: 'File', labelZh: '文件', priority: 4 },
    ],
    outputFormats: ['markdown', 'text', 'html'],
  },

  ui: {
    layout: 'chat-centric',
    panels: [
      { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: true, minWidth: 400, maxWidth: 900 },
      { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 220, maxWidth: 500 },
    ],
    sidebarItems: [
      { id: 'explorer', icon: 'Files', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
      { id: 'dashboard', icon: 'LayoutDashboard', label: 'Dashboard', labelZh: '仪表盘', component: 'SubjectDashboardPanel', position: 1 },
      { id: 'subjects', icon: 'BookOpen', label: 'Subjects', labelZh: '学科管理', component: 'SubjectPanel', position: 2 },
      { id: 'topics', icon: 'Network', label: 'Topics', labelZh: '知识点', component: 'TopicPanel', position: 3 },
      { id: 'quiz-center', icon: 'PenLine', label: 'Quiz Center', labelZh: '测验中心', component: 'QuizCenterPanel', position: 4 },
      { id: 'study-plan', icon: 'Calendar', label: 'Study Plan', labelZh: '学习计划', component: 'StudyPlanPanel', position: 5 },
      { id: 'progress', icon: 'BarChart3', label: 'Progress', labelZh: '学习进度', component: 'ProgressPanel', position: 6 },
      { id: 'flashcards', icon: 'Layers', label: 'Flashcards', labelZh: '知识卡片', component: 'FlashCardPanel', position: 7 },
      { id: 'mistakes', icon: 'AlertCircle', label: 'Mistakes', labelZh: '错题本', component: 'MistakeBookPanel', position: 8 },
    ],
    defaultSidePanel: 'explorer',
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
  getInstallScripts: () => INSTALL_SCRIPTS,
  getUninstallScripts: () => UNINSTALL_SCRIPTS,

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

    try {
      const dbPath = await context.getDatabasePath()
      health.reportCheck('database', 'healthy', `Database ready at ${dbPath}`)
      log.info(`Education database ready at ${dbPath}`)
    } catch (err) {
      health.reportCheck('database', 'degraded', `Database check failed: ${err instanceof Error ? err.message : String(err)}`)
      log.warn(`Failed to verify database: ${err}`)
    }

    try {
      const subjectResult = await context.executeSql('SELECT COUNT(*) as count FROM subjects')
      const subjectCount = subjectResult.rows?.[0]?.count as number || 0
      health.reportCheck('subjects', subjectCount > 0 ? 'healthy' : 'degraded', `${subjectCount} subjects loaded`)
    } catch {
      health.reportCheck('subjects', 'degraded', 'Cannot query subjects')
    }

    health.reportCheck('tools', 'healthy', `${EDUCATION_TOOLS.length} education tools available`)
    health.reportCheck('components', 'healthy', '9 education components registered')

    context.publishData('scenario:activated', {
      scenarioId: context.scenarioId,
      version: context.version,
      capabilities: ['subject_manage', 'topic_manage', 'quiz_manage', 'study_plan_manage', 'progress_manage', 'flashcard_manage', 'mistake_manage', 'topic_explain', 'practice_problems', 'subject_dashboard', 'learning_suggest'],
    })

    try {
      const reviewResult = await context.executeSql(`SELECT COUNT(*) as count FROM review_schedule WHERE next_review_at <= datetime('now') AND status = 'pending'`)
      const dueCount = reviewResult.rows?.[0]?.count as number || 0
      if (dueCount > 0) {
        context.publishData('education:reviews-due', {
          count: dueCount,
          message: `You have ${dueCount} items due for review`,
          messageZh: `你有 ${dueCount} 项待复习`,
        })
        log.info(`Spaced repetition: ${dueCount} items due for review`)
      }
    } catch {
      log.warn('Failed to check due reviews on activation')
    }
  },

  onDeactivate: async (context: ScenarioModuleContext) => {
    context.publishData('scenario:deactivated', { scenarioId: context.scenarioId })
  },

  onUninstall: async (context: ScenarioModuleContext) => {
    context.getLogger().info(`Uninstalling education scenario`)
  },

  onHealthCheck: async (): Promise<ScenarioHealthCheck[]> => {
    const checks: ScenarioHealthCheck[] = []

    try {
      const { scenarioDatabaseManager } = await import('@scenario-system/core/ScenarioDatabaseManager')
      const subjectCount = await scenarioDatabaseManager.executeSql(SCENARIO_ID, 'SELECT COUNT(*) as count FROM subjects')
      const count = subjectCount.rows?.[0]?.count as number || 0
      checks.push({
        name: 'database',
        status: subjectCount.success ? 'healthy' : 'unhealthy',
        message: subjectCount.success ? `${count} subjects in database` : subjectCount.error || 'Database error',
      })
    } catch {
      checks.push({
        name: 'database',
        status: 'unhealthy',
        message: 'Cannot check database status',
      })
    }

    checks.push({
      name: 'tools',
      status: 'healthy',
      message: `${EDUCATION_TOOLS.length} tools available`,
    })

    return checks
  },

  getDependencies: (): ScenarioDependency[] => [],
}

export default educationModule
