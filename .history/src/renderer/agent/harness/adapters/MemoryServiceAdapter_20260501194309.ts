import { memoryService } from '../../services/memoryService'
import type { IMemoryService } from '../kernel/Token'

export class MemoryServiceAdapter implements IMemoryService {
  async getEnabled() {
    const items = await memoryService.getMemories()
    return items.filter(m => m.enabled)
  }

  async add(content: string): Promise<void> {
    await memoryService.addMemory(content)
  }

  async remove(id: string): Promise<void> {
    await memoryService.deleteMemory(id)
  }

  async toggle(id: string, enabled: boolean): Promise<void> {
    await memoryService.updateMemory(id, { enabled })
  }
}
