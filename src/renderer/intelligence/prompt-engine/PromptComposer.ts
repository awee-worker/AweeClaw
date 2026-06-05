/**
 * Prompt builder for agent and chat modes.
 *
 * 支持场景插件系统：从当前活跃的 ScenarioPlugin 获取身份、安全规则、
 * 代码规范和工作流指南，而非硬编码在 promptTemplates.ts 中。
 * 向后兼容：如果没有活跃场景，回退到 promptTemplates 中的常量。
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
  }
): Promise<{ prompt: string; activeSkills: { name: string; description: string }[] }> {
  const {
    openFiles = [],
    activeFile,
    customInstructions,
    promptTemplateId,
    planPhase,
    mentionedSkills,
    userMessage,
  } = options || {}

  let template = promptTemplateId
    ? getPromptTemplateById(promptTemplateId)
    : getDefaultPromptTemplate()

  if (!template) {
    logger.agent.warn(`[PromptBuilder] Template not found: ${promptTemplateId}, falling back to default.`)
    template = getDefaultPromptTemplate()
  }

  const [projectRules, memories, knowledgeEntries, longTermMemories, allSkills, projectSummary] = await Promise.all([
    rulesService.getRules(),
    memoryService.getMemories(),
    knowledgeService.getEnabledEntries(),
    longTermMemoryService.getEnabledEntries(),
    skillService.getSkills(),
    workspacePath ? loadProjectSummary(workspacePath) : Promise.resolve(null),
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
  }

  const prompt = mode === 'chat' ? buildChatPrompt(ctx) : buildSystemPrompt(ctx)

  return {
    prompt,
    activeSkills: activeSkillsList.map(skill => ({
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
