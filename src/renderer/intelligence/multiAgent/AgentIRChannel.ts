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
