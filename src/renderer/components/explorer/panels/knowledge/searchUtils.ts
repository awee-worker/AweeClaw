import React, { type ReactNode } from 'react'

export function highlightText(
  text: string,
  query: string,
  highlightClassName = 'bg-accent/30 text-accent rounded-sm px-0.5',
): ReactNode[] {
  if (!query || !query.trim()) return [text]

  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)

  const result: ReactNode[] = []
  parts.forEach((part, i) => {
    if (regex.test(part)) {
      result.push(
        React.createElement('mark', { key: i, className: highlightClassName }, part),
      )
    } else {
      result.push(part)
    }
  })
  return result
}

export function truncateWithHighlight(
  text: string,
  query: string,
  maxLen = 120,
): { text: string; offset: number } {
  if (!query || text.length <= maxLen) return { text, offset: 0 }

  const lower = text.toLowerCase()
  const idx = lower.indexOf(query.toLowerCase())
  if (idx === -1) return { text: text.slice(0, maxLen) + '...', offset: 0 }

  const start = Math.max(0, idx - Math.floor(maxLen / 3))
  const end = Math.min(text.length, start + maxLen)
  const prefix = start > 0 ? '...' : ''
  const suffix = end < text.length ? '...' : ''

  return {
    text: prefix + text.slice(start, end) + suffix,
    offset: start,
  }
}

export function generateSearchSuggestions(
  entries: { title: string; tags: string[]; category: string }[],
  query: string,
  limit = 5,
): string[] {
  if (!query || query.length < 2) return []

  const q = query.toLowerCase()
  const scored = new Map<string, number>()

  for (const entry of entries) {
    const words = entry.title.toLowerCase().split(/\s+/)
    for (const word of words) {
      if (word.startsWith(q) && word.length > q.length) {
        scored.set(word, (scored.get(word) ?? 0) + 3)
      } else if (word.includes(q) && word.length > q.length) {
        scored.set(word, (scored.get(word) ?? 0) + 1)
      }
    }

    for (const tag of entry.tags) {
      const tagLower = tag.toLowerCase()
      if (tagLower.startsWith(q)) {
        scored.set(tag, (scored.get(tag) ?? 0) + 2)
      }
    }
  }

  return [...scored.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([s]) => s)
}
