export type QuotaLevel = 'green' | 'yellow' | 'orange' | 'red'

export function getQuotaLevel(usedPercent: number): QuotaLevel {
  if (usedPercent >= 95) return 'red'
  if (usedPercent >= 85) return 'orange'
  if (usedPercent >= 70) return 'yellow'
  return 'green'
}

const QUOTA_BAR_COLORS: Record<QuotaLevel, string> = {
  green: 'bg-emerald-500',
  yellow: 'bg-yellow-500',
  orange: 'bg-orange-500',
  red: 'bg-red-500',
}

const QUOTA_TEXT_COLORS: Record<QuotaLevel, string> = {
  green: 'text-emerald-400',
  yellow: 'text-yellow-400',
  orange: 'text-orange-400',
  red: 'text-red-400',
}

const QUOTA_GLOW_COLORS: Record<QuotaLevel, string> = {
  green: 'drop-shadow-[0_0_6px_rgba(52,211,153,0.4)]',
  yellow: 'drop-shadow-[0_0_6px_rgba(250,204,21,0.4)]',
  orange: 'drop-shadow-[0_0_6px_rgba(251,146,60,0.4)]',
  red: 'drop-shadow-[0_0_6px_rgba(248,113,113,0.4)]',
}

export function getQuotaBarColor(usedPercent: number): string {
  return QUOTA_BAR_COLORS[getQuotaLevel(usedPercent)]
}

export function getQuotaTextColor(usedPercent: number): string {
  return QUOTA_TEXT_COLORS[getQuotaLevel(usedPercent)]
}

export function getQuotaGlowColor(usedPercent: number): string {
  return QUOTA_GLOW_COLORS[getQuotaLevel(usedPercent)]
}
