import { logger } from '@utils/Logger'
import { longTermMemoryService } from '../services/longTermMemoryService'
import type { MemoryRetrievalContext, TaskType } from '../services/longTermMemoryService/types'
import { ProjectKnowledgeGraph, projectKnowledgeGraph } from './ProjectKnowledgeGraph'
import { metacognitiveService } from '../services/longTermMemoryService/metacognitiveService'

export interface AdaptivePromptContext {
  query: string
  threadId?: string
  recentMessages?: Array<{ role: string; content: string }>
  currentFile?: string
  workspaceStructure?: string[]
  modelCapabilities?: string[]
}

export interface AdaptivePromptResult {
  systemPromptAddition: string
  contextSections: string[]
  totalEstimatedTokens: number
}

interface PromptStrategy {
  id: string
  condition: (ctx: AdaptivePromptContext) => boolean
  generate: (ctx: AdaptivePromptContext) => Promise<string>
  estimatedTokens: number
  priority: number
}

export class AdaptivePromptEngine {
  private strategies: PromptStrategy[] = []
  private maxContextTokens: number
  private graph: ProjectKnowledgeGraph

  constructor(maxContextTokens: number = 3000, graph?: ProjectKnowledgeGraph) {
    this.maxContextTokens = maxContextTokens
    this.graph = graph ?? projectKnowledgeGraph
    this.registerDefaultStrategies()
  }

  async generateAdaptivePrompt(context: AdaptivePromptContext): Promise<AdaptivePromptResult> {
    const applicableStrategies = this.strategies
      .filter(s => s.condition(context))
      .sort((a, b) => b.priority - a.priority)

    const contextSections: string[] = []
    let totalTokens = 0

    for (const strategy of applicableStrategies) {
      if (totalTokens + strategy.estimatedTokens > this.maxContextTokens) continue

      try {
        const section = await strategy.generate(context)
        if (section) {
          contextSections.push(section)
          totalTokens += strategy.estimatedTokens
        }
      } catch (error) {
        logger.agent.warn(`[AdaptivePrompt] Strategy ${strategy.id} failed:`, error)
      }
    }

    try {
      const memoryPrompt = await this.buildMemoryPrompt(context.query, Math.min(800, this.maxContextTokens - totalTokens))
      if (memoryPrompt) {
        contextSections.push(memoryPrompt)
        totalTokens += Math.ceil(memoryPrompt.length / 4)
      }
    } catch {
    }

    try {
      const retrievalContext: MemoryRetrievalContext = {
        query: context.query,
        currentFile: context.currentFile,
        taskType: this.inferTaskType(context),
        recentTopics: context.recentMessages?.slice(-5).map(m => m.content.slice(0, 50)),
        errorContext: context.recentMessages?.some(m =>
          m.role === 'assistant' && (m.content.includes('Error') || m.content.includes('error'))
        ),
      }
      const contextResults = await longTermMemoryService.contextAwareSearch(retrievalContext, 5)
      if (contextResults.length > 0) {
        const contextLines = contextResults
          .filter(r => r.score > 3)
          .map(r => `- ${r.entry.content}`)
          .slice(0, 5)
        if (contextLines.length > 0) {
          const contextPrompt = `<contextual_memory>
Context-relevant memories:
${contextLines.join('\n')}
</contextual_memory>`
          const contextTokens = Math.ceil(contextPrompt.length / 4)
          if (totalTokens + contextTokens <= this.maxContextTokens) {
            contextSections.push(contextPrompt)
            totalTokens += contextTokens
          }
        }
      }
    } catch {
    }

    if (context.currentFile) {
      const fileEntities = this.graph.search(context.currentFile, 5)
      if (fileEntities.length > 0) {
        const graphPrompt = this.graph.buildContextPrompt(
          fileEntities[0].id,
          1,
          Math.min(600, this.maxContextTokens - totalTokens)
        )
        if (graphPrompt) {
          contextSections.push(graphPrompt)
          totalTokens += Math.ceil(graphPrompt.length / 4)
        }
      }
    }

    try {
      const metaState = await metacognitiveService.assess()
      const metaPrompt = metacognitiveService.buildMetacognitivePrompt(metaState)
      if (metaPrompt && totalTokens + 200 <= this.maxContextTokens) {
        contextSections.push(`<metacognitive>
${metaPrompt}
</metacognitive>`)
        totalTokens += 200
      }
    } catch {
    }

    const finalPromptAddition = contextSections.join('\n\n')

    return {
      systemPromptAddition: finalPromptAddition,
      contextSections,
      totalEstimatedTokens: totalTokens,
    }
  }

  registerStrategy(strategy: PromptStrategy): void {
    this.strategies.push(strategy)
    this.strategies.sort((a, b) => b.priority - a.priority)
  }

  removeStrategy(id: string): void {
    this.strategies = this.strategies.filter(s => s.id !== id)
  }

  private async buildMemoryPrompt(query: string, maxTokens: number): Promise<string> {
    const results = await longTermMemoryService.search({ query, limit: 20 })
    if (results.length === 0) return ''

    const lines: string[] = []
    let estimatedTokens = 0

    for (const result of results) {
      const typeTag = result.entry.tags.find(t => t.startsWith('type:'))
      const type = typeTag ? typeTag.slice(5) : 'memory'
      const line = `[${type}] ${result.entry.content}`
      const estimatedLineTokens = Math.ceil(line.length / 4)

      if (estimatedTokens + estimatedLineTokens > maxTokens) break

      lines.push(line)
      estimatedTokens += estimatedLineTokens
    }

    if (lines.length === 0) return ''

    return `<long_term_memory>
Relevant context from previous interactions:

${lines.join('\n')}
</long_term_memory>`
  }

  private registerDefaultStrategies(): void {
    this.strategies = [
      {
        id: 'error_context',
        priority: 90,
        estimatedTokens: 300,
        condition: (ctx) => {
          if (!ctx.recentMessages || ctx.recentMessages.length === 0) return false
          const lastMsg = ctx.recentMessages[ctx.recentMessages.length - 1]
          return lastMsg.role === 'assistant' &&
            (lastMsg.content.includes('Error') || lastMsg.content.includes('error') || lastMsg.content.includes('failed'))
        },
        generate: async () => {
          const entries = await longTermMemoryService.getEntries()
          const errorSolutions = entries.filter(e =>
            e.enabled && e.tags.includes('type:error_solution')
          )
          if (errorSolutions.length === 0) return ''
          const recent = errorSolutions.slice(0, 3)
          return `<error_context>
Known error solutions:
${recent.map(e => `- ${e.content}`).join('\n')}
</error_context>`
        },
      },
      {
        id: 'project_decisions',
        priority: 70,
        estimatedTokens: 400,
        condition: async () => {
          const entries = await longTermMemoryService.getEntries()
          return entries.some(e => e.enabled && e.tags.includes('type:decision'))
        },
        generate: async () => {
          const entries = await longTermMemoryService.getEntries()
          const decisions = entries.filter(e => e.enabled && e.tags.includes('type:decision')).slice(0, 5)
          if (decisions.length === 0) return ''
          return `<project_decisions>
Key architectural decisions:
${decisions.map(d => `- ${d.content}`).join('\n')}
</project_decisions>`
        },
      },
      {
        id: 'user_preferences',
        priority: 80,
        estimatedTokens: 300,
        condition: async () => {
          const entries = await longTermMemoryService.getEntries()
          return entries.some(e => e.enabled && e.tags.includes('type:preference'))
        },
        generate: async () => {
          const entries = await longTermMemoryService.getEntries()
          const prefs = entries.filter(e => e.enabled && e.tags.includes('type:preference')).slice(0, 5)
          if (prefs.length === 0) return ''
          return `<user_preferences>
User coding preferences:
${prefs.map(p => `- ${p.content}`).join('\n')}
</user_preferences>`
        },
      },
      {
        id: 'workspace_structure',
        priority: 50,
        estimatedTokens: 500,
        condition: (ctx) => {
          return !!ctx.workspaceStructure && ctx.workspaceStructure.length > 0
        },
        generate: async (ctx) => {
          if (!ctx.workspaceStructure) return ''
          const structure = ctx.workspaceStructure.slice(0, 30)
          return `<workspace_structure>
Project file structure:
${structure.map(f => `  ${f}`).join('\n')}
</workspace_structure>`
        },
      },
    ]
  }

  private inferTaskType(context: AdaptivePromptContext): TaskType {
    const query = context.query.toLowerCase()
    const recentContent = context.recentMessages?.slice(-3).map(m => m.content.toLowerCase()).join(' ') ?? ''

    if (query.includes('debug') || query.includes('fix') || query.includes('error') || recentContent.includes('error')) return 'debugging'
    if (query.includes('refactor') || query.includes('improve') || query.includes('optimize')) return 'refactoring'
    if (query.includes('architect') || query.includes('design') || query.includes('structure')) return 'architecture'
    if (query.includes('test') || query.includes('spec') || query.includes('coverage')) return 'testing'
    if (query.includes('doc') || query.includes('readme') || query.includes('comment')) return 'documentation'
    return 'coding'
  }
}

export const adaptivePromptEngine = new AdaptivePromptEngine()
