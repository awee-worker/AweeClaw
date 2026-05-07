import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/types/scenario'

export const TEMPLATE_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'Sparkles', title: 'Get started', titleZh: '开始使用', prompt: 'Help me get started with this scenario.', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20' },
  { icon: 'Lightbulb', title: 'Explore features', titleZh: '探索功能', prompt: 'What can this scenario do? Show me the key features.', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' },
  { icon: 'HelpCircle', title: 'Ask a question', titleZh: '提问', prompt: 'I have a question about this scenario.', color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20' },
]

export const TEMPLATE_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'Welcome!',
  titleZh: '欢迎！',
  subtitle: 'Choose a suggestion below, or type your request.',
  subtitleZh: '选择下方建议，或输入你的需求',
}
