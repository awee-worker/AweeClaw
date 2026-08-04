/**
 * 会议纪要 STT 转写 hook
 *
 * 职责：
 * - 封装 voiceApi.speechToText，提供会议纪要专用的转写接口
 * - 复用云端模式（后端代理）或自定义模式（直连 STT Provider）
 * - 支持超时控制、并发限流（避免段太多时打爆 STT 服务）
 *
 * 不维护状态：转写结果是异步返回的，由调用方（useMeetingNotesRecorder）写入 store。
 *
 * 调用方式：
 *   const transcribe = useTranscription()
 *   const result = await transcribe(audioBlob, { language: 'auto' })
 */

import { useCallback, useRef } from 'react'
import { logger } from '@shared/toolkit/LogEngine'
import { voiceApi, type SttResult } from '../../services/voiceApi'
import { convertBlobToWav } from '../../utils/audioConverter'

export interface TranscribeOptions {
  /** 源语言提示（'auto' 让 STT 自动检测） */
  language?: string
  /** 单段超时（ms），默认 30s */
  timeoutMs?: number
}

export interface TranscribeResult {
  /** 是否成功 */
  success: boolean
  /** 转写文本 */
  text: string
  /** 检测到的源语言 */
  detectedLang: string
  /** 错误信息 */
  error?: string
}

// 默认单段超时
const DEFAULT_TIMEOUT_MS = 30000

export function useTranscription() {
  // 并发控制：最多 2 个并发 STT 请求（避免打爆服务）
  const inflightCountRef = useRef(0)
  const maxConcurrent = 2

  const transcribe = useCallback(
    async (audioBlob: Blob, options: TranscribeOptions = {}): Promise<TranscribeResult> => {
      const { language = 'auto', timeoutMs = DEFAULT_TIMEOUT_MS } = options

      // 并发限流：超过最大并发则等待
      while (inflightCountRef.current >= maxConcurrent) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      inflightCountRef.current++

      try {
        // 转换为 WAV（Whisper 兼容性更好）
        let wavBlob: Blob
        try {
          wavBlob = await convertBlobToWav(audioBlob)
        } catch (err) {
          logger.system.warn('[Transcription] WAV conversion failed, use original blob:', err)
          wavBlob = audioBlob
        }

        // 带超时的 STT 调用
        const result = await Promise.race([
          voiceApi.speechToText(wavBlob, { language, noAuthRetry: false }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`STT 超时（${timeoutMs}ms）`)), timeoutMs),
          ),
        ])

        const sttResult = result as SttResult
        return {
          success: true,
          text: sttResult.text || '',
          detectedLang: sttResult.language || 'auto',
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        logger.system.error('[Transcription] STT failed:', err)
        return {
          success: false,
          text: '',
          detectedLang: 'auto',
          error: msg,
        }
      } finally {
        inflightCountRef.current--
      }
    },
    [],
  )

  return { transcribe }
}
