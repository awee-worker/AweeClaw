import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/types/scenario'

export const STORE_DIAGNOSIS_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'Building2', title: 'Add a store', titleZh: '添加门店', prompt: '我想添加一个新门店，请帮我录入门店信息。', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20' },
  { icon: 'Stethoscope', title: 'Diagnose a store', titleZh: '诊断门店', prompt: '请帮我对我门店进行全面的运营诊断分析，找出存在的问题和改进方向。', color: 'text-orange-500 bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20' },
  { icon: 'TrendingUp', title: 'Compare benchmarks', titleZh: '行业对比', prompt: '请帮我将门店的关键指标与行业基准进行对比分析。', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' },
  { icon: 'ClipboardList', title: 'Create optimization plan', titleZh: '制定优化方案', prompt: '请根据诊断结果帮我制定一份门店优化方案，包含具体的改进行动和时间表。', color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20' },
]

export const STORE_DIAGNOSIS_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'How is your store doing?',
  titleZh: '门店运营状况如何？',
  subtitle: 'Choose a suggestion below, or describe your store diagnosis needs.',
  subtitleZh: '选择下方建议，或描述你的门店诊断需求',
}
