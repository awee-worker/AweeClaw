import type { WorkflowRun } from '@shared/protocols/workflow'

const STORAGE_KEY = 'aweeclaw_workflow_history'
const MAX_HISTORY = 50

export function loadWorkflowHistory(): WorkflowRun[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as WorkflowRun[]
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // ignore storage errors
  }
}

export function deleteWorkflowRun(runId: string): void {
  try {
    const history = loadWorkflowHistory()
    const filtered = history.filter(r => r.id !== runId)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered))
  } catch {
    // ignore
  }
}

export function clearWorkflowHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}
