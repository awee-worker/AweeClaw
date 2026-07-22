/**
 * 因果图 DAG 操作与 do-calculus 本地引擎
 *
 * 实现：
 * 1. DAG 操作：拓扑排序（Kahn）、环检测（DFS 三色标记）、路径查找（BFS）、
 *    祖先/后代遍历、子图提取、统计计算、连通分量（Union-Find）
 * 2. Pearl do-calculus 干预查询：do(X=x) → Y 影响分析
 * 3. 反事实推理：基于路径传播的简化 SCM
 *
 * 算法说明：
 * - 因果图默认为 DAG（CausalGraphStore 已做环检测）
 * - 边 strength（0-1）表示因果强度，传播时按 strength 衰减
 * - prevents/inhibits 视为负向影响（符号 -1），causes/enables 为正向（+1）
 *
 * 与后端 DoCalculusService 保持算法一致，便于本地与云端结果对比验证
 *
 * @module causal-reasoning/DoCalculusEngine
 */

import type {
  CausalNode,
  CausalEdge,
  CausalGraph,
  TopologicalSortResult,
  PathAnalysis,
  GraphStats,
  InterventionResult,
  CounterfactualResult,
  BackdoorAdjustmentResult,
  FrontdoorAdjustmentResult,
  SensitivityAnalysisResult,
  SensitivityGridPoint,
  RobustnessLevel,
  ImpactLevel,
  ChangeDirection,
  SceneThresholds,
} from './CausalReasoningInterface';
import { DEFAULT_THRESHOLDS } from './CausalReasoningInterface';
import type { CausalGraphStore } from './CausalGraphStore';

// ============================================================
// 常量
// ============================================================

/** 影响等级阈值（默认值，可被场景级阈值覆盖） */
const STRONG_THRESHOLD = 0.5;
const WEAK_THRESHOLD = 0.05;

/** 路径查找最大返回数 */
const MAX_PATHS_RETURN = 20;

/** 路径查找最大路径长度 */
const MAX_PATH_LENGTH = 20;

/** 路径查找最大遍历数（防爆栈） */
const MAX_PATHS_LIMIT = 100;

// ============================================================
// DAG 操作
// ============================================================

/**
 * 构建因果图运行时结构
 *
 * 从节点/边列表构建邻接表、逆邻接表、节点映射、名称索引
 */
export function buildCausalGraph(
  nodes: CausalNode[],
  edges: CausalEdge[],
  onlyEnabled = true,
): CausalGraph {
  const filteredNodes = onlyEnabled ? nodes.filter((n) => n.enabled) : nodes;
  const filteredEdges = onlyEnabled
    ? edges.filter((e) => e.enabled)
    : edges;

  const nodeMap = new Map<string, CausalNode>();
  const nameIndex = new Map<string, string>();
  const adjacency = new Map<string, string[]>();
  const reverseAdjacency = new Map<string, string[]>();

  for (const node of filteredNodes) {
    nodeMap.set(node.id, node);
    nameIndex.set(node.name, node.id);
    adjacency.set(node.id, []);
    reverseAdjacency.set(node.id, []);
  }

  for (const edge of filteredEdges) {
    // 仅处理两端节点都存在的边
    if (!nodeMap.has(edge.fromNodeId) || !nodeMap.has(edge.toNodeId)) continue;
    adjacency.get(edge.fromNodeId)?.push(edge.toNodeId);
    reverseAdjacency.get(edge.toNodeId)?.push(edge.fromNodeId);
  }

  return {
    nodes: filteredNodes,
    edges: filteredEdges,
    adjacency,
    reverseAdjacency,
    nodeMap,
    nameIndex,
  };
}

/**
 * 拓扑排序（Kahn 算法）
 *
 * 同时检测环：若排序后的节点数 < 总节点数，则存在环
 */
export function topologicalSort(graph: CausalGraph): TopologicalSortResult {
  const inDegree = new Map<string, number>();
  for (const node of graph.nodes) {
    inDegree.set(node.id, 0);
  }
  for (const node of graph.nodes) {
    const targets = graph.adjacency.get(node.id) ?? [];
    for (const target of targets) {
      inDegree.set(target, (inDegree.get(target) ?? 0) + 1);
    }
  }

  // 入度为 0 的节点入队
  const queue: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const targets = graph.adjacency.get(id) ?? [];
    for (const target of targets) {
      const newDegree = (inDegree.get(target) ?? 0) - 1;
      inDegree.set(target, newDegree);
      if (newDegree === 0) queue.push(target);
    }
  }

  const hasCycle = order.length < graph.nodes.length;
  const cycles = hasCycle ? findCyclesDFS(graph) : [];

  return { order, hasCycle, cycles };
}

/**
 * DFS 三色标记法查找环
 *
 * 白色：未访问 / 灰色：当前递归栈 / 黑色：已完成
 */
function findCyclesDFS(graph: CausalGraph): string[][] {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const node of graph.nodes) color.set(node.id, WHITE);

  const cycles: string[][] = [];
  let cycleCount = 0;
  const MAX_CYCLES = 10;

  const dfs = (nodeId: string, path: string[]): void => {
    if (cycleCount >= MAX_CYCLES) return;
    color.set(nodeId, GRAY);
    path.push(nodeId);

    const targets = graph.adjacency.get(nodeId) ?? [];
    for (const target of targets) {
      if (cycleCount >= MAX_CYCLES) return;
      const targetColor = color.get(target) ?? WHITE;
      if (targetColor === GRAY) {
        // 找到环：从 path 中 target 的位置开始到当前
        const cycleStart = path.indexOf(target);
        const cycle = path.slice(cycleStart);
        cycles.push(cycle);
        cycleCount++;
      } else if (targetColor === WHITE) {
        dfs(target, path);
      }
    }

    path.pop();
    color.set(nodeId, BLACK);
  };

  for (const node of graph.nodes) {
    if ((color.get(node.id) ?? WHITE) === WHITE) {
      dfs(node.id, []);
    }
  }

  return cycles;
}

/**
 * 查找两点间所有路径（BFS）
 *
 * 限制：最多返回 MAX_PATHS_RETURN 条路径，单条路径长度不超过 MAX_PATH_LENGTH
 */
export function findAllPaths(
  graph: CausalGraph,
  fromNodeId: string,
  toNodeId: string,
): PathAnalysis {
  if (!graph.nodeMap.has(fromNodeId) || !graph.nodeMap.has(toNodeId)) {
    return { paths: [], truncated: false };
  }

  const paths: string[][] = [];
  let truncated = false;
  let explored = 0;

  // BFS 队列：存储当前路径
  const queue: string[][] = [[fromNodeId]];

  while (queue.length > 0) {
    if (paths.length >= MAX_PATHS_RETURN) {
      truncated = true;
      break;
    }
    if (explored >= MAX_PATHS_LIMIT) {
      truncated = true;
      break;
    }
    explored++;

    const path = queue.shift()!;
    const current = path[path.length - 1];

    if (current === toNodeId) {
      paths.push([...path]);
      continue;
    }

    // 路径过长则截断
    if (path.length >= MAX_PATH_LENGTH) continue;

    const targets = graph.adjacency.get(current) ?? [];
    for (const target of targets) {
      // 避免重复访问（环检测）
      if (path.includes(target)) continue;
      queue.push([...path, target]);
    }
  }

  return { paths, truncated };
}

/**
 * 查找节点的所有祖先（上游节点）
 */
export function findAncestors(
  graph: CausalGraph,
  nodeId: string,
  maxDepth = 10,
): string[] {
  if (!graph.nodeMap.has(nodeId)) return [];

  const ancestors = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: nodeId, depth: 0 },
  ];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const sources = graph.reverseAdjacency.get(id) ?? [];
    for (const source of sources) {
      if (!ancestors.has(source)) {
        ancestors.add(source);
        queue.push({ id: source, depth: depth + 1 });
      }
    }
  }

  return Array.from(ancestors);
}

/**
 * 查找节点的所有后代（下游节点）
 */
export function findDescendants(
  graph: CausalGraph,
  nodeId: string,
  maxDepth = 10,
): string[] {
  if (!graph.nodeMap.has(nodeId)) return [];

  const descendants = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [
    { id: nodeId, depth: 0 },
  ];

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;

    const targets = graph.adjacency.get(id) ?? [];
    for (const target of targets) {
      if (!descendants.has(target)) {
        descendants.add(target);
        queue.push({ id: target, depth: depth + 1 });
      }
    }
  }

  return Array.from(descendants);
}

/**
 * 计算图统计信息
 */
export function computeStats(graph: CausalGraph): GraphStats {
  const nodeCount = graph.nodes.length;
  const edgeCount = graph.edges.length;
  const density =
    nodeCount > 1 ? edgeCount / (nodeCount * (nodeCount - 1)) : 0;

  // 连通分量（Union-Find）
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (parent.get(x) === x) return x;
    const root = find(parent.get(x)!);
    parent.set(x, root);
    return root;
  };
  const union = (x: string, y: string): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent.set(rx, ry);
  };

  for (const node of graph.nodes) parent.set(node.id, node.id);
  for (const edge of graph.edges) {
    if (parent.has(edge.fromNodeId) && parent.has(edge.toNodeId)) {
      union(edge.fromNodeId, edge.toNodeId);
    }
  }

  const roots = new Set<string>();
  for (const node of graph.nodes) roots.add(find(node.id));

  const componentCount = roots.size;
  const avgOutDegree = nodeCount > 0 ? edgeCount / nodeCount : 0;
  const avgInDegree = nodeCount > 0 ? edgeCount / nodeCount : 0;

  const { hasCycle } = topologicalSort(graph);

  return {
    nodeCount,
    edgeCount,
    density,
    componentCount,
    avgOutDegree,
    avgInDegree,
    hasCycle,
  };
}

// ============================================================
// do-calculus 引擎
// ============================================================

/**
 * do-calculus 本地引擎
 *
 * 提供干预查询与反事实推理能力。
 * 与后端 DoCalculusService 算法保持一致。
 */
export class DoCalculusEngine {
  constructor(private readonly store: CausalGraphStore) {}

  /**
   * 获取指定场景的阈值配置（阶段5新增）
   *
   * 若未传 sceneKey、或场景未配置/被禁用，则返回默认阈值。
   *
   * @param sceneKey 场景标识（可选）
   */
  private getThresholds(sceneKey?: string): SceneThresholds {
    if (!sceneKey) return DEFAULT_THRESHOLDS;
    const sceneConfig = this.store.getSceneConfig(sceneKey);
    if (!sceneConfig) return DEFAULT_THRESHOLDS;
    return {
      strong: sceneConfig.strongThreshold,
      moderate: sceneConfig.moderateThreshold,
      weak: sceneConfig.weakThreshold,
    };
  }

  /**
   * 干预查询：do(X=x) 对 Y 的影响
   *
   * 算法：
   * 1. 加载因果图
   * 2. 找出 X → Y 的所有路径
   * 3. 计算每条路径的累积强度（边 strength 乘积）
   * 4. 总影响 = Σ(路径强度 × 关系符号) / 路径数
   * 5. 输出影响分数 + 等级 + 路径
   *
   * @param sceneKey 场景标识（阶段5新增，可选；若配置了对应场景阈值则覆盖默认）
   */
  async intervention(
    interventionVar: string,
    interventionValue: unknown,
    observedVar: string,
    sceneKey?: string,
  ): Promise<InterventionResult> {
    const startTime = Date.now();

    const thresholds = this.getThresholds(sceneKey);
    const graph = this.loadGraph();
    const fromNodeId = graph.nameIndex.get(interventionVar);
    const toNodeId = graph.nameIndex.get(observedVar);

    if (!fromNodeId) {
      throw new Error(`干预变量 "${interventionVar}" 不存在于因果图中`);
    }
    if (!toNodeId) {
      throw new Error(`观测变量 "${observedVar}" 不存在于因果图中`);
    }

    // 找出所有 X → Y 的路径
    const pathAnalysis = findAllPaths(graph, fromNodeId, toNodeId);

    // 计算每条路径的累积强度
    const causalPaths: string[][] = [];
    let totalStrength = 0;
    let signedSum = 0;

    for (const path of pathAnalysis.paths.slice(0, MAX_PATHS_RETURN)) {
      const pathStrength = this.computePathStrength(graph, path);
      const pathSign = this.computePathSign(graph, path);
      const signed = pathStrength * pathSign;

      totalStrength += pathStrength;
      signedSum += signed;

      // 转换为节点名数组
      causalPaths.push(
        path.map((id) => graph.nodeMap.get(id)?.name ?? id),
      );
    }

    // 计算影响分数 [-1, 1]
    const impactScore =
      causalPaths.length > 0
        ? Math.max(-1, Math.min(1, signedSum / causalPaths.length))
        : 0;

    // 截断的入边数（do(X) 切断 X 的所有入边）
    const truncatedEdges = graph.reverseAdjacency.get(fromNodeId)?.length ?? 0;

    const durationMs = Date.now() - startTime;

    return {
      interventionVar,
      interventionValue,
      observedVar,
      impactScore,
      impactLevel: this.classifyImpact(impactScore, thresholds),
      causalPaths,
      totalStrength,
      truncatedEdges,
      durationMs,
    };
  }

  /**
   * 反事实查询：如果当时 X=x'，Y 会是什么
   *
   * 简化实现（基于路径传播）：
   * 1. 计算 do(X=x') 对 Y 的影响分数
   * 2. 根据影响分数和观测值推断反事实值
   * 3. 置信度 = 路径数 / (路径数 + 1) × 平均路径强度
   *
   * @param sceneKey 场景标识（阶段5新增，可选）
   */
  async counterfactual(
    interventionVar: string,
    interventionValue: unknown,
    observedVar: string,
    observedValue: unknown,
    sceneKey?: string,
  ): Promise<CounterfactualResult> {
    const startTime = Date.now();

    // 复用干预查询逻辑（传入 sceneKey 以应用场景阈值）
    const interventionResult = await this.intervention(
      interventionVar,
      interventionValue,
      observedVar,
      sceneKey,
    );

    // 推断反事实值
    const counterfactualValue = this.predictCounterfactualValue(
      observedValue,
      interventionResult.impactScore,
      interventionValue,
    );

    const wouldChange = !this.deepEqual(counterfactualValue, observedValue);
    const changeDirection = this.classifyChange(
      observedValue,
      counterfactualValue,
    );

    // 置信度：路径数 / (路径数 + 1) × 平均路径强度
    const pathCount = interventionResult.causalPaths.length;
    const avgStrength =
      pathCount > 0
        ? interventionResult.totalStrength / pathCount
        : 0;
    const confidence = (pathCount / (pathCount + 1)) * avgStrength;

    const durationMs = Date.now() - startTime;

    return {
      ...interventionResult,
      observedValue,
      counterfactualValue,
      wouldChange,
      changeDirection,
      confidence,
      durationMs,
    };
  }

  // ============================================================
  // 后门调整（Backdoor Adjustment）
  // ============================================================

  /**
   * 后门调整查询：识别混淆变量 Z，计算调整后的因果效应
   *
   * 算法步骤：
   * 1. 加载因果图
   * 2. Z = commonAncestors(X, Y) - descendants(X) - {X, Y}
   * 3. 调整后效应 = 仅通过有向因果路径 X→Y 的效应（即 do(X) 效应）
   * 4. 混淆偏差 = Σ_z strength(z→X) × strength(z→Y) × sign(z→X) × sign(z→Y) / |Z|
   * 5. 原始关联 = 调整后效应 + 混淆偏差
   *
   * 与后端 DoCalculusService.backdoorAdjustment 算法保持一致。
   */
  async backdoorAdjustment(
    interventionVar: string,
    observedVar: string,
    sceneKey?: string,
  ): Promise<BackdoorAdjustmentResult> {
    const startTime = Date.now();

    const thresholds = this.getThresholds(sceneKey);
    const graph = this.loadGraph();
    const fromNodeId = graph.nameIndex.get(interventionVar);
    const toNodeId = graph.nameIndex.get(observedVar);

    if (!fromNodeId) {
      throw new Error(`干预变量 "${interventionVar}" 不存在于因果图中`);
    }
    if (!toNodeId) {
      throw new Error(`观测变量 "${observedVar}" 不存在于因果图中`);
    }

    // 步骤1：识别混淆变量 Z = commonAncestors(X,Y) - descendants(X) - {X,Y}
    const ancestorsX = new Set(findAncestors(graph, fromNodeId));
    const ancestorsY = new Set(findAncestors(graph, toNodeId));
    const descendantsX = new Set(findDescendants(graph, fromNodeId));

    const zSet: string[] = [];
    for (const z of ancestorsX) {
      if (z === fromNodeId || z === toNodeId) continue;
      if (!ancestorsY.has(z)) continue;
      if (descendantsX.has(z)) continue;
      zSet.push(z);
    }

    const zNames = zSet.map(
      (id) => graph.nodeMap.get(id)?.name ?? id,
    );

    // 步骤2：计算有向因果路径效应（即 do(X) 的效应）
    const pathAnalysis = findAllPaths(graph, fromNodeId, toNodeId);
    const causalPaths: string[][] = [];
    let causalSignedSum = 0;
    let causalPathCount = 0;

    for (const path of pathAnalysis.paths.slice(0, MAX_PATHS_RETURN)) {
      const pathStrength = this.computePathStrength(graph, path);
      const pathSign = this.computePathSign(graph, path);
      causalSignedSum += pathStrength * pathSign;
      causalPathCount++;
      causalPaths.push(
        path.map((id) => graph.nodeMap.get(id)?.name ?? id),
      );
    }

    const adjustedEffect =
      causalPathCount > 0
        ? Math.max(-1, Math.min(1, causalSignedSum / causalPathCount))
        : 0;

    // 步骤3：计算混淆偏差
    let confoundingBias = 0;
    const backdoorPaths: string[][] = [];

    for (const zId of zSet) {
      const zToX = this.computeMaxPathContribution(graph, zId, fromNodeId);
      const zToY = this.computeMaxPathContribution(graph, zId, toNodeId);
      const contribution = zToX.strength * zToY.strength * zToX.sign * zToY.sign;
      confoundingBias += contribution;

      // 构造后门路径示例：X ← Z → ... → Y
      if (backdoorPaths.length < 10 && zToX.path && zToY.path) {
        const zName = graph.nodeMap.get(zId)?.name ?? zId;
        const zToYPathNames = zToY.path
          .slice(1)
          .map((id) => graph.nodeMap.get(id)?.name ?? id);
        backdoorPaths.push([interventionVar, zName, ...zToYPathNames]);
      }
    }
    if (zSet.length > 0) {
      confoundingBias /= zSet.length;
    }
    confoundingBias = Math.max(-1, Math.min(1, confoundingBias));

    const originalAssociation = Math.max(
      -1,
      Math.min(1, adjustedEffect + confoundingBias),
    );

    const durationMs = Date.now() - startTime;

    return {
      interventionVar,
      observedVar,
      adjustmentMethod: 'backdoor',
      satisfiesCriterion: true,
      adjustmentSet: zNames,
      confounders: zNames,
      adjustedEffect,
      adjustedLevel: this.classifyImpact(adjustedEffect, thresholds),
      originalAssociation,
      confoundingBias,
      causalPaths,
      backdoorPaths,
      durationMs,
      reason: zSet.length === 0 ? '未识别到混淆变量，调整集为空' : undefined,
    };
  }

  // ============================================================
  // 前门调整（Frontdoor Adjustment）
  // ============================================================

  /**
   * 前门调整查询：识别中介变量 M，通过中介路径计算因果效应
   *
   * 算法步骤：
   * 1. 加载因果图，找出 X → Y 的所有有向路径
   * 2. 候选中介集 M = ∪(路径上除 X、Y 外的所有节点)
   * 3. 验证前门准则：
   *    a. 移除 M 后无 X → Y 路径
   *    b. X → M 无后门路径（ancestors(X) ∩ ancestors(M) - {X} = ∅）
   *    c. M → Y 的所有后门路径都被 X 阻断
   * 4. 计算前门效应：effect = Σ_m strength(X→m) × strength(m→Y) × sign × sign / |M|
   *
   * 与后端 DoCalculusService.frontdoorAdjustment 算法保持一致。
   */
  async frontdoorAdjustment(
    interventionVar: string,
    observedVar: string,
    sceneKey?: string,
  ): Promise<FrontdoorAdjustmentResult> {
    const startTime = Date.now();

    const thresholds = this.getThresholds(sceneKey);
    const graph = this.loadGraph();
    const fromNodeId = graph.nameIndex.get(interventionVar);
    const toNodeId = graph.nameIndex.get(observedVar);

    if (!fromNodeId) {
      throw new Error(`干预变量 "${interventionVar}" 不存在于因果图中`);
    }
    if (!toNodeId) {
      throw new Error(`观测变量 "${observedVar}" 不存在于因果图中`);
    }

    // 步骤1：找出 X → Y 的所有有向路径
    const pathAnalysis = findAllPaths(graph, fromNodeId, toNodeId);

    if (pathAnalysis.paths.length === 0) {
      const durationMs = Date.now() - startTime;
      return {
        interventionVar,
        observedVar,
        adjustmentMethod: 'frontdoor',
        satisfiesCriterion: false,
        adjustmentSet: [],
        mediators: [],
        adjustedEffect: 0,
        adjustedLevel: 'negligible',
        xToMediatorStrengths: [],
        mediatorToYStrengths: [],
        mediatorPaths: [],
        durationMs,
        reason: 'X 与 Y 之间不存在有向路径，无法应用前门调整',
      };
    }

    // 步骤2：候选中介集 M = 路径上除 X、Y 外的所有节点
    const mediatorSet = new Set<string>();
    const mediatorPaths: string[][] = [];
    for (const path of pathAnalysis.paths.slice(0, MAX_PATHS_RETURN)) {
      for (let i = 1; i < path.length - 1; i++) {
        mediatorSet.add(path[i]);
      }
      mediatorPaths.push(
        path.map((id) => graph.nodeMap.get(id)?.name ?? id),
      );
    }

    // 步骤3：验证前门准则 a - 移除 M 后无 X → Y 路径
    const tempAdjacency = new Map<string, string[]>();
    for (const [id, targets] of graph.adjacency) {
      tempAdjacency.set(
        id,
        targets.filter((t) => !mediatorSet.has(t)),
      );
    }
    const tempGraph: CausalGraph = { ...graph, adjacency: tempAdjacency };
    const remainingPaths = findAllPaths(tempGraph, fromNodeId, toNodeId);
    const criterionA = remainingPaths.paths.length === 0;

    // 步骤4：验证前门准则 b - X → M 无后门路径
    const ancestorsX = new Set(findAncestors(graph, fromNodeId));
    let criterionB = true;
    for (const mId of mediatorSet) {
      const ancestorsM = findAncestors(graph, mId);
      for (const am of ancestorsM) {
        if (am !== fromNodeId && ancestorsX.has(am)) {
          criterionB = false;
          break;
        }
      }
      if (!criterionB) break;
    }

    // 步骤5：验证前门准则 c - M → Y 的所有后门路径都被 X 阻断
    const ancestorsXPlus = new Set([...ancestorsX, fromNodeId]);
    let criterionC = true;
    for (const mId of mediatorSet) {
      const ancestorsM = new Set(findAncestors(graph, mId));
      for (const am of ancestorsM) {
        if (am === mId || am === toNodeId) continue;
        if (!ancestorsXPlus.has(am)) {
          if (this.isAncestorOf(graph, am, toNodeId)) {
            criterionC = false;
            break;
          }
        }
      }
      if (!criterionC) break;
    }

    const satisfiesCriterion = criterionA && criterionB && criterionC;
    const mediatorIds = Array.from(mediatorSet);
    const mediatorNames = mediatorIds.map(
      (id) => graph.nodeMap.get(id)?.name ?? id,
    );

    // 步骤6：计算前门效应
    const xToMediatorStrengths: Array<{
      mediator: string;
      strength: number;
      sign: number;
    }> = [];
    const mediatorToYStrengths: Array<{
      mediator: string;
      strength: number;
      sign: number;
    }> = [];
    let effectSum = 0;

    for (const mId of mediatorIds) {
      const xToM = this.computeMaxPathContribution(graph, fromNodeId, mId);
      const mToY = this.computeMaxPathContribution(graph, mId, toNodeId);
      const mName = graph.nodeMap.get(mId)?.name ?? mId;

      xToMediatorStrengths.push({
        mediator: mName,
        strength: xToM.strength,
        sign: xToM.sign,
      });
      mediatorToYStrengths.push({
        mediator: mName,
        strength: mToY.strength,
        sign: mToY.sign,
      });

      effectSum += xToM.strength * mToY.strength * xToM.sign * mToY.sign;
    }

    const adjustedEffect =
      mediatorIds.length > 0
        ? Math.max(-1, Math.min(1, effectSum / mediatorIds.length))
        : 0;

    const durationMs = Date.now() - startTime;

    let reason: string | undefined;
    if (!satisfiesCriterion) {
      const reasons: string[] = [];
      if (!criterionA) {
        reasons.push('存在不经过中介集 M 的有向路径 X→Y');
      }
      if (!criterionB) {
        reasons.push('X 到 M 存在后门路径（存在共同非 X 祖先）');
      }
      if (!criterionC) {
        reasons.push('M 到 Y 的后门路径未被 X 完全阻断');
      }
      reason = reasons.join('；');
    }

    return {
      interventionVar,
      observedVar,
      adjustmentMethod: 'frontdoor',
      satisfiesCriterion,
      adjustmentSet: mediatorNames,
      mediators: mediatorNames,
      adjustedEffect,
      adjustedLevel: this.classifyImpact(adjustedEffect, thresholds),
      xToMediatorStrengths,
      mediatorToYStrengths,
      mediatorPaths,
      durationMs,
      reason,
    };
  }

  // ============================================================
  // 敏感性分析（Sensitivity Analysis）
  // ============================================================

  /**
   * 敏感性分析：评估未观测混淆变量对反事实结论的影响
   *
   * 算法（基于 Rosenbaum 框架简化版 + VanderWeele E-value 思想）：
   * 1. 复用 backdoorAdjustment 获取调整后效应和已观测混淆偏差
   * 2. 假设未观测混淆变量 U（U→X 强度 α, U→Y 强度 β）
   * 3. 临界混淆乘积 = |adjustedEffect| - WEAK_THRESHOLD
   * 4. 稳健性等级：robust(>0.5) / moderate(>0.2) / sensitive(>0) / fragile(≤0)
   * 5. 生成 11×11 网格的效应热力图
   *
   * 与后端 DoCalculusService.sensitivityAnalysis 算法保持一致。
   */
  async sensitivityAnalysis(
    interventionVar: string,
    observedVar: string,
    sceneKey?: string,
  ): Promise<SensitivityAnalysisResult> {
    const startTime = Date.now();

    // 阶段5：加载场景级阈值
    const thresholds = this.getThresholds(sceneKey);

    // 复用后门调整结果（传入 sceneKey 以应用场景阈值）
    const backdoor = await this.backdoorAdjustment(
      interventionVar,
      observedVar,
      sceneKey,
    );

    const originalAdjustedEffect = backdoor.adjustedEffect;
    const observedConfoundingBias = backdoor.confoundingBias;
    const observedConfounders = backdoor.confounders;

    // 临界混淆乘积（使用场景 weak 阈值）
    const absEffect = Math.abs(originalAdjustedEffect);
    const criticalConfoundingProduct = Math.max(0, absEffect - thresholds.weak);

    // E-value
    const eValue = criticalConfoundingProduct;

    // 稳健性等级（使用场景 strong/moderate 阈值覆盖默认 0.5/0.2）
    let robustnessLevel: RobustnessLevel;
    if (criticalConfoundingProduct > thresholds.strong) {
      robustnessLevel = 'robust';
    } else if (criticalConfoundingProduct > thresholds.moderate) {
      robustnessLevel = 'moderate';
    } else if (criticalConfoundingProduct > 0) {
      robustnessLevel = 'sensitive';
    } else {
      robustnessLevel = 'fragile';
    }

    // 生成 11×11 敏感性网格
    const gridResolution = 11;
    const grid: SensitivityGridPoint[] = [];
    const effectSign = Math.sign(originalAdjustedEffect);

    for (let i = 0; i < gridResolution; i++) {
      for (let j = 0; j < gridResolution; j++) {
        const alpha = i / (gridResolution - 1);
        const beta = j / (gridResolution - 1);
        const confoundingProduct = alpha * beta;

        // 假设未观测混淆与效应反向（最不利场景）
        const adjustedEffectWithU = Math.max(
          -1,
          Math.min(
            1,
            originalAdjustedEffect - effectSign * confoundingProduct,
          ),
        );

        grid.push({
          alpha: Math.round(alpha * 100) / 100,
          beta: Math.round(beta * 100) / 100,
          confoundingProduct: Math.round(confoundingProduct * 1000) / 1000,
          adjustedEffectWithU: Math.round(adjustedEffectWithU * 1000) / 1000,
          remainsSignificant: Math.abs(adjustedEffectWithU) >= thresholds.weak,
        });
      }
    }

    const conclusion = this.buildSensitivityConclusion(
      originalAdjustedEffect,
      criticalConfoundingProduct,
      robustnessLevel,
      observedConfounders.length,
    );

    const durationMs = Date.now() - startTime;

    return {
      interventionVar,
      observedVar,
      originalAdjustedEffect,
      observedConfoundingBias,
      criticalConfoundingProduct,
      eValue,
      robustnessLevel,
      grid,
      gridResolution,
      observedConfounders,
      durationMs,
      conclusion,
    };
  }

  /**
   * 构造敏感性分析结论说明
   */
  private buildSensitivityConclusion(
    adjustedEffect: number,
    criticalProduct: number,
    level: RobustnessLevel,
    observedConfounderCount: number,
  ): string {
    const effectDesc =
      adjustedEffect > 0
        ? `正向效应（${adjustedEffect.toFixed(3)}）`
        : adjustedEffect < 0
          ? `负向效应（${adjustedEffect.toFixed(3)}）`
          : '无明显效应';

    const confounderDesc =
      observedConfounderCount > 0
        ? `已识别 ${observedConfounderCount} 个观测混淆变量`
        : '未识别到观测混淆变量';

    switch (level) {
      case 'robust':
        return `${effectDesc}，${confounderDesc}。结论稳健：未观测混淆变量需达到 ${criticalProduct.toFixed(3)} 的乘积强度才能颠覆结论，现实中不太可能存在如此强的隐藏混淆。`;
      case 'moderate':
        return `${effectDesc}，${confounderDesc}。结论较稳健：未观测混淆变量需达到 ${criticalProduct.toFixed(3)} 的乘积强度才能颠覆结论，建议关注可能被遗漏的强混淆变量。`;
      case 'sensitive':
        return `${effectDesc}，${confounderDesc}。结论较敏感：仅需 ${criticalProduct.toFixed(3)} 的未观测混淆乘积强度即可颠覆结论，应谨慎解读，建议补充关键混淆变量。`;
      case 'fragile':
        return `${effectDesc}，${confounderDesc}。结论脆弱：效应已接近可忽略阈值，任何未观测混淆都可能改变结论，不建议基于此结论做决策。`;
    }
  }

  /**
   * 检查添加 fromNode → toNode 边后是否形成环
   */
  wouldCreateCycle(fromNodeId: string, toNodeId: string): boolean {
    const graph = this.loadGraph();
    // 临时添加新边
    const existingTargets = graph.adjacency.get(fromNodeId) ?? [];
    existingTargets.push(toNodeId);
    graph.adjacency.set(fromNodeId, existingTargets);

    const { hasCycle } = topologicalSort(graph);
    return hasCycle;
  }

  // ============================================================
  // do-calculus 规则 1-3（阶段6新增）
  // ============================================================

  /**
   * do-calculus 规则 1：插入/删除观测
   *
   * 规则：如果 W 阻断了 X 到 Z 的所有后门路径（给定 Y），则
   *   P(Z | do(X), Y, W) = P(Z | X, Y, W)
   *
   * 即：当 W 满足后门准则时，do(X) 可用观测 X 替代。
   *
   * @returns 是否可应用规则 1（true 表示可用观测替代干预）
   */
  canApplyRule1(
    interventionVar: string,
    observedVar: string,
    conditioningSet: string[],
  ): {
    applicable: boolean;
    reason: string;
    backdoorSet: string[];
  } {
    const graph = this.loadGraph();
    const fromId = graph.nameIndex.get(interventionVar);
    const toId = graph.nameIndex.get(observedVar);

    if (!fromId || !toId) {
      return {
        applicable: false,
        reason: '干预变量或观测变量不存在于因果图中',
        backdoorSet: [],
      };
    }

    // 计算满足后门准则的 Z 集合
    const ancestorsX = new Set(findAncestors(graph, fromId));
    const ancestorsY = new Set(findAncestors(graph, toId));
    const descendantsX = new Set(findDescendants(graph, fromId));

    const backdoorSet: string[] = [];
    for (const z of ancestorsX) {
      if (z === fromId || z === toId) continue;
      if (!ancestorsY.has(z)) continue;
      if (descendantsX.has(z)) continue;
      backdoorSet.push(graph.nodeMap.get(z)?.name ?? z);
    }

    // 检查 conditioningSet 是否覆盖后门集合
    const conditioningSetLower = new Set(conditioningSet.map((s) => s.toLowerCase()));
    const coversBackdoor = backdoorSet.every((z) =>
      conditioningSetLower.has(z.toLowerCase()),
    );

    return {
      applicable: coversBackdoor,
      reason: coversBackdoor
        ? `条件集 {${conditioningSet.join(', ')}} 覆盖了后门变量 {${backdoorSet.join(', ')}}，可用观测替代干预`
        : `条件集未覆盖后门变量 {${backdoorSet.join(', ')}}，不可应用规则 1`,
      backdoorSet,
    };
  }

  /**
   * do-calculus 规则 2：交换干预与观测
   *
   * 规则：如果 W 阻断了 X 到 Z 的所有后门路径（给定 Y），且
   *   Z 不是 X 的后代，则
   *   P(Z | do(X), Y, W) = P(Z | do(Y), X, W) 当且仅当
   *   X 到 Z 的所有有向路径都被 Y 阻断
   *
   * 简化实现：检查 Y 是否是 X 到 Z 的中介变量（前门准则）
   *
   * @returns 是否可应用规则 2
   */
  canApplyRule2(
    interventionVar: string,
    mediatorVar: string,
    observedVar: string,
  ): {
    applicable: boolean;
    reason: string;
    frontdoorValid: boolean;
  } {
    const graph = this.loadGraph();
    const xId = graph.nameIndex.get(interventionVar);
    const mId = graph.nameIndex.get(mediatorVar);
    const yId = graph.nameIndex.get(observedVar);

    if (!xId || !mId || !yId) {
      return {
        applicable: false,
        reason: '变量不存在于因果图中',
        frontdoorValid: false,
      };
    }

    // 前门准则验证：
    // 1. X 到 M 的所有有向路径不经过 Y 的后代
    // 2. M 到 Y 的所有后门路径被 X 阻断
    const xToMPaths = findAllPaths(graph, xId, mId).paths;
    const mToYPaths = findAllPaths(graph, mId, yId).paths;

    const hasXToM = xToMPaths.length > 0;
    const hasMToY = mToYPaths.length > 0;

    // M 是否是 X 的后代
    const descendantsX = new Set(findDescendants(graph, xId));
    const mIsDescendantOfX = descendantsX.has(mId);

    // Y 是否是 M 的后代
    const descendantsM = new Set(findDescendants(graph, mId));
    const yIsDescendantOfM = descendantsM.has(yId);

    const frontdoorValid =
      hasXToM && hasMToY && mIsDescendantOfX && yIsDescendantOfM;

    return {
      applicable: frontdoorValid,
      reason: frontdoorValid
        ? `前门准则成立：${interventionVar} → ${mediatorVar} → ${observedVar}，可交换干预与观测`
        : '前门准则不成立，不可应用规则 2',
      frontdoorValid,
    };
  }

  /**
   * do-calculus 规则 3：插入/删除干预
   *
   * 规则：如果 Y 不是 X 的后代，且 W 阻断了 X 到 Y 的所有后门路径，则
   *   P(Y | do(X), W) = P(Y | W)
   *
   * 即：当 Y 不是 X 的后代且后门路径被阻断时，do(X) 可完全移除。
   *
   * @returns 是否可应用规则 3
   */
  canApplyRule3(
    interventionVar: string,
    observedVar: string,
    conditioningSet: string[],
  ): {
    applicable: boolean;
    reason: string;
    yIsDescendantOfX: boolean;
  } {
    const graph = this.loadGraph();
    const xId = graph.nameIndex.get(interventionVar);
    const yId = graph.nameIndex.get(observedVar);

    if (!xId || !yId) {
      return {
        applicable: false,
        reason: '变量不存在于因果图中',
        yIsDescendantOfX: false,
      };
    }

    // Y 是否是 X 的后代
    const descendantsX = new Set(findDescendants(graph, xId));
    const yIsDescendantOfX = descendantsX.has(yId);

    if (yIsDescendantOfX) {
      return {
        applicable: false,
        reason: `${observedVar} 是 ${interventionVar} 的后代，不可应用规则 3`,
        yIsDescendantOfX: true,
      };
    }

    // 检查后门路径是否被阻断（复用规则 1 的逻辑）
    const rule1Result = this.canApplyRule1(
      interventionVar,
      observedVar,
      conditioningSet,
    );

    return {
      applicable: rule1Result.applicable,
      reason: rule1Result.applicable
        ? `${observedVar} 不是 ${interventionVar} 的后代，且后门路径被阻断，可移除 do()`
        : `后门路径未被阻断：${rule1Result.reason}`,
      yIsDescendantOfX: false,
    };
  }

  /**
   * 混淆变量自动识别报告
   *
   * 对指定的 (X, Y) 对，自动识别所有潜在混淆变量并分类：
   * - observed：已观测的混淆变量（在图中）
   * - unobserved：未观测的潜在混淆变量（通过节点类型推断）
   *
   * @returns 混淆变量识别报告
   */
  identifyConfounders(
    interventionVar: string,
    observedVar: string,
  ): {
    observedConfounders: string[];
    potentialConfounders: string[];
    summary: string;
  } {
    const graph = this.loadGraph();
    const xId = graph.nameIndex.get(interventionVar);
    const yId = graph.nameIndex.get(observedVar);

    if (!xId || !yId) {
      return {
        observedConfounders: [],
        potentialConfounders: [],
        summary: '变量不存在于因果图中',
      };
    }

    // 已观测混淆变量 = commonAncestors(X, Y) - descendants(X) - {X, Y}
    const ancestorsX = new Set(findAncestors(graph, xId));
    const ancestorsY = new Set(findAncestors(graph, yId));
    const descendantsX = new Set(findDescendants(graph, xId));

    const observedConfounders: string[] = [];
    for (const z of ancestorsX) {
      if (z === xId || z === yId) continue;
      if (!ancestorsY.has(z)) continue;
      if (descendantsX.has(z)) continue;
      observedConfounders.push(graph.nodeMap.get(z)?.name ?? z);
    }

    // 潜在混淆变量：图中不存在的常见混淆模式
    // 基于节点类型推断：如果 X 是 action 类型，Y 是 metric 类型，
    // 则潜在混淆可能包括环境因素、用户行为等
    const xNode = graph.nodeMap.get(xId);
    const yNode = graph.nodeMap.get(yId);

    const potentialConfounders: string[] = [];
    if (xNode?.type === 'action' && yNode?.type === 'metric') {
      potentialConfounders.push('时间因素', '用户上下文', '系统负载');
    }
    if (xNode?.type === 'metric' && yNode?.type === 'metric') {
      potentialConfounders.push('共同环境因素', '测量误差');
    }

    const summary =
      observedConfounders.length === 0
        ? potentialConfounders.length === 0
          ? `${interventionVar} → ${observedVar}：未识别到混淆变量，因果效应估计可信`
          : `${interventionVar} → ${observedVar}：未观测到混淆变量，但存在 ${potentialConfounders.length} 个潜在混淆（${potentialConfounders.join('、')}），建议补充观测`
        : `${interventionVar} → ${observedVar}：识别到 ${observedConfounders.length} 个已观测混淆（${observedConfounders.join('、')}）${potentialConfounders.length > 0 ? `，另有 ${potentialConfounders.length} 个潜在混淆` : ''}`;

    return {
      observedConfounders,
      potentialConfounders,
      summary,
    };
  }

  // ============================================================
  // 私有辅助方法
  // ============================================================

  /** 从 store 加载因果图 */
  private loadGraph(): CausalGraph {
    const nodes = this.store.listNodes();
    const edges = this.store.listEdges();
    return buildCausalGraph(nodes, edges, true);
  }

  /** 计算路径的累积强度（边 strength 乘积） */
  private computePathStrength(graph: CausalGraph, path: string[]): number {
    let strength = 1;
    for (let i = 0; i < path.length - 1; i++) {
      const edge = this.findEdge(graph, path[i], path[i + 1]);
      if (!edge) return 0;
      strength *= edge.strength;
    }
    return strength;
  }

  /** 计算路径的符号（prevents/inhibits = -1，causes/enables = +1） */
  private computePathSign(graph: CausalGraph, path: string[]): number {
    let sign = 1;
    for (let i = 0; i < path.length - 1; i++) {
      const edge = this.findEdge(graph, path[i], path[i + 1]);
      if (!edge) return 0;
      if (edge.relation === 'prevents' || edge.relation === 'inhibits') {
        sign *= -1;
      }
    }
    return sign;
  }

  /** 查找两个节点之间的边 */
  private findEdge(
    graph: CausalGraph,
    fromId: string,
    toId: string,
  ): CausalEdge | null {
    return (
      graph.edges.find(
        (e) => e.fromNodeId === fromId && e.toNodeId === toId,
      ) ?? null
    );
  }

  /** 影响等级分类 */
  private classifyImpact(
    score: number,
    thresholds: SceneThresholds = DEFAULT_THRESHOLDS,
  ): ImpactLevel {
    const abs = Math.abs(score);
    if (abs >= thresholds.strong) return 'strong';
    if (abs >= thresholds.moderate) return 'moderate';
    if (abs >= thresholds.weak) return 'weak';
    return 'negligible';
  }

  /** 根据影响分数预测反事实值 */
  private predictCounterfactualValue(
    observedValue: unknown,
    impactScore: number,
    _interventionValue: unknown,
  ): unknown {
    // Boolean：影响非忽略则翻转
    if (typeof observedValue === 'boolean') {
      return Math.abs(impactScore) >= WEAK_THRESHOLD
        ? !observedValue
        : observedValue;
    }

    // Number：按影响分数缩放
    if (typeof observedValue === 'number') {
      return observedValue * (1 + impactScore);
    }

    // String：强影响则切换为干预值
    if (typeof observedValue === 'string') {
      return Math.abs(impactScore) >= STRONG_THRESHOLD
        ? String(_interventionValue)
        : observedValue;
    }

    // 其他类型：原样返回
    return observedValue;
  }

  /** 分类改变方向 */
  private classifyChange(
    observed: unknown,
    counterfactual: unknown,
  ): ChangeDirection {
    if (typeof observed === 'boolean' && typeof counterfactual === 'boolean') {
      return observed !== counterfactual ? 'flip' : 'none';
    }
    if (typeof observed === 'number' && typeof counterfactual === 'number') {
      if (counterfactual > observed) return 'increase';
      if (counterfactual < observed) return 'decrease';
      return 'none';
    }
    if (observed !== counterfactual) return 'flip';
    return 'none';
  }

  /** 深度相等判断 */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object' || a === null || b === null) return a === b;
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }

  /**
   * 计算两个节点之间的最大路径贡献（strength × sign）
   *
   * 遍历所有 from → to 的有向路径，返回累积贡献（强度×符号）最大的那条路径。
   * 用于后门调整的混淆偏差计算和前门调整的中介强度计算。
   */
  private computeMaxPathContribution(
    graph: CausalGraph,
    fromId: string,
    toId: string,
  ): { strength: number; sign: number; path: string[] | null } {
    if (fromId === toId) {
      return { strength: 1, sign: 1, path: [fromId] };
    }

    const pathAnalysis = findAllPaths(graph, fromId, toId);
    if (pathAnalysis.paths.length === 0) {
      return { strength: 0, sign: 1, path: null };
    }

    let maxContribution = 0;
    let maxStrength = 0;
    let maxSign = 1;
    let maxPath: string[] | null = null;

    for (const path of pathAnalysis.paths.slice(0, MAX_PATHS_RETURN)) {
      const strength = this.computePathStrength(graph, path);
      const sign = this.computePathSign(graph, path);
      const contribution = strength * sign;
      if (Math.abs(contribution) > Math.abs(maxContribution)) {
        maxContribution = contribution;
        maxStrength = strength;
        maxSign = sign;
        maxPath = path;
      }
    }

    return { strength: maxStrength, sign: maxSign, path: maxPath };
  }

  /**
   * 检查 ancestorId 是否是 descendantId 的祖先（直接或间接）
   *
   * 通过 BFS 反向遍历入边判断。若 ancestorId === descendantId 返回 false（自身不算祖先）。
   */
  private isAncestorOf(
    graph: CausalGraph,
    ancestorId: string,
    descendantId: string,
  ): boolean {
    if (ancestorId === descendantId) return false;
    if (!graph.reverseAdjacency.has(descendantId)) return false;

    const visited = new Set<string>([descendantId]);
    const queue: string[] = [descendantId];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const parents = graph.reverseAdjacency.get(current) ?? [];
      for (const parent of parents) {
        if (parent === ancestorId) return true;
        if (!visited.has(parent)) {
          visited.add(parent);
          queue.push(parent);
        }
      }
    }

    return false;
  }
}
