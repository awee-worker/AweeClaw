import type { WelcomeSuggestionItem, WelcomeTitleConfig } from '@shared/protocols/scenario'

export const LEGAL_WELCOME_SUGGESTIONS: WelcomeSuggestionItem[] = [
  { icon: 'FileText', title: 'Review Contract', titleZh: '审查合同', prompt: 'Please review this contract for potential risks and compliance issues.', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20 hover:bg-amber-500/20' },
  { icon: 'Search', title: 'Legal Research', titleZh: '法律研究', prompt: 'Help me research the applicable laws and regulations for my situation.', color: 'text-blue-500 bg-blue-500/10 border-blue-500/20 hover:bg-blue-500/20' },
  { icon: 'Shield', title: 'Compliance Check', titleZh: '合规检查', prompt: 'Check my business practices against applicable regulatory requirements.', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20 hover:bg-emerald-500/20' },
  { icon: 'PenLine', title: 'Draft Clause', titleZh: '起草条款', prompt: 'Help me draft a contract clause for my specific business scenario.', color: 'text-purple-500 bg-purple-500/10 border-purple-500/20 hover:bg-purple-500/20' },
]

export const LEGAL_WELCOME_TITLE: WelcomeTitleConfig = {
  title: 'Legal Counsel',
  titleZh: '法律顾问',
  subtitle: 'AI-powered legal research, contract analysis, and compliance assistance.',
  subtitleZh: 'AI 驱动的法律研究、合同分析和合规助手。',
}
