import { getServerUrl, getAccessToken } from '@services/backendApi';

export interface RunEvent {
  type: string;
  runId: string;
  nodeId?: string;
  nodeName?: string;
  nodeType?: string;
  status?: string;
  output?: unknown;
  error?: string;
  retrying?: boolean;
  token?: string;
  durationMs?: number;
  log?: string;
  timestamp: string;
}

export interface SSERunOptions {
  workflowId: string;
  accessToken?: string;
  input?: Record<string, unknown>;
  initialVars?: Record<string, unknown>;
  threadId?: string;
  triggerType?: string;
  onEvent?: (event: RunEvent) => void;
  onComplete?: (runId: string, status: string) => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

type SSERouteType = 'run' | 'test' | 'resume' | 'retry';

interface SSERouteConfig {
  path: string;
  hasBody: boolean;
}

const SSE_ROUTES: Record<SSERouteType, (id: string, runId?: string) => SSERouteConfig> = {
  run: (id) => ({ path: `/api/v1/workflows/${id}/run`, hasBody: true }),
  test: (id) => ({ path: `/api/v1/workflows/${id}/test`, hasBody: true }),
  resume: (_, runId) => ({ path: `/api/v1/workflows/runs/${runId}/resume`, hasBody: true }),
  retry: (_, runId) => ({ path: `/api/v1/workflows/runs/${runId}/retry`, hasBody: false }),
};

class WorkflowSSEClient {
  private activeStreams = new Map<string, AbortController>();

  async connect(
    type: SSERouteType,
    options: SSERunOptions,
  ): Promise<{ runId?: string }> {
    const { workflowId, accessToken: providedToken, input, initialVars, threadId, triggerType, onEvent, onComplete, onError, signal } = options;

    const accessToken = providedToken || getAccessToken();
    if (!accessToken) {
      throw new Error('No access token available for SSE connection');
    }

    const route = SSE_ROUTES[type](workflowId, undefined);

    const serverUrl = getServerUrl();
    const url = `${serverUrl}${route.path}`;

    const body: Record<string, unknown> = {};
    if (input) body.input = input;
    if (initialVars) body.initialVars = initialVars;
    if (threadId) body.threadId = threadId;
    if (triggerType) body.triggerType = triggerType;

    const controller = new AbortController();
    const streamKey = `${type}-${workflowId}-${Date.now()}`;
    this.activeStreams.set(streamKey, controller);

    if (signal) {
      signal.addEventListener('abort', () => controller.abort());
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: route.hasBody ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(`SSE connection failed: ${res.status} ${errorText}`);
      }

      const reader = res.body?.getReader();
      if (!reader) {
        throw new Error('Response body is not readable');
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      let extractedRunId: string | undefined;

      const processBuffer = () => {
        const lines = buffer.split('\n');
        buffer = '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.startsWith('event: ')) {
            currentEvent = line.slice(7).trim();
          } else if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') {
              continue;
            }
            try {
              const parsed: RunEvent = JSON.parse(dataStr);
              if (parsed.runId && !extractedRunId) {
                extractedRunId = parsed.runId;
              }
              if (currentEvent) {
                parsed.type = currentEvent;
              }
              onEvent?.(parsed);

              if (parsed.type === 'run:complete' || parsed.type === 'run:error') {
                onComplete?.(parsed.runId, parsed.status || parsed.type);
              }
            } catch {
              // Skip malformed data
            }
          }
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        processBuffer();
      }

      processBuffer();

      return { runId: extractedRunId };
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        return {};
      }
      onError?.(err as Error);
      throw err;
    } finally {
      this.activeStreams.delete(streamKey);
    }
  }

  connectWithSSE(
    type: SSERouteType,
    options: SSERunOptions,
  ): { abort: () => void } {
    const controller = new AbortController();

    this.connect(type, { ...options, signal: controller.signal }).catch(() => {});

    return {
      abort: () => controller.abort(),
    };
  }

  disconnect(streamKey: string): void {
    const controller = this.activeStreams.get(streamKey);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(streamKey);
    }
  }

  disconnectAll(): void {
    for (const [key, controller] of this.activeStreams) {
      controller.abort();
      this.activeStreams.delete(key);
    }
  }
}

export const workflowSSEClient = new WorkflowSSEClient();