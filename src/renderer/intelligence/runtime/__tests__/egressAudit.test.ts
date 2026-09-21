/**
 * 网络出口审计验收
 *
 * 验收目标：出口记录可查证且不含原文，未埋点通道被显式暴露。
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  ALL_EGRESS_CHANNELS,
  EgressAuditLog,
  INSTRUMENTED_CHANNELS,
  DEFAULT_PRIVACY_POLICY,
  getUncoveredChannels,
  isLocalProvider,
  recordRoutingDecision,
  resolveLocalFirstDecision,
} from '../egressAudit'

describe('EgressAuditLog', () => {
  let log: EgressAuditLog

  beforeEach(() => {
    log = new EgressAuditLog()
  })

  it('记录出口并可按类型查询', () => {
    log.record({ kind: 'llm', target: 'openai/gpt-4o', carriesUserContent: true })
    log.record({ kind: 'search', target: 'searxng.local', carriesUserContent: true })

    expect(log.getAll()).toHaveLength(2)
    expect(log.getByKind('llm')).toHaveLength(1)
    expect(log.getByKind('a2a')).toHaveLength(0)
  })

  it('只保留摘要，不存原文', () => {
    const record = log.record({
      kind: 'llm',
      target: 'openai/gpt-4o',
      carriesUserContent: true,
      payloadOutline: { tokens: 1200, kinds: ['user_message'] },
    })

    expect(record.payloadOutline).toEqual({ tokens: 1200, kinds: ['user_message'] })
    expect(Object.keys(record)).not.toContain('content')
  })

  it('超过容量时丢弃最旧记录', () => {
    const small = new EgressAuditLog(3)
    for (let i = 0; i < 5; i++) {
      small.record({ kind: 'llm', target: `target-${i}` })
    }

    const targets = small.getAll().map((record) => record.target)
    expect(targets).toEqual(['target-2', 'target-3', 'target-4'])
  })

  it('按是否携带用户内容筛选', () => {
    log.record({ kind: 'llm', target: 'a', carriesUserContent: true })
    log.record({ kind: 'telemetry', target: 'b', carriesUserContent: false })

    expect(log.getCarryingUserContent()).toHaveLength(1)
  })

  it('汇总覆盖全部通道类型', () => {
    log.record({ kind: 'llm', target: 'a', carriesUserContent: true })
    log.record({ kind: 'llm', target: 'b' })

    const summary = log.summary()
    expect(summary.total).toBe(2)
    expect(summary.carryingUserContent).toBe(1)
    expect(summary.byKind).toHaveLength(ALL_EGRESS_CHANNELS.length)
    expect(summary.byKind.find((item) => item.kind === 'llm')?.count).toBe(2)
  })

  it('清空后无记录', () => {
    log.record({ kind: 'llm', target: 'a' })
    log.clear()

    expect(log.getAll()).toEqual([])
  })

  it('记录 id 互不相同', () => {
    const first = log.record({ kind: 'llm', target: 'a' })
    const second = log.record({ kind: 'llm', target: 'a' })

    expect(first.id).not.toBe(second.id)
  })
})

describe('未埋点通道', () => {
  it('显式列出未覆盖的通道，不隐瞒盲区', () => {
    const uncovered = getUncoveredChannels()

    expect(uncovered.length).toBeGreaterThan(0)
    expect(uncovered).toContain('a2a')
    expect(uncovered).toContain('telemetry')
  })

  it('已埋点与未埋点拼起来覆盖全部通道', () => {
    const combined = [...INSTRUMENTED_CHANNELS, ...getUncoveredChannels()]

    expect(new Set(combined).size).toBe(ALL_EGRESS_CHANNELS.length)
  })
})

describe('isLocalProvider', () => {
  it('识别本地部署提供商', () => {
    expect(isLocalProvider('ollama')).toBe(true)
    expect(isLocalProvider('LMStudio')).toBe(true)
    expect(isLocalProvider('openai')).toBe(false)
    expect(isLocalProvider(null)).toBe(false)
  })
})

describe('resolveLocalFirstDecision', () => {
  const enforced = { forceLocalForSensitive: true, denyWhenLocalUnavailable: true }

  it('非敏感内容走云端', () => {
    const decision = resolveLocalFirstDecision({
      policy: enforced,
      sensitive: false,
      localModelAvailable: true,
    })

    expect(decision.chosen).toBe('cloud')
    expect(decision.reason).toBe('task_requires_capability')
  })

  it('敏感内容且本地可用时不出本机', () => {
    const decision = resolveLocalFirstDecision({
      policy: enforced,
      sensitive: true,
      localModelAvailable: true,
    })

    expect(decision.chosen).toBe('local')
    expect(decision.policyApplied).toBe('force_local_for_sensitive')
  })

  it('敏感内容且本地不可用时拒绝，不静默上云', () => {
    const decision = resolveLocalFirstDecision({
      policy: enforced,
      sensitive: true,
      localModelAvailable: false,
    })

    expect(decision.chosen).toBe('denied')
    expect(decision.reason).toBe('local_unavailable_denied')
  })

  it('策略允许回退时才回退云端，并标注命中策略', () => {
    const decision = resolveLocalFirstDecision({
      policy: { forceLocalForSensitive: true, denyWhenLocalUnavailable: false },
      sensitive: true,
      localModelAvailable: false,
    })

    expect(decision.chosen).toBe('cloud')
    expect(decision.reason).toBe('local_unavailable_fallback_cloud')
    expect(decision.policyApplied).toBe('deny_when_local_unavailable=off')
  })

  it('未启用强制本地时不改变行为', () => {
    const decision = resolveLocalFirstDecision({
      policy: DEFAULT_PRIVACY_POLICY,
      sensitive: true,
      localModelAvailable: true,
    })

    expect(decision.chosen).toBe('cloud')
    expect(decision.policyApplied).toBe('force_local_for_sensitive=off')
  })
})

describe('recordRoutingDecision', () => {
  it('记录本地推理与云端推理的类型差异', () => {
    const log = new EgressAuditLog()

    recordRoutingDecision(
      { chosen: 'local', reason: 'user_policy_sensitive' },
      { provider: 'ollama', model: 'qwen2.5:7b', tokens: 800 },
      log,
    )
    recordRoutingDecision(
      { chosen: 'cloud', reason: 'task_requires_capability' },
      { provider: 'openai', model: 'gpt-4o', tokens: 900 },
      log,
    )

    const records = log.getAll()
    expect(records).toHaveLength(2)
    expect(records[0].payloadOutline?.kinds).toEqual(['local_inference'])
    expect(records[1].payloadOutline?.kinds).toEqual(['cloud_inference'])
    expect(records[1].target).toBe('openai/gpt-4o')
  })

  it('被拒绝的调用不产生出口记录', () => {
    const log = new EgressAuditLog()

    const result = recordRoutingDecision(
      { chosen: 'denied', reason: 'local_unavailable_denied' },
      { provider: 'openai', model: 'gpt-4o' },
      log,
    )

    expect(result).toBeNull()
    expect(log.getAll()).toEqual([])
  })
})
