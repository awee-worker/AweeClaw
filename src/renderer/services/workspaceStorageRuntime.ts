import { aweeclawDir } from './aweeclawDirService'

class WorkspaceStorageRuntime {
  initializeRoot(rootPath: string): Promise<boolean> {
    return aweeclawDir.initialize(rootPath)
  }

  async initializeRoots(rootPaths: string[]): Promise<void> {
    await Promise.all(rootPaths.map(rootPath => this.initializeRoot(rootPath)))
  }

  bindPrimaryRoot(rootPath: string): Promise<void> {
    return aweeclawDir.setPrimaryRoot(rootPath)
  }

  isReady(): boolean {
    return aweeclawDir.isInitialized()
  }

  flush(): Promise<void> {
    return aweeclawDir.flush()
  }

  reset(): void {
    aweeclawDir.reset()
  }
}

export const workspaceStorageRuntime = new WorkspaceStorageRuntime()
