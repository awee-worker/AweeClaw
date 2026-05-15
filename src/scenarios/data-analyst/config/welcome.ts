import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/protocols/scenario'

export const DATA_ANALYST_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'BarChart3', title: 'Analyze a dataset', titleZh: '分析数据集', prompt: 'I have a dataset I want to analyze. Help me explore its structure, find patterns, and generate insights.', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20' },
  { icon: 'Globe', title: 'Create visualization', titleZh: '创建可视化图表', prompt: 'Help me create a compelling data visualization. What chart type would work best for my data?', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' },
  { icon: 'Brain', title: 'Statistical analysis', titleZh: '统计分析', prompt: 'I need help with statistical analysis. Guide me through choosing the right tests and interpreting results.', color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20' },
  { icon: 'FileText', title: 'Data cleaning', titleZh: '数据清洗', prompt: 'Help me clean and preprocess my dataset. Check for missing values, outliers, and data quality issues.', color: 'text-orange-500 bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20' },
]

export const DATA_ANALYST_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'What data to explore?',
  titleZh: '想探索什么数据？',
  subtitle: 'Choose a suggestion below, or describe your data analysis needs.',
  subtitleZh: '选择下方建议，或描述你的数据分析需求',
}
