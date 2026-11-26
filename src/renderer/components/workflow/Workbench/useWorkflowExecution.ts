import { useState, useCallback, useRef, useMemo } from 'react';
import { workflowSSEClient, type RunEvent } from '@shared/configuration/workflows/workflowSSEClient';
import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2';
import type { NodeExecutionRecord, NodeDisplayStatus, WorkflowRunV2 } from './runnerTypes';
import { startLocalWorkflowRun, type LocalRunHandle } from './localWorkflowRunner';

export type RunStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

/**
 * 执行位置。
 *
 * 默认 local：只有渲染进程能访问已安装技能与插件工具（toolManager / skillService），
 * 后端进程既没有技能目录也没有这份工具注册表。需要后端执行器能力（http_request、
 * agent_task 等）时再显式传 server。
 */
export type ExecutionMode = 'local' | 'server';

export interface UseWorkflowExecutionOptions {
  mode?: ExecutionMode;
}

export interface ExecutionState {
  status: RunStatus;
  runId: string | null;
  currentNodeId: string | null;
  nodeHistory: Map<string, NodeExecutionRecord>;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
}

function mapSSEStatusToNodeStatus(sseStatus: string | undefined): NodeExecutionRecord['status'] {
  switch (sseStatus) {
    case 'running':
      return 'running';
    case 'SUCCESS':
      return 'completed';
    case 'FAILED':
      return 'failed';
    case 'SKIPPED':
      return 'skipped';
    default:
      return 'pending';
  }
}

export function useWorkflowExecution(
  workflow: WorkflowDefinitionV2,
  options: UseWorkflowExecutionOptions = {},
) {
  const mode: ExecutionMode = options.mode ?? 'local';

  const [state, setState] = useState<ExecutionState>({
    status: 'idle',
    runId: null,
    currentNodeId: null,
    nodeHistory: new Map(),
    startedAt: null,
    completedAt: null,
    error: null,
  });

  const abortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const executionOrder = useMemo(
    () => {
      const nodeIds = workflow.nodes.map((n) => n.id);
      return nodeIds;
    },
    [workflow.nodes],
  );

  const entryNodes = useMemo(
    () => {
      const targetIds = new Set(workflow.edges.map((e) => e.target));
      return workflow.nodes.filter((n) => !targetIds.has(n.id));
    },
    [workflow.nodes, workflow.edges],
  );

  const getNodeStatus = useCallback(
    (nodeId: string): NodeDisplayStatus => {
      const record = state.nodeHistory instanceof Map
        ? state.nodeHistory.get(nodeId)
        : (state.nodeHistory as NodeExecutionRecord[]).find(r => r.nodeId === nodeId);
      if (record) {
        if (record.status === 'completed') return 'completed';
        if (record.status === 'failed') return 'failed';
        if (record.status === 'running') return 'running';
        if (record.status === 'skipped') return 'pending';
      }
      if (state.currentNodeId === nodeId && state.status === 'running') return 'running';
      return 'pending';
    },
    [state.nodeHistory, state.currentNodeId, state.status],
  );

  const handleSSEEvent = useCallback((event: RunEvent) => {
    setState((prev) => {
      const newHistory = new Map(prev.nodeHistory);

      switch (event.type) {
        case 'run:start':
          return {
            ...prev,
            status: 'running',
            runId: event.runId,
            startedAt: Date.now(),
            error: null,
          };

        case 'run:complete':
          return {
            ...prev,
            status: 'completed',
            completedAt: Date.now(),
          };

        case 'run:error':
          return {
            ...prev,
            status: 'failed',
            completedAt: Date.now(),
            error: event.error || 'Unknown error',
          };

        case 'node:start': {
          if (event.nodeId) {
            newHistory.set(event.nodeId, {
              nodeId: event.nodeId,
              nodeType: (event.nodeType as WorkflowDefinitionV2['nodes'][0]['type']) || 'agent_task',
              status: 'running',
              startedAt: Date.now(),
            });
          }
          return {
            ...prev,
            nodeHistory: newHistory,
            currentNodeId: event.nodeId || prev.currentNodeId,
          };
        }

        case 'node:error': {
          if (event.nodeId) {
            newHistory.set(event.nodeId, {
              nodeId: event.nodeId,
              nodeType: (event.nodeType as WorkflowDefinitionV2['nodes'][0]['type']) || 'agent_task',
              status: 'failed',
              startedAt: newHistory.get(event.nodeId)?.startedAt,
              completedAt: Date.now(),
              error: event.error,
              output: event.output,
            });
          }
          return {
            ...prev,
            nodeHistory: newHistory,
          };
        }

        case 'node:complete': {
          if (event.nodeId) {
            newHistory.set(event.nodeId, {
              nodeId: event.nodeId,
              nodeType: (event.nodeType as WorkflowDefinitionV2['nodes'][0]['type']) || 'agent_task',
              status: mapSSEStatusToNodeStatus(event.status),
              startedAt: newHistory.get(event.nodeId)?.startedAt,
              completedAt: Date.now(),
              output: event.output,
            });
          }
          return {
            ...prev,
            nodeHistory: newHistory,
          };
        }

        case 'run:paused':
          return {
            ...prev,
            status: 'paused',
          };

        default:
          return prev;
      }
    });
  }, []);

  /** 本地执行句柄：仅 local 模式有值，cancel 时优先中断它 */
  const localRef = useRef<LocalRunHandle | null>(null);

  /** 统一的运行前置：状态归零并置 running。返回 false 表示已在运行。 */
  const beginRun = useCallback((): boolean => {
    if (stateRef.current.status === 'running') return false;
    setState({
      status: 'running',
      runId: null,
      currentNodeId: null,
      nodeHistory: new Map(),
      startedAt: Date.now(),
      completedAt: null,
      error: null,
    });
    return true;
  }, []);

  const start = useCallback(
    (input?: Record<string, unknown>) => {
      if (!beginRun()) return;

      if (mode === 'local') {
        // 本地执行：技能与插件工具只有渲染进程能访问
        localRef.current = startLocalWorkflowRun({
          workflow,
          input,
          emit: handleSSEEvent,
        });
        return;
      }

      workflowSSEClient
        .connect('run', {
          workflowId: workflow.id,
          input,
          onEvent: handleSSEEvent,
          onComplete: () => {},
          onError: (err) => {
            setState((prev) => ({
              ...prev,
              status: 'failed',
              error: err.message,
              completedAt: Date.now(),
            }));
          },
        })
        .catch((err) => {
          setState((prev) => ({
            ...prev,
            status: 'failed',
            error: (err as Error).message,
            completedAt: Date.now(),
          }));
        });
    },
    [beginRun, mode, workflow, handleSSEEvent],
  );

  const startTest = useCallback(
    (input?: Record<string, unknown>) => {
      if (!beginRun()) return;

      const controller = new AbortController();
      abortRef.current = controller;

      if (mode === 'local') {
        localRef.current = startLocalWorkflowRun({
          workflow,
          input,
          emit: handleSSEEvent,
          signal: controller.signal,
        });
        return;
      }

      workflowSSEClient
        .connect('test', {
          workflowId: workflow.id,
          input,
          onEvent: handleSSEEvent,
          onComplete: () => {},
          onError: (err) => {
            setState((prev) => ({
              ...prev,
              status: 'failed',
              error: err.message,
              completedAt: Date.now(),
            }));
          },
          signal: controller.signal,
        })
        .catch((err) => {
          setState((prev) => ({
            ...prev,
            status: 'failed',
            error: (err as Error).message,
            completedAt: Date.now(),
          }));
        });
    },
    [beginRun, mode, workflow, handleSSEEvent],
  );

  const cancel = useCallback(() => {
    localRef.current?.cancel();
    localRef.current = null;
    abortRef.current?.abort();
    setState((prev) => ({
      ...prev,
      status: 'cancelled',
      completedAt: Date.now(),
    }));
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState({
      status: 'idle',
      runId: null,
      currentNodeId: null,
      nodeHistory: new Map(),
      startedAt: null,
      completedAt: null,
      error: null,
    });
  }, []);

  const isRunning = state.status === 'running';
  const isDone = state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled';
  const isIdle = state.status === 'idle';

  return {
    run: {
      id: state.runId ?? '',
      workflowId: workflow.id,
      status: state.status === 'idle' ? 'pending' : state.status,
      startedAt: state.startedAt ?? Date.now(),
      completedAt: state.completedAt ?? undefined,
      variables: {},
      nodeHistory: Array.from(state.nodeHistory.values()),
      currentNodeId: state.currentNodeId ?? undefined,
      error: state.error ?? undefined,
    } as WorkflowRunV2,
    executionOrder,
    entryNodes,
    getNodeStatus,
    start,
    startTest,
    cancel,
    reset,
    isRunning,
    isDone,
    isIdle,
  };
}