type Locale = 'zh' | 'en'

interface DurationBreakdown {
  days: number
  hours: number
  minutes: number
  seconds: number
}

function decomposeDuration(ms: number): DurationBreakdown {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  return {
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
  }
}

const ZH_RELATIVE = {
  justNow: '刚刚',
  minutesAgo: (n: number) => `${n}分钟前`,
  hoursAgo: (n: number) => `${n}小时前`,
  yesterday: '昨天',
  daysAgo: (n: number) => `${n}天前`,
  weeksAgo: (n: number) => `${n}周前`,
  monthsAgo: (n: number) => `${n}个月前`,
} as const

const EN_RELATIVE = {
  justNow: 'Just now',
  minutesAgo: (n: number) => `${n}m ago`,
  hoursAgo: (n: number) => `${n}h ago`,
  yesterday: 'Yesterday',
  daysAgo: (n: number) => `${n}d ago`,
  weeksAgo: (n: number) => `${n}w ago`,
  monthsAgo: (n: number) => `${n}mo ago`,
} as const

function formatAbsoluteDate(timestamp: number, locale: Locale): string {
  const date = new Date(timestamp)
  const currentYear = new Date().getFullYear()
  const options: Intl.DateTimeFormatOptions = {
    month: 'short',
    day: 'numeric',
  }
  if (date.getFullYear() !== currentYear) {
    options.year = 'numeric'
  }
  return date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', options)
}

export function getRelativeTime(timestamp: number, language: Locale = 'en'): string {
  const elapsed = Date.now() - timestamp
  if (elapsed < 0) {
    return language === 'zh' ? ZH_RELATIVE.justNow : EN_RELATIVE.justNow
  }

  const rel = language === 'zh' ? ZH_RELATIVE : EN_RELATIVE
  const { days, hours, minutes } = decomposeDuration(elapsed)

  if (days >= 60) return rel.monthsAgo(Math.floor(days / 30))
  if (days >= 14) return rel.weeksAgo(Math.floor(days / 7))
  if (days >= 2) return rel.daysAgo(days)
  if (days === 1) return rel.yesterday
  if (hours >= 1) return rel.hoursAgo(hours)
  if (minutes >= 1) return rel.minutesAgo(minutes)
  return rel.justNow
}

export function formatTimestamp(timestamp: number, language: Locale = 'en'): string {
  const elapsed = Date.now() - timestamp
  if (elapsed > 7 * 24 * 60 * 60 * 1000) {
    return formatAbsoluteDate(timestamp, language)
  }
  return getRelativeTime(timestamp, language)
}

export function toISO8601Compact(timestamp: number): string {
  const d = new Date(timestamp)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}
