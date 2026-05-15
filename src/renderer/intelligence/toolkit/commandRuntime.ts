/**
 * Command Runtime for tool execution
 */
export interface CommandContext {
  workingDirectory: string
  environment?: Record<string, string>
  timeout?: number
}

export interface CommandResult {
  exitCode: number
  stdout: string
  stderr: string
  duration: number
}

export class CommandRuntime {
  async execute(_command: string, _args: string[], _context: CommandContext): Promise<CommandResult> {
    return {
      exitCode: -1,
      stdout: '',
      stderr: 'CommandRuntime: not available in renderer process',
      duration: 0,
    }
  }
}
