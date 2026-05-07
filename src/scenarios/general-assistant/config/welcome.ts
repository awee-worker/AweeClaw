import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/types/scenario'

export const GENERAL_ASSISTANT_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'Lightbulb', title: 'Brainstorm ideas', titleZh: '头脑风暴', prompt: "I need some creative ideas. Let's brainstorm together and explore different possibilities.", color: 'text-yellow-500 bg-yellow-500/10 border-yellow-500/20 hover:bg-yellow-500/20' },
  { icon: 'HelpCircle', title: 'Answer questions', titleZh: '回答问题', prompt: 'I have a question I need help with. Can you provide a clear and thorough explanation?', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20' },
  { icon: 'Globe', title: 'Research a topic', titleZh: '研究一个话题', prompt: 'Help me research a topic. Find relevant information and summarize the key points.', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' },
  { icon: 'Brain', title: 'Solve a problem', titleZh: '解决问题', prompt: "I'm facing a problem and need help thinking through it. Let's work through it step by step.", color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20' },
]

export const GENERAL_ASSISTANT_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'How can I help?',
  titleZh: '有什么可以帮你的？',
  subtitle: 'Choose a suggestion below, or ask me anything.',
  subtitleZh: '选择下方建议，或直接问我任何问题',
}
