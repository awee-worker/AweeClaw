export interface QuickCommand {
  name: string
  description: string
  aliases?: string[]
  handler: (args: string, ctx: QuickCommandContext) => QuickCommandResult
}

export interface QuickCommandContext {
  activeFilePath?: string
  selectedCode?: string
  workspacePath?: string
}

export interface QuickCommandResult {
  prompt: string
  mode?: 'chat' | 'agent'
}

export type SlashCommand = QuickCommand
export type SlashCommandContext = QuickCommandContext
export type SlashCommandResult = QuickCommandResult

function composePrompt(action: string, args: string, ctx: QuickCommandContext): string {
  let prompt = action
  if (args.trim()) prompt += `: ${args}`
  if (ctx.selectedCode) {
    prompt += `\n\nSelected code:\n\`\`\`\n${ctx.selectedCode}\n\`\`\``
  } else if (ctx.activeFilePath) {
    prompt += ` for file: ${ctx.activeFilePath}`
  }
  return prompt
}

const builtinCommands: QuickCommand[] = [
  {
    name: 'test',
    aliases: ['tests'],
    description: 'Generate unit tests for the selected code or file',
    handler: (args, ctx) => ({
      prompt: composePrompt('Generate comprehensive unit tests', args, ctx),
      mode: 'agent',
    }),
  },
  {
    name: 'explain',
    aliases: ['doc', 'docs'],
    description: 'Explain the selected code or file',
    handler: (args, ctx) => ({
      prompt: composePrompt('Explain this code in detail', args, ctx),
      mode: 'chat',
    }),
  },
  {
    name: 'refactor',
    aliases: ['clean'],
    description: 'Refactor and improve the code quality',
    handler: (args, ctx) => ({
      prompt: composePrompt('Refactor this code to improve readability and maintainability', args, ctx),
      mode: 'agent',
    }),
  },
  {
    name: 'fix',
    aliases: ['debug'],
    description: 'Fix bugs or issues in the code',
    handler: (args, ctx) => ({
      prompt: composePrompt('Find and fix bugs in this code', args, ctx),
      mode: 'agent',
    }),
  },
  {
    name: 'optimize',
    aliases: ['perf'],
    description: 'Optimize code for performance',
    handler: (args, ctx) => ({
      prompt: composePrompt('Optimize this code for better performance', args, ctx),
      mode: 'agent',
    }),
  },
  {
    name: 'comment',
    aliases: ['annotate'],
    description: 'Add comments and documentation',
    handler: (args, ctx) => ({
      prompt: composePrompt('Add clear comments and documentation to this code', args, ctx),
      mode: 'agent',
    }),
  },
  {
    name: 'type',
    aliases: ['types', 'typescript'],
    description: 'Add TypeScript types',
    handler: (args, ctx) => ({
      prompt: composePrompt('Add proper TypeScript types to this code', args, ctx),
      mode: 'agent',
    }),
  },
]

class QuickCommandRegistry {
  private registry: QuickCommand[] = [...builtinCommands]

  list(): QuickCommand[] {
    return this.registry
  }

  getCommands(): QuickCommand[] {
    return this.registry
  }

  match(inputText: string): QuickCommand[] {
    if (!inputText.startsWith('/')) return []
    const query = inputText.slice(1).toLowerCase().split(' ')[0]
    if (!query) return this.registry
    return this.registry.filter(cmd => {
      if (cmd.name.toLowerCase().startsWith(query)) return true
      return cmd.aliases?.some(a => a.toLowerCase().startsWith(query)) ?? false
    })
  }

  findMatching(inputText: string): QuickCommand[] {
    return this.match(inputText)
  }

  execute(inputText: string, context: QuickCommandContext): QuickCommandResult | null {
    if (!inputText.startsWith('/')) return null
    const parts = inputText.slice(1).split(' ')
    const cmdName = parts[0].toLowerCase()
    const args = parts.slice(1).join(' ')
    const cmd = this.registry.find(c => {
      if (c.name.toLowerCase() === cmdName) return true
      return c.aliases?.some(a => a.toLowerCase() === cmdName) ?? false
    })
    return cmd ? cmd.handler(args, context) : null
  }

  parse(inputText: string, context: QuickCommandContext): QuickCommandResult | null {
    return this.execute(inputText, context)
  }

  isCommand(text: string): boolean {
    return text.startsWith('/') && this.execute(text, {}) !== null
  }

  register(command: QuickCommand): void {
    this.registry.push(command)
  }
}

export const quickCommandRegistry = new QuickCommandRegistry()
export const slashCommandService = quickCommandRegistry
