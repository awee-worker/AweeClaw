import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/protocols/scenario'

export const EDUCATION_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'GraduationCap', title: 'Explain Topic', titleZh: '讲解主题', prompt: 'Please explain this topic in a clear and structured way, suitable for learning.', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' },
  { icon: 'PenLine', title: 'Create Quiz', titleZh: '创建测验', prompt: 'Generate a quiz to test my understanding of this subject.', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20' },
  { icon: 'BookOpen', title: 'Study Plan', titleZh: '学习计划', prompt: 'Help me create a structured study plan for mastering this subject.', color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20' },
  { icon: 'MessageSquare', title: 'Tutoring', titleZh: '辅导答疑', prompt: 'I need help understanding a concept. Can you tutor me step by step?', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20' },
]

export const EDUCATION_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'Education Assistant',
  titleZh: '教育助手',
  subtitle: 'AI-powered learning, tutoring, and knowledge exploration.',
  subtitleZh: 'AI 驱动的学习、辅导和知识探索。',
}
