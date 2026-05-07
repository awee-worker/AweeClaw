import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/types/scenario'

export const CREATIVE_WRITER_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'PenTool', title: 'Start a story', titleZh: '开始一个故事', prompt: 'Help me start writing a story. I need help with plot, characters, and setting.', color: 'text-pink-500 bg-pink-500/10 border-pink-500/20 hover:bg-pink-500/20' },
  { icon: 'Lightbulb', title: 'Brainstorm ideas', titleZh: '头脑风暴', prompt: "I need creative ideas. Let's brainstorm together and explore different angles.", color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20 hover:bg-yellow-500/20' },
  { icon: 'FileText', title: 'Improve my writing', titleZh: '改进我的写作', prompt: 'Review my writing and suggest improvements for clarity, style, and engagement.', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20' },
  { icon: 'MessageSquare', title: 'Write copy', titleZh: '撰写文案', prompt: 'Help me write compelling copy for my project. Make it persuasive and engaging.', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' },
]

export const CREATIVE_WRITER_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'What to create today?',
  titleZh: '今天想创作什么？',
  subtitle: 'Choose a suggestion below, or share your creative vision.',
  subtitleZh: '选择下方建议，或分享你的创意灵感',
}
