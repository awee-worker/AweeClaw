import { useState, useCallback, useRef, useMemo } from 'react';
import { workflowSSEClient, type RunEvent } from '@shared/configuration/workflows/workflowSSEClient';
import type { WorkflowDefinitionV2 } from '@shared/protocols/workflowV2';
import type { NodeExecutionRecord, NodeDisplayStatus } from './runnerTypes';

export type RunStatus = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';

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

export function useWorkflowExecution(workflow: WorkflowDefinitionV2) {
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
      const record = state.nodeHistory.get(nodeId);
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
            const existing = newHistory.get(event.nodeId);
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

  const start = useCallback(
    (input?: Record<string, unknown>) => {
      if (stateRef.current.status === 'running') return;

      setState({
        status: 'running',
        runId: null,
        currentNodeId: null,
        nodeHistory: new Map(),
        startedAt: Date.now(),
        completedAt: null,
        error: null,
      });

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
    [workflow.id, handleSSEEvent],
  );

  const startTest = useCallback(
    (input?: Record<string, unknown>) => {
      if (stateRef.current.status === 'running') return;

      setState({
        status: 'running',
        runId: null,
        currentNodeId: null,
        nodeHistory: new Map(),
        startedAt: Date.now(),
        completedAt: null,
        error: null,
      });

      const controller = new AbortController();
      abortRef.current = controller;

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
    [workflow.id, handleSSEEvent],
  );

  const cancel = useCallback(() => {
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
      id: state.runId,
      status: state.status,
      startedAt: state.startedAt,
      completedAt: state.completedAt,
      variables: {},
      nodeHistory: state.nodeHistory,
      currentNodeId: state.currentNodeId,
      error: state.error,
    },
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