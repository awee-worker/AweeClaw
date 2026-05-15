import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/protocols/scenario'

export const MEDICAL_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'Stethoscope', title: 'Symptom Analysis', titleZh: '症状分析', prompt: 'Help me understand possible causes for these symptoms (for reference only).', color: 'text-rose-500 bg-rose-500/10 border-rose-500/20 hover:bg-rose-500/20' },
  { icon: 'FileText', title: 'Medical Report', titleZh: '医学报告', prompt: 'Help me interpret this medical report or lab results.', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20' },
  { icon: 'BookOpen', title: 'Drug Info', titleZh: '药物信息', prompt: 'Provide information about this medication, including usage and interactions.', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' },
  { icon: 'Heart', title: 'Health Tips', titleZh: '健康建议', prompt: 'Provide evidence-based health and wellness recommendations.', color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20' },
]

export const MEDICAL_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'Medical Assistant',
  titleZh: '医疗助手',
  subtitle: 'AI-powered medical information and health guidance (for reference only).',
  subtitleZh: 'AI 驱动的医学信息和健康指导（仅供参考）。',
}
