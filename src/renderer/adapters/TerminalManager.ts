/**
 * 渲染进程终端管理适配器 — 通过 IPC 与主进程通信
 */
export interface TerminalInstance {
  id: string
  cwd: string
  isActive: boolean
}

export class TerminalManager {
  private terminals = new Map<string, TerminalInstance>()

  async create(cwd?: string): Promise<TerminalInstance> {
    const id = `term-${Date.now()}`
    const instance: TerminalInstance = { id, cwd: cwd || '/', isActive: true }
    this.terminals.set(id, instance)
    return instance
  }

  async destroy(id: string): Promise<void> {
    this.terminals.delete(id)
  }

  getActive(): TerminalInstance | undefined {
    for (const term of this.terminals.values()) {
      if (term.isActive) return term
    }
    return undefined
  }

  list(): TerminalInstance[] {
    return Array.from(this.terminals.values())
  }
}

export const terminalManager = new TerminalManager()
