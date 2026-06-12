import { aweeclawDir, type AgentSessionSnapshot } from './appDirService'
import { fromPersistedChatThread } from '@intelligence/types/dialogThreadModel'
import type { ChatThread } from '@intelligence/providerTypes'
import { api } from './electronBridge'

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

  /** 按线程 ID 从数据库加载单个线程（含消息），用于切换到不在 store 中的历史线程 */
  async loadThreadById(threadId: string): Promise<ChatThread | null> {
    const meta = await api.sessionDb.getThreadMeta(threadId)
    if (!meta) return null
    const messages = await api.sessionDb.getThreadMessages(threadId)
    const thread = fromPersistedChatThread({ ...meta, messages })
    thread.messagesHydrated = true
    return thread
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
