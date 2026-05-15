/**
 * Workspace Manager adapter for renderer process
 */
export interface WorkspaceInfo {
  path: string
  name: string
  isOpen: boolean
}

export class WorkspaceManager {
  private currentWorkspace: WorkspaceInfo | null = null

  async open(path: string): Promise<WorkspaceInfo> {
    this.currentWorkspace = {
      path,
      name: path.split('/').pop() || 'workspace',
      isOpen: true,
    }
    return this.currentWorkspace
  }

  getCurrent(): WorkspaceInfo | null {
    return this.currentWorkspace
  }

  async close(): Promise<void> {
    this.currentWorkspace = null
  }
}

export const workspaceManager = new WorkspaceManager()
