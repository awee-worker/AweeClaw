import { fileCacheService } from '../../services/fileCacheService'
import type { IFileCacheService } from '../kernel/Token'

export class FileCacheServiceAdapter implements IFileCacheService {
  hasValidCache(filePath: string): boolean {
    return fileCacheService.hasValidCache(filePath)
  }

  markFileAsRead(filePath: string, content: string): void {
    fileCacheService.markFileAsRead(filePath, content)
  }

  getCachedContent(filePath: string): string | null {
    return fileCacheService.getCachedContent(filePath)
  }

  invalidate(filePath: string): void {
    fileCacheService.invalidate(filePath)
  }

  invalidateAll(): void {
    fileCacheService.invalidateAll()
  }
}
