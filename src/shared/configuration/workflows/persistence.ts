import type { WorkflowRun } from '@shared/protocols/workflow'
import { StorageService } from '@shared/toolkit/StorageService'

const STORAGE_KEY = 'workflow_history'
const MAX_HISTORY = 50

export function loadWorkflowHistory(): WorkflowRun[] {
  try {
    const data = StorageService.get<WorkflowRun[]>(STORAGE_KEY)
    if (!data || !Array.isArray(data)) return []
    return data
  } catch {
    return []
  }
}

export function saveWorkflowRun(run: WorkflowRun): void {
  try {
    const history = loadWorkflowHistory()
    const existingIdx = history.findIndex(r => r.id === run.id)
    if (existingIdx >= 0) {
      history[existingIdx] = run
    } else {
      history.unshift(run)
    }
    const trimmed = history.slice(0, MAX_HISTORY)
    StorageService.set(STORAGE_KEY, trimmed)
  } catch {
    // ignore storage errors
  }
}

export function deleteWorkflowRun(runId: string): void {
  try {
    const history = loadWorkflowHistory()
    const filtered = history.filter(r => r.id !== runId)
    StorageService.set(STORAGE_KEY, filtered)
  } catch {
    // ignore
  }
}

export function clearWorkflowHistory(): void {
  try {
    StorageService.remove(STORAGE_KEY)
  } catch {
    // ignore
  }
}
