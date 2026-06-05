import type { WorkflowRunV2 } from '@shared/protocols/workflowV2'
import { StorageService } from '@shared/toolkit/StorageService'

const HISTORY_KEY = 'workflow_history_v2'
const MAX_HISTORY = 50

export function loadWorkflowHistoryV2(): WorkflowRunV2[] {
  try {
    const data = StorageService.get<WorkflowRunV2[]>(HISTORY_KEY)
    if (!data || !Array.isArray(data)) return []
    return data
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
    StorageService.set(HISTORY_KEY, trimmed)
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
      StorageService.set(HISTORY_KEY, history)
    }
  } catch {
    // ignore
  }
}

export function deleteWorkflowRunV2(runId: string): void {
  try {
    const history = loadWorkflowHistoryV2()
    const filtered = history.filter(r => r.id !== runId)
    StorageService.set(HISTORY_KEY, filtered)
  } catch {
    // ignore
  }
}

export function clearWorkflowHistoryV2(): void {
  try {
    StorageService.remove(HISTORY_KEY)
  } catch {
    // ignore
  }
}
