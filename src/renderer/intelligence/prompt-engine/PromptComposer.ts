/**
 * 提示词构建器 — Agent 与 Chat 模式的提示词组装
 *
 * 职责：
 * - 为 Agent 和 Chat 模式构建系统提示词
 * - 支持场景插件系统：从当前活跃的 ScenarioPlugin 获取身份、安全规则、
 *   代码规范和工作流指南，而非硬编码在 promptTemplates.ts 中
 * - 向后兼容：如果没有活跃场景，回退到 promptTemplates 中的常量
 */

import { WorkMode } from '@/renderer/modes/workModeTypes'
import { modeRegistry } from '../capabilities/mode/WorkModeRegistry'
import type { ModeDescriptor } from '../capabilities/mode/WorkModeDescriptor'
import { generateToolsPromptDescriptionFiltered, type ToolCategory } from '@configuration/toolDefinitions'
import { getToolsForContext } from '@configuration/toolCategoryDefs'
import { DEFAULT_AGENT_CONFIG } from '@configuration/agentProfile'
import { PERFORMANCE_DEFAULTS } from '@shared/configuration/defaultProfile'
import { rulesService, type ProjectRules } from '../runtime/ruleEngine'
import { memoryService, type MemoryItem } from '../runtime/recallService'
import { knowledgeService } from '../runtime/knowledgeService'
import type { KnowledgeEntry } from '@intelligence/providerTypes'
import { longTermMemoryService } from '../runtime/longTermMemoryService'
import type { MemoryEntry } from '@intelligence/providerTypes'
import { skillService, type SkillItem } from '../runtime/skillRepository'
import {
  APP_IDENTITY,
  PROFESSIONAL_OBJECTIVITY,
  LANGUAGE_MATCHING,
  SECURITY_RULES,
  CODE_CONVENTIONS,
  WORKFLOW_GUIDELINES,
  OUTPUT_FORMAT,
  TOOL_GUIDELINES,
  getPromptTemplateById,
  getDefaultPromptTemplate,
} from './promptLibrary'
import { scenarioRegistry } from '@shared/configuration/scenarios'
import { api } from '../../adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'
import { useStore } from '@store'

let projectSummaryCache: { path: string; summary: string; timestamp: number } | null = null
const SUMMARY_CACHE_TTL = 5 * 60 * 1000

async function loadProjectSummary(workspacePath: string): Promise<string | null> {
  try {
    if (
      projectSummaryCache &&
      projectSummaryCache.path === workspacePath &&
      Date.now() - projectSummaryCache.timestamp < SUMMARY_CACHE_TTL
    ) {
      logger.agent.info('[PromptBuilder] Using cached project summary')
      return projectSummaryCache.summary
    }

    const summary = await api.index.getProjectSummaryText(workspacePath)
    if (summary) {
      projectSummaryCache = { path: workspacePath, summary, timestamp: Date.now() }
      logger.agent.info('[PromptBuilder] Loaded project summary:', summary.slice(0, 200) + '...')
      return summary
    }

    logger.agent.info('[PromptBuilder] No project summary available')
    return null
  } catch (error) {
    logger.agent.info('[PromptBuilder] Failed to load project summary:', error)
    return null
  }
}

export const MAX_FILE_CHARS = DEFAULT_AGENT_CONFIG.maxFileContentChars
export const MAX_DIR_ITEMS = 150
export const MAX_SEARCH_RESULTS = PERFORMANCE_DEFAULTS.maxSearchResults
export const MAX_TERMINAL_OUTPUT = DEFAULT_AGENT_CONFIG.maxTerminalChars
export const MAX_CONTEXT_CHARS = DEFAULT_AGENT_CONFIG.maxTotalContextChars

export interface UserInfo {
  username?: string
  realName?: string
  gender?: string
  occupation?: string
}

export interface PromptContext {
  os: string
  workspacePath: string | null
  activeFile: string | null
  openFiles: string[]
  date: string
  mode: WorkMode
  modeDescriptor: ModeDescriptor
  personality: string
  projectRules: ProjectRules | null
  memories: MemoryItem[]
  knowledgeEntries: KnowledgeEntry[]
  longTermMemories: MemoryEntry[]
  userQuery?: string
  autoSkills: SkillItem[]
  mentionedSkills: SkillItem[]
  customInstructions: string | null
  templateId?: string
  projectSummary?: string | null
  planPhase?: 'planning' | 'executing'
  userInfo?: UserInfo | null
  /** 场景动态上下文：由 active scenario 的 getDynamicContext 提供（如当前选中项目） */
  scenarioDynamicContext?: string | null
  /** 阶段2：感知预测上下文（当前场景 + 预测建议 + 代码影响） */
  perceptionContext?: PerceptionContext | null
}

/** 感知预测上下文（由主进程通过 IPC 提供） */
export interface PerceptionContext {
  /** 当前场景摘要 */
  currentScene?: {
    app: string
    activity: string
    textSummary: string
  } | null
  /** 预测的下一步动作（Top-K） */
  predictions?: Array<{
    actionType: string
    target: string
    confidence: number
    reason: string
  }>
  /** 代码影响分析（如果有） */
  codeImpact?: {
    overallLevel: 'high' | 'medium' | 'low' | 'none'
    totalImpactedFiles: number
    highRiskCount: number
    summary: string
  } | null
  /**
   * IoT 上下文摘要（阶段9 s9-01 新增）
   *
   * 由 perceptionContextAggregator 从 IoTBridge 聚合，
   * 包含连接的 Provider、实体数量、最近传感器异常。
   */
  iotContext?: IoTContextSummary | null
  /**
   * 因果推理上下文摘要（阶段9 s9-01 新增）
   *
   * 由 perceptionContextAggregator 从 CausalReasoningService 聚合，
   * 包含因果图规模、最近反事实查询结果。
   */
  causalContext?: CausalContextSummary | null
  /**
   * 监控上下文摘要（阶段9 s9-01 新增）
   *
   * 由 perceptionContextAggregator 从 MonitoringService 聚合，
   * 包含活跃异常数量、最近告警、系统指标摘要。
   */
  monitoringContext?: MonitoringContextSummary | null
}

/**
 * IoT 上下文摘要（轻量级，用于系统提示词注入）
 *
 * 设计原则：
 * - 只保留摘要信息，避免传输大量实体数据
 * - 实体状态仅取 top N 个最近变化的
 * - 异常事件仅取 top N 个最近的
 */
export interface IoTContextSummary {
  /** Bridge 是否运行中 */
  bridgeRunning: boolean
  /** 已连接的 Provider 数量 */
  connectedProviders: number
  /** Provider 总数 */
  totalProviders: number
  /** 实体总数 */
  totalEntities: number
  /** 已连接 Provider 摘要（最多 5 个） */
  providers: Array<{
    name: string
    protocol: string
    state: string
    entityCount: number
    /** 距离最近一次读数的秒数（null 表示从未收到） */
    secondsSinceLastReading: number | null
  }>
  /** 最近变化的实体（最多 5 个，按 lastStateChangedAt 倒序） */
  recentEntities: Array<{
    externalId: string
    entityType: string
    state: string | number | boolean | null
    unit?: string | null
  }>
  /** 传感器异常数量（最近 24h） */
  recentAnomalyCount: number
  /** 最近传感器异常摘要（最多 3 个） */
  recentAnomalies: Array<{
    type: string
    severity: string
    description: string
    entityExternalId: string
  }>
}

/**
 * 因果推理上下文摘要（轻量级）
 */
export interface CausalContextSummary {
  /** 因果推理是否启用 */
  enabled: boolean
  /** 节点数量 */
  nodeCount: number
  /** 边数量 */
  edgeCount: number
  /** 图密度 */
  density: number
  /** 是否存在环 */
  hasCycle: boolean
  /** 最近反事实查询数量（24h） */
  recentQueryCount: number
  /** 最近反事实查询摘要（最多 3 个） */
  recentQueries: Array<{
    queryType: string
    interventionVar: string
    observedVar: string
    impactLevel: string
    success: boolean
  }>
}

/**
 * 监控上下文摘要（轻量级）
 */
export interface MonitoringContextSummary {
  /** 监控是否运行中 */
  running: boolean
  /** 活跃异常数量 */
  activeAnomalyCount: number
  /** 最近异常摘要（最多 3 个） */
  recentAnomalies: Array<{
    type: string
    severity: string
    description: string
    timestamp: number
  }>
  /** 系统指标摘要（仅关键指标） */
  systemMetrics: {
    cpuUsage: number | null
    memoryUsage: number | null
    diskUsage: number | null
  } | null
}

function getActiveScenarioIdentity() {
  const scenario = scenarioRegistry.getActive()
  if (scenario) {
    return {
      systemPrompt: scenario.identity.systemPrompt,
      securityRules: scenario.identity.securityRules,
      conventions: scenario.identity.conventions,
      workflow: scenario.identity.workflow,
      outputFormat: scenario.identity.outputFormat || OUTPUT_FORMAT,
      toolGuidelines: scenario.identity.toolGuidelines || TOOL_GUIDELINES,
    }
  }
  return {
    systemPrompt: APP_IDENTITY,
    securityRules: SECURITY_RULES,
    conventions: CODE_CONVENTIONS,
    workflow: WORKFLOW_GUIDELINES,
    outputFormat: OUTPUT_FORMAT,
    toolGuidelines: TOOL_GUIDELINES,
  }
}

function buildTools(mode: WorkMode, templateId?: string, planPhase?: 'planning' | 'executing'): string {
  const excludeCategories: ToolCategory[] = []
  const activeScenario = scenarioRegistry.getActive()
  const scenarioToolPacks = activeScenario?.capabilities?.toolPacks
  const allowedTools = getToolsForContext({ mode, templateId, planPhase, scenarioToolPacks })
  const baseTools = generateToolsPromptDescriptionFiltered(excludeCategories, allowedTools)
  const { toolGuidelines } = getActiveScenarioIdentity()

  return `## Available Tools

${baseTools}

${toolGuidelines}`
}

function buildEnvironment(ctx: PromptContext): string {
  const now = new Date(ctx.date)
  const dateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
  const timeStr = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const weekday = now.toLocaleDateString('zh-CN', { weekday: 'long' })
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone

  return `## Environment
- OS: ${ctx.os}
- Workspace: ${ctx.workspacePath || 'No workspace open'}
- Active File: ${ctx.activeFile || 'None'}
- Open Files: ${ctx.openFiles.length > 0 ? ctx.openFiles.join(', ') : 'None'}
- Current Date: ${dateStr} ${weekday}
- Current Time: ${timeStr}
- Timezone: ${tz}
- ISO: ${ctx.date}

IMPORTANT: The above date and time are the REAL current time from the user's system. Always use this as the current time reference. Do NOT rely on your training data's knowledge cutoff date for any time-sensitive information.`
}

function buildProjectRules(rules: ProjectRules | null): string | null {
  if (!rules?.content) return null
  return `## Project Rules
${rules.content}`
}

function buildKnowledge(entries: KnowledgeEntry[]): string | null {
  const enabled = entries.filter(e => e.enabled)
  if (enabled.length === 0) return null

  const lines: string[] = []
  let estimatedTokens = 0
  const maxTokens = 1500

  const starredFirst = [...enabled.filter(e => e.starred), ...enabled.filter(e => !e.starred)]

  for (const entry of starredFirst) {
    const tag = entry.tags.length > 0 ? ` [${entry.tags.join(',')}]` : ''
    const line = `- [${entry.category}]${tag} ${entry.content}`
    const lineTokens = Math.ceil(line.length / 4)
    if (estimatedTokens + lineTokens > maxTokens) break
    lines.push(line)
    estimatedTokens += lineTokens
  }

  if (lines.length === 0) return null
  return `## Knowledge Base
${lines.join('\n')}`
}

function buildLongTermMemory(entries: MemoryEntry[], tokenBudget: number = 1500): string | null {
  const enabled = entries.filter(e => e.enabled && e.content.trim())
  if (enabled.length === 0) return null

  const longTermFirst = [...enabled.filter(e => e.status === 'long_term'), ...enabled.filter(e => e.status === 'short_term')]
  const lines: string[] = []
  let estimatedTokens = 0
  const recalledIds: string[] = []

  for (const entry of longTermFirst) {
    const line = `- ${entry.content}`
    const lineTokens = Math.ceil(line.length / 4)
    if (estimatedTokens + lineTokens > tokenBudget) break
    lines.push(line)
    estimatedTokens += lineTokens
    recalledIds.push(entry.id)
  }

  if (recalledIds.length > 0) {
    longTermMemoryService.recordBulkRecall(recalledIds).catch(() => {})
  }

  if (lines.length === 0) return null
  return `## Memory
Important facts and preferences remembered from past conversations:

${lines.join('\n')}`
}

function buildCustomInstructions(instructions: string | null): string | null {
  if (!instructions?.trim()) return null
  return `## Custom Instructions
${instructions.trim()}`
}

function buildProjectSummary(summary: string | null): string | null {
  if (!summary?.trim()) return null

  logger.agent.info('[PromptBuilder] Injecting project summary into system prompt, length:', summary.length)
  return `## Project Overview
${summary.trim()}

Note: This is an auto-generated project summary. Use it to understand the codebase structure before exploring files.`
}

function buildSkillsSections(autoSkills: SkillItem[], mentionedSkills: SkillItem[]): (string | null)[] {
  const index = skillService.buildSkillsIndex(autoSkills) || null
  const fullContent = skillService.buildSkillsPrompt(mentionedSkills) || null
  return [index, fullContent]
}

/**
 * 渲染场景动态上下文段落。
 * 由 active scenario 的 getDynamicContext() 提供，例如场景开发助手的"当前选中项目"信息。
 */
function buildScenarioDynamicContext(content: string | null | undefined): string | null {
  if (!content?.trim()) return null
  return content.trim()
}

/**
 * 调用 active scenario 的 getDynamicContext 获取实时上下文。
 * 异常时降级为 null，不影响主流程。
 */
async function loadScenarioDynamicContext(): Promise<string | null> {
  const scenario = scenarioRegistry.getActive()
  if (!scenario?.getDynamicContext) return null
  try {
    return await scenario.getDynamicContext()
  } catch (err) {
    logger.agent.warn('[PromptBuilder] getDynamicContext failed:', err)
    return null
  }
}

function buildUserContext(userInfo: UserInfo | null | undefined): string | null {
  if (!userInfo) return null
  const lines: string[] = []
  const displayName = userInfo.realName || userInfo.username
  if (displayName) {
    lines.push(`- Name: ${displayName}`)
  }
  if (userInfo.occupation) {
    lines.push(`- Occupation: ${userInfo.occupation}`)
  }
  if (userInfo.gender) {
    const genderMap: Record<string, string> = {
      male: 'Male',
      female: 'Female',
      other: 'Other',
    }
    lines.push(`- Gender: ${genderMap[userInfo.gender] || userInfo.gender}`)
  }
  if (lines.length === 0) return null
  return `## Current User\nYou are chatting with the following user. Use this information to personalize your responses (e.g., address them by name, consider their profession). Do NOT mention these details unless relevant.\n\n${lines.join('\n')}`
}

function buildModeSpecificSections(modeDescriptor: ModeDescriptor): string | null {
  const sections = modeDescriptor.promptProfile.additionalSections
  if (!sections || sections.length === 0) return null

  const modeName = modeDescriptor.displayName
  const header = `## ${modeName} Mode Directives`
  const body = sections.join('\n\n')

  return `${header}\n\n${body}`
}

/**
 * 构建感知预测上下文段落
 *
 * 将当前场景、预测建议、代码影响分析注入系统提示词，
 * 让 AI 能基于物理感知数据做出更贴合用户习惯的决策。
 *
 * 注入策略：
 * - 仅在 perceptionContext 非空时注入
 * - 预测建议作为"参考"提供，不强制 AI 采纳
 * - 代码影响分析提示 AI 关注高风险文件
 *
 * 阶段9 s9-01 扩展：
 * - 新增 IoT 上下文（连接的 Provider、实体、传感器异常）
 * - 新增因果推理上下文（因果图规模、最近反事实查询）
 * - 新增监控上下文（活跃异常、系统指标摘要）
 */
function buildPerceptionContext(ctx: PerceptionContext | null | undefined): string | null {
  if (!ctx) return null

  const parts: string[] = []

  // 1. 当前场景
  if (ctx.currentScene) {
    const scene = ctx.currentScene
    parts.push(
      `- Current Scene: app=${scene.app}, activity=${scene.activity}`,
    )
    if (scene.textSummary) {
      parts.push(`- Scene Summary: ${scene.textSummary.slice(0, 200)}`)
    }
  }

  // 2. 预测建议
  if (ctx.predictions && ctx.predictions.length > 0) {
    const predLines = ctx.predictions.slice(0, 3).map((p, i) => {
      const pct = Math.round(p.confidence * 100)
      return `  ${i + 1}. ${p.actionType}: ${p.target.slice(0, 60)} (${pct}% confidence)`
    })
    parts.push(`- Predicted Next Actions (reference only, do NOT auto-execute):`)
    parts.push(...predLines)
  }

  // 3. 代码影响分析
  if (ctx.codeImpact && ctx.codeImpact.overallLevel !== 'none') {
    const impact = ctx.codeImpact
    parts.push(
      `- Code Impact: ${impact.overallLevel.toUpperCase()} level, ${impact.totalImpactedFiles} files affected, ${impact.highRiskCount} high-risk`,
    )
    if (impact.summary) {
      parts.push(`- Impact Summary: ${impact.summary.slice(0, 200)}`)
    }
  }

  // 4. IoT 上下文（阶段9 s9-01）
  if (ctx.iotContext) {
    const iot = ctx.iotContext
    if (iot.bridgeRunning && iot.totalProviders > 0) {
      parts.push(
        `- IoT Bridge: ${iot.connectedProviders}/${iot.totalProviders} providers connected, ${iot.totalEntities} entities tracked`,
      )
      if (iot.providers.length > 0) {
        const provLines = iot.providers.slice(0, 5).map((p) => {
          const stale = p.secondsSinceLastReading !== null && p.secondsSinceLastReading > 120
          return `  - ${p.name} (${p.protocol}, ${p.state}, ${p.entityCount} entities${
            p.secondsSinceLastReading !== null
              ? `, last reading ${p.secondsSinceLastReading}s ago${stale ? ' [STALE]' : ''}`
              : ''
          })`
        })
        parts.push(...provLines)
      }
      if (iot.recentEntities.length > 0) {
        const entLines = iot.recentEntities.slice(0, 5).map((e) => {
          const stateStr = typeof e.state === 'boolean' ? (e.state ? 'on' : 'off') : String(e.state)
          const unitStr = e.unit ? ` ${e.unit}` : ''
          return `  - ${e.externalId} (${e.entityType}): ${stateStr}${unitStr}`
        })
        parts.push(`- Recent Entity Changes:`)
        parts.push(...entLines)
      }
      if (iot.recentAnomalyCount > 0) {
        parts.push(`- Sensor Anomalies (24h): ${iot.recentAnomalyCount} detected`)
        if (iot.recentAnomalies.length > 0) {
          const anomLines = iot.recentAnomalies.slice(0, 3).map(
            (a) => `  - [${a.severity}] ${a.type} on ${a.entityExternalId}: ${a.description.slice(0, 80)}`,
          )
          parts.push(...anomLines)
        }
      }
    }
  }

  // 5. 因果推理上下文（阶段9 s9-01）
  if (ctx.causalContext && ctx.causalContext.enabled && ctx.causalContext.nodeCount > 0) {
    const causal = ctx.causalContext
    parts.push(
      `- Causal Graph: ${causal.nodeCount} nodes, ${causal.edgeCount} edges, density=${causal.density.toFixed(3)}${causal.hasCycle ? ' [HAS CYCLE]' : ''}`,
    )
    if (causal.recentQueryCount > 0) {
      parts.push(`- Counterfactual Queries (24h): ${causal.recentQueryCount}`)
      if (causal.recentQueries.length > 0) {
        const qLines = causal.recentQueries.slice(0, 3).map(
          (q) =>
            `  - [${q.queryType}] ${q.interventionVar} → ${q.observedVar}: ${q.impactLevel}${q.success ? '' : ' (failed)'}`,
        )
        parts.push(...qLines)
      }
    }
  }

  // 6. 监控上下文（阶段9 s9-01）
  if (ctx.monitoringContext && ctx.monitoringContext.running) {
    const mon = ctx.monitoringContext
    if (mon.activeAnomalyCount > 0) {
      parts.push(`- Active System Anomalies: ${mon.activeAnomalyCount}`)
      if (mon.recentAnomalies.length > 0) {
        const anomLines = mon.recentAnomalies.slice(0, 3).map((a) => {
          const ageMin = Math.round((Date.now() - a.timestamp) / 60000)
          return `  - [${a.severity}] ${a.type}: ${a.description.slice(0, 80)} (${ageMin}min ago)`
        })
        parts.push(...anomLines)
      }
    }
    if (mon.systemMetrics) {
      const m = mon.systemMetrics
      const metricsParts: string[] = []
      if (m.cpuUsage !== null) metricsParts.push(`CPU=${m.cpuUsage.toFixed(1)}%`)
      if (m.memoryUsage !== null) metricsParts.push(`Mem=${m.memoryUsage.toFixed(1)}%`)
      if (m.diskUsage !== null) metricsParts.push(`Disk=${m.diskUsage.toFixed(1)}%`)
      if (metricsParts.length > 0) {
        parts.push(`- System Metrics: ${metricsParts.join(', ')}`)
      }
    }
  }

  if (parts.length === 0) return null

  return `## Perception Context
The following context is derived from local physical perception (screen scenes, behavior history, code dependency analysis), IoT bridge (connected sensors/devices), causal reasoning (cause-effect graph), and system monitoring (anomalies/metrics). Use it to better understand the user's current environment and proactively assist, but do NOT auto-execute predicted actions or IoT device controls without user confirmation.

${parts.join('\n')}`
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const identity = getActiveScenarioIdentity()
  const sections: (string | null)[] = [
    ctx.personality,
    identity.systemPrompt,
    PROFESSIONAL_OBJECTIVITY,
    LANGUAGE_MATCHING,
    identity.securityRules,
    buildTools(ctx.mode, ctx.templateId, ctx.planPhase),
    identity.conventions,
    identity.workflow,
    identity.outputFormat,
    buildModeSpecificSections(ctx.modeDescriptor),
    buildEnvironment(ctx),
    buildUserContext(ctx.userInfo),
    buildProjectSummary(ctx.projectSummary || null),
    buildProjectRules(ctx.projectRules),
    buildLongTermMemory(ctx.longTermMemories),
    buildKnowledge(ctx.knowledgeEntries),
    ...buildSkillsSections(ctx.autoSkills, ctx.mentionedSkills),
    buildScenarioDynamicContext(ctx.scenarioDynamicContext),
    buildPerceptionContext(ctx.perceptionContext),
    buildCustomInstructions(ctx.customInstructions),
  ]

  return sections.filter(Boolean).join('\n\n')
}

export function buildChatPrompt(ctx: PromptContext): string {
  const identity = getActiveScenarioIdentity()
  const sections: (string | null)[] = [
    ctx.personality,
    identity.systemPrompt,
    PROFESSIONAL_OBJECTIVITY,
    LANGUAGE_MATCHING,
    identity.securityRules,
    buildTools(ctx.mode, ctx.templateId, ctx.planPhase),
    identity.conventions,
    identity.outputFormat,
    buildModeSpecificSections(ctx.modeDescriptor),
    buildEnvironment(ctx),
    buildUserContext(ctx.userInfo),
    buildProjectRules(ctx.projectRules),
    buildLongTermMemory(ctx.longTermMemories),
    ...buildSkillsSections(ctx.autoSkills, ctx.mentionedSkills),
    buildScenarioDynamicContext(ctx.scenarioDynamicContext),
    buildPerceptionContext(ctx.perceptionContext),
    buildCustomInstructions(ctx.customInstructions),
  ]

  return sections.filter(Boolean).join('\n\n')
}

export async function buildAgentSystemPrompt(
  mode: WorkMode,
  workspacePath: string | null,
  options?: {
    openFiles?: string[]
    activeFile?: string
    customInstructions?: string
    promptTemplateId?: string
    planPhase?: 'planning' | 'executing'
    mentionedSkills?: string[]
    userMessage?: string
    /** 阶段2：感知预测上下文 */
    perceptionContext?: PerceptionContext | null
  }
): Promise<{ prompt: string; activeSkills: { name: string; description: string }[]; appliedSkills: { name: string; description: string }[] }> {
  const {
    openFiles = [],
    activeFile,
    customInstructions,
    promptTemplateId,
    planPhase,
    mentionedSkills,
    userMessage,
    perceptionContext,
  } = options || {}

  let template = promptTemplateId
    ? getPromptTemplateById(promptTemplateId)
    : getDefaultPromptTemplate()

  if (!template) {
    logger.agent.warn(`[PromptBuilder] Template not found: ${promptTemplateId}, falling back to default.`)
    template = getDefaultPromptTemplate()
  }

  const [projectRules, memories, knowledgeEntries, longTermMemories, allSkills, projectSummary, scenarioDynamicContext] = await Promise.all([
    rulesService.getRules(),
    memoryService.getMemories(),
    knowledgeService.getEnabledEntries(),
    longTermMemoryService.getEnabledEntries(),
    skillService.getSkills(),
    workspacePath ? loadProjectSummary(workspacePath) : Promise.resolve(null),
    loadScenarioDynamicContext(),
  ])

  const autoSkills = allSkills.filter(skill => skill.type === 'auto' && skill.enabled)
  const mentionedManualSkills = mentionedSkills?.length
    ? allSkills.filter(skill =>
        skill.type === 'manual' &&
        skill.enabled &&
        mentionedSkills.includes(skill.name.toLowerCase())
      )
    : []

  const keywordMatchedSkills = userMessage
    ? skillService.matchSkillsByKeywords(allSkills, userMessage)
    : []

  const fullInjectionSkills: typeof allSkills = []
  const fullInjectionNames = new Set<string>()

  for (const skill of [...mentionedManualSkills, ...keywordMatchedSkills]) {
    if (!fullInjectionNames.has(skill.name)) {
      fullInjectionNames.add(skill.name)
      fullInjectionSkills.push(skill)
    }
  }

  const indexOnlySkills = autoSkills.filter(s => !fullInjectionNames.has(s.name))

  const activeSkillNames = new Set<string>()
  const activeSkillsList: typeof allSkills = []

  for (const skill of [...autoSkills, ...fullInjectionSkills]) {
    if (!activeSkillNames.has(skill.name)) {
      activeSkillNames.add(skill.name)
      activeSkillsList.push(skill)
    }
  }

  const cloudUser = useStore.getState().cloudUser
  const userInfo: UserInfo | null = cloudUser
    ? {
        username: cloudUser.username,
        realName: cloudUser.realName,
        gender: cloudUser.gender,
        occupation: cloudUser.occupation,
      }
    : null

  const modeDescriptor = modeRegistry.getOrDefault(mode)

  const ctx: PromptContext = {
    os: getOS(),
    workspacePath,
    activeFile: activeFile || null,
    openFiles,
    date: new Date().toISOString(),
    mode,
    modeDescriptor,
    personality: template.personality,
    projectRules,
    memories,
    knowledgeEntries,
    longTermMemories,
    userQuery: userMessage,
    autoSkills: indexOnlySkills,
    mentionedSkills: fullInjectionSkills,
    customInstructions: customInstructions || null,
    templateId: template.id,
    projectSummary,
    planPhase,
    userInfo,
    scenarioDynamicContext,
    perceptionContext: perceptionContext ?? null,
  }

  const prompt = mode === 'chat' ? buildChatPrompt(ctx) : buildSystemPrompt(ctx)

  return {
    prompt,
    activeSkills: activeSkillsList.map(skill => ({
      name: skill.name,
      description: skill.description,
    })),
    // 仅关键词匹配触发完整注入的技能（用于 UI "已应用技能" 提示）
    appliedSkills: fullInjectionSkills.map(skill => ({
      name: skill.name,
      description: skill.description,
    })),
  }
}

function getOS(): string {
  if (typeof navigator !== 'undefined') {
    return navigator.userAgentData?.platform || navigator.platform || 'Unknown'
  }
  return 'Unknown'
}

export function formatUserMessage(
  message: string,
  context?: {
    selections?: Array<{
      type: 'file' | 'code' | 'folder'
      path: string
      content?: string
      range?: [number, number]
    }>
  }
): string {
  let formatted = message

  if (context?.selections && context.selections.length > 0) {
    const selectionsStr = context.selections
      .map(selection => {
        if (selection.type === 'code' && selection.content && selection.range) {
          return `**${selection.path}** (lines ${selection.range[0]}-${selection.range[1]}):\n\`\`\`\n${selection.content}\n\`\`\``
        }

        if (selection.type === 'file' && selection.content) {
          return `**${selection.path}**:\n\`\`\`\n${selection.content}\n\`\`\``
        }

        return `**${selection.path}**`
      })
      .join('\n\n')

    formatted += `\n\n---\n**Context:**\n${selectionsStr}`
  }

  return formatted
}

export function formatToolResult(toolName: string, result: string, success: boolean): string {
  return success ? result : `Error executing ${toolName}: ${result}`
}
