/**
 * 因果推理接口规范
 *
 * 定义客户端因果推理模块的统一类型规范，覆盖：
 * - 因果图节点/边（CausalNode / CausalEdge）
 * - 因果断言（CausalAssertion）：从文本抽取的待审核因果关系
 * - 反事实查询（CounterfactualQuery）：do(X) 干预与反事实推理
 * - 用户配置（CausalUserConfig）：本地与云端镜像配置
 * - DAG 操作结果（TopologicalSortResult / PathAnalysis / GraphStats）
 * - 干预/反事实推理结果（InterventionResult / CounterfactualResult）
 *
 * 设计原则：
 * - 与后端 Prisma 模型字段保持一致，便于云端同步
 * - 客户端独立实现 do-calculus，离线可用
 * - 隐私优先：默认本地存储，云端上报需用户显式开启
 *
 * @module causal-reasoning/CausalReasoningInterface
 */

// ============================================================
// 基础枚举类型
// ============================================================

/** 节点类型 */
export type CausalNodeType = 'event' | 'action' | 'state' | 'metric';

/** 节点来源 */
export type CausalNodeSource = 'llm' | 'rule' | 'manual' | 'system';

/** 边关系类型 */
export type CausalEdgeRelation = 'causes' | 'enables' | 'prevents' | 'inhibits';

/** 边来源 */
export type CausalEdgeSource = 'llm' | 'rule' | 'manual' | 'statistical';

/** 断言抽取方式 */
export type AssertionExtractor = 'llm' | 'rule';

/** 断言审核状态 */
export type AssertionReviewStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'merged';

/** 反事实查询类型 */
export type CounterfactualQueryType = 'intervention' | 'counterfactual';

/** 反事实推理引擎 */
export type CounterfactualEngine = 'backend' | 'local';

// ============================================================
// 因果图核心数据结构
// ============================================================

/** 因果图节点 */
export interface CausalNode {
  /** 节点唯一 ID（nanoid） */
  id: string;
  /** 用户 ID（本地存储可留空，云端必填） */
  userId?: string;
  /** 节点类型 */
  type: CausalNodeType;
  /** 节点名称（同一用户内唯一） */
  name: string;
  /** 节点描述 */
  description?: string;
  /** 来源 */
  source: CausalNodeSource;
  /** 元数据（如抽取置信度、来源文本片段等） */
  metadata?: Record<string, unknown>;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间戳（毫秒） */
  createdAt: number;
  /** 更新时间戳（毫秒） */
  updatedAt: number;
}

/** 因果图边 */
export interface CausalEdge {
  /** 边唯一 ID */
  id: string;
  /** 用户 ID */
  userId?: string;
  /** 起点 ID */
  fromNodeId: string;
  /** 终点 ID */
  toNodeId: string;
  /** 关系类型 */
  relation: CausalEdgeRelation;
  /** 因果强度 [0, 1] */
  strength: number;
  /** 证据/来源描述 */
  evidence?: string;
  /** 来源 */
  source: CausalEdgeSource;
  /** 是否启用 */
  enabled: boolean;
  /** 创建时间戳（毫秒） */
  createdAt: number;
  /** 更新时间戳（毫秒） */
  updatedAt: number;
}

// ============================================================
// 断言（待审核的因果关系）
// ============================================================

/** 因果断言 */
export interface CausalAssertion {
  /** 断言唯一 ID */
  id: string;
  /** 用户 ID */
  userId?: string;
  /** 原始文本 */
  sourceText: string;
  /** 原因节点名 */
  causeName: string;
  /** 结果节点名 */
  effectName: string;
  /** 关系类型 */
  relation: CausalEdgeRelation;
  /** 因果强度 */
  strength: number;
  /** 抽取方式 */
  extractor: AssertionExtractor;
  /** 抽取元数据（置信度、模板名等） */
  extractMeta?: Record<string, unknown>;
  /** 审核状态 */
  reviewStatus: AssertionReviewStatus;
  /** 审核人 ID */
  reviewedBy?: string;
  /** 审核时间戳 */
  reviewedAt?: number;
  /** 审核备注 */
  reviewNote?: string;
  /** 合并到的边 ID（status=merged 时） */
  mergedEdgeId?: string;
  /** 创建时间戳 */
  createdAt: number;
}

// ============================================================
// 反事实查询记录
// ============================================================

/** 反事实查询记录 */
export interface CounterfactualQueryRecord {
  /** 记录唯一 ID */
  id: string;
  /** 用户 ID */
  userId?: string;
  /** 查询类型 */
  queryType: CounterfactualQueryType;
  /** 干预变量名 */
  interventionVar: string;
  /** 干预值 */
  interventionValue: unknown;
  /** 观测变量名 */
  observedVar: string;
  /** 推理结果 */
  result: unknown;
  /** 推理引擎 */
  engine: CounterfactualEngine;
  /** 推理耗时（ms） */
  durationMs: number;
  /** 是否成功 */
  success: boolean;
  /** 错误信息 */
  error?: string;
  /** 创建时间戳 */
  createdAt: number;
}

// ============================================================
// 用户配置
// ============================================================

/** 因果推理用户配置 */
export interface CausalUserConfig {
  /** 是否启用因果推理 */
  enabled: boolean;
  /** 是否启用自动抽取（从事件流中提取断言） */
  autoExtractionEnabled: boolean;
  /** 是否上报到云端 */
  cloudReportingEnabled: boolean;
  /** 抽取最小置信度阈值 */
  extractionMinConfidence: number;
  /** 是否启用反事实查询 */
  counterfactualEnabled: boolean;
  /** 最大节点数 */
  maxNodes: number;
  /** 数据保留天数 */
  retentionDays: number;
  /** 最后更新时间戳 */
  updatedAt: number;
}

/** 默认用户配置 */
export const DEFAULT_CAUSAL_CONFIG: CausalUserConfig = {
  enabled: false,
  autoExtractionEnabled: false,
  cloudReportingEnabled: false,
  extractionMinConfidence: 0.6,
  counterfactualEnabled: true,
  maxNodes: 500,
  retentionDays: 90,
  updatedAt: Date.now(),
};

// ============================================================
// 场景级阈值配置（阶段5新增）
// ============================================================

/**
 * 场景级阈值配置
 *
 * 允许用户为不同应用场景（如 coding、debugging）配置不同的
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

/** 场景阈值运行时结构（用于 DoCalculusEngine 内部传递） */
export interface SceneThresholds {
  /** 强影响阈值 */
  strong: number;
  /** 中等影响阈值 */
  moderate: number;
  /** 弱影响阈值 */
  weak: number;
}

/** 默认阈值常量（用于无场景配置时的回退） */
export const DEFAULT_THRESHOLDS: SceneThresholds = {
  strong: 0.5,
  moderate: 0.2,
  weak: 0.05,
};

// ============================================================
// DAG 操作结果类型
// ============================================================

/** 拓扑排序结果 */
export interface TopologicalSortResult {
  /** 拓扑顺序（节点 ID 数组） */
  order: string[];
  /** 是否存在环 */
  hasCycle: boolean;
  /** 检测到的环（节点 ID 数组） */
  cycles: string[][];
}

/** 路径分析结果 */
export interface PathAnalysis {
  /** 所有路径（每条路径为节点 ID 数组） */
  paths: string[][];
  /** 是否达到最大路径数限制 */
  truncated: boolean;
}

/** 图统计信息 */
export interface GraphStats {
  /** 节点数 */
  nodeCount: number;
  /** 边数 */
  edgeCount: number;
  /** 图密度 = edgeCount / (nodeCount * (nodeCount - 1)) */
  density: number;
  /** 连通分量数 */
  componentCount: number;
  /** 平均出度 */
  avgOutDegree: number;
  /** 平均入度 */
  avgInDegree: number;
  /** 是否存在环 */
  hasCycle: boolean;
}

// ============================================================
// 干预与反事实推理结果
// ============================================================

/** 影响等级 */
export type ImpactLevel = 'strong' | 'moderate' | 'weak' | 'negligible';

/** 调整方法 */
export type AdjustmentMethod = 'none' | 'backdoor' | 'frontdoor';

/** 干预查询结果 */
export interface InterventionResult {
  /** 干预变量名 */
  interventionVar: string;
  /** 干预值 */
  interventionValue: unknown;
  /** 观测变量名 */
  observedVar: string;
  /** 影响分数 [-1, 1]，正值=促进，负值=抑制 */
  impactScore: number;
  /** 影响等级 */
  impactLevel: ImpactLevel;
  /** 影响路径（每条路径为节点名数组） */
  causalPaths: string[][];
  /** 累积影响强度 */
  totalStrength: number;
  /** 截断的边数 */
  truncatedEdges: number;
  /** 推理耗时（ms） */
  durationMs: number;
  /** 调整方法（none=未调整，backdoor=后门调整，frontdoor=前门调整） */
  adjustmentMethod?: AdjustmentMethod;
  /** 调整集（后门调整时的 Z 集，前门调整时的中介集 M） */
  adjustmentSet?: string[];
  /** 识别到的混淆变量名列表 */
  confounders?: string[];
  /** 识别到的中介变量名列表 */
  mediators?: string[];
}

/** 改变方向 */
export type ChangeDirection = 'increase' | 'decrease' | 'flip' | 'none';

/** 反事实查询结果 */
export interface CounterfactualResult extends InterventionResult {
  /** 实际观测到的值 */
  observedValue: unknown;
  /** 反事实预测值 */
  counterfactualValue: unknown;
  /** Y 是否会改变 */
  wouldChange: boolean;
  /** 改变方向 */
  changeDirection: ChangeDirection;
  /** 置信度 [0, 1] */
  confidence: number;
}

/** 后门调整查询结果 */
export interface BackdoorAdjustmentResult {
  /** 干预变量名 */
  interventionVar: string;
  /** 观测变量名 */
  observedVar: string;
  /** 调整方法：'backdoor' */
  adjustmentMethod: 'backdoor';
  /** 满足后门准则 */
  satisfiesCriterion: boolean;
  /** 后门调整集 Z（混淆变量名列表） */
  adjustmentSet: string[];
  /** 识别的混淆变量名列表（同 adjustmentSet） */
  confounders: string[];
  /** 调整后因果效应分数 [-1, 1] */
  adjustedEffect: number;
  /** 调整后影响等级 */
  adjustedLevel: ImpactLevel;
  /** 原始观测关联分数 [-1, 1]（含混淆偏差） */
  originalAssociation: number;
  /** 混淆偏差（原始关联 - 调整后效应） */
  confoundingBias: number;
  /** 因果路径（有向 X → Y 路径） */
  causalPaths: string[][];
  /** 后门路径示例（X ← Z → ... → Y，最多 10 条） */
  backdoorPaths: string[][];
  /** 推理耗时（ms） */
  durationMs: number;
  /** 不满足后门准则时的原因说明 */
  reason?: string;
}

/** 前门调整查询结果 */
export interface FrontdoorAdjustmentResult {
  /** 干预变量名 */
  interventionVar: string;
  /** 观测变量名 */
  observedVar: string;
  /** 调整方法：'frontdoor' */
  adjustmentMethod: 'frontdoor';
  /** 满足前门准则 */
  satisfiesCriterion: boolean;
  /** 前门中介集 M（中介变量名列表） */
  adjustmentSet: string[];
  /** 中介变量名列表（同 adjustmentSet） */
  mediators: string[];
  /** 前门调整后因果效应分数 [-1, 1] */
  adjustedEffect: number;
  /** 调整后影响等级 */
  adjustedLevel: ImpactLevel;
  /** X → M 路径强度（每条中介路径的 X 到 M 累积强度） */
  xToMediatorStrengths: Array<{
    mediator: string;
    strength: number;
    sign: number;
  }>;
  /** M → Y 路径强度（每条中介路径的 M 到 Y 累积强度） */
  mediatorToYStrengths: Array<{
    mediator: string;
    strength: number;
    sign: number;
  }>;
  /** 中介路径详情（X → M → Y，节点名数组） */
  mediatorPaths: string[][];
  /** 推理耗时（ms） */
  durationMs: number;
  /** 不满足前门准则时的原因说明 */
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
  /** 效应是否仍然显著 */
  remainsSignificant: boolean;
}

/** 敏感性分析结果 */
export interface SensitivityAnalysisResult {
  /** 干预变量名 */
  interventionVar: string;
  /** 观测变量名 */
  observedVar: string;
  /** 原始调整后效应（不含未观测混淆） */
  originalAdjustedEffect: number;
  /** 已观测混淆偏差 */
  observedConfoundingBias: number;
  /** 临界混淆乘积 α × β */
  criticalConfoundingProduct: number;
  /** E-value */
  eValue: number;
  /** 稳健性等级 */
  robustnessLevel: RobustnessLevel;
  /** 敏感性网格 */
  grid: SensitivityGridPoint[];
  /** 网格分辨率 */
  gridResolution: number;
  /** 已观测混淆变量名列表 */
  observedConfounders: string[];
  /** 推理耗时（ms） */
  durationMs: number;
  /** 结论说明 */
  conclusion: string;
}

// ============================================================
// 抽取的断言（中间结构，未持久化）
// ============================================================

/** 从文本抽取的断言（中间结构） */
export interface ExtractedAssertion {
  /** 原始文本 */
  sourceText: string;
  /** 原因节点名 */
  causeName: string;
  /** 结果节点名 */
  effectName: string;
  /** 关系类型 */
  relation: CausalEdgeRelation;
  /** 因果强度 */
  strength: number;
  /** 抽取方式 */
  extractor: AssertionExtractor;
  /** 抽取元数据 */
  extractMeta?: {
    /** 置信度 [0, 1] */
    confidence?: number;
    /** 匹配的模板名 */
    template?: string;
    /** 匹配的文本片段 */
    match?: string;
  };
}

// ============================================================
// 因果图运行时结构（仅内存使用）
// ============================================================

/** 因果图运行时结构（邻接表表示） */
export interface CausalGraph {
  /** 节点列表 */
  nodes: CausalNode[];
  /** 边列表 */
  edges: CausalEdge[];
  /** 邻接表（出边）：nodeId → targetNodeId[] */
  adjacency: Map<string, string[]>;
  /** 逆邻接表（入边）：nodeId → sourceNodeId[] */
  reverseAdjacency: Map<string, string[]>;
  /** 节点 ID → 节点对象 映射 */
  nodeMap: Map<string, CausalNode>;
  /** 节点名 → 节点 ID 映射 */
  nameIndex: Map<string, string>;
}

// ============================================================
// 事件流（AssertionCollector 使用）
// ============================================================

/** 因果事件（用于断言抽取的输入） */
export interface CausalEvent {
  /** 事件类型 */
  type: 'action' | 'state_change' | 'metric_change' | 'anomaly' | 'user_input';
  /** 事件来源（如 'perception' / 'monitoring' / 'manual'） */
  source: string;
  /** 事件时间戳 */
  timestamp: number;
  /** 事件描述文本（用于断言抽取） */
  text: string;
  /** 关联的节点名（可选） */
  relatedNodes?: string[];
  /** 元数据 */
  metadata?: Record<string, unknown>;
}
