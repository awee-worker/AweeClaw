import { api } from '../../../adapters/electronBridge'
import type { IElectronAPI } from '../kernel/Token'

export class ElectronAPIAdapter implements IElectronAPI {
  get file() {
    return {
      read: (path: string) => api.file.read(path),
      write: (path: string, content: string) => api.file.write(path, content),
      exists: (path: string) => api.file.exists(path),
      mkdir: (path: string) => api.file.mkdir(path),
      delete: (path: string) => api.file.delete(path),
      rename: (oldPath: string, newPath: string) => api.file.rename(oldPath, newPath),
      readDir: (path: string) => api.file.readDir(path),
    }
  }

  get shell() {
    return {
      execute: (command: string, cwd?: string) =>
        api.shell.executeSecure({ command, cwd: cwd ?? '', timeout: 30000 }).then(r => ({
          exitCode: r.exitCode ?? 1,
          stdout: r.output ?? '',
          stderr: r.errorOutput ?? '',
        })),
    }
  }
}
