import { logger } from '@utils/Logger'
import { longTermMemory } from './LongTermMemory'
import { projectKnowledgeGraph } from './ProjectKnowledgeGraph'

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
  generate: (ctx: AdaptivePromptContext) => string
  estimatedTokens: number
  priority: number
}

export class AdaptivePromptEngine {
  private strategies: PromptStrategy[] = []
  private maxContextTokens: number

  constructor(maxContextTokens: number = 3000) {
    this.maxContextTokens = maxContextTokens
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
        const section = strategy.generate(context)
        if (section) {
          contextSections.push(section)
          totalTokens += strategy.estimatedTokens
        }
      } catch (error) {
        logger.agent.warn(`[AdaptivePrompt] Strategy ${strategy.id} failed:`, error)
      }
    }

    const memoryPrompt = longTermMemory.buildContextPrompt(context.query, Math.min(800, this.maxContextTokens - totalTokens))
    if (memoryPrompt) {
      contextSections.push(memoryPrompt)
      totalTokens += Math.ceil(memoryPrompt.length / 4)
    }

    if (context.currentFile) {
      const fileEntities = projectKnowledgeGraph.search(context.currentFile, 5)
      if (fileEntities.length > 0) {
        const graphPrompt = projectKnowledgeGraph.buildContextPrompt(
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

    const systemPromptAddition = contextSections.join('\n\n')

    return {
      systemPromptAddition,
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
        generate: (ctx) => {
          const errorSolutions = longTermMemory.getByType('error_solution')
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
        condition: (ctx) => {
          const decisions = longTermMemory.getByType('decision')
          return decisions.length > 0
        },
        generate: () => {
          const decisions = longTermMemory.getByType('decision').slice(0, 5)
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
        condition: () => {
          const prefs = longTermMemory.getByType('preference')
          return prefs.length > 0
        },
        generate: () => {
          const prefs = longTermMemory.getByType('preference').slice(0, 5)
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
        generate: (ctx) => {
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
}

export const adaptivePromptEngine = new AdaptivePromptEngine()
