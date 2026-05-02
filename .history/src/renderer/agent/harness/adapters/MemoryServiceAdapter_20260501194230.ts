import { memoryService } from '../../services/memoryService'
import type { IMemoryService } from '../kernel/Token'

export class MemoryServiceAdapter implements IMemoryService {
  async getEnabled() {
    return memoryService.getEnabled()
  }

  async add(content: string): Promise<void> {
    return memoryService.add(content)
  }

  async remove(id: string): Promise<void> {
    return memoryService.remove(id)
  }

  async toggle(id: string, enabled: boolean): Promise<void> {
    return memoryService.toggle(id, enabled)
  }
}
