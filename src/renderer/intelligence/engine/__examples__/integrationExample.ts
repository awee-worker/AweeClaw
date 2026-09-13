/**
 * 架构增强方案实施指南
 * 
 * 已完成的功能：
 * 1. ✅ BehaviorEngine - 行为引擎（主动触发）
 * 2. ✅ SubAgentEngine - 后台任务引擎
 * 3. ✅ PermissionGuard 扩展 - 项目级权限配置
 * 
 * 下一步需要完成：
 * - 集成到客户端启动流程
 * - 添加前端配置 UI
 * - 编写集成测试
 */

import { initializeBehaviorEngine, initializeSubAgentEngine, disposeEngines } from '../engineInitializer'
import { getBehaviorEngine } from '../../runtime/BehaviorEngine'
import { getSubAgentEngine } from '../SubAgentEngine'

/**
 * 占位实现：真实项目中应替换为实际的 AI 执行逻辑
 * （如 AgentService / MultiAgentOrchestrator）
 */
async function executeWithAI(_prompt: string): Promise<string> {
  return '示例结果：请接入真实 AI 执行逻辑'
}

/**
 * 示例：如何在客户端初始化引擎
 */
export async function setupEngineIntegration() {
  console.log('[Integration] Starting engine initialization...')

  // 1. 初始化行为引擎（回调通过初始化器注入）
  initializeBehaviorEngine(
    // 当生成主动消息时
    (prompt: string, ruleId: string) => {
      console.log(`[BehaviorEngine] Generating prompt for rule ${ruleId}:`, prompt)
      // 推送到聊天窗口
      // sendToChat(prompt)
    },
    // 当显示通知时
    (title: string, body: string) => {
      console.log(`[BehaviorEngine] Notification: ${title}`, body)
      // 显示系统通知
      // showNotification(title, body)
    },
  )

  // 2. 初始化 SubAgent 引擎
  const subAgent = await initializeSubAgentEngine()

  // 3. 设置 SubAgent 引擎的执行器
  // 这里需要接入现有的 AgentService 或 MultiAgentOrchestrator
  subAgent.setExecutor(async (taskId, prompt, onProgress) => {
    console.log(`[SubAgentEngine] Executing task ${taskId}:`, prompt)
    
    // 模拟进度更新
    onProgress?.(10)
    
    // 调用现有的 AI 执行逻辑
    const result = await executeWithAI(prompt)
    
    onProgress?.(100)
    return result
  })

  // 4. 监听任务事件
  subAgent.setCallbacks(
    (event) => {
      console.log(`[SubAgentEngine] Progress: ${event.taskId} - ${event.progress}%`)
      // 更新 UI 进度条
    },
    (event) => {
      console.log(`[SubAgentEngine] Result: ${event.taskId}`, event.success ? '成功' : '失败')
      if (event.success && event.result) {
        // 显示结果通知
        // showNotification('任务完成', event.result)
      }
    },
  )

  console.log('[Integration] Engine initialization completed')

  // 返回清理函数
  return () => {
    disposeEngines()
    console.log('[Integration] Engines disposed')
  }
}

/**
 * 示例：如何创建行为规则
 */
export function createSampleBehaviorRules() {
  const engine = getBehaviorEngine()

  // 规则 1：每天早上 9 点推送待办摘要
  engine.addRule({
    enabled: true,
    name: '每日待办摘要',
    trigger: {
      type: 'time',
      config: {
        time: { value: '09:00', days: [1, 2, 3, 4, 5] }, // 工作日
      },
    },
    action: {
      type: 'prompt',
      prompt: '早上好！现在是 {now}。请查看今日待办任务并生成摘要。',
    },
  })

  // 规则 2：空闲 30 分钟后提醒
  engine.addRule({
    enabled: true,
    name: '空闲提醒',
    trigger: {
      type: 'noInput',
      config: {
        noInput: { latencyMs: 30 * 60 * 1000 }, // 30 分钟
      },
    },
    action: {
      type: 'notify',
      prompt: '您已经空闲了 30 分钟，需要帮助吗？',
    },
  })

  // 规则 3：每 2 小时检查后台任务进度
  engine.addRule({
    enabled: true,
    name: '定期检查任务',
    trigger: {
      type: 'cycle',
      config: {
        cycle: { intervalMs: 2 * 60 * 60 * 1000, infinite: true },
      },
    },
    action: {
      type: 'toolCall',
      toolName: 'scene_tools_stats',
      toolArgs: { tool: 'work-todo' },
    },
  })

  console.log('[SampleRules] Created 3 sample behavior rules')
}

/**
 * 示例：如何使用项目级权限配置
 */
export function configureProjectPermissions(workspacePath: string) {
  const { PermissionGuard } = require('./scenario-system/core/PermissionGuard')
  
  // 创建 PermissionGuard 实例
  const guard = new PermissionGuard('my-scenario', ['filesystem:read'], workspacePath)
  
  // 设置项目级黑名单（禁止执行敏感工具）
  guard.updateProjectConfig({
    blockedTools: ['run_command', 'delete_file_or_folder'],
  })
  
  // 验证权限
  const canRead = guard.checkTool('read_file')
  const canRun = guard.checkTool('run_command')
  
  console.log('Can read file:', canRead.allowed) // true
  console.log('Can run command:', canRun.allowed) // false - blocked by project
  
  // 重置为场景默认权限
  guard.resetProjectConfig()
}

/**
 * 示例：如何创建后台任务
 */
export async function createBackgroundTask() {
  const engine = getSubAgentEngine()
  
  // 创建任务
  const taskId = await engine.createTask(
    '分析项目代码结构并生成报告',
    {
      metadata: {
        priority: 'high',
        category: 'code-analysis',
      },
    },
  )
  
  console.log('Task created:', taskId)
  
  // 启动任务
  await engine.startTask(taskId)
  
  // 等待完成
  const task = await engine.getTask(taskId)
  console.log('Task status:', task?.status)
  console.log('Task progress:', task?.progress)
}

// 导出用于测试
export default {
  setupEngineIntegration,
  createSampleBehaviorRules,
  configureProjectPermissions,
  createBackgroundTask,
}
