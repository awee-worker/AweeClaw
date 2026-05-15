type Locale = 'zh' | 'en'

export type ScenarioDateFormat = 'legal-compliance' | 'medical-hipaa' | 'education-friendly' | 'general'

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

// ============================================
// 场景感知时间格式
// ============================================

interface ScenarioTimeFormatConfig {
    includeTimezone: boolean
    precision: 'second' | 'millisecond'
    includeDate: boolean
    includeTime: boolean
    separator: string
    locale: Locale
}

const SCENARIO_TIME_FORMATS: Record<ScenarioDateFormat, ScenarioTimeFormatConfig> = {
    'legal-compliance': {
        includeTimezone: true,
        precision: 'second',
        includeDate: true,
        includeTime: true,
        separator: 'T',
        locale: 'en',
    },
    'medical-hipaa': {
        includeTimezone: true,
        precision: 'millisecond',
        includeDate: true,
        includeTime: true,
        separator: ' ',
        locale: 'en',
    },
    'education-friendly': {
        includeTimezone: false,
        precision: 'second',
        includeDate: true,
        includeTime: true,
        separator: ' ',
        locale: 'en',
    },
    general: {
        includeTimezone: false,
        precision: 'second',
        includeDate: true,
        includeTime: true,
        separator: ' ',
        locale: 'en',
    },
}

export function formatScenarioTimestamp(
    timestamp: number,
    format: ScenarioDateFormat = 'general',
    localeOverride?: Locale
): string {
    const config = SCENARIO_TIME_FORMATS[format]
    const date = new Date(timestamp)
    const locale = localeOverride ?? config.locale
    const pad = (n: number, width = 2) => String(n).padStart(width, '0')

    const year = date.getFullYear()
    const month = pad(date.getMonth() + 1)
    const day = pad(date.getDate())
    const hours = pad(date.getHours())
    const minutes = pad(date.getMinutes())
    const seconds = pad(date.getSeconds())
    const ms = pad(date.getMilliseconds(), 3)

    let result = ''

    if (config.includeDate) {
        result += `${year}-${month}-${day}`
    }

    if (config.includeDate && config.includeTime) {
        result += config.separator
    }

    if (config.includeTime) {
        result += `${hours}:${minutes}:${seconds}`
        if (config.precision === 'millisecond') {
            result += `.${ms}`
        }
    }

    if (config.includeTimezone) {
        const offset = date.getTimezoneOffset()
        const sign = offset <= 0 ? '+' : '-'
        const absOffset = Math.abs(offset)
        const tzHours = pad(Math.floor(absOffset / 60))
        const tzMinutes = pad(absOffset % 60)
        result += `${sign}${tzHours}:${tzMinutes}`
    }

    if (format === 'legal-compliance') {
        const auditPrefix = locale === 'zh' ? '[合规]' : '[COMPLIANCE]'
        result = `${auditPrefix} ${result}`
    }

    if (format === 'medical-hipaa') {
        const hipaaPrefix = locale === 'zh' ? '[医疗]' : '[HIPAA]'
        result = `${hipaaPrefix} ${result}`
    }

    return result
}

export function getScenarioRelativeTime(
    timestamp: number,
    format: ScenarioDateFormat = 'general',
    language: Locale = 'en'
): string {
    if (format === 'legal-compliance') {
        return formatScenarioTimestamp(timestamp, format, language)
    }

    if (format === 'medical-hipaa') {
        return formatScenarioTimestamp(timestamp, format, language)
    }

    return formatTimestamp(timestamp, language)
}

export function getScenarioTimeFormatConfig(format: ScenarioDateFormat): ScenarioTimeFormatConfig {
    return { ...SCENARIO_TIME_FORMATS[format] }
}

export function toScenarioAuditTimestamp(timestamp: number, scenarioId: string): string {
    const formatted = formatScenarioTimestamp(timestamp, 'legal-compliance')
    return `${formatted} [${scenarioId}]`
}
