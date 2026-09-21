/**
 * 智能体间结构化 IR 通道（Agent IR Channel）
 *
 * 职责：
 * - 将智能体的自然语言输出编码为结构化中间表示（IR），替代原始文本传递
 * - 在智能体间传递紧凑的 IR 解码文本，大幅降低 handoff 的 token 消耗
 * - 提供结构化的结果聚合，替代全量文本拼接
 *
 * 核心概念：
 * - IR（Intermediate Representation）是智能体输出的结构化摘要，包含：
 *   产出物、关键决策、依赖项、下一步建议、状态、一句话总结
 * - 下游智能体只接收 IR 解码后的紧凑文本（约 100-200 token），而非 500 字符的散文
 * - 原始全文仍保留在 results Map 中，仅在需要时回退使用
 *
 * 设计原则：
 * - 非破坏性：IR 编码失败时回退到原始文本，不影响现有流程
 * - 启发式提取：基于正则匹配提取结构化信息，无需额外 LLM 调用
 * - 单一职责：只负责 IR 的编解码与通道管理，不介入执行循环
 * - 可观测：记录编码/解码日志，便于调试
 */

import { logger } from '@toolkit/LogEngine'
import type { ExtractedFile } from './SmartOrchestrator'

// ===== IR 类型定义 =====

export type ArtifactType = 'source' | 'config' | 'test' | 'doc' | 'asset' | 'other'

export interface AgentArtifactIR {
  /** 文件路径（相对或绝对） */
  path: string
  /** 产出物类型 */
  type: ArtifactType
  /** 简要描述（可选） */
  description?: string
}

export type AgentStatus = 'completed' | 'failed' | 'partial'

export interface AgentResultIR {
  /** 智能体 ID */
  agentId: string
  /** 智能体名称 */
  agentName: string
  /** 角色 */
  role: string
  /** 执行状态 */
  status: AgentStatus
  /** 一句话总结（≤100 字符） */
  summary: string
  /** 产出物列表 */
  artifacts: AgentArtifactIR[]
  /** 关键决策/结论 */
  keyDecisions: string[]
  /** 依赖项（需要上游提供的内容） */
  dependencies: string[]
  /** 下一步建议（给下游智能体） */
  nextSteps: string[]
  /** 失败原因（status=failed 时） */
  error?: string
  /** 原始输出长度（用于参考，不存储全文） */
  rawOutputLength: number
  /** 时间戳 */
  timestamp: number
}

// ===== 子代理回传契约 =====

/** 证据引用：指向可回溯的位置，而不是原文 */
export interface SubAgentEvidence {
  kind: 'file' | 'url' | 'query'
  ref: string
}

/**
 * 子代理回传结果
 *
 * 只携带压缩后的结论与证据引用，不携带原始工具输出。
 * 目的是避免子代理的中间过程污染父代理的上下文：父侧需要的是
 * 「结论 + 去哪查证」，而不是子代理读到的每一行文件内容。
 */
export interface SubAgentResult {
  /** 结论（压缩后） */
  conclusion: string
  /** 证据引用（路径 / URL / 查询），非原文 */
  evidence: SubAgentEvidence[]
  /** 执行摘要 */
  summary: { steps: number; toolsUsed: string[] }
  /** 是否因超限被截断 */
  truncated: boolean
}

/** 回传体积上限（token） */
export const SUB_AGENT_RESULT_TOKEN_LIMIT = 8 * 1024

/** CJK 字符范围，用于按字符估算体量 */
const CJK_REGEX = /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/g

/** 证据引用条数上限，避免长任务把引用列表堆爆 */
const MAX_EVIDENCE_ITEMS = 20

/** 文件类工具的参数字段优先级 */
const FILE_ARG_KEYS = ['path', 'filePath', 'file_path', 'file', 'filename'] as const

/** 检索类工具的参数字段优先级 */
const QUERY_ARG_KEYS = ['query', 'pattern', 'searchTerm', 'search_term', 'q'] as const

/**
 * 构造子代理回传结果
 *
 * 结论超过体积上限时按上限截断并置 truncated 为真；
 * 证据引用与执行摘要不参与截断——它们的体积固定，且是父侧回溯的唯一线索。
 */
export function buildSubAgentResult(input: {
  conclusion: string
  evidence?: SubAgentEvidence[]
  steps?: number
  toolsUsed?: string[]
  tokenLimit?: number
}): SubAgentResult {
  const limit = input.tokenLimit ?? SUB_AGENT_RESULT_TOKEN_LIMIT
  const raw = input.conclusion ?? ''
  const tokens = estimateTokens(raw)
  const truncated = tokens > limit

  return {
    conclusion: truncated ? truncateToTokenLimit(raw, tokens, limit) : raw,
    evidence: (input.evidence ?? []).slice(0, MAX_EVIDENCE_ITEMS),
    summary: {
      steps: input.steps ?? 0,
      toolsUsed: input.toolsUsed ?? [],
    },
    truncated,
  }
}

/**
 * 从工具调用记录抽取证据引用
 *
 * 只取参数中的定位信息（路径 / URL / 查询词），不取工具输出内容。
 * 同一路径重复出现时只保留一条。
 */
export function collectEvidence(
  calls: Array<{ toolName: string; args: Record<string, unknown> }>,
): SubAgentEvidence[] {
  const evidence: SubAgentEvidence[] = []
  const seen = new Set<string>()

  const push = (item: SubAgentEvidence) => {
    const key = `${item.kind}:${item.ref}`
    if (seen.has(key)) return
    seen.add(key)
    evidence.push(item)
  }

  for (const call of calls) {
    if (evidence.length >= MAX_EVIDENCE_ITEMS) break
    const args = call.args ?? {}

    const fileRef = pickString(args, FILE_ARG_KEYS) ?? pickMetaFilePath(args)
    if (fileRef) {
      push({ kind: 'file', ref: fileRef })
      continue
    }

    const urlRef = pickString(args, ['url', 'link', 'href'] as const)
    if (urlRef) {
      push({ kind: 'url', ref: urlRef })
      continue
    }

    const queryRef = pickString(args, QUERY_ARG_KEYS)
    if (queryRef) push({ kind: 'query', ref: queryRef })
  }

  return evidence
}

/** 把子代理回传结果渲染为紧凑文本，供父侧消费 */
export function renderSubAgentResult(result: SubAgentResult): string {
  const lines: string[] = [result.conclusion]

  if (result.evidence.length > 0) {
    lines.push('', '证据引用：')
    for (const item of result.evidence) {
      lines.push(`- [${item.kind}] ${item.ref}`)
    }
  }

  if (result.truncated) {
    lines.push('', `（内容超过 ${SUB_AGENT_RESULT_TOKEN_LIMIT} token 上限，已压缩为结论与引用）`)
  }

  return lines.join('\n')
}

/**
 * 估算文本体量（token）
 *
 * 这里刻意不接 tiktoken：编码器是懒加载的重资源，而「是否超过回传上限」
 * 只需要量级判断，用字符数估算足够，不值得让子代理的返回路径依赖它。
 * 系数与项目 token 估算的启发式口径一致（CJK 1.5 字符/token，拉丁 4 字符/token）。
 */
function estimateTokens(text: string): number {
  if (!text) return 0
  const cjkCount = (text.match(CJK_REGEX) || []).length
  const latinCount = text.length - cjkCount
  return Math.ceil(cjkCount / 1.5 + latinCount / 4)
}

function pickString(args: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

/** edit_file / write_file 把路径放在 _meta.filePath 里 */
function pickMetaFilePath(args: Record<string, unknown>): string | null {
  const meta = args._meta
  if (meta && typeof meta === 'object' && !Array.isArray(meta)) {
    const value = (meta as Record<string, unknown>).filePath
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

/** 按 token 占比粗截断，末尾附上原始体量提示 */
function truncateToTokenLimit(text: string, tokens: number, limit: number): string {
  const ratio = limit / tokens
  const keepChars = Math.max(0, Math.floor(text.length * ratio) - 48)
  return `${text.slice(0, keepChars)}\n…[已按回传上限压缩，原始内容约 ${tokens} tokens]`
}

// ===== 常量 =====

/** 总结最大长度 */
const MAX_SUMMARY_LENGTH = 100

/** 单条决策/依赖/下一步最大长度 */
const MAX_ITEM_LENGTH = 120

/** 每类提取项的最大数量 */
const MAX_DECISIONS = 5
const MAX_DEPENDENCIES = 5
const MAX_NEXT_STEPS = 5

/** 产出物类型映射（按文件扩展名） */
const ARTIFACT_TYPE_MAP: Record<string, ArtifactType> = {
  // 源码
  '.ts': 'source', '.tsx': 'source', '.js': 'source', '.jsx': 'source',
  '.vue': 'source', '.svelte': 'source', '.py': 'source', '.java': 'source',
  '.go': 'source', '.rs': 'source', '.rb': 'source', '.php': 'source',
  '.swift': 'source', '.kt': 'source', '.c': 'source', '.cpp': 'source',
  '.h': 'source', '.cs': 'source', '.sql': 'source', '.graphql': 'source',
  '.prisma': 'source',
  // 配置
  '.json': 'config', '.yaml': 'config', '.yml': 'config', '.toml': 'config',
  '.xml': 'config', '.ini': 'config', '.env': 'config', '.conf': 'config',
  '.sh': 'config', '.bash': 'config',
  // 测试
  '.test.ts': 'test', '.test.js': 'test', '.spec.ts': 'test', '.spec.js': 'test',
  // 文档
  '.md': 'doc', '.txt': 'doc', '.rst': 'doc',
  // 资源
  '.svg': 'asset', '.png': 'asset', '.jpg': 'asset', '.jpeg': 'asset',
  '.gif': 'asset', '.webp': 'asset', '.ico': 'asset', '.css': 'asset',
  '.scss': 'asset', '.less': 'asset',
}

/** 关键决策提取正则 */
const DECISION_PATTERNS = [
  /(?:^|\n)\s*(?:#{1,4}\s*)?(?:决策|结论|决定|Decision|Conclusion|Resolved)[:：]\s*(.+)/i,
  /(?:^|\n)\s*(?:#{1,4}\s*)?(?:决策|结论|决定|Decision|Conclusion|Resolved)\s*[:：]?\s*\n((?:.+\n?)+?)(?=\n(?:#{1,4}|$))/i,
]

/** 依赖项提取正则 */
const DEPENDENCY_PATTERNS = [
  /(?:^|\n)\s*(?:#{1,4}\s*)?(?:依赖|需要|等待|Depends|Requires|Waiting)[:：]\s*(.+)/i,
]

/** 下一步提取正则 */
const NEXT_STEP_PATTERNS = [
  /(?:^|\n)\s*(?:#{1,4}\s*)?(?:下一步|后续|待办|Next|Todo|Follow.?up)[:：]\s*(.+)/i,
]

// ===== IR 通道 =====

class AgentIRChannel {
  /** IR 存储（按 agentId 索引） */
  private channel = new Map<string, AgentResultIR>()

  /**
   * 将智能体输出编码为 IR
   *
   * @param agentId - 智能体 ID
   * @param agentName - 智能体名称
   * @param role - 角色
   * @param rawOutput - 原始文本输出
   * @param files - 提取的文件列表
   * @returns 结构化 IR
   */
  encode(
    agentId: string,
    agentName: string,
    role: string,
    rawOutput: string,
    files: ExtractedFile[],
  ): AgentResultIR {
    const status: AgentStatus = rawOutput.startsWith('Error:') ? 'failed' : 'completed'

    const ir: AgentResultIR = {
      agentId,
      agentName,
      role,
      status,
      summary: this.extractSummary(rawOutput),
      artifacts: this.classifyArtifacts(files),
      keyDecisions: this.extractByPatterns(rawOutput, DECISION_PATTERNS, MAX_DECISIONS),
      dependencies: this.extractByPatterns(rawOutput, DEPENDENCY_PATTERNS, MAX_DEPENDENCIES),
      nextSteps: this.extractByPatterns(rawOutput, NEXT_STEP_PATTERNS, MAX_NEXT_STEPS),
      error: status === 'failed' ? rawOutput.slice(0, MAX_ITEM_LENGTH) : undefined,
      rawOutputLength: rawOutput.length,
      timestamp: Date.now(),
    }

    this.channel.set(agentId, ir)

    logger.agent.debug(
      `[AgentIR] encoded ${agentName}: status=${status}, ` +
      `artifacts=${ir.artifacts.length}, decisions=${ir.keyDecisions.length}, ` +
      `rawLen=${ir.rawOutputLength}`,
    )

    return ir
  }

  /**
   * 将 IR 解码为紧凑文本（用于下游智能体的 handoff 上下文）
   *
   * 格式示例：
   * ```
   * [architect] 架构师 - completed
   *   summary: 设计了 API 分层架构，使用 PostgreSQL
   *   artifacts: src/api/routes.ts(source), src/config/db.ts(config)
   *   decisions: 使用 PostgreSQL 作为主数据库; API 采用 RESTful 风格
   *   next: 后端开发实现 API 接口; 测试工程师编写集成测试
   * ```
   *
   * 相比 500 字符的散文，此格式可节省约 50-70% 的 token。
   */
  decode(ir: AgentResultIR): string {
    const lines: string[] = []

    // 头部：角色 + 名称 + 状态
    lines.push(`[${ir.role}] ${ir.agentName} - ${ir.status}`)

    // 总结
    if (ir.summary) {
      lines.push(`  summary: ${ir.summary}`)
    }

    // 产出物
    if (ir.artifacts.length > 0) {
      const artifactStr = ir.artifacts
        .map(a => `${a.path}(${a.type})`)
        .join(', ')
      lines.push(`  artifacts: ${artifactStr}`)
    }

    // 关键决策
    if (ir.keyDecisions.length > 0) {
      lines.push(`  decisions: ${ir.keyDecisions.join('; ')}`)
    }

    // 依赖项
    if (ir.dependencies.length > 0) {
      lines.push(`  depends: ${ir.dependencies.join('; ')}`)
    }

    // 下一步
    if (ir.nextSteps.length > 0) {
      lines.push(`  next: ${ir.nextSteps.join('; ')}`)
    }

    // 错误
    if (ir.error) {
      lines.push(`  error: ${ir.error}`)
    }

    return lines.join('\n')
  }

  /**
   * 构建 handoff 上下文（替代原 buildHandoffContext 中的自然语言拼接）
   *
   * @param currentAgentName - 当前智能体名称
   * @param irList - 已完成智能体的 IR 列表
   * @param projectDir - 项目目录
   * @returns 紧凑的 handoff 上下文文本
   */
  buildHandoffContext(
    currentAgentName: string,
    irList: AgentResultIR[],
    projectDir: string | null,
  ): string {
    const lines: string[] = ['']

    if (projectDir) {
      lines.push('## Project Directory')
      lines.push('All files must be created inside: ' + projectDir)
      lines.push('When using write_file, use paths relative to this directory or absolute paths starting with ' + projectDir)
      lines.push('')
    }

    if (irList.length > 0) {
      lines.push('## Previous Team Work (Structured Handoff)')
      lines.push('')
      lines.push('The following team members have completed their work before you:')
      lines.push('')

      for (const ir of irList) {
        lines.push(this.decode(ir))
        lines.push('')
      }

      lines.push('---')
      lines.push('')
      lines.push('You are ' + currentAgentName + '. Continue from where the previous team members left off.')
      lines.push('REMEMBER: Only do work within YOUR scope. The previous team members handled THEIR parts. You handle YOUR part only.')
      lines.push('')
      lines.push('OUTPUT QUALITY: Only create files that directly fulfill the user\'s request. Do NOT create planning documents, analysis reports, work logs, or any meta-files that the user did not ask for. Create only the actual deliverable files.')
    }

    return lines.join('\n')
  }

  /**
   * 结构化结果聚合（替代全量文本拼接）
   *
   * 将所有智能体的 IR 聚合为一份结构化总结，
   * 相比拼接全部原始文本可大幅减少最终输出的 token 量。
   *
   * @param irList - 所有智能体的 IR
   * @param rawResults - 原始结果 Map（单智能体时直接返回原文）
   * @returns 聚合后的最终答案
   */
  synthesize(irList: AgentResultIR[], rawResults: Map<string, string>): string {
    // 单智能体：直接返回原文，无需聚合
    if (irList.length <= 1 && rawResults.size <= 1) {
      const firstResult = rawResults.values().next().value
      return firstResult || ''
    }

    const lines: string[] = ['## Team Collaboration Summary', '']

    // 按状态分组统计
    const completed = irList.filter(ir => ir.status === 'completed')
    const failed = irList.filter(ir => ir.status === 'failed')

    lines.push(`**Status**: ${completed.length} completed, ${failed.length} failed`)
    lines.push('')

    // 产出物汇总
    const allArtifacts = irList.flatMap(ir => ir.artifacts)
    if (allArtifacts.length > 0) {
      lines.push('### Artifacts')
      for (const a of allArtifacts) {
        lines.push(`- \`${a.path}\` (${a.type})`)
      }
      lines.push('')
    }

    // 各智能体总结
    lines.push('### Agent Summaries')
    for (const ir of irList) {
      const statusIcon = ir.status === 'completed' ? '✅' : ir.status === 'failed' ? '❌' : '⚠️'
      lines.push(`${statusIcon} **${ir.agentName}** (${ir.role}): ${ir.summary}`)

      if (ir.keyDecisions.length > 0) {
        lines.push(`  - Decisions: ${ir.keyDecisions.join('; ')}`)
      }
    }

    return lines.join('\n')
  }

  /** 获取某智能体的 IR */
  get(agentId: string): AgentResultIR | undefined {
    return this.channel.get(agentId)
  }

  /** 获取所有 IR（按完成顺序） */
  getAll(): AgentResultIR[] {
    return Array.from(this.channel.values()).sort((a, b) => a.timestamp - b.timestamp)
  }

  /** 清空通道（新一轮协作时调用） */
  clear(): void {
    this.channel.clear()
  }

  // ===== 私有方法：启发式提取 =====

  /** 提取一句话总结（第一个有意义的行） */
  private extractSummary(rawOutput: string): string {
    const lines = rawOutput.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      // 跳过空行、代码块标记、纯标题行、文件块标记
      if (!trimmed) continue
      if (/^```/.test(trimmed)) continue
      if (/^#{1,6}\s/.test(trimmed) && trimmed.length < 30) continue
      if (/^(file:|✅|❌|⚠️|🔄|🧠|📋)/.test(trimmed)) continue

      // 取第一个有意义的行，截断到 MAX_SUMMARY_LENGTH
      const summary = trimmed.length > MAX_SUMMARY_LENGTH
        ? trimmed.slice(0, MAX_SUMMARY_LENGTH) + '…'
        : trimmed
      return summary
    }
    // 全部被跳过时，返回截断的原始输出
    return rawOutput.slice(0, MAX_SUMMARY_LENGTH) + (rawOutput.length > MAX_SUMMARY_LENGTH ? '…' : '')
  }

  /** 对文件列表进行分类 */
  private classifyArtifacts(files: ExtractedFile[]): AgentArtifactIR[] {
    return files.map(f => ({
      path: f.path,
      type: this.classifyArtifactType(f.path),
    }))
  }

  /** 根据扩展名判断产出物类型 */
  private classifyArtifactType(filePath: string): ArtifactType {
    const name = filePath.split('/').pop() || ''
    const lower = name.toLowerCase()

    // 测试文件
    if (/\.(test|spec)\.(ts|js|tsx|jsx|py|go)$/.test(lower)) return 'test'
    if (lower.startsWith('test_') || lower.endsWith('_test.py')) return 'test'

    // 无扩展名（Dockerfile, Makefile 等）
    if (!name.includes('.')) return 'config'

    // 按扩展名匹配
    const ext = '.' + lower.split('.').pop()
    return ARTIFACT_TYPE_MAP[ext] || 'other'
  }

  /** 按正则模式列表提取文本项 */
  private extractByPatterns(
    text: string,
    patterns: RegExp[],
    maxItems: number,
  ): string[] {
    const items: string[] = []
    const seen = new Set<string>()

    for (const pattern of patterns) {
      pattern.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = pattern.exec(text)) !== null && items.length < maxItems) {
        const raw = match[1].trim()
        if (!raw || seen.has(raw)) continue

        const item = raw.length > MAX_ITEM_LENGTH
          ? raw.slice(0, MAX_ITEM_LENGTH) + '…'
          : raw
        items.push(item)
        seen.add(raw)

        // 防止零宽匹配死循环
        if (match.index === pattern.lastIndex) pattern.lastIndex++
      }
      if (items.length >= maxItems) break
    }

    return items
  }
}

/** IR 通道单例 */
export const agentIRChannel = new AgentIRChannel()
