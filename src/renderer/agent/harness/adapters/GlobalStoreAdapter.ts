import { useStore } from '@/renderer/store'
import type { IGlobalStore } from '../kernel/Token'

export class GlobalStoreAdapter implements IGlobalStore {
  getState(): unknown {
    return useStore.getState()
  }

  setState(partial: unknown): void {
    useStore.setState(partial as Parameters<typeof useStore.setState>[0])
  }
}
