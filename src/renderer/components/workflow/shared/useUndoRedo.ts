import { useState, useCallback, useRef } from 'react'
import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2'

interface HistoryEntry {
  workflow: WorkflowDefinitionV2
  description: string
  timestamp: number
}

const MAX_HISTORY_SIZE = 50

export function useUndoRedo(_initialWorkflow: WorkflowDefinitionV2 | null) {
  const [past, setPast] = useState<HistoryEntry[]>([])
  const [future, setFuture] = useState<HistoryEntry[]>([])
  const skipRecordRef = useRef(false)

  const canUndo = past.length > 0
  const canRedo = future.length > 0

  const recordSnapshot = useCallback(
    (workflow: WorkflowDefinitionV2 | null, description: string) => {
      if (!workflow || skipRecordRef.current) {
        skipRecordRef.current = false
        return
      }
      setPast(prev => {
        const entry: HistoryEntry = {
          workflow: JSON.parse(JSON.stringify(workflow)),
          description,
          timestamp: Date.now(),
        }
        const next = [...prev, entry]
        if (next.length > MAX_HISTORY_SIZE) {
          return next.slice(next.length - MAX_HISTORY_SIZE)
        }
        return next
      })
      setFuture([])
    },
    [],
  )

  const undo = useCallback(
    (currentWorkflow: WorkflowDefinitionV2 | null): WorkflowDefinitionV2 | null => {
      if (past.length === 0 || !currentWorkflow) return currentWorkflow

      const previous = past[past.length - 1]
      const currentSnapshot: HistoryEntry = {
        workflow: JSON.parse(JSON.stringify(currentWorkflow)),
        description: 'redo-point',
        timestamp: Date.now(),
      }

      setFuture(prev => [...prev, currentSnapshot])
      setPast(prev => prev.slice(0, -1))

      return JSON.parse(JSON.stringify(previous.workflow))
    },
    [past],
  )

  const redo = useCallback(
    (currentWorkflow: WorkflowDefinitionV2 | null): WorkflowDefinitionV2 | null => {
      if (future.length === 0 || !currentWorkflow) return currentWorkflow

      const next = future[future.length - 1]
      const currentSnapshot: HistoryEntry = {
        workflow: JSON.parse(JSON.stringify(currentWorkflow)),
        description: 'undo-point',
        timestamp: Date.now(),
      }

      setPast(prev => [...prev, currentSnapshot])
      setFuture(prev => prev.slice(0, -1))

      return JSON.parse(JSON.stringify(next.workflow))
    },
    [future],
  )

  const skipNextRecord = useCallback(() => {
    skipRecordRef.current = true
  }, [])

  const clearHistory = useCallback(() => {
    setPast([])
    setFuture([])
  }, [])

  return {
    canUndo,
    canRedo,
    recordSnapshot,
    undo,
    redo,
    skipNextRecord,
    clearHistory,
  }
}
