import { backendApi, isAuthenticated } from '@services/backendApi';
import type { WorkflowDefinitionV2, WorkflowRunV2 } from '@shared/protocols/workflowV2';

interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface WorkflowQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  type?: string;
  status?: string;
  category?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

interface RunQueryParams {
  page?: number;
  pageSize?: number;
  status?: string;
  triggerType?: string;
}

interface CreateWorkflowPayload {
  name: string;
  nameZh?: string;
  description?: string;
  descriptionZh?: string;
  type?: string;
  category?: string;
  tags?: string[];
  nodes?: unknown[];
  edges?: unknown[];
  variables?: unknown[];
  inputSchema?: Record<string, unknown>;
  templateId?: string;
}

interface UpdateWorkflowPayload {
  name?: string;
  nameZh?: string;
  description?: string;
  descriptionZh?: string;
  type?: string;
  category?: string;
  tags?: string[];
  nodes?: unknown[];
  edges?: unknown[];
  variables?: unknown[];
  inputSchema?: Record<string, unknown>;
  icon?: string;
}

const BASE = '/api/v1/workflows';

function mapServerToClient(item: Record<string, unknown>): WorkflowDefinitionV2 {
  return {
    id: item.id as string,
    name: item.name as string,
    nameZh: (item.nameZh as string) || '',
    description: (item.description as string) || '',
    descriptionZh: (item.descriptionZh as string) || '',
    version: (item.version as string) || '1.0.0',
    author: (item.authorId as string) || '',
    category: (item.category as WorkflowDefinitionV2['category']) || 'general',
    tags: (item.tags as string[]) || [],
    icon: (item.icon as string) || undefined,
    nodes: (item.nodes as WorkflowDefinitionV2['nodes']) || [],
    edges: (item.edges as WorkflowDefinitionV2['edges']) || [],
    variables: (item.variables as WorkflowDefinitionV2['variables']) || [],
    inputSchema: (item.inputSchema as WorkflowDefinitionV2['inputSchema']) || undefined,
    createdAt: item.createdAt ? new Date(item.createdAt as string).getTime() : undefined,
    updatedAt: item.updatedAt ? new Date(item.updatedAt as string).getTime() : undefined,
    isCustom: true,
  };
}

function mapClientToServer(def: WorkflowDefinitionV2): CreateWorkflowPayload {
  return {
    name: def.name,
    nameZh: def.nameZh,
    description: def.description,
    descriptionZh: def.descriptionZh,
    type: 'WORKFLOW',
    category: def.category,
    tags: def.tags,
    nodes: def.nodes,
    edges: def.edges,
    variables: def.variables,
    inputSchema: def.inputSchema,
  };
}

export const workflowClientAPI = {
  isAvailable(): boolean {
    return isAuthenticated();
  },

  async list(query: WorkflowQueryParams = {}): Promise<WorkflowDefinitionV2[]> {
    const params = new URLSearchParams();
    if (query.page) params.set('page', String(query.page));
    if (query.pageSize) params.set('pageSize', String(query.pageSize));
    if (query.search) params.set('search', query.search);
    if (query.type) params.set('type', query.type);
    if (query.status) params.set('status', query.status);
    if (query.category) params.set('category', query.category);
    if (query.sortBy) params.set('sortBy', query.sortBy);
    if (query.sortOrder) params.set('sortOrder', query.sortOrder);

    const qs = params.toString();
    const res = await backendApi.get<PaginatedResponse<Record<string, unknown>>>(
      `${BASE}${qs ? `?${qs}` : ''}`,
    );
    return (res.items || []).map(mapServerToClient);
  },

  async get(id: string): Promise<WorkflowDefinitionV2 | null> {
    try {
      const item = await backendApi.get<Record<string, unknown>>(`${BASE}/${id}`);
      return mapServerToClient(item);
    } catch (err: unknown) {
      if ((err as { status?: number }).status === 404) return null;
      throw err;
    }
  },

  async create(data: WorkflowDefinitionV2): Promise<WorkflowDefinitionV2> {
    const payload = mapClientToServer(data);
    const item = await backendApi.post<Record<string, unknown>>(BASE, payload);
    return mapServerToClient(item);
  },

  async update(id: string, data: Partial<WorkflowDefinitionV2>): Promise<WorkflowDefinitionV2> {
    const payload: UpdateWorkflowPayload = {};
    if (data.name !== undefined) payload.name = data.name;
    if (data.nameZh !== undefined) payload.nameZh = data.nameZh;
    if (data.description !== undefined) payload.description = data.description;
    if (data.descriptionZh !== undefined) payload.descriptionZh = data.descriptionZh;
    if (data.category !== undefined) payload.category = data.category;
    if (data.tags !== undefined) payload.tags = data.tags;
    if (data.nodes !== undefined) payload.nodes = data.nodes;
    if (data.edges !== undefined) payload.edges = data.edges;
    if (data.variables !== undefined) payload.variables = data.variables;
    if (data.inputSchema !== undefined) payload.inputSchema = data.inputSchema;
    if (data.icon !== undefined) payload.icon = data.icon;

    const item = await backendApi.put<Record<string, unknown>>(`${BASE}/${id}`, payload);
    return mapServerToClient(item);
  },

  async delete(id: string): Promise<void> {
    await backendApi.delete(`${BASE}/${id}`);
  },

  async duplicate(id: string): Promise<WorkflowDefinitionV2> {
    const item = await backendApi.post<Record<string, unknown>>(`${BASE}/${id}/duplicate`);
    return mapServerToClient(item);
  },

  async export(id: string): Promise<string> {
    const data = await backendApi.get<Record<string, unknown>>(`${BASE}/${id}/export`);
    return JSON.stringify(data, null, 2);
  },

  async import(json: string): Promise<WorkflowDefinitionV2> {
    const parsed = JSON.parse(json);
    const item = await backendApi.post<Record<string, unknown>>(`${BASE}/import`, parsed);
    return mapServerToClient(item);
  },

  async publish(id: string, note?: string): Promise<WorkflowDefinitionV2> {
    const item = await backendApi.post<Record<string, unknown>>(`${BASE}/${id}/publish`, { note });
    return mapServerToClient(item);
  },

  async archive(id: string): Promise<WorkflowDefinitionV2> {
    const item = await backendApi.post<Record<string, unknown>>(`${BASE}/${id}/archive`);
    return mapServerToClient(item);
  },

  async getVersions(workflowId: string): Promise<unknown[]> {
    return backendApi.get<unknown[]>(`${BASE}/${workflowId}/versions`);
  },

  async getVersion(workflowId: string, versionId: string): Promise<unknown> {
    return backendApi.get<unknown>(`${BASE}/${workflowId}/versions/${versionId}`);
  },

  async restoreVersion(workflowId: string, versionId: string): Promise<WorkflowDefinitionV2> {
    const item = await backendApi.post<Record<string, unknown>>(
      `${BASE}/${workflowId}/versions/${versionId}/restore`,
    );
    return mapServerToClient(item);
  },

  async getVersionDiff(
    workflowId: string,
    versionId: string,
  ): Promise<Record<string, unknown>> {
    return backendApi.get<Record<string, unknown>>(
      `${BASE}/${workflowId}/versions/${versionId}/diff`,
    );
  },

  async getRuns(
    workflowId: string,
    query: RunQueryParams = {},
  ): Promise<WorkflowRunV2[]> {
    const params = new URLSearchParams();
    if (query.page) params.set('page', String(query.page));
    if (query.pageSize) params.set('pageSize', String(query.pageSize));
    if (query.status) params.set('status', query.status);
    if (query.triggerType) params.set('triggerType', query.triggerType);

    const qs = params.toString();
    const res = await backendApi.get<PaginatedResponse<WorkflowRunV2>>(
      `${BASE}/${workflowId}/runs${qs ? `?${qs}` : ''}`,
    );
    return res.items || [];
  },

  async getRunsStats(workflowId: string): Promise<unknown> {
    return backendApi.get<unknown>(`${BASE}/${workflowId}/runs/stats`);
  },

  async getRunDetail(runId: string): Promise<WorkflowRunV2> {
    return backendApi.get<WorkflowRunV2>(`${BASE}/runs/${runId}`);
  },

  async cancelRun(runId: string): Promise<void> {
    return backendApi.delete<void>(`${BASE}/runs/${runId}`);
  },

  async pauseRun(runId: string): Promise<{ success: boolean; runId: string }> {
    return backendApi.post<{ success: boolean; runId: string }>(
      `${BASE}/runs/${runId}/pause`,
    );
  },

  async testNode(
    workflowId: string,
    nodeId: string,
    input?: Record<string, unknown>,
  ): Promise<unknown> {
    return backendApi.post<unknown>(
      `${BASE}/${workflowId}/nodes/${nodeId}/test`,
      { input },
    );
  },

  async batchRun(
    workflowId: string,
    inputs: Array<Record<string, unknown>>,
  ): Promise<{ results: Array<{ runId: string; status: string; error?: string }> }> {
    const dto = { inputs: inputs.map((input) => ({ input })) };
    return backendApi.post<{
      results: Array<{ runId: string; status: string; error?: string }>;
    }>(`${BASE}/${workflowId}/batch`, dto);
  },

  async batchSync(definitions: WorkflowDefinitionV2[]): Promise<{
    imported: number;
    skipped: number;
    errors: string[];
  }> {
    const result = { imported: 0, skipped: 0, errors: [] as string[] };

    for (const def of definitions) {
      try {
        const existing = await this.get(def.id);
        if (existing) {
          await this.update(def.id, def);
          result.skipped++;
        } else {
          await this.create(def);
          result.imported++;
        }
      } catch (err) {
        result.errors.push(
          `${def.name}: ${(err as Error).message || 'Unknown error'}`,
        );
      }
    }

    return result;
  },

  async getPermissions(workflowId: string): Promise<Array<{
    id: string;
    workflowId: string;
    userId: string | null;
    teamId: string | null;
    role: string;
    grantedAt: string;
    grantedBy: string;
    user: { id: string; email: string; username: string | null; avatarUrl: string | null } | null;
    team: { id: string; name: string; avatarUrl: string | null } | null;
  }>> {
    return backendApi.get(`${BASE}/${workflowId}/permissions`) as Promise<Array<{
      id: string;
      workflowId: string;
      userId: string | null;
      teamId: string | null;
      role: string;
      grantedAt: string;
      grantedBy: string;
      user: { id: string; email: string; username: string | null; avatarUrl: string | null } | null;
      team: { id: string; name: string; avatarUrl: string | null } | null;
    }>>;
  },

  async grantPermission(
    workflowId: string,
    granteeUserId: string,
    role: string,
  ): Promise<Record<string, unknown>> {
    return backendApi.post(`${BASE}/${workflowId}/permissions`, {
      userId: granteeUserId,
      role,
    }) as Promise<Record<string, unknown>>;
  },

  async updatePermission(
    workflowId: string,
    permId: string,
    role: string,
  ): Promise<Record<string, unknown>> {
    return backendApi.put(`${BASE}/${workflowId}/permissions/${permId}`, {
      role,
    }) as Promise<Record<string, unknown>>;
  },

  async revokePermission(
    workflowId: string,
    permId: string,
  ): Promise<void> {
    return backendApi.delete(`${BASE}/${workflowId}/permissions/${permId}`) as Promise<void>;
  },

  async grantTeamPermission(
    workflowId: string,
    teamId: string,
    role: string,
  ): Promise<Record<string, unknown>> {
    return backendApi.post(`${BASE}/${workflowId}/permissions/team`, {
      teamId,
      role,
    }) as Promise<Record<string, unknown>>;
  },
};