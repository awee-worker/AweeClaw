/**
 * 任务复杂度检测器
 *
 * 职责：
 * - 分析用户输入的任务描述，判断是否需要多 Agent 协作
 * - 基于关键词、任务长度、领域交叉度等多维度评分
 * - 支持可配置的阈值和规则
 * - 提供详细的复杂度分析报告
 *
 * 检测维度：
 * 1. 多步骤指示词（设计→实现→测试）
 * 2. 任务长度（长任务通常更复杂）
 * 3. 领域交叉度（涉及多个技术领域）
 * 4. 文件/模块数量暗示
 * 5. 特殊关键词（架构、重构、迁移等）
 */

import { logger } from '@toolkit/LogEngine'

export interface ComplexityScore {
  /** 总分（0-100）*/
  total: number
  /** 是否需要多 Agent */
  needsMultiAgent: boolean
  /** 各维度得分 */
  dimensions: {
    multiStep: number
    length: number
    domainCrossing: number
    fileScope: number
    specialKeywords: number
  }
  /** 检测到的关键特征 */
  features: string[]
  /** 建议的 Agent 角色列表 */
  suggestedRoles: string[]
}

export interface DetectorConfig {
  /** 触发多 Agent 的阈值（0-100）*/
  threshold: number
  /** 任务长度权重 */
  lengthWeight: number
  /** 多步骤权重 */
  multiStepWeight: number
  /** 领域交叉权重 */
  domainWeight: number
  /** 文件范围权重 */
  fileScopeWeight: number
  /** 特殊关键词权重 */
  keywordWeight: number
}

const DEFAULT_CONFIG: DetectorConfig = {
  threshold: 25,
  lengthWeight: 10,
  multiStepWeight: 35,
  domainWeight: 25,
  fileScopeWeight: 10,
  keywordWeight: 20,
}

// 多步骤关键词（暗示需要分阶段执行）
const MULTI_STEP_PATTERNS = [
  { pattern: /设计.*实现|架构.*开发|规划.*编码/, score: 30, feature: '设计到实现的完整流程' },
  { pattern: /需求.*分析.*实现|分析.*设计.*开发/, score: 25, feature: '需求分析到实现' },
  { pattern: /开发.*测试.*部署|编码.*测试.*上线/, score: 25, feature: '开发测试部署全流程' },
  { pattern: /前端.*后端|客户端.*服务端|ui.*api/, score: 20, feature: '前后端联动' },
  { pattern: /重构.*优化|改写.*改进|迁移.*升级/, score: 20, feature: '重构优化类任务' },
  { pattern: /先.*然后.*再|第一步.*第二步|首先.*接着/, score: 15, feature: '显式多步骤' },
  { pattern: /实现.*同时.*确保|完成.*并且.*优化/, score: 15, feature: '多目标并行' },
]

// 领域关键词（暗示需要不同专业领域）
const DOMAIN_KEYWORDS: Record<string, { keywords: RegExp; role: string }> = {
  architecture: { keywords: /架构|架构设计|系统设计|模块划分|分层|微服务|单体/, role: 'architect' },
  frontend: { keywords: /前端|ui|界面|组件|页面|react|vue|html|css|tailwind/, role: 'developer' },
  backend: { keywords: /后端|api|接口|数据库|服务|server|controller|model/, role: 'developer' },
  database: { keywords: /数据库|表结构|sql|索引|迁移|schema|postgres|mysql/, role: 'architect' },
  security: { keywords: /安全|认证|授权|加密|漏洞|xss|csrf|jwt|oauth/, role: 'reviewer' },
  performance: { keywords: /性能|优化|并发|缓存|内存|cpu|瓶颈|慢查询/, role: 'reviewer' },
  testing: { keywords: /测试|单元测试|集成测试|e2e|jest|pytest|覆盖率/, role: 'tester' },
  devops: { keywords: /部署|ci\/cd|docker|k8s|流水线|自动化|监控/, role: 'developer' },
}

// 特殊高复杂度关键词
const SPECIAL_KEYWORDS = [
  { pattern: /从零开始|从零搭建|全新项目|初始化项目/, score: 15, feature: '从零搭建' },
  { pattern: /技术选型|选型|对比.*和.*选择|评估.*方案/, score: 15, feature: '技术选型' },
  { pattern: /大规模|高并发|分布式|集群|微服务改造/, score: 20, feature: '大规模系统' },
  { pattern: /遗留代码|祖传代码|历史债务|代码清理/, score: 15, feature: '遗留代码处理' },
  { pattern: /跨平台|多端|兼容|适配|响应式/, score: 10, feature: '跨平台兼容' },
  { pattern: /实时|websocket|推送|流式|长连接/, score: 10, feature: '实时系统' },
]

// 文件/模块范围暗示
const FILE_SCOPE_PATTERNS = [
  { pattern: /整个项目|全站|全局|整体|所有模块/, score: 15, feature: '全项目范围' },
  { pattern: /多个文件|多个模块|几个页面|几个组件/, score: 10, feature: '多文件范围' },
  { pattern: /新增.*表|新增.*模块|新增.*页面/, score: 8, feature: '新增功能模块' },
  { pattern: /修改.*配置|调整.*结构|改动.*流程/, score: 5, feature: '结构性修改' },
]

export class TaskComplexityDetector {
  private config: DetectorConfig

  constructor(config: Partial<DetectorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * 分析任务复杂度
   */
  analyze(task: string): ComplexityScore {
    const trimmed = task.trim()
    if (!trimmed) {
      return this.createScore(
        0,
        { multiStep: 0, length: 0, domainCrossing: 0, fileScope: 0, specialKeywords: 0 },
        [],
        []
      )
    }

    const features: string[] = []
    const suggestedRoles = new Set<string>()

    // 1. 多步骤检测
    const multiStepResult = this.detectMultiStep(trimmed)
    if (multiStepResult.feature) features.push(multiStepResult.feature)

    // 2. 任务长度检测
    const lengthResult = this.detectLength(trimmed)
    if (lengthResult.feature) features.push(lengthResult.feature)

    // 3. 领域交叉检测
    const domainResult = this.detectDomainCrossing(trimmed, suggestedRoles)
    if (domainResult.feature) features.push(domainResult.feature)

    // 4. 文件范围检测
    const fileScopeResult = this.detectFileScope(trimmed)
    if (fileScopeResult.feature) features.push(fileScopeResult.feature)

    // 5. 特殊关键词检测
    const specialResult = this.detectSpecialKeywords(trimmed)
    if (specialResult.feature) features.push(specialResult.feature)

    // 计算总分：各维度原始分数直接累加（不乘权重），权重用于配置调整维度重要性
    // 这样多特征可以叠加，例如：多步骤(30) + 跨领域(20) = 50 分
    const dimensions = {
      multiStep: multiStepResult.score,
      length: lengthResult.score,
      domainCrossing: domainResult.score,
      fileScope: fileScopeResult.score,
      specialKeywords: specialResult.score,
    }

    const total = Math.min(100,
      dimensions.multiStep +
      dimensions.length +
      dimensions.domainCrossing +
      dimensions.fileScope +
      dimensions.specialKeywords
    )

    // 根据特征补充建议角色
    if (dimensions.multiStep > 50) suggestedRoles.add('planner')
    if (dimensions.domainCrossing > 50) suggestedRoles.add('coordinator')
    if (total > 70) suggestedRoles.add('reviewer')

    const result = this.createScore(
      total,
      dimensions,
      features,
      Array.from(suggestedRoles)
    )

    logger.agent.debug(
      `[ComplexityDetector] Task complexity: ${total}/100, ` +
      `multiAgent=${result.needsMultiAgent}, features=[${features.join(', ')}]`
    )

    return result
  }

  /**
   * 快速判断是否需要多 Agent
   */
  needsMultiAgent(task: string): boolean {
    return this.analyze(task).needsMultiAgent
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<DetectorConfig>): void {
    this.config = { ...this.config, ...config }
  }

  // ===== 私有检测方法 =====

  private detectMultiStep(task: string): { score: number; feature: string } {
    let score = 0
    let feature = ''

    for (const item of MULTI_STEP_PATTERNS) {
      if (item.pattern.test(task)) {
        score = Math.max(score, item.score)
        if (!feature) feature = item.feature
      }
    }

    return { score, feature }
  }

  private detectLength(task: string): { score: number; feature: string } {
    const length = task.length
    let score = 0
    let feature = ''

    if (length > 200) {
      score = 30
      feature = '长任务描述（>200字）'
    } else if (length > 100) {
      score = 20
      feature = '中等长度任务（100-200字）'
    } else if (length > 50) {
      score = 10
      feature = '较长任务（50-100字）'
    }

    return { score, feature }
  }

  private detectDomainCrossing(
    task: string,
    suggestedRoles: Set<string>
  ): { score: number; feature: string } {
    const matchedDomains: string[] = []

    for (const [domain, config] of Object.entries(DOMAIN_KEYWORDS)) {
      if (config.keywords.test(task)) {
        matchedDomains.push(domain)
        suggestedRoles.add(config.role)
      }
    }

    let score = 0
    let feature = ''

    if (matchedDomains.length >= 4) {
      score = 40
      feature = `多领域交叉（${matchedDomains.length}个领域）`
    } else if (matchedDomains.length >= 3) {
      score = 30
      feature = `较广领域覆盖（${matchedDomains.length}个领域）`
    } else if (matchedDomains.length >= 2) {
      score = 20
      feature = `跨领域任务（${matchedDomains.length}个领域）`
    } else if (matchedDomains.length === 1) {
      score = 10
      feature = `单一领域（${matchedDomains[0]}）`
    }

    return { score, feature }
  }

  private detectFileScope(task: string): { score: number; feature: string } {
    let score = 0
    let feature = ''

    for (const item of FILE_SCOPE_PATTERNS) {
      if (item.pattern.test(task)) {
        score = Math.max(score, item.score)
        if (!feature) feature = item.feature
      }
    }

    return { score, feature }
  }

  private detectSpecialKeywords(task: string): { score: number; feature: string } {
    let score = 0
    let feature = ''

    for (const item of SPECIAL_KEYWORDS) {
      if (item.pattern.test(task)) {
        score = Math.max(score, item.score)
        if (!feature) feature = item.feature
      }
    }

    return { score, feature }
  }

  private createScore(
    total: number,
    dimensions: ComplexityScore['dimensions'],
    features: string[],
    suggestedRoles: string[]
  ): ComplexityScore {
    return {
      total,
      needsMultiAgent: total >= this.config.threshold,
      dimensions,
      features,
      suggestedRoles,
    }
  }
}

/**
 * 全局检测器实例
 */
export const taskComplexityDetector = new TaskComplexityDetector()
