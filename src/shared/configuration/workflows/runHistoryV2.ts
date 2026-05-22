import type { WorkflowRunV2 } from '@shared/protocols/workflowV2'

const HISTORY_KEY = 'aweeclaw_workflow_history_v2'
const MAX_HISTORY = 50

export function loadWorkflowHistoryV2(): WorkflowRunV2[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed as WorkflowRunV2[]
  } catch {
    return []
  }
}

export function saveWorkflowRunV2(run: WorkflowRunV2): void {
  try {
    const history = loadWorkflowHistoryV2()
    const existingIdx = history.findIndex(r => r.id === run.id)
    if (existingIdx >= 0) {
      history[existingIdx] = run
    } else {
      history.unshift(run)
    }
    const trimmed = history.slice(0, MAX_HISTORY)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(trimmed))
  } catch {
    // ignore storage errors
  }
}

export function updateWorkflowRunStatusV2(runId: string, updates: Partial<WorkflowRunV2>): void {
  try {
    const history = loadWorkflowHistoryV2()
    const idx = history.findIndex(r => r.id === runId)
    if (idx >= 0) {
      history[idx] = { ...history[idx], ...updates }
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
    }
  } catch {
    // ignore
  }
}

export function deleteWorkflowRunV2(runId: string): void {
  try {
    const history = loadWorkflowHistoryV2()
    const filtered = history.filter(r => r.id !== runId)
    localStorage.setItem(HISTORY_KEY, JSON.stringify(filtered))
  } catch {
    // ignore
  }
}

export function clearWorkflowHistoryV2(): void {
  try {
    localStorage.removeItem(HISTORY_KEY)
  } catch {
    // ignore
  }
}
