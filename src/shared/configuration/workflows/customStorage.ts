import type { WorkflowDefinition } from '@shared/protocols/workflow'
import { StorageService } from '@shared/toolkit/StorageService'

const STORAGE_KEY = 'custom_workflows'

export function loadCustomWorkflows(): WorkflowDefinition[] {
  try {
    const data = StorageService.get<WorkflowDefinition[]>(STORAGE_KEY)
    if (!data || !Array.isArray(data)) return []
    return data
  } catch {
    return []
  }
}

export function saveCustomWorkflow(wf: WorkflowDefinition): void {
  try {
    const existing = loadCustomWorkflows()
    const idx = existing.findIndex(w => w.id === wf.id)
    if (idx >= 0) {
      existing[idx] = wf
    } else {
      existing.push(wf)
    }
    StorageService.set(STORAGE_KEY, existing)
  } catch {
    // ignore
  }
}

export function deleteCustomWorkflow(workflowId: string): void {
  try {
    const existing = loadCustomWorkflows()
    const filtered = existing.filter(w => w.id !== workflowId)
    StorageService.set(STORAGE_KEY, filtered)
  } catch {
    // ignore
  }
}
