import type { ToolCategory } from '@shared/config/tools'

export type PermissionAction = 'allow' | 'ask' | 'deny'

export interface ToolPermissionRule {
  toolName?: string
  category?: ToolCategory
  action: PermissionAction
  conditions?: ToolPermissionCondition[]
  rateLimit?: ToolRateLimitConfig
}

export interface ToolPermissionCondition {
  field: string
  operator: 'eq' | 'neq' | 'contains' | 'matches' | 'starts_with'
  value: unknown
}

export interface ToolRateLimitConfig {
  maxCalls: number
  windowMs: number
  burstSize?: number
}

export interface ToolPermissionCheckResult {
  allowed: boolean
  action: PermissionAction
  rule?: ToolPermissionRule
  rateLimited: boolean
  retryAfterMs?: number
  reason?: string
}

interface RateLimitState {
  timestamps: number[]
  tokens: number
  lastRefill: number
}

const DEFAULT_RULES: ToolPermissionRule[] = [
  { category: 'read', action: 'allow' },
  { category: 'search', action: 'allow' },
  { category: 'lsp', action: 'allow' },
  { category: 'plan', action: 'allow' },
  { category: 'data', action: 'allow' },
  { category: 'interaction', action: 'allow' },
  { category: 'media', action: 'allow' },
  { category: 'office', action: 'allow' },
  { category: 'write', action: 'ask', rateLimit: { maxCalls: 30, windowMs: 60_000 } },
  { category: 'terminal', action: 'ask', rateLimit: { maxCalls: 20, windowMs: 60_000 } },
  { category: 'network', action: 'ask', rateLimit: { maxCalls: 10, windowMs: 60_000 } },
]

export class ToolPermissionManager {
  private rules: ToolPermissionRule[] = []
  private rateLimitStates = new Map<string, RateLimitState>()
  private sessionDecisions = new Map<string, PermissionAction>()
  private listeners = new Set<(event: ToolPermissionEvent) => void>()

  constructor(rules?: ToolPermissionRule[]) {
    this.rules = rules ?? [...DEFAULT_RULES]
  }

  addRule(rule: ToolPermissionRule): void {
    this.rules.push(rule)
  }

  removeRule(index: number): void {
    this.rules.splice(index, 1)
  }

  getRules(): ToolPermissionRule[] {
    return [...this.rules]
  }

  setRules(rules: ToolPermissionRule[]): void {
    this.rules = rules
  }

  check(
    toolName: string,
    category: ToolCategory,
    params?: Record<string, unknown>
  ): ToolPermissionCheckResult {
    const rule = this.findMatchingRule(toolName, category, params)

    if (!rule) {
      return {
        allowed: true,
        action: 'allow',
        rateLimited: false,
      }
    }

    if (rule.action === 'deny') {
      this.emit({ type: 'denied', toolName, category, rule })
      return {
        allowed: false,
        action: 'deny',
        rule,
        rateLimited: false,
        reason: `Tool '${toolName}' is denied by rule`,
      }
    }

    if (rule.rateLimit) {
      const rateLimitResult = this.checkRateLimit(toolName, rule.rateLimit)
      if (!rateLimitResult.allowed) {
        this.emit({ type: 'rate_limited', toolName, category, rule, retryAfterMs: rateLimitResult.retryAfterMs })
        return {
          allowed: false,
          action: rule.action,
          rule,
          rateLimited: true,
          retryAfterMs: rateLimitResult.retryAfterMs,
          reason: `Rate limit exceeded for '${toolName}': ${rule.rateLimit.maxCalls} calls per ${rule.rateLimit.windowMs}ms`,
        }
      }
    }

    const sessionKey = `${toolName}:${category}`
    const sessionDecision = this.sessionDecisions.get(sessionKey)
    if (sessionDecision === 'allow') {
      return { allowed: true, action: 'allow', rule, rateLimited: false }
    }
    if (sessionDecision === 'deny') {
      return { allowed: false, action: 'deny', rule, rateLimited: false, reason: 'Denied by session decision' }
    }

    if (rule.action === 'ask') {
      this.emit({ type: 'permission_request', toolName, category, rule, params })
      return {
        allowed: false,
        action: 'ask',
        rule,
        rateLimited: false,
        reason: `Tool '${toolName}' requires user approval`,
      }
    }

    this.emit({ type: 'allowed', toolName, category, rule })
    return { allowed: true, action: 'allow', rule, rateLimited: false }
  }

  approveSession(toolName: string, category: ToolCategory, action: PermissionAction): void {
    const sessionKey = `${toolName}:${category}`
    this.sessionDecisions.set(sessionKey, action)
  }

  clearSessionDecisions(): void {
    this.sessionDecisions.clear()
  }

  resetRateLimits(toolName?: string): void {
    if (toolName) {
      this.rateLimitStates.delete(toolName)
    } else {
      this.rateLimitStates.clear()
    }
  }

  onEvent(listener: (event: ToolPermissionEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private findMatchingRule(
    toolName: string,
    category: ToolCategory,
    params?: Record<string, unknown>
  ): ToolPermissionRule | undefined {
    for (const rule of this.rules) {
      if (rule.toolName && rule.toolName !== toolName) continue
      if (rule.category && rule.category !== category) continue
      if (rule.conditions && !this.evaluateConditions(rule.conditions, params ?? {})) continue
      return rule
    }
    return undefined
  }

  private evaluateConditions(
    conditions: ToolPermissionCondition[],
    params: Record<string, unknown>
  ): boolean {
    for (const cond of conditions) {
      const value = params[cond.field]
      let result: boolean

      switch (cond.operator) {
        case 'eq':
          result = value === cond.value
          break
        case 'neq':
          result = value !== cond.value
          break
        case 'contains':
          result = typeof value === 'string' && typeof cond.value === 'string' && value.includes(cond.value)
          break
        case 'matches':
          try {
            result = typeof value === 'string' && new RegExp(cond.value as string).test(value)
          } catch {
            result = false
          }
          break
        case 'starts_with':
          result = typeof value === 'string' && typeof cond.value === 'string' && value.startsWith(cond.value)
          break
        default:
          result = false
      }

      if (!result) return false
    }
    return true
  }

  private checkRateLimit(
    key: string,
    config: ToolRateLimitConfig
  ): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now()
    let state = this.rateLimitStates.get(key)

    if (!state) {
      state = {
        timestamps: [],
        tokens: config.burstSize ?? config.maxCalls,
        lastRefill: now,
      }
      this.rateLimitStates.set(key, state)
    }

    if (config.burstSize) {
      const elapsed = now - state.lastRefill
      const refillRate = config.maxCalls / config.windowMs
      const tokensToAdd = elapsed * refillRate
      state.tokens = Math.min(config.burstSize, state.tokens + tokensToAdd)
      state.lastRefill = now

      if (state.tokens >= 1) {
        state.tokens -= 1
        return { allowed: true }
      }

      const retryAfterMs = Math.ceil((1 - state.tokens) / refillRate)
      return { allowed: false, retryAfterMs }
    }

    state.timestamps = state.timestamps.filter(ts => now - ts < config.windowMs)

    if (state.timestamps.length >= config.maxCalls) {
      const oldestInWindow = state.timestamps[0]
      const retryAfterMs = oldestInWindow - now + config.windowMs
      return { allowed: false, retryAfterMs: Math.max(0, retryAfterMs) }
    }

    state.timestamps.push(now)
    return { allowed: true }
  }

  private emit(event: ToolPermissionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // ignore
      }
    }
  }
}

export type ToolPermissionEvent =
  | { type: 'allowed'; toolName: string; category: ToolCategory; rule: ToolPermissionRule }
  | { type: 'denied'; toolName: string; category: ToolCategory; rule: ToolPermissionRule }
  | { type: 'rate_limited'; toolName: string; category: ToolCategory; rule: ToolPermissionRule; retryAfterMs?: number }
  | { type: 'permission_request'; toolName: string; category: ToolCategory; rule: ToolPermissionRule; params?: Record<string, unknown> }

export const toolPermissionManager = new ToolPermissionManager()
