import type {
  ScenarioPlugin,
  ScenarioIdentity,
  ScenarioCapabilities,
  ScenarioUI,
  ScenarioDataSources,
} from '@shared/protocols/scenario'
import { EDUCATION_WELCOME_SUGGESTIONS, EDUCATION_WELCOME_TITLE } from './welcome'
import { buildScenarioIdentity } from '../../scenarioBrandIdentity'

const EDUCATION_IDENTITY: ScenarioIdentity = {
  systemPrompt: buildScenarioIdentity('Education Assistant', 'focused on learning and knowledge transfer') + `

**Core Education Capabilities:**
- **Subject Management**: Organize courses and subjects for structured learning
- **Topic Explanation**: Break down complex topics into digestible explanations with adaptive difficulty
- **Quiz Generation**: Create assessments with varying difficulty levels and question types
- **Study Planning**: Design structured learning paths with milestones and daily schedules
- **Practice Problems**: Generate exercises with step-by-step solutions and progressive hints
- **Progress Tracking**: Monitor learning progress with comprehension scores and review scheduling
- **Flashcards**: Create and review knowledge cards using SM-2 spaced repetition algorithm
- **Mistake Book**: Track wrong answers, review mistakes, and mark them as mastered`,

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
}

const EDUCATION_CAPABILITIES: ScenarioCapabilities = {
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
}

const EDUCATION_UI: ScenarioUI = {
  layout: 'chat-centric',
  panels: [
    { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: true, minWidth: 400, maxWidth: 900 },
    { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 220, maxWidth: 500 },
  ],
  sidebarItems: [
    { id: 'explorer', icon: 'Files', label: 'Workspace', labelZh: '工作区', component: 'ExplorerView', position: 0 },
    { id: 'subjects', icon: 'BookOpen', label: 'Subjects', labelZh: '学科管理', component: 'SubjectPanel', position: 1 },
    { id: 'quiz-center', icon: 'PenLine', label: 'Quiz Center', labelZh: '测验中心', component: 'QuizCenterPanel', position: 2 },
    { id: 'study-plan', icon: 'Calendar', label: 'Study Plan', labelZh: '学习计划', component: 'StudyPlanPanel', position: 3 },
    { id: 'progress', icon: 'BarChart3', label: 'Progress', labelZh: '学习进度', component: 'ProgressPanel', position: 4 },
    { id: 'flashcards', icon: 'Layers', label: 'Flashcards', labelZh: '知识卡片', component: 'FlashCardPanel', position: 5 },
    { id: 'mistakes', icon: 'AlertCircle', label: 'Mistakes', labelZh: '错题本', component: 'MistakeBookPanel', position: 6 },
  ],
  defaultSidePanel: 'explorer',
  statusBarItems: [],
  welcomeSuggestions: EDUCATION_WELCOME_SUGGESTIONS,
  welcomeTitle: EDUCATION_WELCOME_TITLE,
}

const EDUCATION_DATA_SOURCES: ScenarioDataSources = {
  workspace: true,
  customSources: [],
}

export const educationScenario: ScenarioPlugin = {
  id: 'education',
  name: 'Education Assistant',
  nameZh: '教育助手',
  icon: 'GraduationCap',
  description: 'AI-powered learning, tutoring, and knowledge exploration',
  descriptionZh: 'AI 驱动的学习、辅导和知识探索',
  version: '1.0.0',
  author: 'awee',
  category: 'education',
  tags: ['education', 'learning', 'tutoring', 'quiz'],
  isBuiltin: true,
  source: 'builtin',
  requiresWorkspace: false,

  identity: EDUCATION_IDENTITY,
  capabilities: EDUCATION_CAPABILITIES,
  ui: EDUCATION_UI,
  dataSources: EDUCATION_DATA_SOURCES,
}

export default educationScenario
