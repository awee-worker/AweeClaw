import { api } from '../../../adapters/electronBridge'
import type { IFileService } from '../kernel/Token'
import { getDirname } from '@shared/toolkit/pathHelper'

export class FileServiceAdapter implements IFileService {
  async read(path: string): Promise<string | null> {
    return api.file.read(path)
  }

  async write(path: string, content: string): Promise<boolean> {
    return api.file.write(path, content)
  }

  async exists(path: string): Promise<boolean> {
    return api.file.exists(path)
  }

  async mkdir(path: string): Promise<boolean> {
    return api.file.mkdir(path)
  }

  async delete(path: string): Promise<boolean> {
    return api.file.delete(path)
  }

  async rename(oldPath: string, newPath: string): Promise<boolean> {
    return api.file.rename(oldPath, newPath)
  }

  async readDir(path: string): Promise<string[] | null> {
    return api.file.readDir(path)
  }

  getDirname(path: string): string {
    return getDirname(path)
  }
}
