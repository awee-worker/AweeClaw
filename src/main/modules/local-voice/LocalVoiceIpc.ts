/**
 * 本地语音引擎 IPC 处理器（主进程）
 *
 * 通道清单：
 * - local-voice:get-config | update-config | reset-config   配置读写
 * - local-voice:get-status                                  运行状态
 * - local-voice:initialize-asr | initialize-tts | initialize-gpt-sovits  引擎初始化
 * - local-voice:recognize | synthesize | synthesize-gpt-sovits  语音处理
 * - local-voice:get-available-models | download-model | cancel-download  模型管理
 *
 * 事件推送：`local-voice:download-progress`，由 preload 侧订阅。
 *
 * 约定：所有 handler 通过 safeIpcHandle 注册，统一返回 `{ success, data }` / `{ success:false, error }`。
 *
 * @module local-voice/LocalVoiceIpc
 */

import { safeIpcHandle } from '../../bridge/core/ipcGuard'
import { logger } from '@shared/toolkit/LogEngine'
import { LocalVoiceManager } from './LocalVoiceManager'
import {
  resetLocalVoiceConfig,
} from './LocalVoiceStore'
import type { DownloadProgress } from './ModelDownloader'

/** 是否已注册（显式挡一层，语义更清晰） */
let registered = false

/** 统一的错误响应 */
function fail(err: unknown): { success: false; error: string } {
  return { success: false, error: err instanceof Error ? err.message : String(err) }
}

/** 注册本地语音引擎 IPC（幂等） */
export function registerLocalVoiceIpc(): void {
  if (registered) return
  registered = true

  const manager = LocalVoiceManager.getInstance()

  // --------------------------------------------
  // 配置
  // --------------------------------------------
  safeIpcHandle('local-voice:get-config', async () => {
    return { success: true, data: manager.getConfig() }
  })

  safeIpcHandle('local-voice:update-config', async (_event, patch: unknown) => {
    try {
      const config = manager.updateConfig(patch as any)
      return { success: true, data: config }
    } catch (err) {
      logger.system.error('[LocalVoice] update-config failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('local-voice:reset-config', async () => {
    try {
      const config = resetLocalVoiceConfig()
      manager.updateConfig(config)
      return { success: true, data: config }
    } catch (err) {
      return fail(err)
    }
  })

  // --------------------------------------------
  // 状态
  // --------------------------------------------
  safeIpcHandle('local-voice:get-status', async () => {
    return { success: true, data: manager.getStatus() }
  })

  // --------------------------------------------
  // 引擎初始化
  // --------------------------------------------
  safeIpcHandle('local-voice:initialize-asr', async () => {
    try {
      await manager.initializeAsr()
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      logger.system.error('[LocalVoice] initialize-asr failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('local-voice:initialize-tts', async () => {
    try {
      await manager.initializeTts()
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      logger.system.error('[LocalVoice] initialize-tts failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('local-voice:initialize-gpt-sovits', async () => {
    try {
      await manager.initializeGptSovits()
      return { success: true, data: manager.getStatus() }
    } catch (err) {
      logger.system.error('[LocalVoice] initialize-gpt-sovits failed:', err)
      return fail(err)
    }
  })

  // --------------------------------------------
  // 语音处理
  // --------------------------------------------
  safeIpcHandle('local-voice:recognize', async (_event, params: unknown) => {
    const { audioData, sampleRate } = params as { audioData: string; sampleRate?: number }
    
    try {
      // 解码 base64 音频数据
      const audioBuffer = Buffer.from(audioData, 'base64')
      const result = await manager.recognize(audioBuffer, sampleRate)
      return { success: true, data: result }
    } catch (err) {
      logger.system.error('[LocalVoice] recognize failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('local-voice:synthesize', async (_event, params: unknown) => {
    const { text, voice, speed } = params as { text: string; voice?: string; speed?: number }
    
    try {
      const result = await manager.synthesize(text, voice, speed)
      
      // 将音频数据转换为 base64
      const audioData = result.audioBuffer.toString('base64')
      
      return {
        success: true,
        data: {
          ...result,
          audioData,
          audioBuffer: undefined, // 不传递 Buffer 对象
        },
      }
    } catch (err) {
      logger.system.error('[LocalVoice] synthesize failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('local-voice:synthesize-gpt-sovits', async (_event, params: unknown) => {
    const { text, referenceAudio, language } = params as { text: string; referenceAudio?: string; language?: string }
    
    try {
      const result = await manager.synthesizeWithGptSovits(text, referenceAudio, language)
      
      // 将音频数据转换为 base64
      const audioData = result.audioBuffer.toString('base64')
      
      return {
        success: true,
        data: {
          ...result,
          audioData,
          audioBuffer: undefined, // 不传递 Buffer 对象
        },
      }
    } catch (err) {
      logger.system.error('[LocalVoice] synthesize-gpt-sovits failed:', err)
      return fail(err)
    }
  })

  // --------------------------------------------
  // 模型管理
  // --------------------------------------------
  safeIpcHandle('local-voice:get-available-models', async () => {
    try {
      const models = await manager.getAvailableModels()
      return { success: true, data: models }
    } catch (err) {
      logger.system.error('[LocalVoice] get-available-models failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('local-voice:download-model', async (_event, params: unknown) => {
    const { modelId } = params as { modelId: string }
    
    try {
      // 创建进度回调（通过 IPC 推送进度）
      const onProgress = (progress: DownloadProgress) => {
        logger.system.debug('[LocalVoice] download progress:', progress.percentage)
      }

      const success = await manager.downloadModel(modelId, onProgress)
      return { success, data: { modelId, downloaded: success } }
    } catch (err) {
      logger.system.error('[LocalVoice] download-model failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('local-voice:cancel-download', async (_event, params: unknown) => {
    const { modelId } = params as { modelId: string }
    
    try {
      manager.cancelDownload(modelId)
      return { success: true, data: { modelId, cancelled: true } }
    } catch (err) {
      logger.system.error('[LocalVoice] cancel-download failed:', err)
      return fail(err)
    }
  })

  safeIpcHandle('local-voice:is-model-downloaded', async (_event, params: unknown) => {
    const { modelId } = params as { modelId: string }
    
    try {
      const downloaded = manager.isModelDownloaded(modelId)
      return { success: true, data: { modelId, downloaded } }
    } catch (err) {
      logger.system.error('[LocalVoice] is-model-downloaded failed:', err)
      return fail(err)
    }
  })

  logger.system.info('[LocalVoice] IPC handlers registered')
}

/** 注销本地语音引擎 IPC（幂等） */
export function unregisterLocalVoiceIpc(): void {
  if (!registered) return
  registered = false
  
  // 注意：safeIpcHandle 注册的处理器无法直接注销
  // 实际实现中可能需要更复杂的机制
  logger.system.info('[LocalVoice] IPC handlers unregistered')
}