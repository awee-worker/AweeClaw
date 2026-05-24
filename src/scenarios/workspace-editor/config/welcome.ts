import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/protocols/scenario'

export const CODE_EDITOR_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'Sparkles', title: 'Explain this project', titleZh: '解释当前项目', prompt: 'Please explain the overall architecture and purpose of the current project.', color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20' },
  { icon: 'Code2', title: 'Generate feature', titleZh: '生成新功能', prompt: "I want to build a new feature. Let's start by discussing the requirements and architecture.", color: 'text-accent bg-accent/10 border-accent/20 hover:bg-accent/20' },
  { icon: 'FileText', title: 'Add documentation', titleZh: '添加注释或文档', prompt: 'Generate comprehensive comments and documentation for the active file.', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' },
  { icon: 'Bug', title: 'Find hidden bugs', titleZh: '帮我找出隐藏的 Bug', prompt: 'Review the current codebase or active file for any potential bugs, edge cases, or security issues.', color: 'text-orange-500 bg-orange-500/10 border-orange-500/20 hover:bg-orange-500/20' },
]

export const CODE_EDITOR_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'What to build today?',
  titleZh: '今天想构建什么？',
  subtitle: 'Choose a suggestion below, or tell me your initial thoughts directly.',
  subtitleZh: '选择下方建议，或直接告诉我你的初步想法',
}
