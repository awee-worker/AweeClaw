/**
 * 因果推理主服务
 *
 * 职责：
 * - 编排 CausalGraphStore / DoCalculusEngine / AssertionCollector
 * - 暴露给 IPC 层调用的统一 API
 * - 配置变更时联动启停 AssertionCollector
 * - 启动时初始化与定时清理
 *
 * 单例模式，主进程启动时初始化。
 *
 * @module causal-reasoning/CausalReasoningService
 */

import { logger } from '@shared/toolkit/LogEngine';
import { CausalGraphStore } from './CausalGraphStore';
import { DoCalculusEngine, buildCausalGraph, computeStats } from './DoCalculusEngine';
import { AssertionExtractor, AssertionCollector } from './AssertionCollector';
import type {
  CausalNode,
  CausalEdge,
  CausalAssertion,
  CounterfactualQueryRecord,
  CausalUserConfig,
  CausalSceneConfig,
  CausalEvent,
  InterventionResult,
  CounterfactualResult,
  BackdoorAdjustmentResult,
  FrontdoorAdjustmentResult,
  SensitivityAnalysisResult,
  GraphStats,
  CausalNodeType,
  CausalNodeSource,
  CausalEdgeRelation,
  CausalEdgeSource,
  AssertionExtractor as ExtractorType,
  AssertionReviewStatus,
  CounterfactualQueryType,
  ExtractedAssertion,
} from './CausalReasoningInterface';

// ============================================================
// CausalReasoningService 实现
// ============================================================

/**
 * 因果推理主服务
 *
 * 单例模式，编排存储/引擎/收集器三大子模块。
 */
export class CausalReasoningService {
  private static instance: CausalReasoningService | null = null;

  /** 存储层 */
  private readonly store: CausalGraphStore;

  /** do-calculus 引擎 */
  private readonly engine: DoCalculusEngine;

  /** 断言抽取器 */
  private readonly extractor: AssertionExtractor;

  /** 事件流收集器 */
  private readonly collector: AssertionCollector;

  /** 是否已初始化 */
  private initialized = false;

  private constructor() {
    this.store = CausalGraphStore.getInstance();
    this.engine = new DoCalculusEngine(this.store);
    this.extractor = new AssertionExtractor();
    this.collector = AssertionCollector.getInstance();
  }

  /** 获取单例 */
  static getInstance(): CausalReasoningService {
    if (!CausalReasoningService.instance) {
      CausalReasoningService.instance = new CausalReasoningService();
    }
    return CausalReasoningService.instance;
  }

  /** 初始化服务 */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.store.initialize();

    // 根据配置启动收集器
    const config = this.store.getConfig();
    if (config.enabled && config.autoExtractionEnabled) {
      this.collector.start();
    }

    this.initialized = true;
    logger.causal?.info('[CausalReasoningService] 初始化完成');
  }

  // ============================================================
  // 节点管理
  // ============================================================

  listNodes(filter?: {
    type?: CausalNodeType;
    source?: CausalNodeSource;
    enabled?: boolean;
    keyword?: string;
  }): CausalNode[] {
    return this.store.listNodes(filter);
  }

  createNode(input: {
    type: CausalNodeType;
    name: string;
    description?: string;
    source?: CausalNodeSource;
    metadata?: Record<string, unknown>;
    enabled?: boolean;
  }): CausalNode {
    return this.store.createNode(input);
  }

  updateNode(
    nodeId: string,
    updates: {
      description?: string;
      metadata?: Record<string, unknown>;
      enabled?: boolean;
    },
  ): CausalNode {
    return this.store.updateNode(nodeId, updates);
  }

  deleteNode(nodeId: string): void {
    this.store.deleteNode(nodeId);
  }

  // ============================================================
  // 边管理
  // ============================================================

  listEdges(filter?: {
    relation?: CausalEdgeRelation;
    source?: CausalEdgeSource;
    enabled?: boolean;
    nodeId?: string;
  }): CausalEdge[] {
    return this.store.listEdges(filter);
  }

  createEdge(input: {
    fromNodeId: string;
    toNodeId: string;
    relation?: CausalEdgeRelation;
    strength?: number;
    evidence?: string;
    source?: CausalEdgeSource;
    enabled?: boolean;
  }): CausalEdge {
    // 环检测
    if (this.engine.wouldCreateCycle(input.fromNodeId, input.toNodeId)) {
      throw new Error('添加此边会形成环，因果图必须是 DAG');
    }
    return this.store.createEdge(input);
  }

  createEdgeByNames(input: {
    fromName: string;
    toName: string;
    relation?: CausalEdgeRelation;
    strength?: number;
    evidence?: string;
    source?: CausalEdgeSource;
  }): CausalEdge {
    // 先确保节点存在
    const fromNode = this.store.getOrCreateNodeByName(input.fromName);
    const toNode = this.store.getOrCreateNodeByName(input.toName);

    return this.createEdge({
      fromNodeId: fromNode.id,
      toNodeId: toNode.id,
      relation: input.relation,
      strength: input.strength,
      evidence: input.evidence,
      source: input.source ?? 'llm',
      enabled: true,
    });
  }

  updateEdge(
    edgeId: string,
    updates: {
      relation?: CausalEdgeRelation;
      strength?: number;
      evidence?: string;
      enabled?: boolean;
    },
  ): CausalEdge {
    return this.store.updateEdge(edgeId, updates);
  }

  deleteEdge(edgeId: string): void {
    this.store.deleteEdge(edgeId);
  }

  // ============================================================
  // 断言管理
  // ============================================================

  listAssertions(filter?: {
    reviewStatus?: AssertionReviewStatus;
    causeName?: string;
    effectName?: string;
    startDate?: number;
    endDate?: number;
  }): CausalAssertion[] {
    return this.store.listAssertions(filter);
  }

  reportAssertion(input: {
    sourceText: string;
    causeName: string;
    effectName: string;
    relation?: CausalEdgeRelation;
    strength?: number;
    extractor?: ExtractorType;
    extractMeta?: Record<string, unknown>;
  }): CausalAssertion {
    return this.store.addAssertion(input);
  }

  batchReportAssertions(
    inputs: Array<{
      sourceText: string;
      causeName: string;
      effectName: string;
      relation?: CausalEdgeRelation;
      strength?: number;
      extractor?: ExtractorType;
      extractMeta?: Record<string, unknown>;
    }>,
  ): CausalAssertion[] {
    return this.store.addAssertions(inputs);
  }

  reviewAssertion(
    assertionId: string,
    review: {
      status: 'approved' | 'rejected' | 'merged';
      reviewedBy?: string;
      reviewNote?: string;
    },
  ): CausalAssertion {
    return this.store.reviewAssertion(assertionId, review);
  }

  /** 从文本自动抽取断言 */
  async extractAssertions(
    sourceText: string,
    minConfidence?: number,
  ): Promise<ExtractedAssertion[]> {
    return this.extractor.extract(sourceText, minConfidence);
  }

  /**
   * 设置 LLM 抽取回调
   *
   * 回调由渲染层通过 IPC 注入，调用 IntelligenceCore 的 LLM 能力。
   * 传入 null 清除回调，降级为仅规则抽取。
   */
  setLlmCallback(
    callback: ((text: string, minConfidence: number) => Promise<ExtractedAssertion[]>) | null,
  ): void {
    this.extractor.setLlmCallback(callback);
  }

  // ============================================================
  // 干预与反事实查询
  // ============================================================

  async intervention(
    interventionVar: string,
    interventionValue: unknown,
    observedVar: string,
    sceneKey?: string,
  ): Promise<InterventionResult> {
    const config = this.store.getConfig();
    if (!config.counterfactualEnabled) {
      throw new Error('反事实查询未启用');
    }

    const result = await this.engine.intervention(
      interventionVar,
      interventionValue,
      observedVar,
      sceneKey,
    );

    // 保存查询记录
    this.store.addQuery({
      queryType: 'intervention',
      interventionVar,
      interventionValue,
      observedVar,
      result: result as unknown as Record<string, unknown>,
      engine: 'local',
      durationMs: result.durationMs,
      success: true,
    });

    return result;
  }

  async counterfactual(
    interventionVar: string,
    interventionValue: unknown,
    observedVar: string,
    observedValue: unknown,
    sceneKey?: string,
  ): Promise<CounterfactualResult> {
    const config = this.store.getConfig();
    if (!config.counterfactualEnabled) {
      throw new Error('反事实查询未启用');
    }

    const result = await this.engine.counterfactual(
      interventionVar,
      interventionValue,
      observedVar,
      observedValue,
      sceneKey,
    );

    // 保存查询记录
    this.store.addQuery({
      queryType: 'counterfactual',
      interventionVar,
      interventionValue,
      observedVar,
      result: result as unknown as Record<string, unknown>,
      engine: 'local',
      durationMs: result.durationMs,
      success: true,
    });

    return result;
  }

  /** 后门调整查询：识别混淆变量 Z，计算调整后因果效应 */
  async backdoorAdjustment(
    interventionVar: string,
    observedVar: string,
    sceneKey?: string,
  ): Promise<BackdoorAdjustmentResult> {
    const config = this.store.getConfig();
    if (!config.counterfactualEnabled) {
      throw new Error('反事实查询未启用');
    }

    const result = await this.engine.backdoorAdjustment(
      interventionVar,
      observedVar,
      sceneKey,
    );

    // 保存查询记录
    this.store.addQuery({
      queryType: 'intervention',
      interventionVar,
      interventionValue: null,
      observedVar,
      result: result as unknown as Record<string, unknown>,
      engine: 'local',
      durationMs: result.durationMs,
      success: true,
    });

    return result;
  }

  /** 前门调整查询：识别中介变量 M，通过中介路径计算因果效应 */
  async frontdoorAdjustment(
    interventionVar: string,
    observedVar: string,
    sceneKey?: string,
  ): Promise<FrontdoorAdjustmentResult> {
    const config = this.store.getConfig();
    if (!config.counterfactualEnabled) {
      throw new Error('反事实查询未启用');
    }

    const result = await this.engine.frontdoorAdjustment(
      interventionVar,
      observedVar,
      sceneKey,
    );

    // 保存查询记录
    this.store.addQuery({
      queryType: 'intervention',
      interventionVar,
      interventionValue: null,
      observedVar,
      result: result as unknown as Record<string, unknown>,
      engine: 'local',
      durationMs: result.durationMs,
      success: true,
    });

    return result;
  }

  /** 敏感性分析：评估未观测混淆变量对反事实结论的影响 */
  async sensitivityAnalysis(
    interventionVar: string,
    observedVar: string,
    sceneKey?: string,
  ): Promise<SensitivityAnalysisResult> {
    const config = this.store.getConfig();
    if (!config.counterfactualEnabled) {
      throw new Error('反事实查询未启用');
    }

    const result = await this.engine.sensitivityAnalysis(
      interventionVar,
      observedVar,
      sceneKey,
    );

    // 保存查询记录
    this.store.addQuery({
      queryType: 'intervention',
      interventionVar,
      interventionValue: null,
      observedVar,
      result: result as unknown as Record<string, unknown>,
      engine: 'local',
      durationMs: result.durationMs,
      success: true,
    });

    return result;
  }

  // ============================================================
  // 场景级阈值配置（阶段5新增）
  // ============================================================

  /** 获取指定场景的阈值配置（未配置或被禁用时返回 null） */
  getSceneConfig(sceneKey: string): CausalSceneConfig | null {
    return this.store.getSceneConfig(sceneKey);
  }

  /** 列出所有场景配置 */
  listSceneConfigs(): CausalSceneConfig[] {
    return this.store.listSceneConfigs();
  }

  /** 创建或更新场景阈值配置 */
  upsertSceneConfig(
    sceneKey: string,
    updates: {
      strongThreshold?: number;
      moderateThreshold?: number;
      weakThreshold?: number;
      enabled?: boolean;
      description?: string;
    },
  ): CausalSceneConfig {
    return this.store.upsertSceneConfig(sceneKey, updates);
  }

  /** 删除场景阈值配置 */
  deleteSceneConfig(sceneKey: string): boolean {
    return this.store.deleteSceneConfig(sceneKey);
  }

  listQueries(filter?: {
    queryType?: CounterfactualQueryType;
    startDate?: number;
    endDate?: number;
  }): CounterfactualQueryRecord[] {
    return this.store.listQueries(filter);
  }

  // ============================================================
  // 配置管理
  // ============================================================

  getConfig(): CausalUserConfig {
    return this.store.getConfig();
  }

  updateConfig(updates: Partial<CausalUserConfig>): CausalUserConfig {
    const oldConfig = this.store.getConfig();
    const newConfig = this.store.updateConfig(updates);

    // 联动启停收集器
    if (
      oldConfig.enabled !== newConfig.enabled ||
      oldConfig.autoExtractionEnabled !== newConfig.autoExtractionEnabled
    ) {
      if (newConfig.enabled && newConfig.autoExtractionEnabled) {
        this.collector.start();
      } else {
        this.collector.stop();
      }
    }

    // 隐私模式联动
    this.store.setPrivacyMode(!newConfig.cloudReportingEnabled);

    return newConfig;
  }

  // ============================================================
  // 图统计
  // ============================================================

  getStats(): GraphStats {
    const nodes = this.store.listNodes();
    const edges = this.store.listEdges();
    const graph = buildCausalGraph(nodes, edges, true);
    return computeStats(graph);
  }

  // ============================================================
  // 事件流收集
  // ============================================================

  /** 收集事件（供其他模块调用） */
  collectEvent(event: CausalEvent): void {
    this.collector.collectEvent(event);
  }

  /** 立即抽取事件流 */
  async flushEvents(): Promise<{ extracted: number }> {
    return this.collector.flush();
  }

  // ============================================================
  // 数据维护
  // ============================================================

  cleanupExpired(): { deleted: number } {
    return this.store.cleanupExpired();
  }

  clearAllData(): void {
    this.store.clearAll();
  }
}
