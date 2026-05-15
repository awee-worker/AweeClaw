import type { WorkflowDefinition } from '@shared/protocols/workflow'

const STORAGE_KEY = 'aweeclaw_custom_workflows'

export function loadCustomWorkflows(): WorkflowDefinition[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as WorkflowDefinition[]
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing))
  } catch {
    // ignore
  }
}

export function deleteCustomWorkflow(workflowId: string): void {
  try {
    const existing = loadCustomWorkflows()
    const filtered = existing.filter(w => w.id !== workflowId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
  } catch {
    // ignore
  }
}
