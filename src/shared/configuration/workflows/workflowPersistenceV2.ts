import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2'
import { StorageService } from '@shared/toolkit/StorageService'

const DEFINITIONS_KEY = 'workflow_definitions_v2'
const MAX_DEFINITIONS = 100

export function loadWorkflowDefinitions(): WorkflowDefinitionV2[] {
  try {
    const data = StorageService.get<WorkflowDefinitionV2[]>(DEFINITIONS_KEY)
    if (!data || !Array.isArray(data)) return []
    return data
  } catch {
    return []
  }
}

export function loadWorkflowDefinition(id: string): WorkflowDefinitionV2 | null {
  const defs = loadWorkflowDefinitions()
  return defs.find(d => d.id === id) || null
}

export function saveWorkflowDefinition(def: WorkflowDefinitionV2): void {
  try {
    const defs = loadWorkflowDefinitions()
    const existingIdx = defs.findIndex(d => d.id === def.id)
    const toSave: WorkflowDefinitionV2 = {
      ...def,
      updatedAt: Date.now(),
    }
    if (existingIdx >= 0) {
      defs[existingIdx] = toSave
    } else {
      defs.unshift(toSave)
    }
    const trimmed = defs.slice(0, MAX_DEFINITIONS)
    StorageService.set(DEFINITIONS_KEY, trimmed)
  } catch {
    // ignore storage errors
  }
}

export function deleteWorkflowDefinition(id: string): void {
  try {
    const defs = loadWorkflowDefinitions()
    const filtered = defs.filter(d => d.id !== id)
    StorageService.set(DEFINITIONS_KEY, filtered)
  } catch {
    // ignore
  }
}

export function duplicateWorkflowDefinition(id: string): WorkflowDefinitionV2 | null {
  const original = loadWorkflowDefinition(id)
  if (!original) return null

  const now = Date.now()
  const duplicate: WorkflowDefinitionV2 = {
    ...JSON.parse(JSON.stringify(original)),
    id: `wf-${now}`,
    name: `${original.name} (Copy)`,
    nameZh: `${original.nameZh} (副本)`,
    createdAt: now,
    updatedAt: now,
  }
  saveWorkflowDefinition(duplicate)
  return duplicate
}

export function exportWorkflowDefinition(def: WorkflowDefinitionV2): string {
  return JSON.stringify(def, null, 2)
}

export function importWorkflowDefinition(json: string): WorkflowDefinitionV2 | null {
  try {
    const parsed = JSON.parse(json)
    if (!parsed.id || !parsed.nodes || !Array.isArray(parsed.nodes)) {
      return null
    }
    const now = Date.now()
    const imported: WorkflowDefinitionV2 = {
      ...parsed,
      id: `wf-${now}`,
      name: parsed.name || 'Imported Workflow',
      nameZh: parsed.nameZh || '导入的工作流',
      createdAt: now,
      updatedAt: now,
    }
    saveWorkflowDefinition(imported)
    return imported
  } catch {
    return null
  }
}
