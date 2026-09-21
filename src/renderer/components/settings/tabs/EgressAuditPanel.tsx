/**
 * 数据出口面板
 *
 * 把「哪些数据离开了本机」变成可查证事实：逐条列出出口记录，
 * 并显式标注未埋点的通道——只展示已记录项而不说明覆盖范围，
 * 会让用户误以为「没记录就是没发生」。
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Globe, RefreshCw, ShieldAlert, Trash2 } from 'lucide-react'
import { ToggleSwitch } from '@components/ui'
import { StorageService } from '@shared/toolkit/StorageService'
import { type Language } from '@renderer/i18n'
import {
  ALL_EGRESS_CHANNELS,
  DEFAULT_PRIVACY_POLICY,
  egressAudit,
  getUncoveredChannels,
  type EgressKind,
  type EgressRecord,
  type PrivacyPolicy,
} from '@intelligence/runtime/egressAudit'

interface EgressAuditPanelProps {
  language: Language
}

/** 策略持久化键 */
const POLICY_STORAGE_KEY = 'privacy-egress-policy'

/** 每类出口的中英文案 */
const KIND_LABELS: Record<EgressKind, { zh: string; en: string }> = {
  llm: { zh: '模型调用', en: 'Model call' },
  tool: { zh: '工具请求', en: 'Tool request' },
  search: { zh: '网络检索', en: 'Web search' },
  marketplace: { zh: '市场访问', en: 'Marketplace' },
  a2a: { zh: '外部智能体', en: 'External agent' },
  telemetry: { zh: '遥测', en: 'Telemetry' },
}

/** 一次展示的最大记录条数 */
const MAX_VISIBLE_RECORDS = 50

function loadPolicy(): PrivacyPolicy {
  try {
    const stored = StorageService.get<PrivacyPolicy>(POLICY_STORAGE_KEY)
    return stored ? { ...DEFAULT_PRIVACY_POLICY, ...stored } : DEFAULT_PRIVACY_POLICY
  } catch {
    return DEFAULT_PRIVACY_POLICY
  }
}

export function EgressAuditPanel({ language }: EgressAuditPanelProps) {
  const isZh = language === 'zh'

  const [records, setRecords] = useState<EgressRecord[]>(() => egressAudit.getAll())
  const [policy, setPolicy] = useState<PrivacyPolicy>(loadPolicy)
  const [activeKind, setActiveKind] = useState<'all' | EgressKind>('all')

  useEffect(() => {
    setRecords(egressAudit.getAll())
    return egressAudit.subscribe(() => setRecords(egressAudit.getAll()))
  }, [])

  const updatePolicy = (updates: Partial<PrivacyPolicy>) => {
    const next = { ...policy, ...updates }
    setPolicy(next)
    try {
      StorageService.set(POLICY_STORAGE_KEY, next)
    } catch {
      // 持久化失败不影响当前会话内的策略生效
    }
  }

  const uncovered = useMemo(() => getUncoveredChannels(), [])

  const visibleRecords = useMemo(() => {
    const filtered = activeKind === 'all'
      ? records
      : records.filter((record) => record.kind === activeKind)
    return [...filtered].reverse().slice(0, MAX_VISIBLE_RECORDS)
  }, [records, activeKind])

  const carryingCount = records.filter((record) => record.carriesUserContent).length

  return (
    <div className="space-y-8 animate-fade-in pb-10">
      <div className="p-5 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-start gap-4 shadow-sm">
        <div className="p-2 bg-blue-500/10 rounded-lg shrink-0">
          <Globe className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-blue-500 mb-1 tracking-tight">
            {isZh ? '数据出口' : 'Data Egress'}
          </h3>
          <p className="text-xs text-text-secondary leading-relaxed opacity-90">
            {isZh
              ? '记录所有离开本机的数据请求，只保存「发到哪、什么类型、体量多大」，不保存内容原文。'
              : 'Logs every request that leaves this machine. Only destination, type and size are stored — never the content itself.'}
          </p>
        </div>
      </div>

      <section className="space-y-5 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
          {isZh ? '隐私策略' : 'Privacy Policy'}
        </h4>
        <div className="space-y-4">
          <ToggleSwitch
            label={isZh ? '敏感内容强制使用本地模型' : 'Force local model for sensitive content'}
            checked={policy.forceLocalForSensitive}
            onChange={e => updatePolicy({ forceLocalForSensitive: e.target.checked })}
          />
          <p className="text-[11px] text-text-muted leading-relaxed ml-1">
            {isZh
              ? '开启后，被判定为敏感的内容只交给本地模型处理，不发送到外部服务。'
              : 'When on, content marked sensitive is handled by the local model only and never sent to external services.'}
          </p>

          <ToggleSwitch
            label={isZh ? '本地模型不可用时拒绝外发' : 'Deny egress when local model is unavailable'}
            checked={policy.denyWhenLocalUnavailable}
            onChange={e => updatePolicy({ denyWhenLocalUnavailable: e.target.checked })}
          />
          <p className="text-[11px] text-text-muted leading-relaxed ml-1">
            {isZh
              ? '开启后，本地模型不可用时直接拒绝执行，而不是静默改用云端模型。'
              : 'When on, the request fails instead of silently falling back to a cloud model.'}
          </p>
        </div>
      </section>

      {uncovered.length > 0 && (
        <section className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-start gap-3">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>
            <div className="text-[12px] font-semibold text-amber-500">
              {isZh ? '以下通道尚未接入审计' : 'These channels are not instrumented yet'}
            </div>
            <p className="text-[11px] text-text-secondary leading-relaxed mt-1">
              {uncovered.map(kind => (isZh ? KIND_LABELS[kind].zh : KIND_LABELS[kind].en)).join('、')}
              {isZh
                ? '：这些通道的活动不会出现在下方列表中，不代表没有发生。'
                : ': their activity will not appear below — absence of a record does not mean nothing happened.'}
            </p>
          </div>
        </section>
      )}

      <section className="space-y-5 p-6 bg-surface/20 backdrop-blur-md rounded-2xl border border-border shadow-sm">
        <div className="flex items-center justify-between">
          <h4 className="text-[12px] font-bold text-text-muted uppercase tracking-widest opacity-60 ml-1">
            {isZh ? '出口记录' : 'Egress Records'}
          </h4>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setRecords(egressAudit.getAll())}
              className="inline-flex items-center gap-1 rounded-lg border border-border/50 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary"
            >
              <RefreshCw className="w-3 h-3" />
              {isZh ? '刷新' : 'Refresh'}
            </button>
            <button
              onClick={() => {
                egressAudit.clear()
                setRecords([])
              }}
              className="inline-flex items-center gap-1 rounded-lg border border-border/50 px-2 py-1 text-[11px] text-text-secondary transition-colors hover:text-text-primary"
            >
              <Trash2 className="w-3 h-3" />
              {isZh ? '清空' : 'Clear'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <button
            onClick={() => setActiveKind('all')}
            className={`rounded-full border px-2.5 py-1 transition-colors ${
              activeKind === 'all'
                ? 'border-accent/50 bg-accent/10 text-accent'
                : 'border-border/50 text-text-muted hover:text-text-secondary'
            }`}
          >
            {isZh ? `全部 ${records.length}` : `All ${records.length}`}
          </button>
          {ALL_EGRESS_CHANNELS.map(kind => {
            const count = records.filter(record => record.kind === kind).length
            if (count === 0) return null
            return (
              <button
                key={kind}
                onClick={() => setActiveKind(kind)}
                className={`rounded-full border px-2.5 py-1 transition-colors ${
                  activeKind === kind
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-border/50 text-text-muted hover:text-text-secondary'
                }`}
              >
                {isZh ? KIND_LABELS[kind].zh : KIND_LABELS[kind].en} {count}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-text-muted">
          <ShieldAlert className="w-3.5 h-3.5" />
          {isZh
            ? `共 ${records.length} 条记录，其中 ${carryingCount} 条携带用户内容`
            : `${records.length} records, ${carryingCount} carrying user content`}
        </div>

        {visibleRecords.length === 0 ? (
          <p className="text-[11px] text-text-muted leading-relaxed ml-1">
            {isZh
              ? '暂无出口记录。开启对话后，这里会出现对应的模型调用记录。'
              : 'No egress records yet. Model calls will appear here once you start a conversation.'}
          </p>
        ) : (
          <div className="space-y-1.5">
            {visibleRecords.map(record => (
              <div
                key={record.id}
                className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/25 px-3 py-2"
              >
                <span className="shrink-0 text-[11px] text-text-muted">
                  {new Date(record.timestamp).toLocaleTimeString()}
                </span>
                <span className="shrink-0 rounded bg-surface/60 px-1.5 py-0.5 text-[10px] text-text-secondary">
                  {isZh ? KIND_LABELS[record.kind].zh : KIND_LABELS[record.kind].en}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-text-primary">
                  {record.target}
                </span>
                {record.payloadOutline?.tokens !== undefined && (
                  <span className="shrink-0 text-[11px] text-text-muted">
                    ~{record.payloadOutline.tokens} tokens
                  </span>
                )}
                {record.carriesUserContent && (
                  <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-500">
                    {isZh ? '含用户内容' : 'user content'}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
