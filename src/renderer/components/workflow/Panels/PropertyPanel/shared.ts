import type { ConditionOperator } from '@shared/protocols/workflow'
import type { TabId } from './types'

export const INPUT_CLASS = [
  'w-full px-2.5 py-1.5 text-xs rounded-lg',
  'border border-gray-200 bg-gray-50',
  'text-gray-700 placeholder:text-gray-400',
  'focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-400/50 focus:bg-white',
  'transition-all',
].join(' ')

export const SELECT_CLASS = [
  'w-full px-2.5 py-1.5 text-xs rounded-lg',
  'border border-gray-200 bg-gray-50',
  'text-gray-700',
  'focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-400/50 focus:bg-white',
  'transition-all appearance-none cursor-pointer',
].join(' ')

export const TEXTAREA_CLASS = [
  'w-full px-2.5 py-1.5 text-xs rounded-lg',
  'border border-gray-200 bg-gray-50',
  'text-gray-700 placeholder:text-gray-400',
  'focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-400/50 focus:bg-white',
  'transition-all resize-none',
].join(' ')

export const TEXTAREA_MONO_CLASS = [
  'w-full px-2.5 py-1.5 text-xs rounded-lg',
  'border border-gray-200 bg-gray-50',
  'text-gray-700 placeholder:text-gray-400',
  'focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-400/50 focus:bg-white',
  'transition-all resize-none font-mono',
].join(' ')

export const TAB_LABELS: Record<TabId, { en: string; zh: string }> = {
  basic: { en: 'Basic', zh: '基础' },
  role: { en: 'Role', zh: '角色' },
  tools: { en: 'Tools', zh: '工具' },
  io: { en: 'I/O', zh: '输入/输出' },
  error: { en: 'Error', zh: '异常' },
  advanced: { en: 'Adv', zh: '高级' },
}

export const CONDITION_OPERATORS: { value: ConditionOperator; label: { en: string; zh: string } }[] = [
  { value: 'eq', label: { en: 'equals', zh: '等于' } },
  { value: 'neq', label: { en: 'not equals', zh: '不等于' } },
  { value: 'gt', label: { en: 'greater than', zh: '大于' } },
  { value: 'gte', label: { en: '>=', zh: '大于等于' } },
  { value: 'lt', label: { en: 'less than', zh: '小于' } },
  { value: 'lte', label: { en: '<=', zh: '小于等于' } },
  { value: 'contains', label: { en: 'contains', zh: '包含' } },
  { value: 'not_contains', label: { en: 'not contains', zh: '不包含' } },
  { value: 'is_truthy', label: { en: 'is truthy', zh: '为真' } },
  { value: 'is_falsy', label: { en: 'is falsy', zh: '为假' } },
]

export const EMOJI_ICON_MAP: Record<string, string> = {
  Bot: '🤖', Users: '👥', Workflow: '🔄', MessageSquare: '💬', CheckCircle: '✅',
  ClipboardList: '📋', GitBranch: '🔀', GitMerge: '🔱', Repeat: '🔁', Layers: '📚',
  Merge: '🔗', Wrench: '🔧', Server: '🖥️', Terminal: '⌨️', Globe: '🌐',
  Variable: '📌', Shuffle: '🔀', BookOpen: '📖', Clock: '⏰', Webhook: '🪝',
  Bell: '🔔', FileText: '📄', FileOutput: '📤', BellRing: '🔔',
}

export function getEmojiForIcon(iconName: string): string {
  return EMOJI_ICON_MAP[iconName] || '⬡'
}