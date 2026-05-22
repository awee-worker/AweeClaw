import type {
  WorkflowDefinition,
  WorkflowStep,
  AgentMessageConfig,
  UserInputConfig,
  ConditionConfig,
  ParallelConfig,
  DelayConfig,
} from '@shared/protocols/workflow'
import type {
  WorkflowDefinitionV2,
  WorkflowNodeV2,
  WorkflowEdgeV2,
  WorkflowNodeData,
  WorkflowVariable,
} from '@shared/protocols/workflowV2'
import { createDefaultNodeData } from './defaultData'

function generateNodeId(stepId: string): string {
  return stepId
}

function mapStepTypeToNodeType(step: WorkflowStep): WorkflowNodeV2['type'] {
  switch (step.type) {
    case 'agent_message':
      return 'agent_task'
    case 'user_input':
      return (step.config as UserInputConfig).approvalMode ? 'user_approval' : 'user_input'
    case 'condition':
      return 'condition'
    case 'parallel':
      return 'parallel'
    case 'delay':
      return 'delay'
    default:
      return 'agent_task'
  }
}

function buildNodeData(step: WorkflowStep): WorkflowNodeData {
  const base: WorkflowNodeData = {
    ...createDefaultNodeData(mapStepTypeToNodeType(step)),
    description: step.nameZh || step.name,
    timeout: step.timeout,
  }

  if (step.roleId) {
    base.roleId = step.roleId
  }

  if (step.onError) {
    base.onError = {
      action: step.onError.action,
      gotoNodeId: step.onError.gotoStep,
      maxRetries: step.onError.maxRetries,
      retryDelayMs: step.onError.retryDelayMs,
    }
  }

  switch (step.type) {
    case 'agent_message': {
      const cfg = step.config as AgentMessageConfig
      base.systemPrompt = cfg.message
      base.outputVar = cfg.outputVar || 'result'
      break
    }
    case 'user_input': {
      const cfg = step.config as UserInputConfig
      base.inputType = 'text'
      base.inputOptions = cfg.options?.map(o => ({ label: o.label, value: o.id }))
      base.outputVar = cfg.outputVar
      break
    }
    case 'condition': {
      const cfg = step.config as ConditionConfig
      base.conditions = (cfg.safeConditions || []).map((c, i) => ({
        id: `cond-${i}`,
        variable: c.variable,
        operator: c.operator,
        value: c.value,
        targetHandle: 'then',
      }))
      break
    }
    case 'parallel': {
      base.parallelStrategy = 'all'
      break
    }
    case 'delay': {
      const cfg = step.config as DelayConfig
      base.delayMs = cfg.durationMs
      break
    }
  }

  return base
}

export function migrateV1ToV2(v1: WorkflowDefinition): WorkflowDefinitionV2 {
  const nodes: WorkflowNodeV2[] = []
  const edges: WorkflowEdgeV2[] = []
  const stepEntries = Object.entries(v1.steps)

  const visited = new Set<string>()
  const positionMap = new Map<string, { x: number; y: number }>()
  let yCounter = 0

  const getOrAssignPosition = (stepId: string): { x: number; y: number } => {
    if (positionMap.has(stepId)) return positionMap.get(stepId)!
    const pos = { x: 250, y: yCounter * 150 }
    positionMap.set(stepId, pos)
    yCounter++
    return pos
  }

  const processStep = (stepId: string): void => {
    if (visited.has(stepId)) return
    visited.add(stepId)

    const step = v1.steps[stepId]
    if (!step) return

    const position = getOrAssignPosition(stepId)

    nodes.push({
      id: generateNodeId(stepId),
      type: mapStepTypeToNodeType(step),
      name: step.name,
      nameZh: step.nameZh,
      position,
      data: buildNodeData(step),
    })

    if (step.next) {
      edges.push({
        id: `edge-${stepId}-${step.next}`,
        source: generateNodeId(stepId),
        target: generateNodeId(step.next),
        type: 'default',
      })
      getOrAssignPosition(step.next)
      processStep(step.next)
    }

    if (step.type === 'condition') {
      const cfg = step.config as ConditionConfig
      if (cfg.thenStep) {
        edges.push({
          id: `edge-${stepId}-${cfg.thenStep}-then`,
          source: generateNodeId(stepId),
          target: generateNodeId(cfg.thenStep),
          sourceHandle: 'then',
          label: 'Yes',
          type: 'condition',
        })
        getOrAssignPosition(cfg.thenStep)
        processStep(cfg.thenStep)
      }
      if (cfg.elseStep) {
        edges.push({
          id: `edge-${stepId}-${cfg.elseStep}-else`,
          source: generateNodeId(stepId),
          target: generateNodeId(cfg.elseStep),
          sourceHandle: 'else',
          label: 'No',
          type: 'condition',
        })
        getOrAssignPosition(cfg.elseStep)
        processStep(cfg.elseStep)
      }
    }

    if (step.type === 'parallel') {
      const cfg = step.config as ParallelConfig
      for (const parallelStepId of cfg.steps) {
        edges.push({
          id: `edge-${stepId}-${parallelStepId}-parallel`,
          source: generateNodeId(stepId),
          target: generateNodeId(parallelStepId),
          type: 'parallel',
          animated: true,
        })
        getOrAssignPosition(parallelStepId)
        processStep(parallelStepId)
      }
    }
  }

  processStep(v1.startStep)

  for (const [stepId] of stepEntries) {
    if (!visited.has(stepId)) {
      processStep(stepId)
    }
  }

  const variables: WorkflowVariable[] = v1.variables
    ? Object.entries(v1.variables).map(([name, value]) => ({
        name,
        type: (typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : typeof value === 'object' ? 'object' : 'string') as WorkflowVariable['type'],
        defaultValue: value,
        scope: 'workflow' as const,
      }))
    : []

  return {
    id: v1.id,
    name: v1.name,
    nameZh: v1.nameZh,
    description: v1.description,
    descriptionZh: v1.descriptionZh,
    version: v1.version,
    author: v1.author,
    category: v1.category,
    tags: v1.tags,
    icon: v1.icon,
    nodes,
    edges,
    variables,
    inputSchema: v1.inputSchema,
    isCustom: v1.isCustom,
  }
}

export function isV2Definition(def: WorkflowDefinition | WorkflowDefinitionV2): def is WorkflowDefinitionV2 {
  return 'nodes' in def && 'edges' in def && !('steps' in def)
}
