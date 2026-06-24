/**
 * 工作区管理器适配器
 *
 * 提供工作区的打开、切换、查询等能力。
 */

/* ------------------------------------------------------------------ */
/* 类型定义                                                            */
/* ------------------------------------------------------------------ */

/** 工作区信息 */
export interface WorkspaceInfo {
  /** 工作区路径 */
  path: string
  /** 工作区名称 */
  name: string
  /** 是否已打开 */
  isOpen: boolean
}

/* ------------------------------------------------------------------ */
/* 工作区管理器                                                        */
/* ------------------------------------------------------------------ */

/**
 * 工作区管理器
 *
 * 负责管理当前工作区状态，支持打开、切换、查询等操作。
 */
export class WorkspaceManager {
  private currentWorkspace: WorkspaceInfo | null = null
  private readonly recentWorkspaces: WorkspaceInfo[] = []

  /**
   * 打开工作区
   *
   * @param path 工作区路径
   * @returns 工作区信息
   */
  async open(path: string): Promise<WorkspaceInfo> {
    this.currentWorkspace = {
      path,
      name: path.split('/').pop() || 'workspace',
      isOpen: true,
    }
    return this.currentWorkspace
  }

  /**
   * 打开文件夹（兼容旧 API）
   *
   * @param path 文件夹路径
   * @returns 工作区信息
   */
  async openFolder(path: string): Promise<WorkspaceInfo> {
    return this.open(path)
  }

  /**
   * 切换到指定工作区
   *
   * @param path 目标工作区路径
   * @returns 工作区信息
   */
  async switchTo(path: string): Promise<WorkspaceInfo> {
    return this.open(path)
  }

  /**
   * 获取当前工作区
   *
   * @returns 工作区信息，未打开则返回 null
   */
  getCurrent(): WorkspaceInfo | null {
    return this.currentWorkspace
  }

  /**
   * 获取当前工作区路径
   *
   * @returns 工作区路径，未打开则返回 null
   */
  getCurrentWorkspacePath(): string | null {
    return this.currentWorkspace?.path || null
  }

  /**
   * 关闭当前工作区
   */
  async close(): Promise<void> {
    this.currentWorkspace = null
  }

  /**
   * 获取最近打开的工作区列表
   *
   * @returns 工作区信息列表
   */
  getRecentWorkspaces(): WorkspaceInfo[] {
    return [...this.recentWorkspaces]
  }
}

/** 全局工作区管理器实例 */
export const workspaceManager = new WorkspaceManager()
