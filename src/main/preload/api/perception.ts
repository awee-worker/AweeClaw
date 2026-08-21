/**
 * Perception API — 感知层 IPC 桥接
 *
 * 将主进程的 PerceptionStore 能力暴露给渲染进程。
 * 渲染进程通过 window.electronAPI.perception.* 调用。
 *
 * 所有方法返回 { success: boolean, data?: T, error?: string } 统一格式。
 *
 * 阶段2 新增接口：
 * - predictAction: 基于当前场景预测下一步动作
 * - recordBehavior: 记录用户实际行为（用于积累历史数据）
 * - submitFeedback: 提交预测反馈（accepted/rejected/ignored）
 * - analyzeImpact: 代码变更影响分析
 * - getPredictionStats: 获取预测统计
 */

import { ipcRenderer } from 'electron'

/** 统一的 IPC 响应格式 */
export interface IpcResponse<T = unknown> {
  success: boolean
  data?: T
  error?: string
}

/** 用户动作（与 PerceptionInterface 保持一致） */
export interface UserAction {
  type: 'command' | 'file_edit' | 'app_switch' | 'search' | 'chat' | 'idle'
  target: string
  durationMs?: number
}

/** 预测请求 */
export interface PredictRequest {
  sceneText: string
  app: string
  activity: 'coding' | 'browsing' | 'chatting' | 'reading' | 'writing' | 'debugging' | 'idle' | 'unknown'
  openFiles?: string[]
  terminalCmds?: string[]
  topK?: number
  confidenceThreshold?: number
}

/** 预测结果项 */
export interface PredictionResult {
  id: string
  predictedAction: UserAction
  confidence: number
  basedOnBehaviors: string[]
  reason: string
  modelVersion: string
}

/** 预测响应 */
export interface PredictResponse {
  success: boolean
  predictions: PredictionResult[]
  embedding: number[]
  sampleCount: number
  error?: string
}

/** 反馈类型 */
export type PredictionFeedback = 'accepted' | 'rejected' | 'ignored'

/** 变更类型 */
export type ChangeType = 'modified' | 'added' | 'deleted' | 'renamed'

/** 变更文件 */
export interface ChangedFile {
  filePath: string
  relativePath: string
  changeType: ChangeType
  additions?: number
  deletions?: number
}

/** 影响分析请求 */
export interface ImpactAnalysisRequest {
  projectPath: string
  language?: 'typescript' | 'javascript' | 'python'
  changedFiles: ChangedFile[]
  forceRebuild?: boolean
  maxDepth?: number
  /** 是否启用 Git 伴随修改分析（阶段9 s9-09，默认 true） */
  enableCoModification?: boolean
  /** 伴随修改分析返回的 Top-K（默认 5） */
  coModificationTopK?: number
  /** 是否强制刷新伴随修改缓存（阶段9 s9-09） */
  forceRefreshCoModification?: boolean
}

/** 影响等级 */
export type ImpactLevel = 'high' | 'medium' | 'low' | 'none'

/** 影响分析响应 */
export interface ImpactAnalysisResponse {
  success: boolean
  projectPath: string
  overallImpact: ImpactLevel
  totalImpactedFiles: number
  results: Array<{
    changedFile: string
    relativePath: string
    changeType: ChangeType
    impactedFiles: Array<{
      filePath: string
      relativePath: string
      depth: number
      isTest: boolean
    }>
    impactedCount: number
    nonTestCount: number
    testCount: number
    impactLevel: ImpactLevel
    maxDepth: number
    /** Git 伴随修改文件列表（阶段9 s9-09） */
    coModifiedFiles?: Array<{
      relativePath: string
      coOccurrence: number
      frequency: number
    }>
    /** 该文件在 git 历史中出现的 commit 数（阶段9 s9-09） */
    coModifiedTotalCommits?: number
  }>
  graphStats: {
    fileCount: number
    edgeCount: number
    builtAt: number
  }
  highRiskFiles: Array<{
    filePath: string
    relativePath: string
    impactedByCount: number
  }>
  /** Git 伴随修改分析统计（阶段9 s9-09，未启用时为 null） */
  coModificationStats?: {
    totalCommits: number
    uniqueFiles: number
    uniqueFilePairs: number
    analyzedAt: number
    fromCache: boolean
  } | null
  error?: string
}

/** 行为记录参数 */
export interface RecordBehaviorParams {
  sceneId?: string
  sceneText: string
  app: string
  activity: string
  action: UserAction
  outcome?: 'success' | 'failure' | 'abandoned'
  openFiles?: string[]
  terminalCmds?: string[]
}

/** 场景时间轴项（精简版 ScreenScene，去掉 elements/embedding 等大字段） */
export interface SceneTimelineItem {
  id: string
  timestamp: number
  app: string
  windowTitle: string
  activity: 'coding' | 'browsing' | 'chatting' | 'reading' | 'writing' | 'debugging' | 'idle' | 'unknown'
  textSummary: string
}

/** 行为热力图单元格 */
export interface BehaviorHeatmapCell {
  /** 日期（YYYY-MM-DD） */
  date: string
  /** 小时（0-23） */
  hour: number
  /** 该时段的行为数量 */
  count: number
  /** 主要活动类型 */
  topActivity: string
}

/** 感知层 API 接口 */
export interface PerceptionApi {
  // ===== 阶段1：配置与查询 =====
  /** 获取隐私配置 */
  getPrivacyConfig: () => Promise<IpcResponse<unknown>>
  /** 更新隐私配置 */
  updatePrivacyConfig: (config: Record<string, unknown>) => Promise<IpcResponse<void>>
  /** 获取最近的屏幕场景 */
  getRecentScenes: (limit?: number) => Promise<IpcResponse<unknown[]>>
  /** 检索相似屏幕场景 */
  searchSimilarScenes: (embedding: number[], topK?: number) => Promise<IpcResponse<unknown[]>>
  /** 检索相似用户行为 */
  searchSimilarBehaviors: (embedding: number[], topK?: number) => Promise<IpcResponse<unknown[]>>
  /** 清空所有感知数据 */
  clearAllData: () => Promise<IpcResponse<boolean>>
  /** 清理过期数据 */
  cleanupExpiredData: () => Promise<IpcResponse<void>>
  /** 更新预测结果（用于校准） */
  updatePredictionOutcome: (
    predictionId: string,
    actualAction: unknown,
    feedback?: 'accepted' | 'rejected' | 'ignored',
  ) => Promise<IpcResponse<boolean>>

  // ===== 阶段2：行为预测 =====
  /** 基于当前场景预测下一步动作 */
  predictAction: (req: PredictRequest) => Promise<PredictResponse>
  /** 记录用户实际行为（积累历史数据） */
  recordBehavior: (params: RecordBehaviorParams) => Promise<IpcResponse<boolean>>
  /** 提交预测反馈 */
  submitFeedback: (
    predictionId: string,
    feedback: PredictionFeedback,
    actualAction?: UserAction,
  ) => Promise<IpcResponse<boolean>>

  // ===== 阶段2：代码影响分析 =====
  /** 代码变更影响分析 */
  analyzeImpact: (req: ImpactAnalysisRequest) => Promise<ImpactAnalysisResponse>

  // ===== 阶段9 s9-09：Git 伴随修改分析 =====
  /** 分析项目的 git 历史伴随修改模式 */
  analyzeCoModification: (
    projectPath: string,
    options?: {
      maxCommits?: number
      forceRefresh?: boolean
      excludedDirs?: string[]
    },
  ) => Promise<IpcResponse<{
    projectPath: string
    totalCommits: number
    uniqueFiles: number
    uniqueFilePairs: number
    analysisDurationMs: number
    analyzedAt: number
    cachePath: string
    fromCache: boolean
  }>>
  /** 查询单个文件的伴随修改文件列表 */
  getCoModifiedFiles: (
    projectPath: string,
    relativeFilePath: string,
    topK?: number,
  ) => Promise<IpcResponse<{
    filePath: string
    totalCommits: number
    coModifiedFiles: Array<{
      relativePath: string
      coOccurrence: number
      frequency: number
    }>
  }>>
  /** 获取已分析项目的伴随修改统计信息 */
  getCoModificationStats: (projectPath: string) => Promise<IpcResponse<{
    projectPath: string
    totalCommits: number
    uniqueFiles: number
    uniqueFilePairs: number
    analysisDurationMs: number
    analyzedAt: number
    cachePath: string
    fromCache: boolean
  } | null>>
  /** 清空指定项目的伴随修改缓存 */
  clearCoModificationCache: (projectPath: string) => Promise<IpcResponse<void>>

  // ===== 阶段2：统计 =====
  /** 获取预测统计（命中数/反馈分布） */
  getPredictionStats: (days?: number) => Promise<IpcResponse<unknown>>

  // ===== 阶段2：场景时间轴与热力图 =====
  /** 获取指定时间范围内的场景时间轴（按时间倒序） */
  getSceneTimeline: (startDate: number, endDate: number, limit?: number) => Promise<IpcResponse<SceneTimelineItem[]>>
  /** 获取行为热力图数据（每天 × 每小时） */
  getBehaviorHeatmap: (days?: number) => Promise<IpcResponse<BehaviorHeatmapCell[]>>
  /** 获取指定时间范围内的用户行为列表 */
  getBehaviorsByTimeRange: (startTime: number, endTime: number, limit?: number) => Promise<IpcResponse<unknown[]>>

  // ===== 阶段3：摄像头权限 =====
  /** 查询摄像头权限状态：'not-determined' | 'granted' | 'denied' | 'restricted' | 'unknown' */
  getCameraPermissionStatus: () => Promise<IpcResponse<string>>
  /**
   * 请求摄像头权限（macOS 弹系统授权对话框）。
   * 返回 { success, data: boolean, redirectToSettings?: boolean }
   * - data=true: 已授权
   * - data=false + redirectToSettings=true: 用户曾拒绝，需引导到系统设置
   * - data=false: 用户在对话框中拒绝
   */
  requestCameraPermission: () => Promise<IpcResponse<boolean> & { redirectToSettings?: boolean }>
  /** 打开系统设置中的摄像头权限页面（引导用户手动开启） */
  openCameraSettings: () => Promise<IpcResponse<void>>

  // ===== 阶段9：LLM 双模式行为预测 =====
  /**
   * 初始化 LLM 行为预测器
   *
   * @param config LLM 配置（model + apiKey + baseUrl 等）
   * @returns 初始化是否成功
   */
  initLlmPredictor: (config: {
    model: string
    apiKey?: string
    baseUrl?: string
    temperature?: number
  }) => Promise<IpcResponse<boolean>>
  /** 查询 LLM 预测器是否已就绪 */
  isLlmPredictorReady: () => Promise<IpcResponse<boolean>>
  /** 重置 LLM 预测器（恢复纯统计模式） */
  resetLlmPredictor: () => Promise<IpcResponse<void>>

  // ===== D-步骤5：场景模式感知策略切换 =====
  /**
   * 设置场景模式感知过滤器
   *
   * 场景模式切换时由渲染进程调用，将新模式的 perceptionFilter 同步到
   * PerceptionFusionService，控制各感知通道（scene/iot/monitoring）的启停。
   *
   * @param filter 感知过滤器（与 SceneModeDescriptor.PerceptionFilter 结构一致）
   */
  setSceneFilter: (filter: Record<string, boolean> | null) => Promise<IpcResponse<void>>
}

/** 创建感知层 API */
export function createPerceptionApi(): PerceptionApi {
  return {
    // ===== 阶段1：配置与查询 =====
    getPrivacyConfig: () =>
      ipcRenderer.invoke('perception:getPrivacyConfig'),

    updatePrivacyConfig: (config) =>
      ipcRenderer.invoke('perception:updatePrivacyConfig', config),

    getRecentScenes: (limit = 20) =>
      ipcRenderer.invoke('perception:getRecentScenes', limit),

    searchSimilarScenes: (embedding, topK = 10) =>
      ipcRenderer.invoke('perception:searchSimilarScenes', embedding, topK),

    searchSimilarBehaviors: (embedding, topK = 20) =>
      ipcRenderer.invoke('perception:searchSimilarBehaviors', embedding, topK),

    clearAllData: () =>
      ipcRenderer.invoke('perception:clearAllData'),

    cleanupExpiredData: () =>
      ipcRenderer.invoke('perception:cleanupExpiredData'),

    updatePredictionOutcome: (predictionId, actualAction, feedback) =>
      ipcRenderer.invoke('perception:updatePredictionOutcome', predictionId, actualAction, feedback),

    // ===== 阶段2：行为预测 =====
    predictAction: (req) =>
      ipcRenderer.invoke('perception:predictAction', req),

    recordBehavior: (params) =>
      ipcRenderer.invoke('perception:recordBehavior', params),

    submitFeedback: (predictionId, feedback, actualAction) =>
      ipcRenderer.invoke('perception:submitFeedback', predictionId, feedback, actualAction),

    // ===== 阶段2：代码影响分析 =====
    analyzeImpact: (req) =>
      ipcRenderer.invoke('perception:analyzeImpact', req),

    // ===== 阶段9 s9-09：Git 伴随修改分析 =====
    analyzeCoModification: (projectPath, options) =>
      ipcRenderer.invoke('perception:analyzeCoModification', projectPath, options),

    getCoModifiedFiles: (projectPath, relativeFilePath, topK = 10) =>
      ipcRenderer.invoke('perception:getCoModifiedFiles', projectPath, relativeFilePath, topK),

    getCoModificationStats: (projectPath) =>
      ipcRenderer.invoke('perception:getCoModificationStats', projectPath),

    clearCoModificationCache: (projectPath) =>
      ipcRenderer.invoke('perception:clearCoModificationCache', projectPath),

    // ===== 阶段2：统计 =====
    getPredictionStats: (days = 30) =>
      ipcRenderer.invoke('perception:getPredictionStats', days),

    // ===== 阶段2：场景时间轴与热力图 =====
    getSceneTimeline: (startDate, endDate, limit = 500) =>
      ipcRenderer.invoke('perception:getSceneTimeline', startDate, endDate, limit),

    getBehaviorHeatmap: (days = 14) =>
      ipcRenderer.invoke('perception:getBehaviorHeatmap', days),

    getBehaviorsByTimeRange: (startTime, endTime, limit = 1000) =>
      ipcRenderer.invoke('perception:getBehaviorsByTimeRange', startTime, endTime, limit),

    // ===== 阶段3：摄像头权限 =====
    getCameraPermissionStatus: () =>
      ipcRenderer.invoke('perception:getCameraPermissionStatus'),

    requestCameraPermission: () =>
      ipcRenderer.invoke('perception:requestCameraPermission'),

    openCameraSettings: () =>
      ipcRenderer.invoke('perception:openCameraSettings'),

    // ===== 阶段9：LLM 双模式行为预测 =====
    initLlmPredictor: (config) =>
      ipcRenderer.invoke('perception:initLlmPredictor', config),

    isLlmPredictorReady: () =>
      ipcRenderer.invoke('perception:isLlmPredictorReady'),

    resetLlmPredictor: () =>
      ipcRenderer.invoke('perception:resetLlmPredictor'),

    // ===== D-步骤5：场景模式感知策略切换 =====
    setSceneFilter: (filter) =>
      ipcRenderer.invoke('perception:setSceneFilter', filter),
  }
}
