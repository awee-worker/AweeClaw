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
import { nativeImage } from 'electron'
import { logger } from '@shared/toolkit/LogEngine'
import {
  getEmergencyStopController,
  EmergencyStopError,
} from './EmergencyStop'
import { getDesktopControlManager } from './DesktopControlManager'
import {
  getAutomationModeController,
  type AutomationStepInfo,
} from './AutomationModeController'
import type { LLMConfig, LLMMessage, ImageContent, TextContent } from '@shared/protocols/modelProtocol'
import { createModel } from '@main/modules/ai-provider/modelRegistry'
import { generateText } from 'ai'
import { MessageConverter } from '@main/modules/ai-provider/core/MessageAdapter'
import type { Rect } from './types/actions'

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
/** 后端 OCR 接口返回的文字识别项（含像素坐标） */
interface OcrTextItem {
  text: string
  /** 文字区域中心点 X 坐标（像素） */
  x: number
  /** 文字区域中心点 Y 坐标（像素） */
  y: number
  width: number
  height: number
  /** 置信度 0-1 */
  confidence: number
}

export interface VisualAgentLoopConfig {
  /** 任务描述 */
  task: string
  /**
   * 最大循环次数
   * - 0：无限制（仅靠任务完成/中止/用户停止退出，适合复杂多步任务）
   * - >0：达到上限后自动结束
   */
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
  | 'click_text'
  | 'move'
  | 'scroll'
  | 'type_text'
  | 'press_key'
  | 'key_combo'
  | 'open_app'
  | 'focus_window'
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
  maxSteps: 0, // 0 = 无限制，由任务完成/中止/用户停止控制结束
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
3. Action types: click, double_click, right_click, click_text, move, scroll, type_text, press_key, key_combo, open_app, focus_window, wait, screenshot, complete, abort
4. For click/move/scroll, params must include x, y coordinates.
5. For type_text, params must include text.
6. For press_key, params must include key.
7. For key_combo, params must include keys array.
8. For click_text, params must include text (the visible text label of the UI element to click). The system will use OCR to find the EXACT pixel coordinates of that text on screen and click it. This is your PRIMARY click method - use it for ALL UI elements that have visible text. Do NOT use click with guessed coordinates when click_text is available.
9. For open_app, params must include app (application name, e.g. "WeChat", "Chrome", "Finder"). Use this when the target application is NOT already open or visible on screen. After launching, wait for it to appear before interacting.
10. For focus_window, params must include window_title (substring to match the window title). Use this to bring an existing window to the front when the app is open but its window is minimized, behind other windows, or not focused.
11. Set completed=true when task is done.
12. Set action.type="abort" if the task cannot be completed.
13. Confidence is 0.0-1.0, where 1.0 means very certain.

IMPORTANT - Task execution strategy:
- If the target application is NOT visible on the current screenshot, DO NOT just search the screen. Use open_app to launch it first, then take a new screenshot to verify it opened.
- If the application is open but the desired window is not focused, use focus_window to bring it to the front.
- After launching or focusing, ALWAYS use wait (2000ms) for the UI to settle before taking the next action. The application needs time to render its window.
- Only interact with UI elements (click, type) after confirming the target application/window is visible on screen.

IMPORTANT - Multi-window & application management (CRITICAL for complex tasks):
- Complex tasks often involve multiple applications/windows (e.g., copy data from browser to spreadsheet, compare two documents).
- You CAN manage multiple windows: use focus_window to switch between them, or use key_combo (e.g., Cmd+Tab / Alt+Tab) to cycle through apps.
- If a window is not visible on screen, it may be minimized or behind others. Use focus_window with its title to bring it forward.
- You can open multiple apps sequentially with open_app; each stays running in the background.
- When copying between apps: interact with source app first (select/copy), then focus_window to target app, then paste.
- Window titles can be matched by substring (e.g., focus_window "微信" matches any WeChat window).

IMPORTANT - Multi-step task completion (CRITICAL):
- Tasks are usually multi-step. NEVER mark completed=true after just one action (like opening an app).
- You MUST continue executing actions step by step until the ENTIRE task is fully done.
- Example: Task "open WeChat and send message to 代码江湖" requires:
  Step 1: open_app WeChat
  Step 2: wait 2000ms (for WeChat to render)
  Step 3: screenshot, find the contact search box, click it
  Step 4: type_text "代码江湖" in search box
  Step 5: wait 1000ms, screenshot, find the contact in results, click it
  Step 6: find the message input box, click it
  Step 7: type_text the message content
  Step 8: press_key Enter (or click send button)
  Step 9: verify message sent, then completed=true
- DO NOT stop early. DO NOT abort. DO NOT mark completed until the message is actually sent.
- If you cannot find an element, take a new screenshot and look more carefully. Use scroll if needed.
- Each step should advance the task. Do not repeat the same action more than 3 times.

IMPORTANT - Coordinate accuracy (CRITICAL - READ THIS FIRST):
- YOU MUST USE click_text FOR ANY UI ELEMENT THAT HAS VISIBLE TEXT. This is a HARD RULE, not a suggestion.
- Using click with manually guessed x/y coordinates is STRICTLY FORBIDDEN when the target has a visible text label.
- Your manually guessed coordinates are ALWAYS WRONG because you cannot estimate pixel positions from images accurately.
- click_text uses OCR to find the exact pixel position of text on screen, which is GUARANTEED accurate.
- The ONLY valid use of click is when the target has NO text at all (e.g., icon-only buttons, empty whitespace, color swatches).
- If you are even 1% unsure about coordinates, use click_text. Guessing coordinates will fail the task.

IMPORTANT - How click_text works (READ THIS):
- click_text crops the screenshot to the target app window BEFORE OCR, so only text from the target app is recognized.
- This means you MUST use focus_window to bring the target app to the foreground BEFORE using click_text.
- click_text does EXACT match first, then substring match. If you search "代码江湖" and both "代码江湖" and "代码江湖行路人" exist, the exact match "代码江湖" wins.
- To distinguish between similar names, use the full unique name: "代码江湖" will NOT match "代码江湖行路人" unless no exact match exists.
- OCR may merge adjacent text. If "代码江湖" is not found, try a shorter substring like "代码" or "江湖".

IF click_text FAILS (OCR can't find the text):
- DO NOT fall back to click with guessed coordinates. That WILL fail.
- First, check if the target app is in the foreground. If not, use focus_window first, then retry click_text.
- Second, try click_text with a SHORTER substring (e.g., "代码" instead of "代码江湖").
- Third, try click_text with a different nearby text label that you can see clearly.
- ONLY as absolute last resort, if ALL text is unrecognizable, use click with coordinates estimated from the screenshot.

CORRECT examples:
  - To click contact "代码江湖" in chat list: action="click_text", params={text:"代码江湖"} ✓
  - To click "发送" button: action="click_text", params={text:"发送"} ✓
  - To click "登录" button: action="click_text", params={text:"登录"} ✓
  - To click a textless icon (no label): action="click", params={x,y} ✓ (only when NO text label exists)

WRONG examples (will cause task failure):
  - To click contact "代码江湖": action="click", params={x:330,y:200} ✗ (text is VISIBLE, MUST use click_text!)
  - To click "确认" button: action="click", params={x:500,y:400} ✗ (text is VISIBLE, MUST use click_text!)
  - To click any button/link/menu with text: action="click", params={x,y} ✗ (text is VISIBLE, MUST use click_text!)

IMPORTANT - Efficiency & accuracy tips:
- CRITICAL: click_text is your PRIMARY click method. You should use it for 95%+ of all click actions. Only fall back to click for truly textless elements.
- Prefer keyboard shortcuts over precise clicks when possible (e.g., Cmd+F to search, Tab to navigate fields, Enter to confirm). Keyboard actions are more reliable than pixel-accurate clicks.
- For text input: first click_text or click the input field to focus it, wait briefly, THEN type. Do not type without focusing first.
- For searching in an app: use the app's built-in search (Cmd+F or search box) rather than visually scanning a long list.
- For sending messages: type text then press Enter, rather than clicking a send button (more reliable).
- Combine actions mentally: if you need to click+type, plan both in sequence.
- Avoid clicking near screen edges or overlay elements (glow, exit button at bottom-right).

IMPORTANT - Overlay artifacts to ignore:
While automation mode is active, the screen has visual overlays that are NOT part of the real UI:
- A subtle animated glow around the screen edges.
- A small circular exit button at the bottom-right corner.
These are control UI of the automation system. NEVER click them, NEVER reference them in coordinates, and NEVER treat them as application elements. Always analyze the actual application windows in the center of the screen.`

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
 *   maxSteps: 0, // 0 = 无限制，由任务完成/中止/用户停止控制结束
 *   visionModel: config,
 * })
 * ```
 */
export class VisualAgentLoop extends EventEmitter {
  private isRunning = false
  private abortController: AbortController | null = null
  /** 最近一次聚焦/启动的目标应用名，用于截图前重新激活防止 TRAE 抢焦点 */
  private lastTargetApp: string | null = null

  /** 最近一次聚焦/启动的目标应用窗口边界，用于 OCR 时裁剪截图范围 */
  private lastTargetBounds: Rect | null = null
  /** 当前任务的云端配置（用于调用后端 OCR 接口做精准文字定位） */
  private cloudOcrConfig: { serverUrl: string; accessToken: string } | null = null

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
    // maxSteps: 0 = 无限制（仅靠完成/中止/用户停止退出），>0 为上限
    if (mergedConfig.maxSteps < 0) {
      throw new Error(`Invalid maxSteps: ${mergedConfig.maxSteps} (must be >= 0, 0 means unlimited)`)
    }

    // 提取云端配置，供 click_text 动作调用后端 OCR 接口
    const vm = mergedConfig.visionModel
    if (vm.cloudMode && vm.serverUrl && vm.accessToken) {
      this.cloudOcrConfig = { serverUrl: vm.serverUrl, accessToken: vm.accessToken }
    } else {
      this.cloudOcrConfig = null
    }

    this.isRunning = true
    this.abortController = new AbortController()

    // 监听紧急停止
    const onEmergencyStop = (): void => {
      logger.desktop.info('[VisualAgentLoop] Emergency stop triggered, aborting')
      this.abortController?.abort()
    }
    stopController.on('emergency-stop', onEmergencyStop)

    // 进入自动化模式：显示覆盖层（边缘光晕 + 退出按钮 + 输入锁定）
    const automationCtrl = getAutomationModeController()
    try {
      await automationCtrl.enter({
        task: mergedConfig.task,
        maxSteps: mergedConfig.maxSteps,
      })
      automationCtrl.reportLog(`Visual agent loop started: ${mergedConfig.task}`)
    } catch (err) {
      logger.desktop.warn('[VisualAgentLoop] Enter automation mode failed, continue without overlay:', err)
    }

    const startTime = Date.now()
    const steps: VisualLoopStep[] = []
    let completed = false
    let aborted = false
    // 重置目标应用跟踪
    this.lastTargetApp = null
    this.lastTargetBounds = null
    const manager = getDesktopControlManager()
    let abortReason: string | undefined
    let resultDescription = ''
    let consecutiveErrors = 0 // 连续失败计数，超过阈值自动中止

    try {
      // maxSteps=0 表示无限制，循环直到任务完成/中止/用户停止
      // 硬性安全上限 200 步，防止 LLM 陷入死循环导致无限消耗
      const HARD_LIMIT = 200
      for (let i = 0; i < HARD_LIMIT && (mergedConfig.maxSteps === 0 || i < mergedConfig.maxSteps); i++) {
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
          const shot = await this.captureScreen()
          step.screenshot = shot.base64

          // 2. 发送给视觉模型分析
          const analysis = await this.analyzeScreenshot(
            shot.base64,
            shot.width,
            shot.height,
            mergedConfig,
            config.task,
            steps,
          )
          step.analysis = analysis.analysis
          step.action = analysis.action

          // 3. 检查是否完成（含早停保护：仅 open_app/wait 等初始动作不信任 completed）
          if (analysis.completed) {
            if (!this.hasSubstantialProgress(steps)) {
              // LLM 误判完成：之前只有 open_app/wait/screenshot，任务不可能已完成
              logger.desktop.warn(
                `[VisualAgentLoop] LLM claimed completed but no substantial input actions found, ` +
                `ignoring and continuing (step ${i + 1})`,
              )
              automationCtrl.reportLog(
                `LLM 误判任务完成，已忽略并继续执行（之前仅有初始动作）`,
                'warn',
              )
              // 不 break，继续下一步，但要记录这条步骤
              step.completed = false
              step.completionReason = 'Completed claim rejected: no substantial progress'
              steps.push(step)
              continue
            }
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
          if (!analysis.action) {
            // LLM 未返回有效 action（可能是 JSON 解析失败或返回格式不对）
            logger.desktop.warn(
              `[VisualAgentLoop] Step ${i + 1}: LLM returned no actionable command, ` +
              `raw analysis: ${analysis.analysis.slice(0, 200)}`,
            )
            step.error = 'No actionable command from LLM'
            step.duration = Date.now() - stepStart
            steps.push(step)
            this.emit(VISUAL_LOOP_EVENT_STEP_ERROR, { stepIndex: i, error: step.error })
            consecutiveErrors += 1
            if (consecutiveErrors >= 5) {
              aborted = true
              abortReason = `LLM returned no action for ${consecutiveErrors} consecutive steps`
              break
            }
            continue
          }

          if (analysis.action) {
            // 危险操作检查
            if (!mergedConfig.allowDangerousActions && this.isDangerousAction(analysis.action)) {
              throw new Error(`Dangerous action rejected: ${analysis.action.type}`)
            }

            // 上报步骤进度到覆盖窗口
            const stepInfo: AutomationStepInfo = {
              index: i,
              actionType: analysis.action.type,
              description: analysis.action.reasoning || analysis.action.type,
              status: 'running',
              timestamp: Date.now(),
            }
            automationCtrl.reportStep(stepInfo)

            // 输入类动作执行前切换为穿透模式，让模拟事件作用于目标应用
            const isInput = this.isInputAction(analysis.action.type)
            if (isInput) automationCtrl.setInputElementActive(true)

            // 关键：overlay 穿透模式切换会导致 TRAE 窗口获得焦点，
            // 必须在执行点击/键盘前重新激活目标应用，否则点击会落在 TRAE 上
            if (isInput && this.lastTargetApp) {
              try {
                await manager.activateApp(this.lastTargetApp)
                // 等待 activate 生效 + 窗口重绘
                await this.sleep(200)
              } catch {
                // activate 失败不阻断点击
              }
            }

            try {
              const execResult = await this.executeAction(analysis.action, mergedConfig.stepTimeout)
              step.executionResult = execResult
              stepInfo.status = 'completed'
              automationCtrl.reportStep(stepInfo)
            } finally {
              // 动作完成后恢复阻塞模式，用户无法点击屏幕其他内容
              if (isInput) automationCtrl.setInputElementActive(false)
            }
          }

          step.duration = Date.now() - stepStart
          steps.push(step)
          this.emit(VISUAL_LOOP_EVENT_STEP_COMPLETE, step)
          consecutiveErrors = 0 // 成功执行，重置连续失败计数

          // 步骤间隔（maxSteps=0 无限制时也执行间隔）
          if (mergedConfig.stepInterval > 0) {
            await this.sleep(mergedConfig.stepInterval)
          }
        } catch (err) {
          step.error = err instanceof Error ? err.message : String(err)
          step.duration = Date.now() - stepStart
          steps.push(step)
          this.emit(VISUAL_LOOP_EVENT_STEP_ERROR, { stepIndex: i, error: step.error })

          // 紧急停止错误直接中止
          if (err instanceof EmergencyStopError || this.abortController.signal.aborted) {
            logger.desktop.warn(
              `[VisualAgentLoop] Step ${i + 1} aborted: ${step.error} ` +
              `(emergencyStop=${err instanceof EmergencyStopError}, signal=${this.abortController.signal.aborted})`,
            )
            aborted = true
            abortReason = step.error
            break
          }

          // 连续失败超过阈值则中止，避免无限重试
          consecutiveErrors += 1
          logger.desktop.warn(
            `[VisualAgentLoop] Step ${i + 1} failed (${consecutiveErrors} consecutive): ${step.error}`,
          )
          if (consecutiveErrors >= 5) {
            aborted = true
            abortReason = `Consecutive errors (${consecutiveErrors}): ${step.error}`
            break
          }
        }
      }

      if (!completed && !aborted) {
        if (steps.length >= 200) {
          resultDescription = `Reached hard safety limit (200 steps) without completion`
        } else {
          resultDescription = `Reached max steps (${mergedConfig.maxSteps}) without completion`
        }
      }
    } finally {
      stopController.off('emergency-stop', onEmergencyStop)
      this.isRunning = false
      this.abortController = null

      // 退出自动化模式：销毁覆盖层、解除输入锁定
      try {
        const exitReason = aborted
          ? (abortReason ?? 'aborted')
          : completed
            ? 'task completed'
            : 'reached max steps'
        await automationCtrl.exit(exitReason)
      } catch (err) {
        logger.desktop.warn('[VisualAgentLoop] Exit automation mode failed:', err)
      }
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
      // 记录调用栈，便于诊断谁触发了 abort
      const stack = new Error().stack
      logger.desktop.warn(`[VisualAgentLoop] abort() called. Stack: ${stack?.slice(0, 800)}`)
      this.abortController.abort()
    }
  }

  // ============================================
  // 内部方法
  // ============================================

  /** 截图当前屏幕，返回 base64 数据与屏幕逻辑尺寸 */
  private async captureScreen(): Promise<{ base64: string; width: number; height: number }> {
    const manager = getDesktopControlManager()

    // 截图前重新激活目标应用，防止 TRAE overlay/主窗口抢回焦点
    // 根因：Electron 的 setIgnoreMouseEvents 切换可能导致 TRAE 窗口短暂成为 key window，
    // 导致截图时 TRAE 在最前面而非目标应用
    if (this.lastTargetApp) {
      try {
        await manager.activateApp(this.lastTargetApp)
        // 等待窗口渲染
        await this.sleep(300)
      } catch {
        // activate 失败不阻断流程
      }
    }

    const result = await manager.captureScreen()
    if (!result.success) {
      throw new Error(`Screenshot failed: ${result.error}`)
    }
    // 提取 base64 数据（去掉 data:image/png;base64, 前缀）
    const base64 = result.dataUrl.replace(/^data:image\/\w+;base64,/, '')
    return {
      base64,
      width: result.region.width,
      height: result.region.height,
    }
  }

  /** 分析截图并决策下一步 */
  private async analyzeScreenshot(
    screenshot: string,
    screenWidth: number,
    screenHeight: number,
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
      text: this.buildPrompt(task, screenWidth, screenHeight, previousSteps),
    }

    const imageContent: ImageContent = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/jpeg',
        data: screenshot,
      },
    }

    const messages: LLMMessage[] = [
      {
        role: 'user',
        content: [textContent, imageContent],
      },
    ]

    // 调用视觉模型（带超时保护，防止 LLM 响应过慢导致循环卡死）
    const model = createModel(config.visionModel)
    const messageConverter = new MessageConverter()
    const baseMessages = messageConverter.convert(messages, config.systemPrompt ?? DEFAULT_SYSTEM_PROMPT)

    const llmTimeout = Math.max(config.stepTimeout, 60_000) // LLM 分析至少给 60 秒
    // 使用 AbortController 统一管理超时，避免 setTimeout 泄漏和未清理的 reject
    const timeoutController = new AbortController()
    const timer = setTimeout(() => timeoutController.abort(), llmTimeout)

    // 如果外部已经 abort，立即退出
    if (this.abortController?.signal.aborted) {
      clearTimeout(timer)
      throw new Error('VisualAgentLoop aborted before LLM call')
    }

    logger.desktop.info(`[VisualAgentLoop] LLM call started (timeout=${llmTimeout}ms)`)

    let result
    try {
      result = await generateText({
        model,
        messages: baseMessages,
        abortSignal: this.abortController?.signal,
      })
    } catch (err) {
      clearTimeout(timer)
      // 区分 abort 和其他错误
      if (this.abortController?.signal.aborted) {
        logger.desktop.warn(`[VisualAgentLoop] LLM call aborted by external signal`)
      } else if (timeoutController.signal.aborted) {
        logger.desktop.warn(`[VisualAgentLoop] LLM call timed out after ${llmTimeout}ms`)
      } else {
        logger.desktop.error(`[VisualAgentLoop] LLM call failed:`, err)
      }
      throw err
    }
    clearTimeout(timer)

    // 记录 LLM 原始返回，便于诊断"无进一步操作"类问题
    logger.desktop.info(`[VisualAgentLoop] LLM raw response: ${result.text.slice(0, 500)}`)

    // 解析 JSON 响应
    const parsed = this.parseAnalysisResponse(result.text)
    logger.desktop.info(
      `[VisualAgentLoop] Parsed: action=${parsed.action?.type ?? 'none'}, ` +
      `completed=${parsed.completed}, confidence=${parsed.action?.confidence ?? 'n/a'}`,
    )
    return parsed
  }

  /** 构建提示词 */
  private buildPrompt(
    task: string,
    screenWidth: number,
    screenHeight: number,
    previousSteps: VisualLoopStep[],
  ): string {
    const stepHistory = previousSteps.length > 0
      ? previousSteps.map((s, i) => {
          const actionType = s.action?.type ?? 'unknown'
          const actionParams = s.action?.params ? JSON.stringify(s.action.params) : ''
          const execResult = s.executionResult ? ` => ${typeof s.executionResult === 'object' ? JSON.stringify(s.executionResult) : String(s.executionResult)}` : ''
          const errorInfo = s.error ? ` [ERROR: ${s.error}]` : ''
          return `Step ${i + 1}: ${actionType}(${actionParams})${execResult}${errorInfo}\n  Analysis: ${s.analysis}`
        }).join('\n\n')
      : 'No previous steps yet. This is the first step.'

    // 检测重复点击：若最近 2-3 步点击位置接近（误差 ±30px），说明点击未生效，需改用键盘
    const recentClicks = previousSteps.slice(-3).filter(s => s.action?.type === 'click' || s.action?.type === 'double_click')
    let repeatWarning = ''
    if (recentClicks.length >= 2) {
      const pts = recentClicks.map(s => ({ x: s.action!.params.x as number, y: s.action!.params.y as number }))
      const closeCount = pts.filter((p, i) => i > 0 && Math.abs(p.x - pts[0].x) < 30 && Math.abs(p.y - pts[0].y) < 30).length
      if (closeCount >= 1) {
        repeatWarning = `\n\nWARNING: You have clicked near (${pts[0].x}, ${pts[0].y}) ${recentClicks.length} times but the UI did not respond. The click coordinates may be inaccurate or the element is not clickable. 
STRATEGY CHANGE: Stop clicking that area. Instead, use keyboard shortcuts:
- Use Cmd+F or the app's search function to find the target.
- Use arrow keys + Enter to navigate and select.
- Use Tab to move between fields.
Keyboard actions are far more reliable than pixel-accurate clicks.`
      }
    }

    return `Task: ${task}

Screen resolution: ${screenWidth} x ${screenHeight} pixels (logical coordinates).
IMPORTANT: The screenshot pixel coordinates ARE the click coordinates. (0,0) is top-left corner. X increases rightward, Y increases downward. When you specify click coordinates, they will be used directly as screen logical coordinates.

Previous steps executed:
${stepHistory}
${repeatWarning}

Analyze the CURRENT screenshot carefully. Determine what has been accomplished so far and what remains to complete the task. Then decide the SINGLE next action to advance the task.

Remember: Do NOT mark completed=true until the ENTIRE task is fully done. If you just opened an app, the task is NOT done — you must continue interacting with the app to complete the user's request.`
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

      case 'click_text': {
        // OCR 精确定位：LLM 提供要点击的文字，程序用后端 OCR 找到精确坐标后点击
        const searchText = params.text as string
        if (!searchText) {
          throw new Error('click_text requires "text" param')
        }
        return executeWithTimeout(async () => {
          // 1. 截图（此时目标应用已在前台，由调用前的 activate 保证）
          const screenResult = await manager.captureScreen()
          if (!screenResult.success || !screenResult.dataUrl) {
            throw new Error('Screenshot failed for OCR')
          }

          const img = nativeImage.createFromDataURL(screenResult.dataUrl)
          const origSize = img.getSize()
          if (origSize.width === 0 || origSize.height === 0) {
            throw new Error('Screenshot image is empty (0x0), cannot perform OCR')
          }

          // 2. 裁剪到目标窗口边界，避免 OCR 误识别其他窗口的文字（如 IDE 代码）
          //    全屏截图时 OCR 会读到 IDE 的 "scripts"、"README.md" 等文字，
          //    与微信窗口的 "代码江湖" 等混在一起，导致 substring 匹配命中错误窗口
          let cropX = 0, cropY = 0, cropW = origSize.width, cropH = origSize.height
          if (this.lastTargetBounds) {
            const b = this.lastTargetBounds
            // 边界保护：确保裁剪区域不超出截图范围
            cropX = Math.max(0, Math.round(b.x))
            cropY = Math.max(0, Math.round(b.y))
            cropW = Math.min(origSize.width - cropX, Math.round(b.width))
            cropH = Math.min(origSize.height - cropY, Math.round(b.height))
            if (cropW > 0 && cropH > 0 && (cropW < origSize.width || cropH < origSize.height)) {
              logger.desktop.info(
                `[VisualAgentLoop] click_text: crop to window (${cropX},${cropY} ${cropW}x${cropH}) ` +
                `from full screen ${origSize.width}x${origSize.height}`,
              )
            }
          }

          // 3. 图像下采样加速 OCR
          //    全屏截图（如 1800x1169）直接用 Tesseract 识别中文需 ~11s
          //    裁剪后窗口区域通常 ~1000x800，无需下采样或轻度下采样即可
          //    中文字符需至少 14px 高度才能被 Tesseract 识别
          const MAX_DIM = 1500
          const maxOrig = Math.max(cropW, cropH)
          let ocrImageBase64: string
          let scaleX = 1
          let scaleY = 1

          let processImg = img
          if (cropW < origSize.width || cropH < origSize.height) {
            // 裁剪到窗口区域
            processImg = img.crop({ x: cropX, y: cropY, width: cropW, height: cropH })
          }

          if (maxOrig > MAX_DIM) {
            const ratio = MAX_DIM / maxOrig
            const newW = Math.round(cropW * ratio)
            const newH = Math.round(cropH * ratio)
            const resized = processImg.resize({ width: newW, height: newH, quality: 'best' })
            ocrImageBase64 = resized.toJPEG(92).toString('base64')
            scaleX = cropW / newW
            scaleY = cropH / newH
            logger.desktop.info(
              `[VisualAgentLoop] click_text: resized ${cropW}x${cropH} → ${newW}x${newH} ` +
              `(scaleX=${scaleX.toFixed(2)}, scaleY=${scaleY.toFixed(2)}) for OCR`,
            )
          } else {
            ocrImageBase64 = processImg.toJPEG(92).toString('base64')
          }

          // 4. 调用后端 OCR 接口识别
          const ocrItems = await this.callBackendOcr(ocrImageBase64)
          if (ocrItems.length === 0) {
            throw new Error('OCR returned no text - image may be too low quality or empty')
          }

          // 日志：OCR 识别到的文字总数和置信度分布
          const highConfItems = ocrItems.filter(i => i.confidence >= 0.5)
          logger.desktop.info(
            `[VisualAgentLoop] click_text: OCR found ${ocrItems.length} items, ${highConfItems.length} with confidence>=0.5`,
          )

          // 5. 智能匹配文字：精确匹配优先于子串匹配，高置信度优先
          //    典型场景：微信联系人 "代码江湖" 和 "代码江湖行路人" 同时存在，
          //    精确匹配 "代码江湖" 应优先于子串匹配 "代码江湖行路人"
          const target = searchText.toLowerCase()
          const sortedByConf = [...ocrItems].sort((a, b) => b.confidence - a.confidence)

          // 第一轮：精确匹配（text 与 searchText 完全相等，忽略大小写）
          let match = sortedByConf.find(item =>
            item.text.toLowerCase().trim() === target.trim(),
          )
          // 第二轮：子串匹配（text 包含 searchText 或 searchText 包含 text）
          if (!match) {
            match = sortedByConf.find(item => {
              const itemText = item.text.toLowerCase().trim()
              return itemText.includes(target) || target.includes(itemText)
            })
          }
          if (!match) {
            // 列出置信度最高的前 10 个结果，帮助 LLM 理解 OCR 识别到了什么
            const topItems = sortedByConf.slice(0, 10)
              .map(i => `"${i.text}"(conf=${i.confidence.toFixed(2)})`)
              .join(', ')
            throw new Error(
              `Text "${searchText}" not found in ${ocrItems.length} OCR results. ` +
              `Top results: ${topItems}`,
            )
          }

          // 6. 坐标缩放还原：OCR 坐标 → 裁剪区域坐标 → 原始屏幕坐标
          const origX = Math.round(match.x * scaleX) + cropX
          const origY = Math.round(match.y * scaleY) + cropY
          logger.desktop.info(
            `[VisualAgentLoop] click_text: "${searchText}" matched "${match.text}" ` +
            `OCR(${match.x},${match.y}) → Screen(${origX},${origY}) confidence=${match.confidence.toFixed(2)}`,
          )

          // 6. 用精确坐标点击
          const clickResult = await manager.mouseClick({
            x: origX,
            y: origY,
            button: 'left',
            clickType: 'single',
          })
          return {
            ...clickResult,
            matchedText: match.text,
            ocrX: origX,
            ocrY: origY,
            confidence: match.confidence,
          }
        })
      }

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

      case 'open_app': {
        // 启动应用（如微信、浏览器等），若已运行则前置其窗口
        const appName = params.app as string
        if (!appName) {
          throw new Error('open_app requires "app" param')
        }
        // 记录目标应用名，供后续截图前重新激活，防止 TRAE 抢焦点
        this.lastTargetApp = appName
        return executeWithTimeout(async () => {
          const result = await manager.launchApp(appName)
          // 应用启动/前置后，等待窗口渲染完成，避免下一步截图取到旧画面
          await this.sleep(2000)
          // 获取窗口真实边界，用于 OCR 时裁剪截图
          this.lastTargetBounds = await manager.getActiveWindowBounds(appName)
          if (this.lastTargetBounds) {
            logger.desktop.info(
              `[VisualAgentLoop] open_app: "${appName}" bounds=${JSON.stringify(this.lastTargetBounds)}`,
            )
          }
          return { ...result, autoWaited: 2000 }
        })
      }

      case 'focus_window': {
        // 按窗口标题模糊匹配，将窗口置于前台
        const windowTitle = params.window_title as string
        if (!windowTitle) {
          throw new Error('focus_window requires "window_title" param')
        }
        return executeWithTimeout(async () => {
          const matches = await manager.findWindow(windowTitle)
          if (matches.length === 0) {
            throw new Error(`No window found matching title: ${windowTitle}`)
          }
          const target = matches[0]
          await manager.bringWindowToFront(target.id)
          // 记录目标应用名，供截图前重新激活
          this.lastTargetApp = target.appName || target.title || windowTitle
          // 窗口前置后短暂等待，让动画与重绘完成
          await this.sleep(800)
          // 获取窗口真实边界（findWindow 返回的 bounds 是 0x0，必须用 AppleScript 获取）
          this.lastTargetBounds = await manager.getActiveWindowBounds(this.lastTargetApp)
          if (this.lastTargetBounds) {
            logger.desktop.info(
              `[VisualAgentLoop] focus_window: "${target.title || windowTitle}" bounds=${JSON.stringify(this.lastTargetBounds)}`,
            )
          }
          return { focused: target.title, windowId: target.id, autoWaited: 800 }
        })
      }

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

  /**
   * 调用后端 OCR 接口识别屏幕文字，返回带像素坐标的文字列表
   *
   * 接口：POST {serverUrl}/api/v1/multimodal/ocr/screen
   * 后端使用 Tesseract 引擎做像素级识别，返回每个文字行的中心点坐标。
   * 这比 LLM 猜坐标精准得多，是 click_text 动作可靠性的关键。
   */
  private async callBackendOcr(imageBase64: string): Promise<Array<OcrTextItem>> {
    if (!this.cloudOcrConfig) {
      throw new Error('Cloud OCR config not available (cloudMode or serverUrl/accessToken missing)')
    }
    const { serverUrl, accessToken } = this.cloudOcrConfig
    const url = `${serverUrl.replace(/\/+$/, '')}/api/v1/multimodal/ocr/screen`

    const start = Date.now()
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ imageBase64 }),
        signal: this.abortController?.signal,
      })
      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Backend OCR HTTP ${res.status}: ${errText.slice(0, 200)}`)
      }
      const json = await res.json() as {
        // 后端全局拦截器包装: { success, data: { items, elapsed } }
        success?: boolean
        data?: { items?: Array<OcrTextItem>; elapsed?: number }
        // 直连（无拦截器）或错误时: { items?: [...] } | { error?: string }
        items?: Array<OcrTextItem>
        error?: string
      }
      // 兼容两种响应结构：包装后的 data.items 或裸 items
      const items = json.data?.items ?? json.items ?? []
      if (json.error) {
        throw new Error(`Backend OCR error: ${json.error}`)
      }
      logger.desktop.info(`[VisualAgentLoop] Backend OCR returned ${items.length} items in ${Date.now() - start}ms`)
      return items
    } catch (err) {
      logger.desktop.error(`[VisualAgentLoop] Backend OCR failed: ${(err as Error).message}`)
      throw err
    }
  }

  /** 判断动作类型是否为输入类（需要穿透覆盖层作用于目标应用） */
  private isInputAction(type: VisualActionType): boolean {
    switch (type) {
      case 'click':
      case 'double_click':
      case 'right_click':
      case 'click_text':
      case 'move':
      case 'scroll':
      case 'type_text':
      case 'press_key':
      case 'key_combo':
        return true
      case 'open_app':
      case 'focus_window':
      case 'wait':
      case 'screenshot':
      case 'complete':
      case 'abort':
        return false
      default:
        return false
    }
  }

  /**
   * 判断已完成步骤中是否有实质性进展
   *
   * 用于 LLM 早停保护：如果 LLM 声称任务完成，但之前只执行了
   * open_app/wait/screenshot/focus_window 等辅助动作，没有任何实际的
   * 输入操作（点击、输入文本、按键），则任务不可能真正完成，拒绝 completed。
   */
  private hasSubstantialProgress(steps: VisualLoopStep[]): boolean {
    return steps.some((s) => {
      const type = s.action?.type
      if (!type) return false
      // 实质性输入操作：点击、输入、按键
      return (
        type === 'click' ||
        type === 'double_click' ||
        type === 'right_click' ||
        type === 'type_text' ||
        type === 'press_key' ||
        type === 'key_combo' ||
        type === 'scroll'
      )
    })
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
