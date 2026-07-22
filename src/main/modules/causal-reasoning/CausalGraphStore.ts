/**
 * 因果图本地存储 — 基于 JSON 文件的原子写入持久化
 *
 * 存储四类数据：
 * 1. nodes.json：因果图节点
 * 2. edges.json：因果图边
 * 3. assertions.json：待审核的因果断言
 * 4. queries.json：反事实查询历史
 * 5. config.json：用户配置
 *
 * 数据生命周期：
 * - 默认保留 90 天（按用户配置 retentionDays）
 * - 启动时清理过期数据（仅清理已审核的断言）
 * - 隐私模式下不写入磁盘（仅内存）
 *
 * 写入策略：原子写入（先写 .tmp 文件再 rename），避免崩溃导致数据损坏
 *
 * @module causal-reasoning/CausalGraphStore
 */

import { logger } from '@shared/toolkit/LogEngine';
import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import { randomUUID } from 'crypto';
import type {
  CausalNode,
  CausalEdge,
  CausalAssertion,
  CounterfactualQueryRecord,
  CausalUserConfig,
  CausalSceneConfig,
  CausalNodeType,
  CausalNodeSource,
  CausalEdgeRelation,
  CausalEdgeSource,
  AssertionExtractor,
  AssertionReviewStatus,
  CounterfactualQueryType,
  CounterfactualEngine,
} from './CausalReasoningInterface';
import { DEFAULT_CAUSAL_CONFIG } from './CausalReasoningInterface';

// ============================================================
// 常量
// ============================================================

/** 文件名 */
const FILE_NAMES = {
  NODES: 'nodes.json',
  EDGES: 'edges.json',
  ASSERTIONS: 'assertions.json',
  QUERIES: 'queries.json',
  CONFIG: 'config.json',
  SCENE_CONFIGS: 'scene-configs.json',
} as const;

// ============================================================
// 持久化数据包装结构
// ============================================================

interface PersistedFile<T> {
  /** 数据版本号（用于未来 schema 迁移） */
  version: number;
  /** 最后更新时间戳 */
  updatedAt: number;
  /** 数据列表 */
  data: T[];
}

interface ConfigFile {
  version: number;
  updatedAt: number;
  config: CausalUserConfig;
}

// ============================================================
// CausalGraphStore 实现
// ============================================================

/**
 * 因果图本地存储管理器
 *
 * 单例模式，主进程启动时初始化。
 * 提供 nodes / edges / assertions / queries / config 的 CRUD 操作。
 */
export class CausalGraphStore {
  private static instance: CausalGraphStore | null = null;

  /** 存储根目录 */
  private readonly storageDir: string;

  /** 内存缓存 */
  private nodes: CausalNode[] = [];
  private edges: CausalEdge[] = [];
  private assertions: CausalAssertion[] = [];
  private queries: CounterfactualQueryRecord[] = [];
  private config: CausalUserConfig;
  /** 场景级阈值配置（阶段5新增） */
  private sceneConfigs: CausalSceneConfig[] = [];

  /** 是否已初始化 */
  private initialized = false;

  /** 是否为隐私模式（不写入磁盘） */
  private privacyMode = false;

  private constructor() {
    this.storageDir = path.join(app.getPath('userData'), 'causal-reasoning');
    this.config = { ...DEFAULT_CAUSAL_CONFIG };
  }

  /** 获取单例 */
  static getInstance(): CausalGraphStore {
    if (!CausalGraphStore.instance) {
      CausalGraphStore.instance = new CausalGraphStore();
    }
    return CausalGraphStore.instance;
  }

  /** 初始化：创建目录、加载数据、清理过期数据 */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // 创建存储目录
      if (!fs.existsSync(this.storageDir)) {
        fs.mkdirSync(this.storageDir, { recursive: true });
      }

      // 加载所有数据
      this.config = this.loadConfig();
      this.nodes = this.loadFile<CausalNode>(FILE_NAMES.NODES);
      this.edges = this.loadFile<CausalEdge>(FILE_NAMES.EDGES);
      this.assertions = this.loadFile<CausalAssertion>(FILE_NAMES.ASSERTIONS);
      this.queries = this.loadFile<CounterfactualQueryRecord>(FILE_NAMES.QUERIES);
      this.sceneConfigs = this.loadFile<CausalSceneConfig>(FILE_NAMES.SCENE_CONFIGS);

      // 清理过期数据
      this.cleanupExpired();

      this.initialized = true;
      logger.causal?.info(
        `[CausalGraphStore] 初始化完成：nodes=${this.nodes.length} edges=${this.edges.length} assertions=${this.assertions.length} queries=${this.queries.length}`,
      );
    } catch (e) {
      logger.causal?.error('[CausalGraphStore] 初始化失败:', e);
      // 初始化失败时使用空数据，保证服务可用
      this.initialized = true;
    }
  }

  /** 设置隐私模式 */
  setPrivacyMode(enabled: boolean): void {
    this.privacyMode = enabled;
  }

  // ============================================================
  // 节点 CRUD
  // ============================================================

  /** 查询所有节点 */
  listNodes(filter?: {
    type?: CausalNodeType;
    source?: CausalNodeSource;
    enabled?: boolean;
    keyword?: string;
  }): CausalNode[] {
    let result = this.nodes;
    if (filter) {
      if (filter.type) result = result.filter((n) => n.type === filter.type);
      if (filter.source) result = result.filter((n) => n.source === filter.source);
      if (filter.enabled !== undefined)
        result = result.filter((n) => n.enabled === filter.enabled);
      if (filter.keyword) {
        const kw = filter.keyword.toLowerCase();
        result = result.filter(
          (n) =>
            n.name.toLowerCase().includes(kw) ||
            (n.description?.toLowerCase().includes(kw) ?? false),
        );
      }
    }
    return result;
  }

  /** 按 ID 查询节点 */
  getNodeById(nodeId: string): CausalNode | null {
    return this.nodes.find((n) => n.id === nodeId) ?? null;
  }

  /** 按名称查询节点 */
  getNodeByName(name: string): CausalNode | null {
    return this.nodes.find((n) => n.name === name) ?? null;
  }

  /** 创建节点 */
  createNode(input: {
    type: CausalNodeType;
    name: string;
    description?: string;
    source?: CausalNodeSource;
    metadata?: Record<string, unknown>;
    enabled?: boolean;
  }): CausalNode {
    // 检查同名节点
    const existing = this.getNodeByName(input.name);
    if (existing) {
      throw new Error(`节点 "${input.name}" 已存在`);
    }

    // 检查节点数上限
    if (this.nodes.length >= this.config.maxNodes) {
      throw new Error(`节点数已达上限 ${this.config.maxNodes}`);
    }

    const now = Date.now();
    const node: CausalNode = {
      id: randomUUID(),
      type: input.type,
      name: input.name,
      description: input.description,
      source: input.source ?? 'manual',
      metadata: input.metadata,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.nodes.push(node);
    this.persistNodes();
    return node;
  }

  /** 更新节点 */
  updateNode(
    nodeId: string,
    updates: {
      description?: string;
      metadata?: Record<string, unknown>;
      enabled?: boolean;
    },
  ): CausalNode {
    const node = this.getNodeById(nodeId);
    if (!node) throw new Error(`节点 ${nodeId} 不存在`);

    if (updates.description !== undefined) node.description = updates.description;
    if (updates.metadata !== undefined) node.metadata = updates.metadata;
    if (updates.enabled !== undefined) node.enabled = updates.enabled;
    node.updatedAt = Date.now();

    this.persistNodes();
    return node;
  }

  /** 删除节点（级联删除关联边） */
  deleteNode(nodeId: string): void {
    const idx = this.nodes.findIndex((n) => n.id === nodeId);
    if (idx === -1) throw new Error(`节点 ${nodeId} 不存在`);

    this.nodes.splice(idx, 1);
    // 级联删除关联边
    this.edges = this.edges.filter(
      (e) => e.fromNodeId !== nodeId && e.toNodeId !== nodeId,
    );
    this.persistNodes();
    this.persistEdges();
  }

  /** 按名称获取或创建节点 */
  getOrCreateNodeByName(
    name: string,
    type: CausalNodeType = 'event',
  ): CausalNode {
    const existing = this.getNodeByName(name);
    if (existing) return existing;

    return this.createNode({ type, name, source: 'llm' });
  }

  // ============================================================
  // 边 CRUD
  // ============================================================

  /** 查询所有边 */
  listEdges(filter?: {
    relation?: CausalEdgeRelation;
    source?: CausalEdgeSource;
    enabled?: boolean;
    nodeId?: string;
  }): CausalEdge[] {
    let result = this.edges;
    if (filter) {
      if (filter.relation) result = result.filter((e) => e.relation === filter.relation);
      if (filter.source) result = result.filter((e) => e.source === filter.source);
      if (filter.enabled !== undefined)
        result = result.filter((e) => e.enabled === filter.enabled);
      if (filter.nodeId)
        result = result.filter(
          (e) => e.fromNodeId === filter.nodeId || e.toNodeId === filter.nodeId,
        );
    }
    return result;
  }

  /** 按 ID 查询边 */
  getEdgeById(edgeId: string): CausalEdge | null {
    return this.edges.find((e) => e.id === edgeId) ?? null;
  }

  /** 创建边 */
  createEdge(input: {
    fromNodeId: string;
    toNodeId: string;
    relation?: CausalEdgeRelation;
    strength?: number;
    evidence?: string;
    source?: CausalEdgeSource;
    enabled?: boolean;
  }): CausalEdge {
    // 验证节点存在
    const fromNode = this.getNodeById(input.fromNodeId);
    if (!fromNode) throw new Error(`起点节点 ${input.fromNodeId} 不存在`);
    const toNode = this.getNodeById(input.toNodeId);
    if (!toNode) throw new Error(`终点节点 ${input.toNodeId} 不存在`);

    // 不允许自环
    if (input.fromNodeId === input.toNodeId) {
      throw new Error('不允许自环边（from === to）');
    }

    // 检查重复边
    const relation = input.relation ?? 'causes';
    const duplicate = this.edges.find(
      (e) =>
        e.fromNodeId === input.fromNodeId &&
        e.toNodeId === input.toNodeId &&
        e.relation === relation,
    );
    if (duplicate) {
      throw new Error('该因果关系已存在');
    }

    const now = Date.now();
    const edge: CausalEdge = {
      id: randomUUID(),
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      relation,
      strength: input.strength ?? 0.5,
      evidence: input.evidence,
      source: input.source ?? 'manual',
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.edges.push(edge);
    this.persistEdges();
    return edge;
  }

  /** 按节点名创建边（自动创建不存在的节点） */
  createEdgeByNames(input: {
    fromName: string;
    toName: string;
    relation?: CausalEdgeRelation;
    strength?: number;
    evidence?: string;
    source?: CausalEdgeSource;
  }): CausalEdge {
    const fromNode = this.getOrCreateNodeByName(input.fromName);
    const toNode = this.getOrCreateNodeByName(input.toName);

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

  /** 更新边 */
  updateEdge(
    edgeId: string,
    updates: {
      relation?: CausalEdgeRelation;
      strength?: number;
      evidence?: string;
      enabled?: boolean;
    },
  ): CausalEdge {
    const edge = this.getEdgeById(edgeId);
    if (!edge) throw new Error(`边 ${edgeId} 不存在`);

    if (updates.relation !== undefined) edge.relation = updates.relation;
    if (updates.strength !== undefined) edge.strength = updates.strength;
    if (updates.evidence !== undefined) edge.evidence = updates.evidence;
    if (updates.enabled !== undefined) edge.enabled = updates.enabled;
    edge.updatedAt = Date.now();

    this.persistEdges();
    return edge;
  }

  /** 删除边 */
  deleteEdge(edgeId: string): void {
    const idx = this.edges.findIndex((e) => e.id === edgeId);
    if (idx === -1) throw new Error(`边 ${edgeId} 不存在`);

    this.edges.splice(idx, 1);
    this.persistEdges();
  }

  // ============================================================
  // 断言 CRUD
  // ============================================================

  /** 查询断言列表 */
  listAssertions(filter?: {
    reviewStatus?: AssertionReviewStatus;
    causeName?: string;
    effectName?: string;
    startDate?: number;
    endDate?: number;
  }): CausalAssertion[] {
    let result = this.assertions;
    if (filter) {
      if (filter.reviewStatus)
        result = result.filter((a) => a.reviewStatus === filter.reviewStatus);
      if (filter.causeName)
        result = result.filter((a) => a.causeName.includes(filter.causeName!));
      if (filter.effectName)
        result = result.filter((a) => a.effectName.includes(filter.effectName!));
      if (filter.startDate)
        result = result.filter((a) => a.createdAt >= filter.startDate!);
      if (filter.endDate)
        result = result.filter((a) => a.createdAt <= filter.endDate!);
    }
    return result;
  }

  /** 添加断言 */
  addAssertion(input: {
    sourceText: string;
    causeName: string;
    effectName: string;
    relation?: CausalEdgeRelation;
    strength?: number;
    extractor?: AssertionExtractor;
    extractMeta?: Record<string, unknown>;
  }): CausalAssertion {
    const assertion: CausalAssertion = {
      id: randomUUID(),
      sourceText: input.sourceText,
      causeName: input.causeName,
      effectName: input.effectName,
      relation: input.relation ?? 'causes',
      strength: input.strength ?? 0.5,
      extractor: input.extractor ?? 'llm',
      extractMeta: input.extractMeta,
      reviewStatus: 'pending',
      createdAt: Date.now(),
    };

    this.assertions.push(assertion);
    this.persistAssertions();
    return assertion;
  }

  /** 批量添加断言 */
  addAssertions(
    inputs: Array<{
      sourceText: string;
      causeName: string;
      effectName: string;
      relation?: CausalEdgeRelation;
      strength?: number;
      extractor?: AssertionExtractor;
      extractMeta?: Record<string, unknown>;
    }>,
  ): CausalAssertion[] {
    const now = Date.now();
    const created: CausalAssertion[] = inputs.map((input) => ({
      id: randomUUID(),
      sourceText: input.sourceText,
      causeName: input.causeName,
      effectName: input.effectName,
      relation: input.relation ?? 'causes',
      strength: input.strength ?? 0.5,
      extractor: input.extractor ?? 'llm',
      extractMeta: input.extractMeta,
      reviewStatus: 'pending',
      createdAt: now,
    }));

    this.assertions.push(...created);
    this.persistAssertions();
    return created;
  }

  /** 审核断言 */
  reviewAssertion(
    assertionId: string,
    review: {
      status: 'approved' | 'rejected' | 'merged';
      reviewedBy?: string;
      reviewNote?: string;
    },
  ): CausalAssertion {
    const assertion = this.assertions.find((a) => a.id === assertionId);
    if (!assertion) throw new Error(`断言 ${assertionId} 不存在`);
    if (assertion.reviewStatus !== 'pending') {
      throw new Error(`断言当前状态为 ${assertion.reviewStatus}，仅 pending 状态可审核`);
    }

    assertion.reviewStatus = review.status;
    assertion.reviewedBy = review.reviewedBy;
    assertion.reviewedAt = Date.now();
    assertion.reviewNote = review.reviewNote;

    // merged 状态：合并入因果图（创建边）
    if (review.status === 'merged') {
      try {
        const edge = this.createEdgeByNames({
          fromName: assertion.causeName,
          toName: assertion.effectName,
          relation: assertion.relation,
          strength: assertion.strength,
          evidence: assertion.sourceText,
          source: assertion.extractor,
        });
        assertion.mergedEdgeId = edge.id;
      } catch (e) {
        // 合并失败（如产生环或重复边）则降级为 approved
        logger.causal?.warn(
          `[CausalGraphStore] 断言 ${assertionId} 合并失败，降级为 approved:`,
          e,
        );
        assertion.reviewStatus = 'approved';
      }
    }

    this.persistAssertions();
    return assertion;
  }

  // ============================================================
  // 反事实查询记录
  // ============================================================

  /** 查询反事实历史 */
  listQueries(filter?: {
    queryType?: CounterfactualQueryType;
    startDate?: number;
    endDate?: number;
  }): CounterfactualQueryRecord[] {
    let result = this.queries;
    if (filter) {
      if (filter.queryType)
        result = result.filter((q) => q.queryType === filter.queryType);
      if (filter.startDate)
        result = result.filter((q) => q.createdAt >= filter.startDate!);
      if (filter.endDate)
        result = result.filter((q) => q.createdAt <= filter.endDate!);
    }
    return result;
  }

  /** 添加反事实查询记录 */
  addQuery(input: {
    queryType: CounterfactualQueryType;
    interventionVar: string;
    interventionValue: unknown;
    observedVar: string;
    result: unknown;
    engine: CounterfactualEngine;
    durationMs: number;
    success: boolean;
    error?: string;
  }): CounterfactualQueryRecord {
    const record: CounterfactualQueryRecord = {
      id: randomUUID(),
      queryType: input.queryType,
      interventionVar: input.interventionVar,
      interventionValue: input.interventionValue,
      observedVar: input.observedVar,
      result: input.result,
      engine: input.engine,
      durationMs: input.durationMs,
      success: input.success,
      error: input.error,
      createdAt: Date.now(),
    };

    this.queries.push(record);
    this.persistQueries();
    return record;
  }

  // ============================================================
  // 配置管理
  // ============================================================

  /** 获取配置 */
  getConfig(): CausalUserConfig {
    return { ...this.config };
  }

  /** 更新配置 */
  updateConfig(updates: Partial<CausalUserConfig>): CausalUserConfig {
    this.config = { ...this.config, ...updates, updatedAt: Date.now() };
    this.persistConfig();
    return this.getConfig();
  }

  /** 重置配置为默认值 */
  resetConfig(): CausalUserConfig {
    this.config = { ...DEFAULT_CAUSAL_CONFIG, updatedAt: Date.now() };
    this.persistConfig();
    return this.getConfig();
  }

  // ============================================================
  // 场景级阈值配置（阶段5新增）
  // ============================================================

  /** 获取指定场景的阈值配置（未配置或被禁用时返回 null） */
  getSceneConfig(sceneKey: string): CausalSceneConfig | null {
    const config = this.sceneConfigs.find((c) => c.sceneKey === sceneKey);
    if (!config || !config.enabled) return null;
    return { ...config };
  }

  /** 列出所有场景配置（按更新时间倒序） */
  listSceneConfigs(): CausalSceneConfig[] {
    return [...this.sceneConfigs]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({ ...c }));
  }

  /** 创建或更新场景配置（upsert） */
  upsertSceneConfig(
    sceneKey: string,
    updates: Partial<Omit<CausalSceneConfig, 'sceneKey' | 'updatedAt'>>,
  ): CausalSceneConfig {
    // 校验阈值范围与单调性
    const strong = updates.strongThreshold ?? 0.5;
    const moderate = updates.moderateThreshold ?? 0.2;
    const weak = updates.weakThreshold ?? 0.05;
    if (
      strong < 0 ||
      strong > 1 ||
      moderate < 0 ||
      moderate > 1 ||
      weak < 0 ||
      weak > 1
    ) {
      throw new Error('阈值必须在 [0, 1] 范围内');
    }
    if (strong < moderate || moderate < weak) {
      throw new Error('阈值必须满足 strong >= moderate >= weak');
    }

    const idx = this.sceneConfigs.findIndex((c) => c.sceneKey === sceneKey);
    const now = Date.now();

    if (idx >= 0) {
      // 更新现有配置
      const existing = this.sceneConfigs[idx];
      this.sceneConfigs[idx] = {
        ...existing,
        strongThreshold: updates.strongThreshold ?? existing.strongThreshold,
        moderateThreshold:
          updates.moderateThreshold ?? existing.moderateThreshold,
        weakThreshold: updates.weakThreshold ?? existing.weakThreshold,
        enabled: updates.enabled ?? existing.enabled,
        description: updates.description ?? existing.description,
        updatedAt: now,
      };
    } else {
      // 新建配置
      this.sceneConfigs.push({
        sceneKey,
        strongThreshold: strong,
        moderateThreshold: moderate,
        weakThreshold: weak,
        enabled: updates.enabled ?? true,
        description: updates.description ?? null,
        updatedAt: now,
      });
    }

    this.persistSceneConfigs();
    return this.getSceneConfig(sceneKey) ?? this.sceneConfigs[this.sceneConfigs.length - 1];
  }

  /** 删除场景配置 */
  deleteSceneConfig(sceneKey: string): boolean {
    const before = this.sceneConfigs.length;
    this.sceneConfigs = this.sceneConfigs.filter((c) => c.sceneKey !== sceneKey);
    const deleted = this.sceneConfigs.length < before;
    if (deleted) {
      this.persistSceneConfigs();
    }
    return deleted;
  }

  // ============================================================
  // 数据清理
  // ============================================================

  /** 清理过期断言（按 retentionDays 配置） */
  cleanupExpired(): { deleted: number } {
    const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
    const before = this.assertions.length;

    // 仅清理已审核（非 pending）的过期断言
    this.assertions = this.assertions.filter(
      (a) => a.reviewStatus === 'pending' || a.createdAt >= cutoff,
    );

    const deleted = before - this.assertions.length;
    if (deleted > 0) {
      this.persistAssertions();
      logger.causal?.info(`[CausalGraphStore] 已清理 ${deleted} 条过期断言`);
    }

    // 同时清理过期的查询记录
    const queryBefore = this.queries.length;
    this.queries = this.queries.filter((q) => q.createdAt >= cutoff);
    const queryDeleted = queryBefore - this.queries.length;
    if (queryDeleted > 0) {
      this.persistQueries();
      logger.causal?.info(
        `[CausalGraphStore] 已清理 ${queryDeleted} 条过期查询记录`,
      );
    }

    return { deleted: deleted + queryDeleted };
  }

  /** 清空所有数据 */
  clearAll(): void {
    this.nodes = [];
    this.edges = [];
    this.assertions = [];
    this.queries = [];
    this.sceneConfigs = [];
    this.persistNodes();
    this.persistEdges();
    this.persistAssertions();
    this.persistQueries();
    this.persistSceneConfigs();
    logger.causal?.info('[CausalGraphStore] 已清空所有因果推理数据');
  }

  // ============================================================
  // 持久化辅助方法
  // ============================================================

  /** 加载 JSON 文件（失败返回空数组） */
  private loadFile<T>(fileName: string): T[] {
    const filePath = path.join(this.storageDir, fileName);
    try {
      if (!fs.existsSync(filePath)) return [];
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content) as PersistedFile<T>;
      return Array.isArray(parsed.data) ? parsed.data : [];
    } catch (e) {
      logger.causal?.warn(`[CausalGraphStore] 加载 ${fileName} 失败:`, e);
      return [];
    }
  }

  /** 加载配置文件 */
  private loadConfig(): CausalUserConfig {
    const filePath = path.join(this.storageDir, FILE_NAMES.CONFIG);
    try {
      if (!fs.existsSync(filePath)) return { ...DEFAULT_CAUSAL_CONFIG };
      const content = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(content) as ConfigFile;
      return { ...DEFAULT_CAUSAL_CONFIG, ...parsed.config };
    } catch (e) {
      logger.causal?.warn('[CausalGraphStore] 加载配置失败:', e);
      return { ...DEFAULT_CAUSAL_CONFIG };
    }
  }

  /** 原子写入 JSON 文件 */
  private writeFile<T>(fileName: string, data: T[]): void {
    // 隐私模式下不写入磁盘
    if (this.privacyMode) return;

    const filePath = path.join(this.storageDir, fileName);
    const tmpPath = `${filePath}.tmp`;
    const payload: PersistedFile<T> = {
      version: 1,
      updatedAt: Date.now(),
      data,
    };

    try {
      // 先写 .tmp 文件
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
      // 原子 rename
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      logger.causal?.error(`[CausalGraphStore] 写入 ${fileName} 失败:`, e);
      // 清理临时文件
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
  }

  /** 持久化节点 */
  private persistNodes(): void {
    this.writeFile(FILE_NAMES.NODES, this.nodes);
  }

  /** 持久化边 */
  private persistEdges(): void {
    this.writeFile(FILE_NAMES.EDGES, this.edges);
  }

  /** 持久化断言 */
  private persistAssertions(): void {
    this.writeFile(FILE_NAMES.ASSERTIONS, this.assertions);
  }

  /** 持久化查询记录 */
  private persistQueries(): void {
    this.writeFile(FILE_NAMES.QUERIES, this.queries);
  }

  /** 持久化场景配置（阶段5新增） */
  private persistSceneConfigs(): void {
    this.writeFile(FILE_NAMES.SCENE_CONFIGS, this.sceneConfigs);
  }

  /** 持久化配置 */
  private persistConfig(): void {
    if (this.privacyMode) return;
    const filePath = path.join(this.storageDir, FILE_NAMES.CONFIG);
    const tmpPath = `${filePath}.tmp`;
    const payload: ConfigFile = {
      version: 1,
      updatedAt: Date.now(),
      config: this.config,
    };
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      logger.causal?.error('[CausalGraphStore] 写入配置失败:', e);
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // ignore
      }
    }
  }
}
