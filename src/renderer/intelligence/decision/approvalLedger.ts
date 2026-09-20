/**
 * 审批结果账本
 *
 * 定位：留存「哪条命令被摆到用户面前、用户批准还是拒绝」这条链路的事实数据。
 *
 * 为什么要留：决策层给出的置信度是启发式估计，阈值 0.7 也是拍出来的，
 * 没有做过频率校准。而用户每次点「批准 / 拒绝」，本质上都是在给判定结果
 * 打标注——这是系统内唯一不依赖人工构造、能反映真实偏好的信号来源。
 * 把它记下来，才谈得上后续校准阈值、以及判断某条灰区规则到底该留还是该删。
 *
 * 判读方式：
 * - 某条灰区规则命中后用户高频拒绝 → 规则抓得准，值得留
 * - 某条灰区规则命中后用户几乎都批准 → 规则过宽，每次都在制造无谓点击
 *
 * 记录只用于本地统计，不随对话请求外发；命令内容做截断后存储，
 * 避免把长命令（可能含敏感路径或参数）整条写进本地存储。
 */

import { getToolApprovalType } from '@configuration/toolDefinitions'
import { StorageService } from '@shared/toolkit/StorageService'
import { assessCommandRisk, type CommandRiskLevel } from './commandRisk'

/** 存储键（StorageService 会自动加命名空间前缀） */
const STORAGE_KEY = 'decision.approvalLedger'

/**
 * 账本容量上限
 *
 * 只保留最近若干条：这是用于观察近期偏好的样本，不是审计日志，
 * 无上限会让 localStorage 随使用时长无限增长。
 */
const MAX_ENTRIES = 300

/** 命令摘要最大长度 */
const COMMAND_SUMMARY_MAX = 120

/** 单条审批记录 */
export interface ApprovalLedgerEntry {
  /** 记录时间（毫秒时间戳） */
  timestamp: number
  /** 所属请求 id */
  requestId: string
  /** 工具调用 id */
  toolCallId: string
  /** 工具名 */
  toolName: string
  /** 工具审批类型（来自 TOOL_CONFIGS） */
  approvalType: string
  /** 用户的授权方式 */
  authorizationMode?: string
  /** 命令风险级别（仅命令类工具有值） */
  riskLevel?: CommandRiskLevel
  /** 风险判定置信度（仅命令类工具有值） */
  riskConfidence?: number
  /** 命中的灰区规则 id（仅命令类工具有值） */
  riskRuleId?: string
  /** 判定理由（仅命令类工具有值） */
  riskRationale?: string
  /** 命令摘要（截断后的命令，仅命令类工具有值） */
  commandSummary?: string
  /** 用户决定 */
  decision: 'approved' | 'rejected'
}

/** 记录入参：时间戳由账本自行填充 */
export type ApprovalLedgerInput = Omit<ApprovalLedgerEntry, 'timestamp'>

/** 内存缓存：避免每次读取都解析 localStorage */
let cache: ApprovalLedgerEntry[] | null = null

function load(): ApprovalLedgerEntry[] {
  if (cache) return cache
  const stored = StorageService.get<ApprovalLedgerEntry[]>(STORAGE_KEY, [])
  cache = Array.isArray(stored) ? stored : []
  return cache
}

/** 把命令压成一行短文本，便于在统计界面里辨认 */
export function summarizeCommand(command: string, maxLength = COMMAND_SUMMARY_MAX): string {
  const singleLine = command.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= maxLength) return singleLine
  return `${singleLine.slice(0, maxLength)}…`
}

/**
 * 由工具调用构造一条记录
 *
 * 命令类工具顺带做一次风险分级：审批被触发的原因（是硬拦截还是灰区）
 * 是后续校准的关键字段，不能只记「用户点了批准」。
 */
export function buildApprovalEntry(params: {
  toolCall: { id: string; name: string; arguments?: Record<string, unknown> }
  requestId: string
  decision: 'approved' | 'rejected'
  authorizationMode?: string
}): ApprovalLedgerEntry {
  const { toolCall, requestId, decision, authorizationMode } = params
  const entry: ApprovalLedgerEntry = {
    timestamp: Date.now(),
    requestId,
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    approvalType: getToolApprovalType(toolCall.name),
    authorizationMode,
    decision,
  }

  if (toolCall.name === 'run_command') {
    const command = toolCall.arguments?.command
    if (typeof command === 'string' && command.trim()) {
      const risk = assessCommandRisk(command)
      entry.riskLevel = risk.level
      entry.riskConfidence = risk.confidence
      entry.riskRuleId = risk.ruleId
      entry.riskRationale = risk.rationale
      entry.commandSummary = summarizeCommand(command)
    }
  }

  return entry
}

/** 追加一条记录 */
export function recordApproval(entry: ApprovalLedgerEntry): void {
  const entries = load()
  entries.push(entry)
  if (entries.length > MAX_ENTRIES) {
    entries.splice(0, entries.length - MAX_ENTRIES)
  }
  StorageService.set(STORAGE_KEY, entries)
}

/** 读取全部记录（按写入顺序） */
export function getApprovalEntries(): ApprovalLedgerEntry[] {
  return [...load()]
}

/** 清空记录（内存与存储同时清理） */
export function clearApprovalLedger(): void {
  cache = []
  StorageService.remove(STORAGE_KEY)
}

/** 重置内存缓存：用于切换到最新的存储内容（测试与账号切换） */
export function resetApprovalLedgerCache(): void {
  cache = null
}

/** 分组统计结果 */
export interface ApprovalBreakdown {
  key: string
  total: number
  approved: number
  rejected: number
  /** 批准率 0~1；用户全部批准的规则意味着它在制造无谓点击 */
  approvalRate: number
}

/** 账本汇总 */
export interface ApprovalSummary {
  total: number
  approved: number
  rejected: number
  /** 按命令风险级别分组 */
  byRiskLevel: ApprovalBreakdown[]
  /** 按工具名分组 */
  byTool: ApprovalBreakdown[]
  /** 按灰区规则分组：判断某条规则该留还是该删的直接依据 */
  byReviewRule: ApprovalBreakdown[]
}

function buildBreakdown(
  entries: ApprovalLedgerEntry[],
  keyOf: (entry: ApprovalLedgerEntry) => string | undefined,
): ApprovalBreakdown[] {
  const groups = new Map<string, { total: number; approved: number }>()
  for (const entry of entries) {
    const key = keyOf(entry)
    if (!key) continue
    const bucket = groups.get(key) ?? { total: 0, approved: 0 }
    bucket.total++
    if (entry.decision === 'approved') bucket.approved++
    groups.set(key, bucket)
  }

  return Array.from(groups.entries())
    .map(([key, bucket]) => ({
      key,
      total: bucket.total,
      approved: bucket.approved,
      rejected: bucket.total - bucket.approved,
      approvalRate: bucket.total > 0 ? round4(bucket.approved / bucket.total) : 0,
    }))
    .sort((a, b) => b.total - a.total)
}

/** 汇总账本：把「用户到底批准了什么」变成可读的分组统计 */
export function summarizeApprovalLedger(
  entries: ApprovalLedgerEntry[] = load(),
): ApprovalSummary {
  let approved = 0
  for (const entry of entries) {
    if (entry.decision === 'approved') approved++
  }

  return {
    total: entries.length,
    approved,
    rejected: entries.length - approved,
    byRiskLevel: buildBreakdown(entries, (entry) => entry.riskLevel),
    byTool: buildBreakdown(entries, (entry) => entry.toolName),
    byReviewRule: buildBreakdown(entries, (entry) => entry.riskRuleId),
  }
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
