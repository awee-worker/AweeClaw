import { aweeclawDir } from './appDirService'

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

  /** 轻量级绑定 — 仅创建目录，不初始化 SQLite，用于启动关键路径 */
  bindPrimaryRootLite(rootPath: string): Promise<void> {
    return aweeclawDir.setPrimaryRootLite(rootPath)
  }

  /** 初始化存储引擎 — SQLite + 数据迁移 + 全量加载，首屏渲染后调用 */
  initializeStorage(): Promise<void> {
    return aweeclawDir.initializeStorage()
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
