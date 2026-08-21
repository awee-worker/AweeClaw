/**
 * 场景感知策略管理器（D-步骤5）
 *
 * 模式切换时，将新模式的 perceptionFilter 通过 IPC 同步到主进程
 * PerceptionFusionService，控制各感知通道（scene/iot/monitoring）的启停。
 *
 * 过滤器字段（与 SceneModeDescriptor.PerceptionFilter 结构一致）：
 * - desktopWindowSwitching: 桌面窗口切换检测
 * - activeAppTracking: 活动应用检测
 * - calendarEvents: 日历事件
 * - workspaceFileChanges: 工作区文件改动
 * - screenIdleTime: 屏幕久坐时长
 * - weather: 天气
 * - iotHealth: IoT 健康设备
 * - emotionAnalysis: 情绪分析
 * - iotEnvironment: IoT 环境传感器
 * - studyDuration: 学习时长
 * - forgettingCurve: 遗忘曲线计算
 *
 * PerceptionFusionService 内部按通道聚合判断：
 * - 场景通道：desktopWindowSwitching || activeAppTracking 都禁用时跳过
 * - IoT 通道：iotHealth || iotEnvironment 都禁用时跳过
 * - 监控/因果通道：始终采集
 *
 * @see {@link file:///Volumes/MacData/Ai/aweeclaw/aweeclaw-client/docs/scene-modes/04-d-implementation.md} D-步骤5 设计
 */

import type { SceneModeProfile, PerceptionFilter } from './SceneModeDescriptor'
import { api } from '@renderer/adapters/electronBridge'
import { logger } from '@toolkit/LogEngine'

/**
 * 将 PerceptionFilter 转换为 IPC 传输用的 Record<string, boolean>
 *
 * PerceptionFilter 是固定的接口结构，而 IPC 层使用 Record<string, boolean>
 * 以便主进程不需要依赖渲染层类型定义。
 */
function toFilterRecord(filter: PerceptionFilter): Record<string, boolean> {
  return { ...filter }
}

/**
 * 场景感知策略管理器
 *
 * 通过 addSceneModeListener 注册，模式切换时自动：
 * 1. 将 perceptionFilter 转换为 IPC 传输格式
 * 2. 通过 IPC 同步到主进程 PerceptionFusionService.setSceneFilter()
 */
class ScenePerceptionManager {
  /**
   * 同步感知过滤器到主进程
   */
  async syncPerceptionFilter(profile: SceneModeProfile): Promise<void> {
    const filterRecord = toFilterRecord(profile.perceptionFilter)
    const enabledCount = Object.values(filterRecord).filter((v) => v).length

    try {
      const result = await api.perception.setSceneFilter(filterRecord)
      if (!result.success) {
        logger.system.warn(
          `[ScenePerception] setSceneFilter 返回失败: ${result.error ?? 'unknown'}`,
        )
        return
      }
      logger.system.info(
        `[ScenePerception] Synced filter for ${profile.displayNameZh} (${enabledCount}/${Object.keys(filterRecord).length} 信号启用)`,
      )
    } catch (err) {
      logger.system.warn('[ScenePerception] Failed to sync filter:', err)
    }
  }
}

/** 场景感知策略管理器单例 */
export const scenePerceptionManager = new ScenePerceptionManager()
