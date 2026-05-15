import { fileCacheService } from '../../runtime/fileCacheManager'
import type { IFileCacheService } from '../kernel/Token'

export class FileCacheServiceAdapter implements IFileCacheService {
  hasValidCache(filePath: string): boolean {
    return fileCacheService.hasValidCache(filePath)
  }

  markFileAsRead(filePath: string, content: string): void {
    fileCacheService.markFileAsRead(filePath, content)
  }

  getCachedContent(_filePath: string): string | null {
    return fileCacheService.getFileHash(_filePath)
  }

  invalidate(_filePath: string): void {
    fileCacheService.clear()
  }

  invalidateAll(): void {
    fileCacheService.clear()
  }
}
