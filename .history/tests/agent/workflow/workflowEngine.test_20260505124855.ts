import { describe, it, expect, beforeEach } from 'vitest'
import { workflowEngine } from '@shared/types/workflow'
import type {
  WorkflowDefinition,
  DAGValidationResult,
  SafeCondition,
} from '@shared/types/workflow'

const simpleWorkflow: WorkflowDefinition = {
  id: 'test-simple',
  name: 'Simple Test',
  nameZh: '简单测试',
  description: 'A simple test workflow',
  descriptionZh: '简单测试工作流',
  version: '1.0.0',
  author: 'test',
  category: 'custom',
  tags: [],
  startStep: 'step1',
  steps: {
    step1: {
      id: 'step1',
      name: 'Step 1',
      type: 'delay',
      config: { type: 'delay', durationMs: 10 },
      next: 'step2',
    },
    step2: {
      id: 'step2',
      name: 'Step 2',
      type: 'delay',
      config: { type: 'delay', durationMs: 10 },
    },
  },
}

const cyclicWorkflow: WorkflowDefinition = {
  id: 'test-cyclic',
  name: 'Cyclic Test',
  nameZh: '循环测试',
  description: 'A cyclic workflow',
  descriptionZh: '循环工作流',
  version: '1.0.0',
  author: 'test',
  category: 'custom',
  tags: [],
  startStep: 'step1',
  steps: {
    step1: {
      id: 'step1',
      name: 'Step 1',
      type: 'delay',
      config: { type: 'delay', durationMs: 10 },
      next: 'step2',
    },
    step2: {
      id: 'step2',
      name: 'Step 2',
      type: 'delay',
      config: { type: 'delay', durationMs: 10 },
      next: 'step1',
    },
  },
}

const missingStepWorkflow: WorkflowDefinition = {
  id: 'test-missing',
  name: 'Missing Step Test',
  nameZh: '缺失步骤测试',
  description: 'A workflow with missing step',
  descriptionZh: '缺失步骤工作流',
  version: '1.0.0',
  author: 'test',
  category: 'custom',
  tags: [],
  startStep: 'step1',
  steps: {
    step1: {
      id: 'step1',
      name: 'Step 1',
      type: 'delay',
      config: { type: 'delay', durationMs: 10 },
      next: 'nonexistent',
    },
  },
}

const conditionWorkflow: WorkflowDefinition = {
  id: 'test-condition',
  name: 'Condition Test',
  nameZh: '条件测试',
  description: 'A workflow with conditions',
  descriptionZh: '条件工作流',
  version: '1.0.0',
  author: 'test',
  category: 'custom',
  tags: [],
  startStep: 'check',
  steps: {
    check: {
      id: 'check',
      name: 'Check',
      type: 'condition',
      config: {
        type: 'condition',
        expression: 'score > 50',
        safeConditions: [{ variable: 'score', operator: 'gt', value: 50 }],
        thenStep: 'pass',
        elseStep: 'fail',
      },
    },
    pass: {
      id: 'pass',
      name: 'Pass',
      type: 'delay',
      config: { type: 'delay', durationMs: 10 },
    },
    fail: {
      id: 'fail',
      name: 'Fail',
      type: 'delay',
      config: { type: 'delay', durationMs: 10 },
    },
  },
}

describe('WorkflowEngine DAG Validation', () => {
  it('validates a simple valid workflow', () => {
    const result = workflowEngine.validateDAG(simpleWorkflow)
    expect(result.valid).toBe(true)
    expect(result.errors.length).toBe(0)
  })

  it('detects cycles', () => {
    const result = workflowEngine.validateDAG(cyclicWorkflow)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.type === 'cycle')).toBe(true)
  })

  it('detects missing step references', () => {
    const result = workflowEngine.validateDAG(missingStepWorkflow)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.type === 'missing_step')).toBe(true)
  })

  it('detects missing start step', () => {
    const badWorkflow = { ...simpleWorkflow, startStep: 'nonexistent' }
    const result = workflowEngine.validateDAG(badWorkflow)
    expect(result.valid).toBe(false)
    expect(result.errors.some(e => e.type === 'missing_step')).toBe(true)
  })

  it('warns about unreachable steps', () => {
    const unreachableWorkflow: WorkflowDefinition = {
      ...simpleWorkflow,
      steps: {
        ...simpleWorkflow.steps,
        orphan: {
          id: 'orphan',
          name: 'Orphan',
          type: 'delay',
          config: { type: 'delay', durationMs: 10 },
        },
      },
    }
    const result = workflowEngine.validateDAG(unreachableWorkflow)
    expect(result.warnings.some(w => w.type === 'unreachable')).toBe(true)
  })

  it('warns about agent steps without error handlers', () => {
    const noHandlerWorkflow: WorkflowDefinition = {
      id: 'test-no-handler',
      name: 'No Handler',
      nameZh: '无处理器',
      description: 'Test',
      descriptionZh: '测试',
      version: '1.0.0',
      author: 'test',
      category: 'custom',
      tags: [],
      startStep: 'agent1',
      steps: {
        agent1: {
          id: 'agent1',
          name: 'Agent',
          type: 'agent_message',
          config: { type: 'agent_message', message: 'Hello', waitForResponse: true },
        },
      },
    }
    const result = workflowEngine.validateDAG(noHandlerWorkflow)
    expect(result.warnings.some(w => w.type === 'no_error_handler')).toBe(true)
  })
})

describe('WorkflowEngine Safe Condition Evaluation', () => {
  beforeEach(() => {
    workflowEngine.register(conditionWorkflow)
  })

  it('executes condition with safe conditions (then branch)', async () => {
    const run = await workflowEngine.start('test-condition', { score: 80 })
    expect(run.status).toBe('completed')
    expect(run.stepHistory.some(s => s.stepId === 'pass')).toBe(true)
    expect(run.stepHistory.some(s => s.stepId === 'fail')).toBe(false)
  })

  it('executes condition with safe conditions (else branch)', async () => {
    const run = await workflowEngine.start('test-condition', { score: 30 })
    expect(run.status).toBe('completed')
    expect(run.stepHistory.some(s => s.stepId === 'fail')).toBe(true)
    expect(run.stepHistory.some(s => s.stepId === 'pass')).toBe(false)
  })
})

describe('WorkflowEngine Snapshot and Rollback', () => {
  it('creates snapshots in step results', async () => {
    workflowEngine.register(simpleWorkflow)
    const run = await workflowEngine.start('test-simple')
    expect(run.stepHistory.length).toBeGreaterThan(0)
    for (const result of run.stepHistory) {
      expect(result.snapshot).toBeDefined()
      expect(result.snapshot!.variables).toBeDefined()
      expect(result.snapshot!.timestamp).toBeGreaterThan(0)
    }
  })

  it('rollbackStep restores previous state', async () => {
    const retryWorkflow: WorkflowDefinition = {
      id: 'test-rollback',
      name: 'Rollback Test',
      nameZh: '回滚测试',
      description: 'Test rollback',
      descriptionZh: '回滚测试',
      version: '1.0.0',
      author: 'test',
      category: 'custom',
      tags: [],
      startStep: 'step1',
      variables: { counter: 0 },
      steps: {
        step1: {
          id: 'step1',
          name: 'Step 1',
          type: 'delay',
          config: { type: 'delay', durationMs: 10 },
          next: 'step2',
        },
        step2: {
          id: 'step2',
          name: 'Step 2',
          type: 'delay',
          config: { type: 'delay', durationMs: 10 },
        },
      },
    }
    workflowEngine.register(retryWorkflow)
    const run = await workflowEngine.start('test-rollback', { counter: 0 })

    expect(run.stepHistory.length).toBe(2)

    const rolledBack = workflowEngine.rollbackStep(run.id, 0)
    expect(rolledBack).toBe(true)

    const updatedRun = workflowEngine.getRun(run.id)
    expect(updatedRun!.stepHistory.length).toBe(1)
    expect(updatedRun!.currentStepId).toBe('step1')
  })

  it('rollbackStep returns false for invalid run', () => {
    expect(workflowEngine.rollbackStep('nonexistent', 0)).toBe(false)
  })
})

describe('WorkflowEngine Retry with Counter', () => {
  it('respects max retries', async () => {
    let callCount = 0
    const flakyWorkflow: WorkflowDefinition = {
      id: 'test-retry',
      name: 'Retry Test',
      nameZh: '重试测试',
      description: 'Test retry',
      descriptionZh: '重试测试',
      version: '1.0.0',
      author: 'test',
      category: 'custom',
      tags: [],
      startStep: 'flaky',
      steps: {
        flaky: {
          id: 'flaky',
          name: 'Flaky Step',
          type: 'agent_message',
          config: { type: 'agent_message', message: 'Do something', waitForResponse: true },
          onError: { action: 'retry', maxRetries: 2, retryDelayMs: 10 },
        },
      },
    }

    workflowEngine.register(flakyWorkflow)
    workflowEngine.setCallbacks({
      sendMessageToAgent: async () => {
        callCount++
        throw new Error('Intentional failure')
      },
      requestUserInput: async () => null,
    })

    const run = await workflowEngine.start('test-retry')
    expect(run.status).toBe('failed')
    expect(run.error).toContain('Max retries')
    expect(callCount).toBe(3)
  })
})
