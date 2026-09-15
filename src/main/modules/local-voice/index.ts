/**
 * 本地语音引擎模块导出
 *
 * 本模块提供离线 ASR/TTS 功能，支持多种引擎：
 * 1. Sherpa-ONNX ASR（离线语音识别）
 * 2. Sherpa-ONNX TTS（离线语音合成）
 * 3. GPT-SoVITS（声音克隆）
 *
 * 设计要点：
 * 1. 默认关闭：遵循 P1 通用要求
 * 2. 引擎优先级：本地优先/云端优先/仅本地/仅云端
 * 3. 模型管理：支持下载、校验、缓存
 * 4. 错误处理：引擎不可用时的降级策略
 *
 * @module local-voice
 */

import { LocalVoiceManager } from './LocalVoiceManager'
import { registerLocalVoiceIpc, unregisterLocalVoiceIpc } from './LocalVoiceIpc'

// 配置存储
export {
  readLocalVoiceConfig,
  updateLocalVoiceConfig,
  resetLocalVoiceConfig,
  isLocalVoiceEnabled,
  isAsrEnabled,
  isTtsEnabled,
  isGptSovitsEnabled,
  shouldUseLocalEngine,
  getEffectivePriority,
  getLocalVoiceDataDir,
  getLocalVoiceConfigPath,
  DEFAULT_LOCAL_VOICE_CONFIG,
  type LocalVoiceConfig,
  type AsrEngineConfig,
  type TtsEngineConfig,
  type GptSovitsEngineConfig,
  type EngineType,
  type EnginePriority,
} from './LocalVoiceStore'

// 引擎实现
export { SherpaAsrEngine, type AsrResult, type EngineStatus } from './engines/SherpaAsrEngine'
export { SherpaTtsEngine, type TtsResult } from './engines/SherpaTtsEngine'
export { GptSovitsEngine } from './engines/GptSovitsEngine'

// 模型下载器
export {
  ModelDownloader,
  type ModelMetadata,
  type DownloadProgress,
  type DownloadTask,
} from './ModelDownloader'

// 管理器
export { LocalVoiceManager }

// IPC 处理器
// 注意：必须静态导入。打包后模块被内联进主进程 bundle，运行时 `require('./LocalVoiceIpc')`
// 会因文件不存在抛 MODULE_NOT_FOUND，进而中断 moduleInitializer 后续模块初始化。
export { registerLocalVoiceIpc, unregisterLocalVoiceIpc }

/**
 * 初始化本地语音引擎模块
 *
 * 在主进程启动时调用，注册 IPC 处理器。
 */
export function initializeLocalVoiceModule(): void {
  // 注册 IPC 处理器（静态引用，禁止使用 require，避免打包后路径失效）
  registerLocalVoiceIpc()

  console.log('[LocalVoice] 模块初始化完成')
}

/**
 * 清理本地语音引擎模块
 *
 * 在应用退出时调用，释放资源。
 */
export async function cleanupLocalVoiceModule(): Promise<void> {
  try {
    const manager = LocalVoiceManager.getInstance()
    await manager.dispose()

    console.log('[LocalVoice] 模块清理完成')
  } catch (error) {
    console.error('[LocalVoice] 模块清理失败:', error)
  }
}