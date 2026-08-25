/**
 * 声音提醒总闸门
 *
 * 所有提示音（完成/错误/授权等）在播放前必须经过本模块判定，
 * 统一读取「设置 → 智能体 → 声音提醒」的开关配置：
 * - enabled：总开关，关闭后所有提示音静音
 * - taskComplete：任务完成提醒
 * - taskError：错误提醒
 * - needApproval：需确认操作提醒
 *
 * 未配置（旧版本无此字段）时返回 true，保持原有行为不变。
 * 语音对话（Voice Chat）中播放的 AI 语音内容不属于提示音，不受本闸门控制。
 */

import { useStore } from '@store'

/** 提示音分类，与设置面板的三个子开关对应；general 仅受总开关控制 */
export type SoundCategory = 'taskComplete' | 'taskError' | 'needApproval' | 'general'

/**
 * 判断指定分类的提示音是否允许播放。
 * 读取全局 agentConfig.soundNotifications，读取失败或未配置时放行。
 */
export function isSoundAllowed(category: SoundCategory): boolean {
  try {
    const settings = useStore.getState().agentConfig?.soundNotifications
    if (!settings) return true
    if (!settings.enabled) return false
    switch (category) {
      case 'taskComplete':
        return settings.taskComplete
      case 'taskError':
        return settings.taskError
      case 'needApproval':
        return settings.needApproval
      default:
        return true
    }
  } catch {
    // 读取失败时保守放行，避免声音系统整体失效
    return true
  }
}
