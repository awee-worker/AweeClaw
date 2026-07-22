/**
 * Causal Reasoning API — 因果推理层 IPC 桥接
 *
 * 将主进程的 CausalReasoningService 能力暴露给渲染进程。
 * 渲染进程通过 window.electronAPI.causal.* 调用。
 *
 * 所有方法返回 { success: boolean, data?: T, error?: string } 统一格式。
 *
 * 提供能力：
 * - 配置管理：getConfig / updateConfig
 * - 节点 CRUD：listNodes / createNode / updateNode / deleteNode
 * - 边 CRUD：listEdges / createEdge / createEdgeByNames / updateEdge / deleteEdge
 * - 断言管理：listAssertions / reportAssertion / batchReportAssertions /
 *              reviewAssertion / extractAssertions
 * - 干预/反事实查询：intervention / counterfactual / listQueries
 * - 图统计：getStats
 * - 事件流：collectEvent / flushEvents
 * - 数据维护：cleanupExpired / clearAllData
 */

import { ipcRenderer } from 'electron';

/** 统一的 IPC 响应格式 */
export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ============================================================
// 类型定义（与 CausalReasoningInterface 保持一致）
// ============================================================

export type CausalNodeType = 'event' | 'action' | 'state' | 'metric';
export type CausalNodeSource = 'llm' | 'rule' | 'manual' | 'system';
export type CausalEdgeRelation = 'causes' | 'enables' | 'prevents' | 'inhibits';
export type CausalEdgeSource = 'llm' | 'rule' | 'manual' | 'statistical';
export type AssertionExtractor = 'llm' | 'rule';
export type AssertionReviewStatus = 'pending' | 'approved' | 'rejected' | 'merged';
export type CounterfactualQueryType = 'intervention' | 'counterfactual';
export type CounterfactualEngine = 'backend' | 'local';
export type ImpactLevel = 'strong' | 'moderate' | 'weak' | 'negligible';
export type ChangeDirection = 'increase' | 'decrease' | 'flip' | 'none';

/** 因果图节点 */
export interface CausalNode {
  id: string;
  type: CausalNodeType;
  name: string;
  description?: string;
  source: CausalNodeSource;
  metadata?: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 因果图边 */
export interface CausalEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: CausalEdgeRelation;
  strength: number;
  evidence?: string;
  source: CausalEdgeSource;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** 因果断言 */
export interface CausalAssertion {
  id: string;
  sourceText: string;
  causeName: string;
  effectName: string;
  relation: CausalEdgeRelation;
  strength: number;
  extractor: AssertionExtractor;
  extractMeta?: Record<string, unknown>;
  reviewStatus: AssertionReviewStatus;
  reviewedBy?: string;
  reviewedAt?: number;
  reviewNote?: string;
  mergedEdgeId?: string;
  createdAt: number;
}

/** 反事实查询记录 */
export interface CounterfactualQueryRecord {
  id: string;
  queryType: CounterfactualQueryType;
  interventionVar: string;
  interventionValue: unknown;
  observedVar: string;
  result: unknown;
  engine: CounterfactualEngine;
  durationMs: number;
  success: boolean;
  error?: string;
  createdAt: number;
}

/** 用户配置 */
export interface CausalUserConfig {
  enabled: boolean;
  autoExtractionEnabled: boolean;
  cloudReportingEnabled: boolean;
  extractionMinConfidence: number;
  counterfactualEnabled: boolean;
  maxNodes: number;
  retentionDays: number;
  updatedAt: number;
}

/**
 * 场景级阈值配置（阶段5新增）
 *
 * 允许用户为不同应用场景（如 coding、debugging、browsing）配置不同的
 * do-calculus 影响等级阈值，覆盖默认值（STRONG=0.5, MODERATE=0.2, WEAK=0.05）。
 */
export interface CausalSceneConfig {
  /** 场景标识（如 'coding'、'debugging'、'browsing'） */
  sceneKey: string;
  /** 强影响阈值 [0, 1] */
  strongThreshold: number;
  /** 中等影响阈值 [0, 1] */
  moderateThreshold: number;
  /** 弱影响阈值 [0, 1] */
  weakThreshold: number;
  /** 是否启用此场景配置 */
  enabled: boolean;
  /** 备注（场景用途说明） */
  description: string | null;
  /** 最后更新时间戳 */
  updatedAt: number;
}

/** 场景阈值配置更新参数（upsert 使用） */
export interface UpsertSceneConfigInput {
  strongThreshold?: number;
  moderateThreshold?: number;
  weakThreshold?: number;
  enabled?: boolean;
  description?: string;
}

/** 图统计信息 */
export interface GraphStats {
  nodeCount: number;
  edgeCount: number;
  density: number;
  componentCount: number;
  avgOutDegree: number;
  avgInDegree: number;
  hasCycle: boolean;
}

/** 干预查询结果 */
export interface InterventionResult {
  interventionVar: string;
  interventionValue: unknown;
  observedVar: string;
  impactScore: number;
  impactLevel: ImpactLevel;
  causalPaths: string[][];
  totalStrength: number;
  truncatedEdges: number;
  durationMs: number;
  adjustmentMethod?: 'none' | 'backdoor' | 'frontdoor';
  adjustmentSet?: string[];
  confounders?: string[];
  mediators?: string[];
}

/** 反事实查询结果 */
export interface CounterfactualResult extends InterventionResult {
  observedValue: unknown;
  counterfactualValue: unknown;
  wouldChange: boolean;
  changeDirection: ChangeDirection;
  confidence: number;
}

/** 后门调整查询结果 */
export interface BackdoorAdjustmentResult {
  interventionVar: string;
  observedVar: string;
  adjustmentMethod: 'backdoor';
  satisfiesCriterion: boolean;
  adjustmentSet: string[];
  confounders: string[];
  adjustedEffect: number;
  adjustedLevel: ImpactLevel;
  originalAssociation: number;
  confoundingBias: number;
  causalPaths: string[][];
  backdoorPaths: string[][];
  durationMs: number;
  reason?: string;
}

/** 前门调整查询结果 */
export interface FrontdoorAdjustmentResult {
  interventionVar: string;
  observedVar: string;
  adjustmentMethod: 'frontdoor';
  satisfiesCriterion: boolean;
  adjustmentSet: string[];
  mediators: string[];
  adjustedEffect: number;
  adjustedLevel: ImpactLevel;
  xToMediatorStrengths: Array<{
    mediator: string;
    strength: number;
    sign: number;
  }>;
  mediatorToYStrengths: Array<{
    mediator: string;
    strength: number;
    sign: number;
  }>;
  mediatorPaths: string[][];
  durationMs: number;
  reason?: string;
}

/** 稳健性等级 */
export type RobustnessLevel = 'robust' | 'moderate' | 'sensitive' | 'fragile';

/** 敏感性分析网格点 */
export interface SensitivityGridPoint {
  /** U → X 强度 α */
  alpha: number;
  /** U → Y 强度 β */
  beta: number;
  /** 混淆乘积 α × β */
  confoundingProduct: number;
  /** 该混淆下调整后的效应分数 */
  adjustedEffectWithU: number;
  /** 效应是否仍然显著（|effect| >= WEAK_THRESHOLD） */
  remainsSignificant: boolean;
}

/** 敏感性分析结果 */
export interface SensitivityAnalysisResult {
  interventionVar: string;
  observedVar: string;
  originalAdjustedEffect: number;
  observedConfoundingBias: number;
  criticalConfoundingProduct: number;
  eValue: number;
  robustnessLevel: RobustnessLevel;
  grid: SensitivityGridPoint[];
  gridResolution: number;
  observedConfounders: string[];
  durationMs: number;
  conclusion: string;
}

/** 抽取的断言 */
export interface ExtractedAssertion {
  sourceText: string;
  causeName: string;
  effectName: string;
  relation: CausalEdgeRelation;
  strength: number;
  extractor: AssertionExtractor;
  extractMeta?: {
    confidence?: number;
    template?: string;
    match?: string;
  };
}

// ============================================================
// API 接口
// ============================================================

/** 因果推理层 API 接口 */
export interface CausalReasoningApi {
  // ===== 配置 =====
  getConfig: () => Promise<IpcResponse<CausalUserConfig>>;
  updateConfig: (
    updates: Partial<CausalUserConfig>,
  ) => Promise<IpcResponse<CausalUserConfig>>;

  // ===== 节点 CRUD =====
  listNodes: (filter?: {
    type?: CausalNodeType;
    source?: CausalNodeSource;
    enabled?: boolean;
    keyword?: string;
  }) => Promise<IpcResponse<CausalNode[]>>;
  createNode: (input: {
    type: CausalNodeType;
    name: string;
    description?: string;
    source?: CausalNodeSource;
    metadata?: Record<string, unknown>;
    enabled?: boolean;
  }) => Promise<IpcResponse<CausalNode>>;
  updateNode: (
    nodeId: string,
    updates: {
      description?: string;
      metadata?: Record<string, unknown>;
      enabled?: boolean;
    },
  ) => Promise<IpcResponse<CausalNode>>;
  deleteNode: (nodeId: string) => Promise<IpcResponse<boolean>>;

  // ===== 边 CRUD =====
  listEdges: (filter?: {
    relation?: CausalEdgeRelation;
    source?: CausalEdgeSource;
    enabled?: boolean;
    nodeId?: string;
  }) => Promise<IpcResponse<CausalEdge[]>>;
  createEdge: (input: {
    fromNodeId: string;
    toNodeId: string;
    relation?: CausalEdgeRelation;
    strength?: number;
    evidence?: string;
    source?: CausalEdgeSource;
    enabled?: boolean;
  }) => Promise<IpcResponse<CausalEdge>>;
  createEdgeByNames: (input: {
    fromName: string;
    toName: string;
    relation?: CausalEdgeRelation;
    strength?: number;
    evidence?: string;
    source?: CausalEdgeSource;
  }) => Promise<IpcResponse<CausalEdge>>;
  updateEdge: (
    edgeId: string,
    updates: {
      relation?: CausalEdgeRelation;
      strength?: number;
      evidence?: string;
      enabled?: boolean;
    },
  ) => Promise<IpcResponse<CausalEdge>>;
  deleteEdge: (edgeId: string) => Promise<IpcResponse<boolean>>;

  // ===== 断言管理 =====
  listAssertions: (filter?: {
    reviewStatus?: AssertionReviewStatus;
    causeName?: string;
    effectName?: string;
    startDate?: number;
    endDate?: number;
  }) => Promise<IpcResponse<CausalAssertion[]>>;
  reportAssertion: (input: {
    sourceText: string;
    causeName: string;
    effectName: string;
    relation?: CausalEdgeRelation;
    strength?: number;
    extractor?: AssertionExtractor;
    extractMeta?: Record<string, unknown>;
  }) => Promise<IpcResponse<CausalAssertion>>;
  batchReportAssertions: (
    inputs: Array<{
      sourceText: string;
      causeName: string;
      effectName: string;
      relation?: CausalEdgeRelation;
      strength?: number;
      extractor?: AssertionExtractor;
      extractMeta?: Record<string, unknown>;
    }>,
  ) => Promise<IpcResponse<CausalAssertion[]>>;
  reviewAssertion: (
    assertionId: string,
    review: {
      status: 'approved' | 'rejected' | 'merged';
      reviewedBy?: string;
      reviewNote?: string;
    },
  ) => Promise<IpcResponse<CausalAssertion>>;
  extractAssertions: (
    sourceText: string,
    minConfidence?: number,
  ) => Promise<IpcResponse<ExtractedAssertion[]>>;

  // ===== LLM 抽取（阶段5新增） =====
  /** 使用 LLM 从文本抽取因果断言（通过渲染层 IntelligenceCore） */
  extractWithLlm: (
    sourceText: string,
    minConfidence?: number,
  ) => Promise<IpcResponse<ExtractedAssertion[]>>;
  /** 注册 LLM 抽取回调（启用自动 LLM 抽取） */
  registerLlmCallback: () => Promise<IpcResponse<boolean>>;
  /** 注销 LLM 抽取回调（降级为仅规则抽取） */
  unregisterLlmCallback: () => Promise<IpcResponse<boolean>>;
  /**
   * 初始化 LLM 抽取器（阶段9 s9-03 新增）
   *
   * 渲染层通过此 IPC 传入 LLM 配置（model + apiKey + baseUrl），
   * 主进程的 LlmAssertionExtractor 直接调用 LLMService，无需 IPC 回调。
   *
   * 调用此方法后还需调用 registerLlmCallback() 启用自动抽取。
   *
   * @param config LLM 配置（model 必填，apiKey/baseUrl/temperature 可选）
   */
  initLlmExtractor: (config: {
    model: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
  }) => Promise<IpcResponse<boolean>>;

  // ===== 干预/反事实查询 =====
  // 阶段5新增：所有查询方法均支持可选 sceneKey 参数，用于场景级阈值覆盖
  intervention: (
    interventionVar: string,
    interventionValue: unknown,
    observedVar: string,
    sceneKey?: string,
  ) => Promise<IpcResponse<InterventionResult>>;
  counterfactual: (
    interventionVar: string,
    interventionValue: unknown,
    observedVar: string,
    observedValue: unknown,
    sceneKey?: string,
  ) => Promise<IpcResponse<CounterfactualResult>>;
  /** 后门调整查询（识别混淆变量 Z，计算调整后因果效应） */
  backdoorAdjustment: (
    interventionVar: string,
    observedVar: string,
    sceneKey?: string,
  ) => Promise<IpcResponse<BackdoorAdjustmentResult>>;
  /** 前门调整查询（识别中介变量 M，通过中介路径计算因果效应） */
  frontdoorAdjustment: (
    interventionVar: string,
    observedVar: string,
    sceneKey?: string,
  ) => Promise<IpcResponse<FrontdoorAdjustmentResult>>;
  /** 敏感性分析（评估未观测混淆变量对反事实结论的影响） */
  sensitivityAnalysis: (
    interventionVar: string,
    observedVar: string,
    sceneKey?: string,
  ) => Promise<IpcResponse<SensitivityAnalysisResult>>;
  listQueries: (filter?: {
    queryType?: CounterfactualQueryType;
    startDate?: number;
    endDate?: number;
  }) => Promise<IpcResponse<CounterfactualQueryRecord[]>>;

  // ===== 场景级阈值配置（阶段5新增） =====
  /** 列出所有场景阈值配置 */
  listSceneConfigs: () => Promise<IpcResponse<CausalSceneConfig[]>>;
  /** 获取指定场景的阈值配置（未配置或被禁用时返回 null） */
  getSceneConfig: (
    sceneKey: string,
  ) => Promise<IpcResponse<CausalSceneConfig | null>>;
  /** 创建或更新场景阈值配置 */
  upsertSceneConfig: (
    sceneKey: string,
    updates: UpsertSceneConfigInput,
  ) => Promise<IpcResponse<CausalSceneConfig>>;
  /** 删除场景阈值配置 */
  deleteSceneConfig: (sceneKey: string) => Promise<IpcResponse<boolean>>;

  // ===== 图统计 =====
  getStats: () => Promise<IpcResponse<GraphStats>>;

  // ===== 事件流 =====
  collectEvent: (event: {
    type: 'action' | 'state_change' | 'metric_change' | 'anomaly' | 'user_input';
    source: string;
    timestamp: number;
    text: string;
    relatedNodes?: string[];
    metadata?: Record<string, unknown>;
  }) => Promise<IpcResponse<boolean>>;
  flushEvents: () => Promise<IpcResponse<{ extracted: number }>>;

  // ===== 数据维护 =====
  cleanupExpired: () => Promise<IpcResponse<{ deleted: number }>>;
  clearAllData: () => Promise<IpcResponse<boolean>>;
}

// ============================================================
// API 实现
// ============================================================

/** 创建因果推理层 API */
export function createCausalReasoningApi(): CausalReasoningApi {
  return {
    // ===== 配置 =====
    getConfig: () => ipcRenderer.invoke('causal:getConfig'),
    updateConfig: (updates) =>
      ipcRenderer.invoke('causal:updateConfig', updates),

    // ===== 节点 CRUD =====
    listNodes: (filter) => ipcRenderer.invoke('causal:listNodes', filter),
    createNode: (input) => ipcRenderer.invoke('causal:createNode', input),
    updateNode: (nodeId, updates) =>
      ipcRenderer.invoke('causal:updateNode', nodeId, updates),
    deleteNode: (nodeId) => ipcRenderer.invoke('causal:deleteNode', nodeId),

    // ===== 边 CRUD =====
    listEdges: (filter) => ipcRenderer.invoke('causal:listEdges', filter),
    createEdge: (input) => ipcRenderer.invoke('causal:createEdge', input),
    createEdgeByNames: (input) =>
      ipcRenderer.invoke('causal:createEdgeByNames', input),
    updateEdge: (edgeId, updates) =>
      ipcRenderer.invoke('causal:updateEdge', edgeId, updates),
    deleteEdge: (edgeId) => ipcRenderer.invoke('causal:deleteEdge', edgeId),

    // ===== 断言管理 =====
    listAssertions: (filter) =>
      ipcRenderer.invoke('causal:listAssertions', filter),
    reportAssertion: (input) =>
      ipcRenderer.invoke('causal:reportAssertion', input),
    batchReportAssertions: (inputs) =>
      ipcRenderer.invoke('causal:batchReportAssertions', inputs),
    reviewAssertion: (assertionId, review) =>
      ipcRenderer.invoke('causal:reviewAssertion', assertionId, review),
    extractAssertions: (sourceText, minConfidence) =>
      ipcRenderer.invoke('causal:extractAssertions', sourceText, minConfidence),
    extractWithLlm: (sourceText, minConfidence) =>
      ipcRenderer.invoke('causal:extractWithLlm', sourceText, minConfidence),
    registerLlmCallback: () => ipcRenderer.invoke('causal:registerLlmCallback'),
    unregisterLlmCallback: () =>
      ipcRenderer.invoke('causal:unregisterLlmCallback'),
    initLlmExtractor: (config) =>
      ipcRenderer.invoke('causal:initLlmExtractor', config),

    // ===== 干预/反事实查询 =====
    intervention: (interventionVar, interventionValue, observedVar, sceneKey) =>
      ipcRenderer.invoke(
        'causal:intervention',
        interventionVar,
        interventionValue,
        observedVar,
        sceneKey,
      ),
    counterfactual: (
      interventionVar,
      interventionValue,
      observedVar,
      observedValue,
      sceneKey,
    ) =>
      ipcRenderer.invoke(
        'causal:counterfactual',
        interventionVar,
        interventionValue,
        observedVar,
        observedValue,
        sceneKey,
      ),
    backdoorAdjustment: (interventionVar, observedVar, sceneKey) =>
      ipcRenderer.invoke(
        'causal:backdoorAdjustment',
        interventionVar,
        observedVar,
        sceneKey,
      ),
    frontdoorAdjustment: (interventionVar, observedVar, sceneKey) =>
      ipcRenderer.invoke(
        'causal:frontdoorAdjustment',
        interventionVar,
        observedVar,
        sceneKey,
      ),
    sensitivityAnalysis: (interventionVar, observedVar, sceneKey) =>
      ipcRenderer.invoke(
        'causal:sensitivityAnalysis',
        interventionVar,
        observedVar,
        sceneKey,
      ),
    listQueries: (filter) => ipcRenderer.invoke('causal:listQueries', filter),

    // ===== 场景级阈值配置（阶段5新增） =====
    listSceneConfigs: () =>
      ipcRenderer.invoke('causal:listSceneConfigs'),
    getSceneConfig: (sceneKey) =>
      ipcRenderer.invoke('causal:getSceneConfig', sceneKey),
    upsertSceneConfig: (sceneKey, updates) =>
      ipcRenderer.invoke('causal:upsertSceneConfig', sceneKey, updates),
    deleteSceneConfig: (sceneKey) =>
      ipcRenderer.invoke('causal:deleteSceneConfig', sceneKey),

    // ===== 图统计 =====
    getStats: () => ipcRenderer.invoke('causal:getStats'),

    // ===== 事件流 =====
    collectEvent: (event) => ipcRenderer.invoke('causal:collectEvent', event),
    flushEvents: () => ipcRenderer.invoke('causal:flushEvents'),

    // ===== 数据维护 =====
    cleanupExpired: () => ipcRenderer.invoke('causal:cleanupExpired'),
    clearAllData: () => ipcRenderer.invoke('causal:clearAllData'),
  };
}
