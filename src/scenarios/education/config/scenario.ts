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
- **Topic Explanation**: Break down complex topics into digestible explanations
- **Adaptive Tutoring**: Adjust teaching style to learner's level and progress
- **Quiz Generation**: Create assessments with varying difficulty levels
- **Study Planning**: Design structured learning paths with milestones
- **Concept Mapping**: Visualize relationships between concepts
- **Practice Problems**: Generate exercises with step-by-step solutions`,

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
- Use knowledge base for storing course materials and notes
- Use file tools to create and manage study documents
- Use search tools for finding supplementary resources
- Save generated quizzes and study plans for future reference`,
}

const EDUCATION_CAPABILITIES: ScenarioCapabilities = {
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
}

const EDUCATION_UI: ScenarioUI = {
  layout: 'focus-centric',
  panels: [
    { id: 'chat', component: 'ChatPanel', region: 'primary', defaultVisible: true, resizable: true, minWidth: 400, maxWidth: 900 },
    { id: 'sidebar', component: 'Sidebar', region: 'secondary', defaultVisible: true, resizable: true, minWidth: 220, maxWidth: 500 },
  ],
  sidebarItems: [
    { id: 'knowledge', icon: 'BookOpen', label: 'Courses', labelZh: '课程', component: 'KnowledgeView', position: 0 },
    { id: 'explorer', icon: 'FolderTree', label: 'Materials', labelZh: '资料', component: 'ExplorerView', position: 1 },
    { id: 'history', icon: 'History', label: 'History', labelZh: '历史', component: 'HistoryView', position: 2 },
  ],
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
