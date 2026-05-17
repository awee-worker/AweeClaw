import type { WorkMode } from '@protocols/workModeProtocol'
import type { CompressionLevel } from '../context/compressionUtils'

export interface ToolPolicy {
  enabled: boolean
  requireApproval?: boolean
}

export interface PromptProfile {
  baseTemplate?: string
  includeWorkspaceContext: boolean
  includeOpenFiles: boolean
  includeActiveFile: boolean
  includeCustomInstructions: boolean
  additionalSections?: string[]
}

export interface ContextProfile {
  includeFullHistory: boolean
  includeToolHistory: boolean
  includeSummaryContext: boolean
  includePlanContext: boolean
  maxContextItems?: number
  contextPriority?: ('history' | 'tools' | 'summary' | 'plan' | 'dependencies')[]
}

export interface BudgetProfile {
  targetRatio: number
  reservedOutputTokens: number
  reservedSafetyTokens: number
  initialCompressionLevel: CompressionLevel
  enableAutoCompression: boolean
  enableSummaryGeneration: boolean
  enableHandoffGeneration: boolean
}

export interface PersistenceProfile {
  persistThread: boolean
  persistMessages: boolean
  persistContextItems: boolean
  persistCompressionStats: boolean
  persistSummary: boolean
  restoreOnStartup: boolean
}

export interface ModeDescriptor {
  id: WorkMode
  displayName: string
  description: string
  toolPolicy: ToolPolicy
  promptProfile: PromptProfile
  contextProfile: ContextProfile
  budgetProfile: BudgetProfile
  persistenceProfile: PersistenceProfile
}

export const CHAT_MODE_DESCRIPTOR: ModeDescriptor = {
  id: 'chat',
  displayName: 'Quick',
  description: '适用于大部分情况 — 快速响应，轻量上下文',
  toolPolicy: {
    enabled: true,
    requireApproval: false,
  },
  promptProfile: {
    includeWorkspaceContext: false,
    includeOpenFiles: true,
    includeActiveFile: true,
    includeCustomInstructions: true,
    additionalSections: [
      'Quick Mode: Prioritize speed and efficiency. Give concise, direct answers. Minimize tool usage — only use tools when absolutely necessary to answer the question. Prefer answering from your own knowledge. Do NOT over-analyze or provide excessive detail unless explicitly requested.',
      'Response Style: Keep responses short and to the point. One-sentence answers are ideal for simple questions. Skip preamble and postamble. Do NOT show your reasoning process unless asked.',
    ],
  },
  contextProfile: {
    includeFullHistory: true,
    includeToolHistory: true,
    includeSummaryContext: false,
    includePlanContext: false,
    maxContextItems: 8,
    contextPriority: ['history', 'tools'],
  },
  budgetProfile: {
    targetRatio: 0.6,
    reservedOutputTokens: 4096,
    reservedSafetyTokens: 1024,
    initialCompressionLevel: 0,
    enableAutoCompression: true,
    enableSummaryGeneration: false,
    enableHandoffGeneration: false,
  },
  persistenceProfile: {
    persistThread: true,
    persistMessages: true,
    persistContextItems: true,
    persistCompressionStats: true,
    persistSummary: false,
    restoreOnStartup: true,
  },
}

export const AGENT_MODE_DESCRIPTOR: ModeDescriptor = {
  id: 'agent',
  displayName: 'Think',
  description: '擅长解决更难的问题 — 深度推理，丰富上下文',
  toolPolicy: {
    enabled: true,
    requireApproval: true,
  },
  promptProfile: {
    includeWorkspaceContext: true,
    includeOpenFiles: true,
    includeActiveFile: true,
    includeCustomInstructions: true,
    additionalSections: [
      'Think Mode: Engage deep reasoning before acting. Always think step by step — analyze the problem thoroughly, consider edge cases, explore multiple approaches, and provide well-reasoned solutions. Show your reasoning process to help the user understand your logic.',
      'Proactive Analysis: Before answering, consider what information you might be missing. Use tools proactively to gather context (read files, search codebase, check dependencies). Do NOT guess when you can verify.',
      'Structured Thinking: Break complex problems into sub-problems. Address each sub-problem methodically. Synthesize findings into a coherent response. Highlight assumptions and potential risks.',
    ],
  },
  contextProfile: {
    includeFullHistory: true,
    includeToolHistory: true,
    includeSummaryContext: true,
    includePlanContext: false,
    maxContextItems: 15,
    contextPriority: ['summary', 'tools', 'history'],
  },
  budgetProfile: {
    targetRatio: 0.85,
    reservedOutputTokens: 8192,
    reservedSafetyTokens: 4096,
    initialCompressionLevel: 0,
    enableAutoCompression: true,
    enableSummaryGeneration: true,
    enableHandoffGeneration: true,
  },
  persistenceProfile: {
    persistThread: true,
    persistMessages: true,
    persistContextItems: true,
    persistCompressionStats: true,
    persistSummary: true,
    restoreOnStartup: true,
  },
}

export const PLAN_MODE_DESCRIPTOR: ModeDescriptor = {
  id: 'plan',
  displayName: 'Expert',
  description: '研究级智能模式 — 深度思考、制定计划、执行任务、事后验证',
  toolPolicy: {
    enabled: true,
    requireApproval: false,
  },
  promptProfile: {
    includeWorkspaceContext: true,
    includeOpenFiles: true,
    includeActiveFile: true,
    includeCustomInstructions: true,
    additionalSections: [
      'Expert Mode: MAXIMUM PRIVILEGE — full access to ALL tools (built-in, MCP, Skills) with no approval required. Use this power responsibly. This mode is for complex, multi-step tasks that require deep expertise and comprehensive execution.',
      'Four-Phase Expert Workflow (MANDATORY): (1) Deep Thinking — Thoroughly analyze the problem, research the codebase, understand dependencies and constraints. (2) Plan — Create a detailed execution plan with clear steps and success criteria. (3) Execute — Implement the plan systematically, making changes file by file. (4) Verify — After each write operation, verify the result (lint, test, read-back). Never skip deep analysis. Never skip verification after write operations.',
      'MCP and Skill tools are available in ALL phases for deep analysis. Use them proactively for comprehensive understanding. Leverage external tools when they can provide better insights or capabilities.',
      'Expert Standards: Provide production-quality output. Consider performance, security, maintainability, and edge cases. Document your reasoning. When multiple approaches exist, explain trade-offs and justify your choice. After completing tasks, summarize what was done and suggest follow-up improvements.',
    ],
  },
  contextProfile: {
    includeFullHistory: true,
    includeToolHistory: true,
    includeSummaryContext: true,
    includePlanContext: true,
    contextPriority: ['plan', 'dependencies', 'summary', 'tools', 'history'],
  },
  budgetProfile: {
    targetRatio: 0.9,
    reservedOutputTokens: 16384,
    reservedSafetyTokens: 4096,
    initialCompressionLevel: 0,
    enableAutoCompression: true,
    enableSummaryGeneration: true,
    enableHandoffGeneration: true,
  },
  persistenceProfile: {
    persistThread: true,
    persistMessages: true,
    persistContextItems: true,
    persistCompressionStats: true,
    persistSummary: true,
    restoreOnStartup: true,
  },
}

export const PLAN_TASK_WORKER_DESCRIPTOR: ModeDescriptor = {
  id: 'agent',
  displayName: 'Expert Task Worker',
  description: 'Background worker for expert plan task execution',
  toolPolicy: {
    enabled: true,
    requireApproval: false,
  },
  promptProfile: {
    includeWorkspaceContext: true,
    includeOpenFiles: false,
    includeActiveFile: false,
    includeCustomInstructions: false,
  },
  contextProfile: {
    includeFullHistory: false,
    includeToolHistory: true,
    includeSummaryContext: false,
    includePlanContext: true,
    maxContextItems: 10,
    contextPriority: ['plan', 'dependencies', 'tools'],
  },
  budgetProfile: {
    targetRatio: 0.8,
    reservedOutputTokens: 8192,
    reservedSafetyTokens: 2048,
    initialCompressionLevel: 1,
    enableAutoCompression: true,
    enableSummaryGeneration: false,
    enableHandoffGeneration: false,
  },
  persistenceProfile: {
    persistThread: false,
    persistMessages: false,
    persistContextItems: false,
    persistCompressionStats: false,
    persistSummary: false,
    restoreOnStartup: false,
  },
}
