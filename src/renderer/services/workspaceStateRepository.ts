import { aweeclawDir, type WorkspaceStateData } from './aweeclawDirService'

class WorkspaceStateRepository {
  get(): Promise<WorkspaceStateData> {
    return aweeclawDir.getWorkspaceState()
  }

  save(state: WorkspaceStateData): Promise<void> {
    return aweeclawDir.saveWorkspaceState(state)
  }

  flush(): Promise<void> {
    return aweeclawDir.flush()
  }
}

export const workspaceStateRepository = new WorkspaceStateRepository()
export type { WorkspaceStateData }
