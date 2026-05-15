/**
 * Context model types
 */
export interface ContextEntry {
  id: string
  type: "file" | "snippet" | "url" | "terminal"
  content: string
  metadata?: Record<string, unknown>
}

export interface ContextWindow {
  entries: ContextEntry[]
  totalTokens: number
  maxTokens: number
}

export function createContextEntry(type: ContextEntry["type"], content: string): ContextEntry {
  return { id: `ctx-${Date.now()}`, type, content }
}
