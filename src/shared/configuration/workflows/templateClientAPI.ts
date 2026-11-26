import { backendApi, isAuthenticated } from '@services/backendApi';

export interface WorkflowTemplateEntry {
  id: string;
  name: string;
  nameZh: string | null;
  description: string;
  descriptionZh: string | null;
  type: 'WORKFLOW' | 'CHAT' | 'RAG';
  category: string | null;
  icon: string | null;
  thumbnail: string | null;
  nodes: unknown[];
  edges: unknown[];
  variables: unknown[];
  inputSchema: Record<string, unknown> | null;
  tags: string[];
  isOfficial: boolean;
  usageCount: number;
  rating: number | null;
  /** 参与评分的真实人数；rating 是该人数的精确均值 */
  ratingCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface TemplateListResult {
  items: WorkflowTemplateEntry[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface TemplateQuery {
  search?: string;
  type?: string;
  category?: string;
  isOfficial?: boolean;
  page?: number;
  pageSize?: number;
}

const BASE = '/api/v1/templates';

function buildQuery(params: Record<string, unknown>): string {
  const entries = Object.entries(params).filter(
    ([, v]) => v !== undefined && v !== null && v !== '',
  );
  if (entries.length === 0) return '';
  return '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&');
}

export const templateClientAPI = {
  isAvailable(): boolean {
    return isAuthenticated();
  },

  async list(query: TemplateQuery = {}): Promise<TemplateListResult> {
    const qs = buildQuery(query as Record<string, unknown>);
    return backendApi.get<TemplateListResult>(`${BASE}${qs}`) as Promise<TemplateListResult>;
  },

  async get(id: string): Promise<WorkflowTemplateEntry> {
    return backendApi.get<WorkflowTemplateEntry>(`${BASE}/${id}`) as Promise<WorkflowTemplateEntry>;
  },

  async create(data: Partial<WorkflowTemplateEntry>): Promise<WorkflowTemplateEntry> {
    return backendApi.post<WorkflowTemplateEntry>(BASE, { body: data }) as Promise<WorkflowTemplateEntry>;
  },

  async update(id: string, data: Partial<WorkflowTemplateEntry>): Promise<WorkflowTemplateEntry> {
    return backendApi.put<WorkflowTemplateEntry>(`${BASE}/${id}`, { body: data }) as Promise<WorkflowTemplateEntry>;
  },

  async delete(id: string): Promise<void> {
    await backendApi.delete(`${BASE}/${id}`);
  },

  async rate(id: string, rating: number): Promise<WorkflowTemplateEntry> {
    return backendApi.post<WorkflowTemplateEntry>(`${BASE}/${id}/rate`, { body: { rating } }) as Promise<WorkflowTemplateEntry>;
  },

  async recordUse(id: string): Promise<{ success: boolean }> {
    return backendApi.post<{ success: boolean }>(`${BASE}/${id}/use`, {}) as Promise<{ success: boolean }>;
  },

  /**
   * 从模板实例化一个工作流。
   *
   * 服务端在单事务内完成「建工作流 + 模板计数」，因此这是「使用模板」的
   * 唯一正确入口 —— 客户端不要自己拼一个空工作流再逐字段复制模板内容。
   * 返回的是新建工作流记录，调用方通常拿 id 再去 workflowClientAPI.get 取
   * 映射后的 V2 结构。
   */
  async instantiate(
    id: string,
    overrides?: { name?: string; nameZh?: string },
  ): Promise<{ id: string }> {
    return backendApi.post<{ id: string }>(`${BASE}/${id}/instantiate`, {
      body: overrides ?? {},
    }) as Promise<{ id: string }>;
  },
};

export const CATEGORIES = [
  { key: 'chat', label: 'Chat', labelZh: '对话' },
  { key: 'rag', label: 'RAG', labelZh: '检索增强生成' },
  { key: 'automation', label: 'Automation', labelZh: '自动化' },
  { key: 'content', label: 'Content', labelZh: '内容生成' },
  { key: 'data', label: 'Data', labelZh: '数据处理' },
  { key: 'customer-service', label: 'Customer Service', labelZh: '客服' },
  { key: 'translation', label: 'Translation', labelZh: '翻译' },
  { key: 'approval', label: 'Approval', labelZh: '审批' },
  { key: 'report', label: 'Report', labelZh: '报告' },
  { key: 'other', label: 'Other', labelZh: '其他' },
];

export const getCategoryLabel = (key: string | null | undefined, lang: 'en' | 'zh' = 'zh'): string => {
  const cat = CATEGORIES.find(c => c.key === key);
  if (!cat) return key || 'Other';
  return lang === 'zh' ? cat.labelZh : cat.label;
};
