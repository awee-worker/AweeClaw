type JsonPrimitive = string | number | boolean | null
type JsonValue = JsonPrimitive | JsonObject | JsonArray
interface JsonObject { [key: string]: JsonValue }
interface JsonArray extends Array<JsonValue> {}

interface PathToken {
  key: string
  isIndex: boolean
}

function tokenizePath(path: string): PathToken[] {
  const tokens: PathToken[] = []
  let buffer = ''
  let inBracket = false

  for (const ch of path) {
    if (ch === '[') {
      if (buffer) { tokens.push({ key: buffer, isIndex: false }); buffer = '' }
      inBracket = true
    } else if (ch === ']') {
      if (buffer) { tokens.push({ key: buffer, isIndex: /^\d+$/.test(buffer) }); buffer = '' }
      inBracket = false
    } else if (ch === '.' && !inBracket) {
      if (buffer) { tokens.push({ key: buffer, isIndex: false }); buffer = '' }
    } else {
      buffer += ch
    }
  }
  if (buffer) tokens.push({ key: buffer, isIndex: /^\d+$/.test(buffer) })
  return tokens
}

export function getByPath(root: unknown, path: string): unknown {
  if (root == null || !path) return undefined
  let current: unknown = root
  for (const { key, isIndex } of tokenizePath(path)) {
    if (current == null || typeof current !== 'object') return undefined
    if (isIndex) {
      if (!Array.isArray(current)) return undefined
      current = current[parseInt(key, 10)]
    } else {
      current = (current as Record<string, unknown>)[key]
    }
  }
  return current
}

export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!obj || !path) return
  const tokens = tokenizePath(path)
  let current: unknown = obj

  for (let i = 0; i < tokens.length - 1; i++) {
    const { key } = tokens[i]
    const nextIsIndex = tokens[i + 1].isIndex
    if (typeof current !== 'object' || current === null) return
    const record = current as Record<string, unknown>
    if (!(key in record)) record[key] = nextIsIndex ? [] : {}
    current = record[key]
  }

  const lastKey = tokens[tokens.length - 1].key
  if (typeof current === 'object' && current !== null) {
    (current as Record<string, unknown>)[lastKey] = value
  }
}

export function hasPath(obj: unknown, path: string): boolean {
  return getByPath(obj, path) !== undefined
}

export function joinJsonPath(...segments: (string | undefined)[]): string {
  return segments.filter(Boolean).join('.')
}

function stripSpecialMarkers(input: string): string {
  return input.replace(/<\|[^|]+\|>/g, '').trim()
}

function truncateToLastValidBrace(input: string): string {
  if (input.endsWith('}')) return input
  let depth = 0
  let lastClose = -1
  let inStr = false
  let esc = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (!inStr) {
      if (ch === '{') depth++
      else if (ch === '}') { depth--; if (depth === 0) lastClose = i }
    }
  }
  return lastClose >= 0 ? input.slice(0, lastClose + 1) : input
}

export function cleanToolCallArgs(raw: string): string {
  let text = stripSpecialMarkers(raw.trimStart()).trimEnd()
  text = truncateToLastValidBrace(text)
  return text
}

function escapeControlChars(input: string): string {
  let out = ''
  let inStr = false
  let esc = false

  for (const ch of input) {
    if (esc) { out += ch; esc = false; continue }
    if (ch === '\\' && inStr) { out += ch; esc = true; continue }
    if (ch === '"') { inStr = !inStr; out += ch; continue }
    if (inStr) {
      const code = ch.charCodeAt(0)
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') { out += '\\r'; continue }
      if (ch === '\t') { out += '\\t'; continue }
      if (code < 32) { out += `\\u${code.toString(16).padStart(4, '0')}`; continue }
    }
    out += ch
  }
  return out
}

export function fixUnescapedNewlines(input: string): string {
  return escapeControlChars(input)
}

export function fixMalformedJson(input: string): string {
  let result = escapeControlChars(input)
  let inStr = false
  let esc = false

  for (let i = 0; i < result.length; i++) {
    if (esc) { esc = false; continue }
    if (result[i] === '\\' && inStr) { esc = true; continue }
    if (result[i] === '"') inStr = !inStr
  }
  if (inStr) result += '"'

  let braces = 0, brackets = 0
  inStr = false; esc = false
  for (const ch of result) {
    if (esc) { esc = false; continue }
    if (ch === '\\' && inStr) { esc = true; continue }
    if (ch === '"') { inStr = !inStr; continue }
    if (!inStr) {
      if (ch === '{') braces++
      else if (ch === '}') braces--
      else if (ch === '[') brackets++
      else if (ch === ']') brackets--
    }
  }
  while (brackets > 0) { result += ']'; brackets-- }
  while (braces > 0) { result += '}'; braces-- }

  return result
}

export function safeParseJson<T = Record<string, unknown>>(
  jsonStr: string,
  fallback: T = {} as T,
): T {
  if (!jsonStr?.trim()) return fallback

  const attempts = [
    () => JSON.parse(jsonStr),
    () => JSON.parse(cleanToolCallArgs(jsonStr)),
    () => JSON.parse(fixUnescapedNewlines(jsonStr)),
    () => JSON.parse(fixMalformedJson(jsonStr)),
  ]

  for (const attempt of attempts) {
    try { return attempt() } catch { /* next */ }
  }
  return fallback
}

export function generateId(prefix = 'id'): string {
  const segment = () => Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${segment()}`
}

export function deepClone<T>(value: T): T {
  return structuredClone(value)
}

export function flattenObject(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      Object.assign(result, flattenObject(val as Record<string, unknown>, path))
    } else {
      result[path] = val
    }
  }
  return result
}
