import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/protocols/scenario'

export const EDUCATION_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'GraduationCap', title: 'Explain Topic', titleZh: '讲解知识点', prompt: '请帮我讲解这个知识点，从基础概念开始，逐步深入，配合例子和类比让我更容易理解。', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' },
  { icon: 'PenLine', title: 'Create Quiz', titleZh: '生成测验', prompt: '请为这个主题生成一套测验题，包含选择题和简答题，帮我检验学习效果。', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20' },
  { icon: 'BookOpen', title: 'Study Plan', titleZh: '制定学习计划', prompt: '请帮我制定一个结构化的学习计划，包含里程碑和每日学习安排。', color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20' },
  { icon: 'Layers', title: 'Flashcards', titleZh: '制作知识卡片', prompt: '请帮我为这个主题制作一组知识卡片，方便我用间隔复习法记忆。', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20' },
  { icon: 'Target', title: 'Practice', titleZh: '练习题', prompt: '请给我出几道练习题，从易到难，包含解题思路和详细解答。', color: 'text-red-500 bg-red-500/10 border-red-500/20 hover:bg-red-500/20' },
  { icon: 'AlertCircle', title: 'Review Mistakes', titleZh: '错题复习', prompt: '请帮我复习之前做错的题目，换一种方式讲解让我真正理解。', color: 'text-pink-500 bg-pink-500/10 border-pink-500/20 hover:bg-pink-500/20' },
]

export const EDUCATION_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'Education Assistant',
  titleZh: '教育助手',
  subtitle: 'Your AI learning companion — explain, quiz, plan, and review.',
  subtitleZh: '你的 AI 学习伙伴 — 讲解、测验、计划、复习，一站式学习。',
}
