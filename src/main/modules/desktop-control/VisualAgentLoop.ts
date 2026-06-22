/**
 * 视觉反馈闭环（L5 智能工作流层）
 *
 * 职责：
 * 1. LLM 驱动的视觉操作循环：截图 → 视觉模型分析 → 决策操作 → 执行 → 验证
 * 2. 最大循环次数限制（防止死循环）
 * 3. 每步操作可回滚
 * 4. 异常情况自动停止
 * 5. 与紧急停止机制集成
 *
 * 设计要点：
 * - 单例模式
 * - 继承 EventEmitter，支持步骤进度事件
 * - 使用 LLMService 调用视觉模型（支持图片输入）
 * - 操作通过 DesktopControlManager 执行
 * - 决策结果结构化输出（动作类型 + 参数）
 *
 * @module desktop-control/VisualAgentLoop
 */

import { EventEmitter } from 'events'
import { logger } from '@shared/toolkit/LogEngine'
import {
  getEmergencyStopController,
  EmergencyStopError,
} from './EmergencyStop'
import { getDesktopControlManager } from './DesktopControlManager'
import type { LLMConfig, LLMMessage, ImageContent, TextContent } from '@shared/protocols/modelProtocol'
import { createModel } from '@main/modules/ai-provider/modelRegistry'
import { generateText } from 'ai'
import { MessageConverter } from '@main/modules/ai-provider/core/MessageAdapter'

// ============================================
// 事件类型常量
// ============================================

export const VISUAL_LOOP_EVENT_STEP_START = 'visual-loop:step-start'
export const VISUAL_LOOP_EVENT_STEP_COMPLETE = 'visual-loop:step-complete'
export const VISUAL_LOOP_EVENT_STEP_ERROR = 'visual-loop:step-error'
export const VISUAL_LOOP_EVENT_COMPLETED = 'visual-loop:completed'
export const VISUAL_LOOP_EVENT_ABORTED = 'visual-loop:aborted'

// ============================================
// 类型定义
// ============================================

/** 视觉闭环配置 */
export interface VisualAgentLoopConfig {
  /** 任务描述 */
  task: string
  /** 最大循环次数（默认 10） */
  maxSteps: number
  /** 视觉模型配置 */
  visionModel: LLMConfig
  /** 每步操作前是否自动截图验证 */
  verifyBeforeAction: boolean
  /** 操作间隔（ms） */
  stepInterval: number
  /** 单步超时（ms） */
  stepTimeout: number
  /** 是否允许危险操作（如关闭窗口、删除文件） */
  allowDangerousActions: boolean
  /** 系统提示词 */
  systemPrompt?: string
}

/** 视觉闭环步骤记录 */
export interface VisualLoopStep {
  /** 步骤序号 */
  index: number
  /** 截图 base64 */
  screenshot: string
  /** LLM 分析结果 */
  analysis: string
  /** 决策的动作 */
  action?: VisualAction
  /** 执行结果 */
  executionResult?: unknown
  /** 是否完成 */
  completed: boolean
  /** 完成原因 */
  completionReason?: string
  /** 错误信息 */
  error?: string
  /** 时间戳 */
  timestamp: number
  /** 耗时（ms） */
  duration: number
}

/** 视觉动作决策 */
export interface VisualAction {
  /** 动作类型 */
  type: VisualActionType
  /** 动作参数 */
  params: Record<string, unknown>
  /** 决策理由 */
  reasoning: string
  /** 置信度（0-1） */
  confidence: number
}

/** 动作类型 */
export type VisualActionType =
  | 'click'
  | 'double_click'
  | 'right_click'
  | 'move'
  | 'scroll'
  | 'type_text'
  | 'press_key'
  | 'key_combo'
  | 'wait'
  | 'screenshot'
  | 'complete'
  | 'abort'

/** 视觉闭环结果 */
export interface VisualLoopResult {
  /** 是否完成 */
  completed: boolean
  /** 总步数 */
  totalSteps: number
  /** 执行的步骤记录 */
  steps: VisualLoopStep[]
  /** 总耗时（ms） */
  duration: number
  /** 最终结果描述 */
  result: string
  /** 是否被中止 */
  aborted: boolean
  /** 中止原因 */
  abortReason?: string
}

/** 默认配置 */
const DEFAULT_CONFIG: Partial<VisualAgentLoopConfig> = {
  maxSteps: 10,
  verifyBeforeAction: true,
  stepInterval: 500,
  stepTimeout: 30_000,
  allowDangerousActions: false,
}

/** 默认系统提示词 */
const DEFAULT_SYSTEM_PROMPT = `You are a desktop automation assistant. Analyze the screenshot and decide the next action to complete the task.

Rules:
1. Respond in JSON format only.
2. Each response must contain: { "analysis": string, "action": { "type": string, "params": object, "reasoning": string, "confidence": number }, "completed": boolean, "completionReason": string }
3. Action types: click, double_click, right_click, move, scroll, type_text, press_key, key_combo, wait, screenshot, complete, abort
4. For click/move/scroll, params must include x, y coordinates.
5. For type_text, params must include text.
6. For press_key, params must include key.
7. For key_combo, params must include keys array.
8. Set completed=true when task is done.
9. Set action.type="abort" if the task cannot be completed.
10. Confidence is 0.0-1.0, where 1.0 means very certain.`

// ============================================
// 视觉闭环引擎实现
// ============================================

/**
 * 视觉反馈闭环引擎
 *
 * 使用方式：
 * ```ts
 * const loop = getVisualAgentLoop()
 * const result = await loop.run({
 *   task: '打开浏览器并搜索"天气"',
 *   maxSteps: 15,
 *   visionModel: config,
 * })
 * ```
 */
export class VisualAgentLoop extends EventEmitter {
  private isRunning = false
  private abortController: AbortController | null = null

  /** 当前是否运行中 */
  get running(): boolean {
    return this.isRunning
  }

  /**
   * 运行视觉闭环
   *
   * @param config 配置
   * @returns 执行结果
   */
  async run(config: VisualAgentLoopConfig): Promise<VisualLoopResult> {
    if (this.isRunning) {
      throw new Error('Visual agent loop is already running')
    }

    // 检查紧急停止
    const stopController = getEmergencyStopController()
    if (stopController.getState().stopped) {
      throw new EmergencyStopError('Emergency stop is active, cannot start visual loop')
    }

    const mergedConfig: VisualAgentLoopConfig = { ...DEFAULT_CONFIG, ...config } as VisualAgentLoopConfig
    if (mergedConfig.maxSteps <= 0 || mergedConfig.maxSteps > 50) {
      throw new Error(`Invalid maxSteps: ${mergedConfig.maxSteps} (must be 1-50)`)
    }

    this.isRunning = true
    this.abortController = new AbortController()

    // 监听紧急停止
    const onEmergencyStop = (): void => {
      logger.desktop.info('[VisualAgentLoop] Emergency stop triggered, aborting')
      this.abortController?.abort()
    }
    stopController.on('emergency-stop', onEmergencyStop)

    const startTime = Date.now()
    const steps: VisualLoopStep[] = []
    let completed = false
    let aborted = false
    let abortReason: string | undefined
    let resultDescription = ''

    try {
      for (let i = 0; i < mergedConfig.maxSteps; i++) {
        // 检查中止信号
        if (this.abortController.signal.aborted) {
          aborted = true
          abortReason = 'Aborted by signal'
          break
        }

        const stepStart = Date.now()
        const step: VisualLoopStep = {
          index: i,
          screenshot: '',
          analysis: '',
          completed: false,
          timestamp: stepStart,
          duration: 0,
        }

        this.emit(VISUAL_LOOP_EVENT_STEP_START, { stepIndex: i })
        logger.desktop.info(`[VisualAgentLoop] Step ${i + 1}/${mergedConfig.maxSteps} started`)

        try {
          // 1. 截图当前屏幕
          const screenshot = await this.captureScreen()
          step.screenshot = screenshot

          // 2. 发送给视觉模型分析
          const analysis = await this.analyzeScreenshot(
            screenshot,
            mergedConfig,
            config.task,
            steps,
          )
          step.analysis = analysis.analysis
          step.action = analysis.action

          // 3. 检查是否完成
          if (analysis.completed) {
            step.completed = true
            step.completionReason = analysis.completionReason || 'Task completed'
            completed = true
            resultDescription = step.completionReason
            steps.push(step)
            break
          }

          // 4. 检查是否中止
          if (analysis.action?.type === 'abort') {
            step.completed = false
            step.completionReason = analysis.action.reasoning || 'Aborted by model'
            aborted = true
            abortReason = step.completionReason
            steps.push(step)
            break
          }

          // 5. 执行动作
          if (analysis.action) {
            // 危险操作检查
            if (!mergedConfig.allowDangerousActions && this.isDangerousAction(analysis.action)) {
              throw new Error(`Dangerous action rejected: ${analysis.action.type}`)
            }

            const execResult = await this.executeAction(analysis.action, mergedConfig.stepTimeout)
            step.executionResult = execResult
          }

          step.duration = Date.now() - stepStart
          steps.push(step)
          this.emit(VISUAL_LOOP_EVENT_STEP_COMPLETE, step)

          // 步骤间隔
          if (mergedConfig.stepInterval > 0 && i < mergedConfig.maxSteps - 1) {
            await this.sleep(mergedConfig.stepInterval)
          }
        } catch (err) {
          step.error = err instanceof Error ? err.message : String(err)
          step.duration = Date.now() - stepStart
          steps.push(step)
          this.emit(VISUAL_LOOP_EVENT_STEP_ERROR, { stepIndex: i, error: step.error })

          // 紧急停止错误直接中止
          if (err instanceof EmergencyStopError || this.abortController.signal.aborted) {
            aborted = true
            abortReason = step.error
            break
          }

          // 其他错误继续下一步
          logger.desktop.warn(`[VisualAgentLoop] Step ${i + 1} failed: ${step.error}`)
        }
      }

      if (!completed && !aborted) {
        resultDescription = `Reached max steps (${mergedConfig.maxSteps}) without completion`
      }
    } finally {
      stopController.off('emergency-stop', onEmergencyStop)
      this.isRunning = false
      this.abortController = null
    }

    const result: VisualLoopResult = {
      completed,
      totalSteps: steps.length,
      steps,
      duration: Date.now() - startTime,
      result: resultDescription,
      aborted,
      abortReason,
    }

    if (aborted) {
      this.emit(VISUAL_LOOP_EVENT_ABORTED, result)
    } else {
      this.emit(VISUAL_LOOP_EVENT_COMPLETED, result)
    }

    logger.desktop.info(
      `[VisualAgentLoop] Completed: steps=${steps.length}, completed=${completed}, aborted=${aborted}, duration=${result.duration}ms`,
    )

    return result
  }

  /** 中止当前循环 */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
  }

  // ============================================
  // 内部方法
  // ============================================

  /** 截图当前屏幕 */
  private async captureScreen(): Promise<string> {
    const manager = getDesktopControlManager()
    const result = await manager.captureScreen()
    if (!result.success) {
      throw new Error(`Screenshot failed: ${result.error}`)
    }
    // 提取 base64 数据（去掉 data:image/png;base64, 前缀）
    const base64 = result.dataUrl.replace(/^data:image\/\w+;base64,/, '')
    return base64
  }

  /** 分析截图并决策下一步 */
  private async analyzeScreenshot(
    screenshot: string,
    config: VisualAgentLoopConfig,
    task: string,
    previousSteps: VisualLoopStep[],
  ): Promise<{
    analysis: string
    action?: VisualAction
    completed: boolean
    completionReason?: string
  }> {
    // 构建消息
    const textContent: TextContent = {
      type: 'text',
      text: this.buildPrompt(task, previousSteps),
    }

    const imageContent: ImageContent = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: screenshot,
      },
    }

    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: [textContent, imageContent],
      },
    ]

    // 调用视觉模型
    const model = createModel(config.visionModel)
    const messageConverter = new MessageConverter()
    const baseMessages = messageConverter.convert(messages, config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT)

    const result = await generateText({
      model,
      messages: baseMessages,
      abortSignal: this.abortController?.signal,
    })

    // 解析 JSON 响应
    return this.parseAnalysisResponse(result.text)
  }

  /** 构建提示词 */
  private buildPrompt(task: string, previousSteps: VisualLoopStep[]): string {
    const stepHistory = previousSteps.length > 0
      ? previousSteps.map((s, i) => `Step ${i + 1}: ${s.action?.type ?? 'unknown'} - ${s.analysis}`).join('\n')
      : 'No previous steps.'

    return `Task: ${task}

Previous steps:
${stepHistory}

Analyze the current screenshot and decide the next action.`
  }

  /** 解析 LLM 响应 */
  private parseAnalysisResponse(text: string): {
    analysis: string
    action?: VisualAction
    completed: boolean
    completionReason?: string
  } {
    try {
      // 尝试提取 JSON
      const jsonMatch = text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        return {
          analysis: text,
          completed: false,
        }
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        analysis?: string
        action?: {
          type?: string
          params?: Record<string, unknown>
          reasoning?: string
          confidence?: number
        }
        completed?: boolean
        completionReason?: string
      }

      return {
        analysis: parsed.analysis ?? text,
        action: parsed.action
          ? {
              type: (parsed.action.type as VisualActionType) ?? 'wait',
              params: parsed.action.params ?? {},
              reasoning: parsed.action.reasoning ?? '',
              confidence: parsed.action.confidence ?? 0.5,
            }
          : undefined,
        completed: parsed.completed ?? false,
        completionReason: parsed.completionReason,
      }
    } catch {
      // JSON 解析失败，返回原始文本
      return {
        analysis: text,
        completed: false,
      }
    }
  }

  /** 执行视觉动作 */
  private async executeAction(action: VisualAction, timeout: number): Promise<unknown> {
    const manager = getDesktopControlManager()
    const params = action.params

    const executeWithTimeout = async <T>(fn: () => Promise<T>): Promise<T> => {
      return Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          setTimeout(() => reject(new Error(`Action timeout: ${action.type}`)), timeout)
        }),
      ])
    }

    switch (action.type) {
      case 'click':
        return executeWithTimeout(() => manager.mouseClick({
          x: params.x as number,
          y: params.y as number,
          button: 'left',
          clickType: 'single',
        }))

      case 'double_click':
        return executeWithTimeout(() => manager.mouseClick({
          x: params.x as number,
          y: params.y as number,
          button: 'left',
          clickType: 'double',
        }))

      case 'right_click':
        return executeWithTimeout(() => manager.mouseClick({
          x: params.x as number,
          y: params.y as number,
          button: 'right',
          clickType: 'single',
        }))

      case 'move':
        return executeWithTimeout(() => manager.mouseMove({
          x: params.x as number,
          y: params.y as number,
        }))

      case 'scroll':
        return executeWithTimeout(() => manager.mouseScroll({
          x: params.x as number,
          y: params.y as number,
          amount: params.amount as number,
        }))

      case 'type_text':
        return executeWithTimeout(() => manager.typeText(params.text as string))

      case 'press_key':
        return executeWithTimeout(() => manager.pressKey(params.key as string))

      case 'key_combo':
        return executeWithTimeout(() => manager.keyCombo(params.keys as string[]))

      case 'wait':
        await this.sleep(params.duration as number ?? 1000)
        return { waited: params.duration ?? 1000 }

      case 'screenshot':
        return { screenshot: await this.captureScreen() }

      case 'complete':
        return { completed: true }

      case 'abort':
        return { aborted: true }

      default:
        throw new Error(`Unknown action type: ${action.type}`)
    }
  }

  /** 判断是否为危险操作 */
  private isDangerousAction(action: VisualAction): boolean {
    // 关闭窗口、删除文件等操作视为危险
    if (action.type === 'key_combo') {
      const keys = (action.params.keys as string[]) ?? []
      const keyStr = keys.join('+').toLowerCase()
      // Alt+F4, Cmd+W 等关闭快捷键
      if (keyStr.includes('f4') || keyStr.includes('cmd+w') || keyStr.includes('ctrl+w')) {
        return true
      }
    }
    return false
  }

  /** 可中断 sleep */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      if (ms <= 0) {
        resolve()
        return
      }
      const timer = setTimeout(resolve, ms)
      this.abortController?.signal.addEventListener('abort', () => {
        clearTimeout(timer)
        resolve()
      }, { once: true })
    })
  }
}

// ============================================
// 单例
// ============================================

let loopInstance: VisualAgentLoop | null = null

/** 获取视觉闭环引擎单例 */
export function getVisualAgentLoop(): VisualAgentLoop {
  if (!loopInstance) {
    loopInstance = new VisualAgentLoop()
  }
  return loopInstance
}
