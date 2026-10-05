/**
 * 通讯录公共常量与工具函数
 */
import type { ContactGender, ContactItem } from '../scene-tools/stores'

/** 关系预设选项 */
export const RELATION_OPTIONS = ['家人', '亲戚', '朋友', '同事', '同学', '客户', '其他'] as const

/** 性别选项 */
export const GENDER_OPTIONS: { value: ContactGender; label: string }[] = [
  { value: 'male', label: '男' },
  { value: 'female', label: '女' },
  { value: 'other', label: '其他' },
  { value: 'unknown', label: '未知' },
]

/** 性别显示文案 */
export const GENDER_LABELS: Record<ContactGender, string> = {
  male: '男',
  female: '女',
  other: '其他',
  unknown: '未知',
}

/** 关系标签配色 */
const RELATION_STYLE: Record<string, { color: string; bg: string }> = {
  家人: { color: '#F43F5E', bg: 'rgba(244,63,94,0.12)' },
  亲戚: { color: '#F97316', bg: 'rgba(249,115,22,0.12)' },
  朋友: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  同事: { color: '#0EA5E9', bg: 'rgba(14,165,233,0.12)' },
  同学: { color: '#10B981', bg: 'rgba(16,185,129,0.12)' },
  客户: { color: '#8B5CF6', bg: 'rgba(139,92,246,0.12)' },
  其他: { color: '#64748B', bg: 'rgba(100,116,139,0.14)' },
}

const FALLBACK_STYLE = { color: '#64748B', bg: 'rgba(100,116,139,0.14)' }

/** 获取关系对应的配色 */
export function relationStyle(relation?: string): { color: string; bg: string } {
  return RELATION_STYLE[relation || ''] ?? FALLBACK_STYLE
}

/** 头像首字母 */
export function contactInitial(name: string): string {
  const n = (name || '').trim()
  if (!n) return '?'
  return n.slice(0, 1).toUpperCase()
}

/** 距下一次生日的天数（无生日返回 null） */
export function daysUntilBirthday(birthday?: string): number | null {
  if (!birthday) return null
  const m = birthday.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  const month = Number(m[2])
  const day = Number(m[3])
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let next = new Date(today.getFullYear(), month - 1, day)
  if (next.getTime() < today.getTime()) {
    next = new Date(today.getFullYear() + 1, month - 1, day)
  }
  return Math.round((next.getTime() - today.getTime()) / 86400000)
}

/** 生日是否临近（默认 7 天内） */
export function isBirthdaySoon(birthday?: string, within = 7): boolean {
  const d = daysUntilBirthday(birthday)
  return d !== null && d <= within
}

/** 生日格式化为 M月D日 */
export function formatBirthday(birthday?: string): string {
  if (!birthday) return ''
  const m = birthday.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return birthday
  return `${Number(m[2])}月${Number(m[3])}日`
}

/** 导出联系人为 JSON 文件 */
export function exportContactsJson(items: ContactItem[]): void {
  try {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `contacts-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  } catch {
    /* ignore */
  }
}
