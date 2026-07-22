/**
 * 感知预测上下文加载器
 *
 * 在 Agent.send 调用前异步加载感知预测上下文，用于注入系统提示词。
 *
 * 加载策略：
 * 1. 检查感知是否启用（getPrivacyConfig）
 * 2. 基于编辑器状态（openFiles/activeFile/workspacePath）构造场景文本
 * 3. 调用 predictAction 获取预测建议
 * 4. 并行调用 aggregateExtendedContext 获取 IoT/Causal/Monitoring 三源摘要（阶段9 s9-01）
 * 5. 返回 PerceptionContext 或 null（任何步骤失败都静默返回 null）
 *
 * 性能保护：
 * - 整体超时 3 秒（阶段9 从 2s 增加到 3s，容纳扩展三源加载），避免阻塞 Agent 启动
 * - 失败静默，不影响主流程
 *
 * @module intelligence/engine/perceptionContextLoader
 */

import { logger } from '@toolkit/LogEngine'
import type { PerceptionContext } from '../prompt-engine/PromptComposer'
import { aggregateExtendedContext } from './perceptionContextAggregator'

/** 加载超时（毫秒） */
const LOAD_TIMEOUT_MS = 3000

/**
 * 从编辑器状态推断当前活动类型
 */
function inferActivity(activeFile: string | null, workspacePath: string | null): string {
  if (!activeFile && !workspacePath) return 'idle'
  if (activeFile) {
    const ext = activeFile.split('.').pop()?.toLowerCase()
    if (ext && ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp'].includes(ext)) {
      return 'coding'
    }
    if (ext && ['md', 'txt', 'pdf'].includes(ext)) {
      return 'reading'
    }
    if (ext && ['doc', 'docx', 'rtf'].includes(ext)) {
      return 'writing'
    }
  }
  return 'coding'
}

/**
 * 构造场景文本（用于嵌入）
 *
 * 将编辑器状态转化为自然语言描述，便于嵌入模型理解。
 */
function buildSceneText(params: {
  activeFile: string | null
  openFiles: string[]
  workspacePath: string | null
  userMessage: string
}): string {
  const parts: string[] = []

  if (params.workspacePath) {
    const projectName = params.workspacePath.split('/').pop() || params.workspacePath
    parts.push(`项目: ${projectName}`)
  }

  if (params.activeFile) {
    parts.push(`当前文件: ${params.activeFile.split('/').pop()}`)
  }

  if (params.openFiles.length > 0) {
    const fileNames = params.openFiles.slice(0, 5).map((f) => f.split('/').pop() || f)
    parts.push(`打开的文件: ${fileNames.join(', ')}`)
  }

  if (params.userMessage) {
    parts.push(`用户请求: ${params.userMessage.slice(0, 100)}`)
  }

  return parts.join(' | ')
}

/**
 * 推断当前应用名称
 */
function inferApp(workspacePath: string | null): string {
  if (!workspacePath) return 'Unknown'
  // 简化：基于工作区路径推断
  return 'Code'
}

/**
 * 加载感知预测上下文
 *
 * @param params 编辑器状态
 * @returns PerceptionContext 或 null
 */
export async function loadPerceptionContext(params: {
  activeFile?: string | null
  openFiles?: string[]
  workspacePath?: string | null
  userMessage?: string
}): Promise<PerceptionContext | null> {
  const {
    activeFile = null,
    openFiles = [],
    workspacePath = null,
    userMessage = '',
  } = params

  try {
    // 1. 检查 electronAPI 是否可用
    if (typeof window === 'undefined' || !window.electronAPI?.perception) {
      return null
    }

    const perception = window.electronAPI.perception

    // 2. 检查感知是否启用（带超时保护）
    const configResult = await withTimeout(
      perception.getPrivacyConfig(),
      LOAD_TIMEOUT_MS,
      'getPrivacyConfig',
    )
    if (!configResult?.success || !configResult.data) {
      return null
    }

    const config = configResult.data as {
      enablePerception?: boolean
      enablePrediction?: boolean
    }
    if (!config.enablePerception) return null

    // 3. 构造场景文本
    const sceneText = buildSceneText({
      activeFile,
      openFiles,
      workspacePath,
      userMessage,
    })
    if (!sceneText) return null

    // 4. 调用预测（带超时保护）
    const activity = inferActivity(activeFile, workspacePath)
    const app = inferApp(workspacePath)

    // 阶段9 s9-01：并行加载感知预测 + 扩展三源（IoT/Causal/Monitoring）
    const [predictResult, extendedContext] = await Promise.all([
      withTimeout(
        perception.predictAction({
          sceneText,
          app,
          activity,
          openFiles: openFiles.slice(0, 5),
          topK: 3,
          confidenceThreshold: 0.15,
        }),
        LOAD_TIMEOUT_MS,
        'predictAction',
      ),
      aggregateExtendedContext(),
    ])

    // 5. 构造 PerceptionContext（合并感知预测 + 扩展三源）
    const hasPredictions =
      predictResult?.success && predictResult.predictions.length > 0

    return {
      currentScene: {
        app,
        activity,
        textSummary: sceneText,
      },
      predictions: hasPredictions
        ? predictResult!.predictions.map((p) => ({
            actionType: p.predictedAction.type,
            target: p.predictedAction.target,
            confidence: p.confidence,
            reason: p.reason,
          }))
        : [],
      codeImpact: null, // 代码影响分析由专用入口触发，不在此加载
      // 阶段9 s9-01：扩展三源摘要（任一为 null 不影响其他字段）
      iotContext: extendedContext.iotContext,
      causalContext: extendedContext.causalContext,
      monitoringContext: extendedContext.monitoringContext,
    }
  } catch (e) {
    logger.agent?.warn(
      `[PerceptionContextLoader] 加载失败: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}

/**
 * 带超时的 Promise 包装
 */
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T | null> {
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) =>
        setTimeout(() => {
          logger.agent?.warn(`[PerceptionContextLoader] ${label} 超时 ${ms}ms`)
          resolve(null)
        }, ms),
      ),
    ])
  } catch (e) {
    logger.agent?.warn(
      `[PerceptionContextLoader] ${label} 异常: ${e instanceof Error ? e.message : String(e)}`,
    )
    return null
  }
}
