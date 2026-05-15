import { useAgentStore } from '../../state/IntelligenceStore'
import type { IAgentStore } from '../kernel/Token'

export class AgentStoreAdapter implements IAgentStore {
  getState(): unknown {
    return useAgentStore.getState()
  }

  setState(partial: unknown): void {
    useAgentStore.setState(partial as Parameters<typeof useAgentStore.setState>[0])
  }

  forThread(threadId: string): { setExecutionMeta(meta: unknown): void; setStreamState(state: unknown): void } {
    const store = useAgentStore.getState().forThread(threadId)
    return {
      setExecutionMeta(meta: unknown) { store.setExecutionMeta(meta as Parameters<typeof store.setExecutionMeta>[0]) },
      setStreamState(state: unknown) { store.setStreamState(state as Parameters<typeof store.setStreamState>[0]) },
    }
  }
}
