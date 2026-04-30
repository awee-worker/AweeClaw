import { aweeclawDir, type AgentSessionSnapshot } from './aweeclawDirService'

class AgentSessionRepository {
  getSnapshot(): Promise<AgentSessionSnapshot | null> {
    return aweeclawDir.getAgentSessionSnapshot()
  }

  stageSnapshot(snapshot: AgentSessionSnapshot): void {
    aweeclawDir.stageAgentSessionSnapshot(snapshot)
  }

  loadThreadMessages(threadId: string): Promise<any[]> {
    return aweeclawDir.loadThreadMessages(threadId)
  }

  deleteThread(threadId: string): Promise<void> {
    return aweeclawDir.deleteThreadData(threadId)
  }

  clear(): Promise<void> {
    return aweeclawDir.clearAllSessions()
  }

  flush(): Promise<void> {
    return aweeclawDir.flush()
  }
}

export const agentSessionRepository = new AgentSessionRepository()
export type { AgentSessionSnapshot }
