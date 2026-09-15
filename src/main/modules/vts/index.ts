/**
 * VTS（VTube Studio）联动模块入口（主进程）
 *
 * 由 `bootstrap/moduleInitializer.ts` 在 `initializeModules()` 中调用；
 * 由 `bootstrap/globalCleanup.ts` 在退出流程中调用清理。
 *
 * 模块组成：
 *   VtsStore        配置 + token 持久化（<userData>/vts，token safeStorage 加密）
 *   VtsClient       WS 握手 / 鉴权 / 指令收发
 *   VtsLipSync      RMS + FFT 口型算法（自写 radix-2 FFT，零新增依赖）
 *   VtsAudioBridge  ffmpeg-static 转 24kHz/16bit/mono PCM 并分帧
 *   VtsManager      生命周期编排 + 自校正帧发送循环
 *   VtsIpc          IPC 通道
 *
 * 与 P0-2（直播互动）的关系：**互相独立**。VTS 驱动的是本机 Live2D 模型，
 * 直播模块消费的是远端弹幕流，两者只在「都是外部内容的输出端」这一层同构。
 *
 * 与 VRM 桌面伴侣的关系：**口型数据源互斥**。VRM 用 `useVrmLipSync.pushVolume`
 * （渲染进程内驱动），VTS 走主进程 PCM 分析；两者可以同时连接，但同一时刻
 * 只应有一个消费 TTS 音频，设置页需要向用户说明这一点。
 *
 * @module vts
 */

import { logger } from '@shared/toolkit/LogEngine'
import { getVtsManager } from './VtsManager'
import { registerVtsIpc } from './VtsIpc'

export { getVtsManager, VTS_STATUS_CHANNEL } from './VtsManager'
export { VtsClient, LIPSYNC_REQUEST_ID } from './VtsClient'
export { VtsLipSync, SAMPLES_PER_FRAME, BYTES_PER_FRAME } from './VtsLipSync'
export { transcodeToPcm, splitPcmIntoFrames, VTS_FRAME_INFO } from './VtsAudioBridge'
export {
  getConfig as getVtsConfig,
  updateConfig as updateVtsConfig,
  resetConfig as resetVtsConfig,
  validateConfig as validateVtsConfig,
  saveToken as saveVtsToken,
  getVtsDataDir,
  DEFAULT_VTS_CONFIG,
  DEFAULT_VTS_URL,
} from './VtsStore'
export * from './types'

/** 初始化 VTS 联动模块 */
export async function initVtsModule(): Promise<void> {
  registerVtsIpc()
  await getVtsManager().start()
  logger.system.info('[VTS] module initialized')
}

/**
 * 卸载 VTS 联动模块。
 *
 * `stop()` 会清空帧队列、复位口型、关闭 WebSocket —— 缺任何一步都会留下
 * 「退出后 VTS 端嘴还张着」或「往已关闭的 socket 写数据」的残留。
 */
export async function cleanupVtsModule(): Promise<void> {
  await getVtsManager().stop()
  logger.system.info('[VTS] module cleaned up')
}
